import Stance from "./enums/Stance";
import WZFiles from "./enums/WZFiles";
import PLAY_AUDIO from "../Audio/PlayAudio";
import WZManager from "../wz-utils/WZManager";

export enum WeaponType {
  SWORD = 1302,
  AXE = 1312,
  MACE = 1322,
  DAGGER = 1332,
  WAND = 1372,
  STAFF = 1382,
  SWORD_2H = 1402,
  AXE_2H = 1412,
  MACE_2H = 1422,
  SPEAR = 1432,
  POLEARM = 1442,
  BOW = 1452,
  CROSSBOW = 1462,
  CLAW = 1472,
  KNUCKLER = 1482,
  PISTOL = 1492,
}

export enum EquipType {
  UNDEFINED = -1,
  ACCESSORY = 0,
  CAP = 100,
  CAPE = 110,
  COAT = 104,
  FACE = 2,
  GLOVES = 108,
  HAIR = 3,
  LONGCOAT = 105,
  PANTS = 106,
  PET_EQUIP = 180,
  PET_EQUIP_FIELD = 181,
  PET_EQUIP_LABEL = 182,
  PET_EQUIP_QUOTE = 183,
  RING = 111,
  SHIELD = 109,
  SHOES = 107,
  TAMING = 190,
  TAMING_SADDLE = 191,
  SWORD = 1302,
  AXE = 1312,
  MACE = 1322,
  DAGGER = 1332,
  WAND = 1372,
  STAFF = 1382,
  SWORD_2H = 1402,
  AXE_2H = 1412,
  MACE_2H = 1422,
  SPEAR = 1432,
  POLEARM = 1442,
  BOW = 1452,
  CROSSBOW = 1462,
  CLAW = 1472,
  KNUCKLER = 1482,
  PISTOL = 1492,
}

const EquipTypeToSoundName: Record<WeaponType, string> = {
  [WeaponType.SWORD]: "swordL",
  [WeaponType.AXE]: "mace",
  [WeaponType.MACE]: "mace",
  [WeaponType.DAGGER]: "swordS",
  [WeaponType.WAND]: "swordS",
  [WeaponType.STAFF]: "poleArm",
  [WeaponType.SWORD_2H]: "swordL",
  [WeaponType.AXE_2H]: "mac",
  [WeaponType.MACE_2H]: "mac",
  [WeaponType.SPEAR]: "spear",
  [WeaponType.POLEARM]: "poleArm",
  [WeaponType.BOW]: "bow",
  [WeaponType.CROSSBOW]: "cBow",
  [WeaponType.CLAW]: "tGlove",
  [WeaponType.KNUCKLER]: "knuckle",
  [WeaponType.PISTOL]: "gun",
};

export interface WeaponConfig {
  isRanged: boolean;
  meleeRange: number;
  stances: {
    melee: Stance[];
    ranged: Stance[];
  };
}

const WEAPON_CONFIG: Record<number, WeaponConfig> = {
  [WeaponType.SWORD]: {
    isRanged: false,
    meleeRange: 80,
    stances: {
      melee: [Stance.stabO1, Stance.stabO2, Stance.swingO1, Stance.swingO2, Stance.swingO3],
      ranged: [],
    },
  },
  [WeaponType.AXE]: {
    isRanged: false,
    meleeRange: 80,
    stances: {
      melee: [Stance.stabO1, Stance.stabO2, Stance.swingO1, Stance.swingO2, Stance.swingO3],
      ranged: [],
    },
  },
  [WeaponType.MACE]: {
    isRanged: false,
    meleeRange: 80,
    stances: {
      melee: [Stance.stabO1, Stance.stabO2, Stance.swingO1, Stance.swingO2, Stance.swingO3],
      ranged: [],
    },
  },
  [WeaponType.DAGGER]: {
    isRanged: false,
    meleeRange: 60,
    stances: {
      melee: [Stance.stabO1, Stance.stabO2, Stance.swingO1, Stance.swingO2, Stance.swingO3],
      ranged: [],
    },
  },
  [WeaponType.WAND]: {
    isRanged: false,
    meleeRange: 70,
    stances: {
      melee: [Stance.swingO1, Stance.swingO2, Stance.swingO3, Stance.stabO1, Stance.stabO2],
      ranged: [],
    },
  },
  [WeaponType.STAFF]: {
    isRanged: false,
    meleeRange: 70,
    stances: {
      // Staff WZ sprites have no stabO2
      melee: [Stance.swingO1, Stance.swingO2, Stance.swingO3, Stance.stabO1],
      ranged: [],
    },
  },
  [WeaponType.SWORD_2H]: {
    isRanged: false,
    meleeRange: 90,
    stances: {
      // 2H blunt/blade weapons carry swingT frames, not swingO
      melee: [Stance.stabO1, Stance.stabO2, Stance.swingT1, Stance.swingT2, Stance.swingT3],
      ranged: [],
    },
  },
  [WeaponType.AXE_2H]: {
    isRanged: false,
    meleeRange: 90,
    stances: {
      melee: [Stance.stabO1, Stance.stabO2, Stance.swingT1, Stance.swingT2, Stance.swingT3],
      ranged: [],
    },
  },
  [WeaponType.MACE_2H]: {
    isRanged: false,
    meleeRange: 90,
    stances: {
      melee: [Stance.stabO1, Stance.stabO2, Stance.swingT1, Stance.swingT2, Stance.swingT3],
      ranged: [],
    },
  },
  [WeaponType.SPEAR]: {
    isRanged: false,
    meleeRange: 100,
    stances: {
      // Spears/polearms only have stabT/swingP/swingT2 frames; spears favor stabs
      melee: [Stance.stabT1, Stance.stabT2, Stance.swingP1],
      ranged: [],
    },
  },
  [WeaponType.POLEARM]: {
    isRanged: false,
    meleeRange: 100,
    stances: {
      melee: [Stance.swingT2, Stance.swingP1, Stance.swingP2, Stance.stabT1, Stance.stabT2],
      ranged: [],
    },
  },
  [WeaponType.BOW]: {
    isRanged: true,
    meleeRange: 80,
    stances: {
      melee: [Stance.swingT1, Stance.swingT3],
      ranged: [Stance.shoot1],
    },
  },
  [WeaponType.CROSSBOW]: {
    isRanged: true,
    meleeRange: 80,
    stances: {
      // Crossbow WZ sprites: swingT1/stabT1 melee, shoot2 (not shoot1) firing
      melee: [Stance.swingT1, Stance.stabT1],
      ranged: [Stance.shoot2],
    },
  },
  [WeaponType.CLAW]: {
    isRanged: true,
    meleeRange: 60,
    stances: {
      // Claw WZ sprites only have swingO/stabO frames — the v83 star throw
      // is the one-hand flick (swingO1), there is no shoot stance for claws
      melee: [Stance.stabO1, Stance.stabO2, Stance.swingO1, Stance.swingO2],
      ranged: [Stance.swingO1],
    },
  },
  [WeaponType.KNUCKLER]: {
    isRanged: false,
    meleeRange: 75,
    stances: {
      melee: [Stance.swingP1, Stance.swingP2],
      ranged: [],
    },
  },
  [WeaponType.PISTOL]: {
    isRanged: true,
    meleeRange: 75,
    stances: {
      melee: [Stance.swingP1, Stance.swingP2],
      ranged: [Stance.shoot1],
    },
  },
};

export function getWeaponConfig(weaponType: number): WeaponConfig | undefined {
  return WEAPON_CONFIG[weaponType];
}

// Default projectile item IDs per ranged weapon type (until inventory consumption is implemented)
export const DEFAULT_PROJECTILE_ID: Partial<Record<number, number>> = {
  [WeaponType.BOW]: 2060000,      // arrow
  [WeaponType.CROSSBOW]: 2060000, // arrow
  [WeaponType.CLAW]: 2070000,     // throwing star
  [WeaponType.PISTOL]: 2330000,   // bullet
};

const map = new Map();
console.log(Object.keys(EquipType));
for (const key in EquipType) {
  if (Object.prototype.hasOwnProperty.call(EquipType, key)) {
    map.set(EquipType[key], key);
  }
}

export const playAudioForAttackByWeaponType = async function (
  equipType: WeaponType
) {
  // there is sometimes /Attack and /Attack2
  // probebly the second one is for close range attack
  const jumpNode: any = await WZManager.get(
    `${WZFiles.Sound}/Weapon.img/${EquipTypeToSoundName[equipType]}/Attack`
  );
  const jumpAudio = jumpNode.nGetAudio();
  PLAY_AUDIO(jumpAudio);
};

const getEquipTypeById = function (itemid: number) {
  let ret;
  const val = Math.floor(itemid / 100000);
  if (val === 13 || val === 14) {
    // ret = map.get(Math.floor(itemid / 1000));
    ret = Math.floor(itemid / 1000);
  } else {
    // ret = map.get(Math.floor(itemid / 10000));
    ret = Math.floor(itemid / 10000);
  }

  return ret || EquipType.UNDEFINED;
};

export default getEquipTypeById;
