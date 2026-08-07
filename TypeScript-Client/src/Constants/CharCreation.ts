import { JobId } from './Jobs';

/**
 * Character creation data for the three races the v83 login screen offers.
 *
 * The appearance lists come from `Etc.wz/MakeCharInfo.img`, which splits them
 * into three sets: `Info` (Explorers), `PremiumChar*` (Knights of Cygnus) and
 * `OrientChar*` (Aran). Premium is identical to Info in v83 — a new Cygnus
 * Knight wears the same beginner clothes an Explorer does — so the two share
 * one set here. Only Aran differs: its own faces plus the fixed Rien outfit
 * and a beginner polearm, with no alternatives to cycle through.
 */
export type CreationRace = 'normal' | 'knight' | 'aran';

export interface RaceAppearanceSet {
  faces: number[];
  hairs: number[];
  tops: number[];
  bottoms: number[];
  shoes: number[];
  weapons: number[];
}

export interface RaceCreationInfo {
  /**
   * Job the character is created as: Beginner, Noblesse or Legend. This is all
   * the client sends — the server maps the job to its start map itself, so a
   * client can't ask to be born somewhere it shouldn't be.
   */
  jobId: number;
  male: RaceAppearanceSet;
  female: RaceAppearanceSet;
}

/**
 * Hair and skin palettes are shared by every race. MakeCharInfo lists only
 * four of each, but this screen has always offered the full palette and
 * narrowing it now would take options away from Explorer creation, which
 * works today.
 */
export const HAIR_COLORS = [0, 1, 2, 3, 4, 5, 6, 7];
export const SKIN_COLORS = [0, 1, 2, 3, 4, 5, 9];

const EXPLORER_MALE: RaceAppearanceSet = {
  faces: [20000, 20001, 20002],
  hairs: [30030, 30020, 30000],
  tops: [1040002, 1040006, 1040010],
  bottoms: [1060002, 1060006],
  shoes: [1072001, 1072005, 1072037, 1072038],
  weapons: [1302000, 1322005, 1312004],
};

const EXPLORER_FEMALE: RaceAppearanceSet = {
  faces: [21000, 21001, 21002],
  hairs: [31000, 31010, 31020],
  tops: [1041002, 1041006, 1041010, 1041011],
  bottoms: [1061002, 1061008],
  shoes: [1072001, 1072005, 1072037, 1072038],
  weapons: [1302000, 1322005, 1312004],
};

// Aran wears the same outfit whichever gender it is — MakeCharInfo lists a
// single option per slot, so those rows have nothing to cycle through.
const ARAN_OUTFIT = {
  tops: [1042167],
  bottoms: [1062115],
  shoes: [1072383],
  weapons: [1442079],
};

const ARAN_MALE: RaceAppearanceSet = {
  faces: [20100, 20401, 20402],
  hairs: [30030, 30020, 30000],
  ...ARAN_OUTFIT,
};

const ARAN_FEMALE: RaceAppearanceSet = {
  faces: [21700, 21201, 21002],
  hairs: [31000, 31040, 31050],
  ...ARAN_OUTFIT,
};

export const RACE_CREATION: Record<CreationRace, RaceCreationInfo> = {
  normal: { jobId: JobId.Beginner, male: EXPLORER_MALE, female: EXPLORER_FEMALE },
  knight: { jobId: JobId.Noblesse, male: EXPLORER_MALE, female: EXPLORER_FEMALE },
  aran: { jobId: JobId.Legend, male: ARAN_MALE, female: ARAN_FEMALE },
};

export function getRaceInfo(race: string): RaceCreationInfo {
  return RACE_CREATION[race as CreationRace] || RACE_CREATION.normal;
}

/** Appearance options for a race at a given gender (0 = male, 1 = female) */
export function getRaceAppearance(race: string, gender: number): RaceAppearanceSet {
  const info = getRaceInfo(race);
  return gender === 1 ? info.female : info.male;
}

/**
 * The create-character screen's working state: every list it can cycle plus
 * the row currently selected in each. The index signature is what lets the
 * screen drive its rows from a table of key names.
 */
export interface CharCreationOptions {
  faces: number[];
  hairs: number[];       // base hair IDs (style)
  hairColors: number[];  // color offsets (0-7)
  skinColors: number[];
  tops: number[];
  bottoms: number[];
  shoes: number[];
  weapons: number[];
  faceIndex: number;
  hairIndex: number;
  hairColorIndex: number;
  skinIndex: number;
  topIndex: number;
  bottomIndex: number;
  shoesIndex: number;
  weaponIndex: number;
  gender: number;
  [key: string]: number | number[];
}

/** Fresh option state for a race/gender, with every row back at its first entry */
export function makeRaceOptions(race: string, gender: number): CharCreationOptions {
  const set = getRaceAppearance(race, gender);
  return {
    faces: set.faces,
    hairs: set.hairs,
    hairColors: HAIR_COLORS,
    skinColors: SKIN_COLORS,
    tops: set.tops,
    bottoms: set.bottoms,
    shoes: set.shoes,
    weapons: set.weapons,
    faceIndex: 0,
    hairIndex: 0,
    hairColorIndex: 0,
    skinIndex: 0,
    topIndex: 0,
    bottomIndex: 0,
    shoesIndex: 0,
    weaponIndex: 0,
    gender,
  };
}
