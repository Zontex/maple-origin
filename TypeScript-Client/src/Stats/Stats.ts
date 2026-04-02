import { AttackType } from "../Constants/AttackType";
import { WeaponType } from "../Constants/EquipType";
import { JobsMainType, JobsType, getJobCategory, getJobNameById } from "../Constants/Jobs";

export class DamageRange {
  min: number;
  max: number;

  constructor(min: number, max: number) {
    this.min = min;
    this.max = max;
  }
}

const defaultCritChance = 0.05;
const defaultCritDamagePercent = 1.0;

// todo
// 1. this not considering skills yet
class Stats {
  opts: any;
  str: number;
  dex: number;
  int: number;
  luk: number;
  maxHp: number;
  maxMp: number;
  jobId: number;          // Canonical numeric job ID (v83: 0=Beginner, 100=Warrior, etc.)
  jobType: JobsType;      // Derived from jobId — used by damage calc string comparisons
  level: number;
  job: string;            // Derived display name from jobId
  abilityPoints: number;
  criticalChance: number;
  criticalDamage: number;

  constructor(opts: any) {
    this.str = opts.str || 0;
    this.dex = opts.dex || 0;
    this.int = opts.int || 0;
    this.luk = opts.luk || 0;
    this.maxHp = opts.maxHp || 0;
    this.maxMp = opts.maxMp || 0;
    this.jobId = opts.jobId ?? 0;
    this.jobType = opts.jobType || getJobCategory(this.jobId);
    this.level = opts.level || 1;
    this.job = opts.job || getJobNameById(this.jobId);
    this.abilityPoints = opts.abilityPoints || 0;

    // need to add skills to this
    this.criticalChance = defaultCritChance;
    this.criticalDamage = defaultCritDamagePercent;
  }

  setJobId(id: number) {
    this.jobId = id;
    this.jobType = getJobCategory(id);
    this.job = getJobNameById(id);
  }

  addAbilityPoints = (amount = 5) => {
    this.abilityPoints += amount;
  };

  addStr = (amount = 1) => {
    if (this.abilityPoints < amount) {
      return;
    }

    this.str += amount;
    this.abilityPoints -= amount;
  };

  addDex = (amount = 1) => {
    if (this.abilityPoints < amount) {
      return;
    }

    this.dex += amount;
    this.abilityPoints -= amount;
  };

  addInt = (amount = 1) => {
    if (this.abilityPoints < amount) {
      return;
    }

    this.int += amount;
    this.abilityPoints -= amount;
  };

  addLuk = (amount = 1) => {
    if (this.abilityPoints < amount) {
      return;
    }

    this.luk += amount;
    this.abilityPoints -= amount;
  };

  getWeaponAttack(equips: any[]) {
    let weaponAttack = 0;
    equips.forEach((equipe) => {
      if (equipe.info.incPAD != null) {
        weaponAttack += equipe.info.incPAD.nValue;
      }
      if (equipe.info.attack != null) {
        weaponAttack += equipe.info.attack.nValue;
      }
    });

    return weaponAttack;
  }

  getAttackRange(
    equips: any[],
    weaponType: WeaponType,
    attackType: AttackType
  ) {
    let primary = 0;
    let secondary = 0;

    const skillMastery = 0.1; // Adjust this value as needed
    const weaponAttack = this.getWeaponAttack(equips);

    switch (weaponType) {
      case WeaponType.SWORD:
        primary = this.str * 4.0;
        secondary = this.dex;
        break;
      case WeaponType.AXE:
      case WeaponType.MACE:
        if (attackType === AttackType.Swing) {
          primary = this.str * 4.4;
        } else {
          primary = this.str * 3.2;
        }
        secondary = this.dex;
        break;
      case WeaponType.WAND:
      case WeaponType.STAFF:
        primary = this.str * 4.0;
        secondary = this.dex;
        break;
      case WeaponType.SWORD_2H:
        primary = this.str * 4.6;
        secondary = this.dex;
        break;
      case WeaponType.AXE_2H:
      case WeaponType.MACE_2H:
        if (attackType === AttackType.Swing) {
          primary = this.str * 4.8;
        } else {
          primary = this.str * 3.4;
        }
        secondary = this.dex;
        break;
      case WeaponType.SPEAR:
        if (attackType === AttackType.Stab) {
          primary = this.str * 5.0;
        } else {
          primary = this.str * 3.0;
        }
        secondary = this.dex;
        break;
      case WeaponType.POLEARM:
        if (attackType === AttackType.Swing) {
          primary = this.str * 5.0;
        } else {
          primary = this.str * 3.0;
        }
        secondary = this.dex;
        break;
      case WeaponType.DAGGER:
        if (this.jobType === JobsType.Thief) {
          primary = this.luk * 3.6;
          secondary = this.str + this.dex;
        } else {
          primary = this.str * 4.0;
          secondary = this.dex;
        }
        break;
      case WeaponType.BOW:
        primary = this.dex * 3.4;
        secondary = this.str;
        break;
      case WeaponType.CROSSBOW:
        primary = this.dex * 3.6;
        secondary = this.str;
        break;
      case WeaponType.CLAW:
        primary = this.luk * 3.6;
        secondary = this.str + this.dex;
        break;
      case WeaponType.KNUCKLER:
        primary = this.str * 4.8;
        secondary = this.dex;
        break;
      case WeaponType.PISTOL:
        primary = this.dex * 3.6;
        secondary = this.str;
        break;
    }

    // console.log(primary, secondary, weaponAttack, skillMastery);

    const maxDamage = Math.floor(((primary + secondary) * weaponAttack) / 100);
    const minDamage = Math.floor(
      ((primary * 0.9 * skillMastery + secondary) * weaponAttack) / 100
    );

    // console.log("maxDamage: " + maxDamage);
    // console.log("minDamage: " + minDamage);
    return new DamageRange(minDamage, maxDamage);
  }

  getRandomAttack(
    equips: any[],
    weaponType: WeaponType,
    attackType: AttackType
  ) {
    const damageRange = this.getAttackRange(equips, weaponType, attackType);
    const minDamage = damageRange.min;
    const maxDamage = damageRange.max;
    const chosenAttack = Math.floor(
      Math.random() * (maxDamage - minDamage + 1) + minDamage
    );
    return chosenAttack;
  }

  static getRandomAttackDamageFromAttackRange(damageRange: DamageRange) {
    const minDamage = damageRange.min;
    const maxDamage = damageRange.max;
    const chosenAttack = Math.floor(
      Math.random() * (maxDamage - minDamage + 1) + minDamage
    );
    return chosenAttack;
  }

  getAccuracy() {
    if (
      [
        JobsMainType.Magician,
        JobsMainType.Begginer,
        JobsMainType.Warrior,
      ].includes(this.jobType)
    ) {
      return this.dex * 0.8 + this.luk * 0.5;
    } else if (this.jobType === JobsType.Brawler) {
      return this.dex * 0.9 + this.luk * 0.3;
    } else if (
      [JobsMainType.Archer, JobsMainType.Thief, JobsMainType.Pirate].includes(
        this.jobType
      )
    ) {
      return Math.floor(this.dex * 0.6 + this.luk * 0.3);
    } else {
      return 0; // or throw an error
    }
  }

  getAvoidability() {
    let avoidability = 0;
    if (this.jobType === JobsMainType.Brawler) {
      avoidability = this.dex * 1.5 + this.luk * 0.5;
    } else {
      // All classes including Beginner: v83 base avoidability
      avoidability = this.dex * 0.25 + this.luk * 0.5;
    }

    return Math.floor(avoidability);
  }

  getHands() {
    return this.dex + this.int + this.luk;
  }

  getWeaponDefense(equips: any[]) {
    // calculate weapon defense from all equipped items
    let weaponDef = 0;
    equips.forEach((equipe) => {
      if (equipe.info.incPDD != null) {
        weaponDef += equipe.info.incPDD.nValue;
      }
    });

    return weaponDef;
  }

  getMagicDefense(equips: any[]) {
    // probebly some of all quipped items with min of 4
    // still can research this
    const minMagicDefense = 4;
    // calculate weapon defense from all equipped items
    let magicDef = minMagicDefense;
    equips.forEach((equipe) => {
      if (equipe.info.incMDD != null) {
        magicDef += equipe.info.incMDD.nValue;
      }
    });

    return magicDef;
  }

  getAttackDamageRangeAfterMonsterDefense(
    damageRange: DamageRange,
    monsterWeaponDef: number,
    monsterLevel: number
  ) {
    const levelDifference = Math.max(0, monsterLevel - this.level);
    const maxDamage = Math.floor(
      damageRange.max * (1 - 0.01 * levelDifference) - monsterWeaponDef * 0.5
    );
    const minDamage = Math.floor(
      damageRange.min * (1 - 0.01 * levelDifference) - monsterWeaponDef * 0.6
    );

    return new DamageRange(minDamage, maxDamage);
  }

  getMagicDamageAfterMonsterDefense(
    damageRange: DamageRange,
    monsterMagicDef: number,
    monsterLevel: number
  ) {
    const levelDifference = Math.max(0, monsterLevel - this.level);

    const maxDamage = Math.floor(
      damageRange.max - monsterMagicDef * 0.5 * (1 + 0.01 * levelDifference)
    );
    const minDamage = Math.floor(
      damageRange.max - monsterMagicDef * 0.6 * (1 + 0.01 * levelDifference)
    );

    // console.log("maxDamage (with defense): " + maxDamage);
    // console.log("minDamage (with defense): " + minDamage);

    return new DamageRange(minDamage, maxDamage);
  }

  // monster.eva = monsterAvoidability
  // between 1 - 0
  getChanceToHitMonster(monsterLevel: number, monsterAvoidability: number) {
    // v83: hitRate = accuracy / ((1.84 + 0.07 * levelDiff) * mobAvoid)
    if (monsterAvoidability <= 0) return 1;
    const levelDifference = Math.max(0, monsterLevel - this.level);
    const ChancetoHit =
      this.getAccuracy() /
        ((1.84 + 0.07 * levelDifference) * monsterAvoidability);

    return Math.max(0, Math.min(1, ChancetoHit));
  }

  getRandomIsMiss(monsterLevel: number, monsterAvoidability: number) {
    const chanceToHit = this.getChanceToHitMonster(
      monsterLevel,
      monsterAvoidability
    );
    const random = Math.random();
    if (random < chanceToHit) {
      return false;
    } else {
      return true;
    }
  }

  // this is only for touch damage
  getChanceToGetMonsterTouchMiss(
    monsterLevel: number,
    monsterAccuracy: number
  ) {
    // v83 hit/miss: level gap heavily penalizes low-level mobs hitting higher-level players
    const levelGap = Math.max(0, this.level - monsterLevel);
    const playerAvoid = this.getAvoidability();
    // Each level of gap adds ~5% miss chance; avoid vs acc adds additional miss
    const levelMissBonus = levelGap * 5;
    const avoidMissBonus = Math.max(0, playerAvoid - monsterAccuracy) * 0.5;
    const chanceToMiss = Math.min(95, levelMissBonus + avoidMissBonus) / 100;
    return chanceToMiss;
  }

  // this is only for touch damage
  getChanceToGetMonsterMagicMiss(
    monsterLevel: number,
    monsterAccuracy: number
  ) {
    const levelDifference = Math.max(0, monsterLevel - this.level);
    const ajustedAvoidability = this.getAvoidability() - levelDifference / 2;
    const ChanceToMiss = 10 / 9 - monsterAccuracy / (0.9 * ajustedAvoidability);

    if (ChanceToMiss > 1) {
      return 1;
    } else if (ChanceToMiss < 0) {
      return 0;
    } else {
      return ChanceToMiss;
    }
  }

  getRandomMonsterTouchMiss(monsterLevel: number, monsterAccuracy: number) {
    const chanceToMiss = this.getChanceToGetMonsterTouchMiss(
      monsterLevel,
      monsterAccuracy
    );
    const random = Math.random();
    return random < chanceToMiss;
  }

  getRandomMonsterMagicMiss(monsterLevel: number, monsterAccuracy: number) {
    const chanceToMiss = this.getChanceToGetMonsterMagicMiss(
      monsterLevel,
      monsterAccuracy
    );
    const random = Math.random();
    return random < chanceToMiss;
  }

  getSpeedPrecetnage(equips: any[]) {
    let speed = 100;
    equips.forEach((equipe) => {
      if (equipe.info.incSpeed != null) {
        speed += equipe.info.incSpeed.nValue;
      }
    });

    return speed;
  }

  // did not test it yet
  getJumpPrecetnage(equips: any[]) {
    // console.log("method getJumpPrecetnage is not tested yet!!!!!!!");
    let jump = 100;
    equips.forEach((equipe) => {
      if (equipe.info.incJump != null) {
        jump += equipe.info.incJump.nValue;
      }
    });

    return jump;
  }
}

export default Stats;
