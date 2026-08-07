export enum JobsType {
  Archer = "Archer",
  Hunter = "Hunter",
  Ranger = "Ranger",
  Bowmaster = "Bowmaster",
  Crossbowman = "Crossbowman",
  Sniper = "Sniper",
  Marksman = "Marksman",
  Magician = "Magician",
  FirePoisonWizard = "Fire/Poison Wizard",
  IceLightningWizard = "Ice/Lightning Wizard",
  Cleric = "Cleric",
  FirePoisonMage = "Fire/Poison Mage",
  IceLightningMage = "Ice/Lightning Mage",
  Priest = "Priest",
  FirePoisonArchMage = "Fire/Poison Arch Mage",
  IceLightningArchMage = "Ice/Lightning Arch Mage",
  Bishop = "Bishop",
  Rogue = "Rogue",
  Brawler = "Brawler",
  Gunslinger = "Gunslinger",
  Marauder = "Marauder",
  Outlaw = "Outlaw",
  Buccaneer = "Buccaneer",
  Corsair = "Corsair",
  Thief = "Thief",
  Assassin = "Assassin",
  Bandit = "Bandit",
  Hermit = "Hermit",
  ChiefBandit = "Chief Bandit",
  NightLord = "Night Lord",
  Shadower = "Shadower",
  Swordman = "Swordman",
  Fighter = "Fighter",
  Page = "Page",
  Spearman = "Spearman",
  Crusader = "Crusader",
  WhiteKnight = "White Knight",
  DragonKnight = "Dragon Knight",
  Hero = "Hero",
  Paladin = "Paladin",
  DarkKnight = "Dark Knight",

  Begginer = "Begginer",
}

export const JobsMainType: any = {
  [JobsType.Archer]: JobsType.Archer,
  [JobsType.Magician]: JobsType.Magician,
  // [JobsType.Pirate]: JobsType.Pirate,
  [JobsType.Thief]: JobsType.Thief,
  // [JobsType.Warrior]: JobsType.Warrior,
  [JobsType.Begginer]: JobsType.Begginer,
};

// ─── Numeric Job IDs (v83) ───────────────────────────────────────────
// These are the canonical job IDs used by WZ data, quest requirements,
// and server protocol. The string-based JobsType enum above is kept
// for backward compatibility with damage calculation code.

export enum JobId {
  // Explorers
  Beginner = 0,
  Warrior = 100, Fighter = 110, Crusader = 111, Hero = 112,
  Page = 120, WhiteKnight = 121, Paladin = 122,
  Spearman = 130, DragonKnight = 131, DarkKnight = 132,
  Magician = 200, FPWizard = 210, FPMage = 211, FPArchMage = 212,
  ILWizard = 220, ILMage = 221, ILArchMage = 222,
  Cleric = 230, Priest = 231, Bishop = 232,
  Bowman = 300, Hunter = 310, Ranger = 311, Bowmaster = 312,
  Crossbowman = 320, Sniper = 321, Marksman = 322,
  Thief = 400, Assassin = 410, Hermit = 411, NightLord = 412,
  Bandit = 420, ChiefBandit = 421, Shadower = 422,
  Pirate = 500, Brawler = 510, Marauder = 511, Buccaneer = 512,
  Gunslinger = 520, Outlaw = 521, Corsair = 522,
  // GM
  MapleLeafBrigadier = 800, GM = 900, SuperGM = 910,
  // Cygnus Knights
  Noblesse = 1000,
  DawnWarrior1 = 1100, DawnWarrior2 = 1110, DawnWarrior3 = 1111, DawnWarrior4 = 1112,
  BlazeWizard1 = 1200, BlazeWizard2 = 1210, BlazeWizard3 = 1211, BlazeWizard4 = 1212,
  WindArcher1 = 1300, WindArcher2 = 1310, WindArcher3 = 1311, WindArcher4 = 1312,
  NightWalker1 = 1400, NightWalker2 = 1410, NightWalker3 = 1411, NightWalker4 = 1412,
  ThunderBreaker1 = 1500, ThunderBreaker2 = 1510, ThunderBreaker3 = 1511, ThunderBreaker4 = 1512,
  // Aran
  Legend = 2000, Aran1 = 2100, Aran2 = 2110, Aran3 = 2111, Aran4 = 2112,
  // Evan
  Evan = 2001, Evan1 = 2200, Evan2 = 2210, Evan3 = 2211, Evan4 = 2212,
  Evan5 = 2213, Evan6 = 2214, Evan7 = 2215, Evan8 = 2216, Evan9 = 2217, Evan10 = 2218,
}

export const JOB_ID_TO_NAME: Record<number, string> = {
  [JobId.Beginner]: 'Beginner',
  [JobId.Warrior]: 'Warrior', [JobId.Fighter]: 'Fighter', [JobId.Crusader]: 'Crusader', [JobId.Hero]: 'Hero',
  [JobId.Page]: 'Page', [JobId.WhiteKnight]: 'White Knight', [JobId.Paladin]: 'Paladin',
  [JobId.Spearman]: 'Spearman', [JobId.DragonKnight]: 'Dragon Knight', [JobId.DarkKnight]: 'Dark Knight',
  [JobId.Magician]: 'Magician', [JobId.FPWizard]: 'F/P Wizard', [JobId.FPMage]: 'F/P Mage', [JobId.FPArchMage]: 'F/P Arch Mage',
  [JobId.ILWizard]: 'I/L Wizard', [JobId.ILMage]: 'I/L Mage', [JobId.ILArchMage]: 'I/L Arch Mage',
  [JobId.Cleric]: 'Cleric', [JobId.Priest]: 'Priest', [JobId.Bishop]: 'Bishop',
  [JobId.Bowman]: 'Bowman', [JobId.Hunter]: 'Hunter', [JobId.Ranger]: 'Ranger', [JobId.Bowmaster]: 'Bowmaster',
  [JobId.Crossbowman]: 'Crossbowman', [JobId.Sniper]: 'Sniper', [JobId.Marksman]: 'Marksman',
  [JobId.Thief]: 'Thief', [JobId.Assassin]: 'Assassin', [JobId.Hermit]: 'Hermit', [JobId.NightLord]: 'Night Lord',
  [JobId.Bandit]: 'Bandit', [JobId.ChiefBandit]: 'Chief Bandit', [JobId.Shadower]: 'Shadower',
  [JobId.Pirate]: 'Pirate', [JobId.Brawler]: 'Brawler', [JobId.Marauder]: 'Marauder', [JobId.Buccaneer]: 'Buccaneer',
  [JobId.Gunslinger]: 'Gunslinger', [JobId.Outlaw]: 'Outlaw', [JobId.Corsair]: 'Corsair',
  [JobId.GM]: 'GM', [JobId.SuperGM]: 'Super GM',
  [JobId.Noblesse]: 'Noblesse',
  [JobId.DawnWarrior1]: 'Dawn Warrior', [JobId.DawnWarrior2]: 'Dawn Warrior', [JobId.DawnWarrior3]: 'Dawn Warrior', [JobId.DawnWarrior4]: 'Dawn Warrior',
  [JobId.BlazeWizard1]: 'Blaze Wizard', [JobId.BlazeWizard2]: 'Blaze Wizard', [JobId.BlazeWizard3]: 'Blaze Wizard', [JobId.BlazeWizard4]: 'Blaze Wizard',
  [JobId.WindArcher1]: 'Wind Archer', [JobId.WindArcher2]: 'Wind Archer', [JobId.WindArcher3]: 'Wind Archer', [JobId.WindArcher4]: 'Wind Archer',
  [JobId.NightWalker1]: 'Night Walker', [JobId.NightWalker2]: 'Night Walker', [JobId.NightWalker3]: 'Night Walker', [JobId.NightWalker4]: 'Night Walker',
  [JobId.ThunderBreaker1]: 'Thunder Breaker', [JobId.ThunderBreaker2]: 'Thunder Breaker', [JobId.ThunderBreaker3]: 'Thunder Breaker', [JobId.ThunderBreaker4]: 'Thunder Breaker',
  [JobId.Legend]: 'Legend', [JobId.Aran1]: 'Aran', [JobId.Aran2]: 'Aran', [JobId.Aran3]: 'Aran', [JobId.Aran4]: 'Aran',
  [JobId.Evan]: 'Evan',
};

/** Get display name for a numeric job ID */
export function getJobNameById(jobId: number): string {
  return JOB_ID_TO_NAME[jobId] || 'Beginner';
}

/** Get the job niche (class family): 0=beginner, 1=warrior, 2=mage, 3=bowman, 4=thief, 5=pirate */
export function getJobNiche(jobId: number): number {
  return Math.floor((jobId / 100) % 10);
}

/**
 * Equip reqJob bitmask, indexed by job niche. A beginner has no bit of their
 * own, so any item that names a class at all is closed to them until they
 * advance — which is why 0 has to mean "everyone" rather than "beginner".
 */
export const JOB_REQ_BITS = [0, 1, 2, 4, 8, 16];

/**
 * Whether a job may wear an equip with this `info/reqJob`. Values combine, so
 * a dagger at 9 is warrior|thief and a spear at 13 is warrior|bowman|thief.
 */
export function jobMeetsEquipReq(jobId: number, reqJob: number): boolean {
  if (!reqJob) return true;   // 0 — no class named, anyone may wear it
  if (reqJob < 0) return true; // -1 on a few event weapons: every bit set
  const niche = getJobNiche(jobId);
  if (niche > 5) return true; // GM jobs (800/900) wear anything
  return (reqJob & JOB_REQ_BITS[niche]) !== 0;
}

/** Get job advancement branch: 0=beginner, 1=1st job, 2=2nd, 3=3rd, 4=4th */
export function getJobBranch(jobId: number): number {
  if (jobId % 1000 === 0) return 0; // Beginner/Noblesse/Legend
  if (jobId % 100 === 0) return 1;  // 1st job
  return 2 + (jobId % 10);          // 2nd+ based on last digit
}

/** Check if currentJob is in the same branch as baseJob and at equal or higher advancement */
export function isA(currentJob: number, baseJob: number): boolean {
  const baseBranch = Math.floor(baseJob / 10);
  return (Math.floor(currentJob / 10) === baseBranch && currentJob >= baseJob) ||
    (baseBranch % 10 === 0 && Math.floor(currentJob / 100) === Math.floor(baseJob / 100));
}

/** Map a numeric job ID to the JobsType string enum for damage calc compatibility */
export function getJobCategory(jobId: number): JobsType {
  const niche = getJobNiche(jobId);
  switch (niche) {
    case 1: return JobsType.Swordman;   // Warrior family
    case 2: return JobsType.Magician;
    case 3: return JobsType.Archer;
    case 4: return JobsType.Thief;
    case 5: {
      // Pirate — Brawler vs Gunslinger distinction for accuracy calcs
      const tens = Math.floor((jobId % 100) / 10);
      if (tens === 1) return JobsType.Brawler;
      if (tens === 2) return JobsType.Gunslinger;
      return JobsType.Brawler; // base pirate defaults to brawler
    }
    default: return JobsType.Begginer;
  }
}

export const JobsOrder = {
  [JobsType.Archer]: {
    firstJob: JobsType.Archer,
    secondJobs: [JobsType.Hunter, JobsType.Crossbowman],
    thirdJobs: [JobsType.Ranger, JobsType.Sniper],
    fourthJobs: [JobsType.Bowmaster, JobsType.Marksman],
  },
  [JobsType.Magician]: {
    firstJob: JobsType.Magician,
    secondJobs: [
      JobsType.FirePoisonWizard,
      JobsType.IceLightningWizard,
      JobsType.Cleric,
    ],
    thirdJobs: [
      JobsType.FirePoisonMage,
      JobsType.IceLightningMage,
      JobsType.Priest,
    ],
    fourthJobs: [
      JobsType.FirePoisonArchMage,
      JobsType.IceLightningArchMage,
      JobsType.Bishop,
    ],
  },
  // [JobsType.Pirate]: {
  //   firstJob: JobsType.Rogue,
  //   secondJobs: [JobsType.Brawler, JobsType.Gunslinger],
  //   thirdJobs: [JobsType.Marauder, JobsType.Outlaw],
  //   fourthJobs: [JobsType.Buccaneer, JobsType.Corsair],
  // },
  [JobsType.Thief]: {
    firstJob: JobsType.Thief,
    secondJobs: [JobsType.Assassin, JobsType.Bandit],
    thirdJobs: [JobsType.Hermit, JobsType.ChiefBandit],
    fourthJobs: [JobsType.NightLord, JobsType.Shadower],
  },
  // [JobsType.Warrior]: {
  //   firstJob: JobsType.Swordman,
  //   secondJobs: [JobsType.Fighter, JobsType.Page, JobsType.Spearman],
  //   thirdJobs: [JobsType.Crusader, JobsType.WhiteKnight, JobsType.DragonKnight],
  //   fourthJobs: [JobsType.Hero, JobsType.Paladin, JobsType.DarkKnight],
  // },
};
