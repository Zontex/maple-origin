import { AttackType } from "../Constants/AttackType";
import { WeaponType } from "../Constants/EquipType";
import { JobsType, getJobCategory, getJobNameById } from "../Constants/Jobs";

export class DamageRange {
  min: number;
  max: number;

  constructor(min: number, max: number) {
    this.min = min;
    this.max = max;
  }
}

/** Total SP a Beginner ever earns: 1 each at levels 2, 3 and 4. */
export const BEGINNER_SP_TOTAL = 3;

const defaultCritChance = 0.05;
const defaultCritDamagePercent = 1.0;

// Buff/passive bonus shapes fed into recalcLocalStats
export interface StatBonuses {
  pad: number;
  mad: number;
  pdd: number;
  mdd: number;
  acc: number;
  eva: number;
  speed: number;
  jump: number;
  hyperBodyHpPct?: number;
  hyperBodyMpPct?: number;
}

export interface RecalcSources {
  equips: any[];               // sparse Character.wz node array (slot 10 = weapon)
  equipBonuses?: Record<string, number>[]; // per-instance scroll bonuses (inc* keys)
  baseMaxHp: number;
  baseMaxMp: number;
  buffBonuses: StatBonuses | null;
  passiveBonuses: StatBonuses | null;
  projectileWatk: number;      // equipped ammo incPAD (0 until ammo system lands)
}

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
  /**
   * Skill points, held per job tier rather than in one pool.
   *
   * Keyed by the tier's job id — the same ids SkillData.getJobTierFileIds
   * produces, so 0 / 200 / 210 for an FP wizard. A point earned as a
   * Beginner can only ever buy Beginner skills, and 1st-job points stay
   * spendable in the 1st-job tab after advancing. One shared pool let a
   * newly advanced character spend Beginner points on job skills.
   */
  spByTier: Record<number, number> = {};
  /**
   * False for a character loaded from a pre-split save, where `sp` was one
   * number. The skill window rebuilds the pools once skills are loaded, then
   * sets this — it needs the learned skill levels, which Stats does not have.
   */
  spPoolsRebuilt: boolean = false;
  criticalChance: number;
  criticalDamage: number;

  // Effective ("local") stats = base + equips + buffs + passives.
  // Recomputed by recalcLocalStats on every stat-affecting event; all combat
  // and display formulas read these, never raw base + ad-hoc equip scans.
  localStr: number = 0;
  localDex: number = 0;
  localInt: number = 0;
  localLuk: number = 0;
  localWatk: number = 0;
  localMagic: number = 0;
  localMaxHp: number = 0;
  localMaxMp: number = 0;
  localAcc: number = 0;
  localEva: number = 0;
  localPdd: number = 0;
  localMdd: number = 0;
  localSpeed: number = 100;
  localJump: number = 100;

  // Fired on AP allocation so the owner can recalc without polling
  onStatsChanged: (() => void) | null = null;

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
    // spByTier is authoritative; `sp` is the legacy single number and lands in
    // the current tier so old saves keep their points somewhere spendable.
    if (opts.spByTier && typeof opts.spByTier === "object") {
      this.spByTier = { ...opts.spByTier };
      this.spPoolsRebuilt = true;
    } else {
      this.sp = opts.sp || 0;
    }

    this.criticalChance = defaultCritChance;
    this.criticalDamage = defaultCritDamagePercent;

    // Sensible values before the first recalc (no equips/buffs applied yet)
    this.recalcLocalStats({
      equips: [],
      baseMaxHp: this.maxHp,
      baseMaxMp: this.maxMp,
      buffBonuses: null,
      passiveBonuses: null,
      projectileWatk: 0,
    });
  }

  /**
   * Recompute all local* stats. Mirrors Cosmic's reapplyLocalStats():
   * base -> equip pass -> ammo watk -> buff pass -> passive pass -> derived.
   */
  recalcLocalStats(sources: RecalcSources) {
    const { equips, equipBonuses, baseMaxHp, baseMaxMp, buffBonuses, passiveBonuses, projectileWatk } = sources;

    this.localStr = this.str;
    this.localDex = this.dex;
    this.localInt = this.int;
    this.localLuk = this.luk;
    this.localMaxHp = baseMaxHp;
    this.localMaxMp = baseMaxMp;
    this.localWatk = 0;
    this.localPdd = 0;
    this.localMdd = 0;
    this.localSpeed = 100;
    this.localJump = 100;
    let equipAcc = 0;
    let equipEva = 0;
    let equipMagic = 0;

    for (const equip of equips) {
      const info = equip?.info;
      if (!info) continue;
      this.localStr += info.incSTR?.nValue ?? 0;
      this.localDex += info.incDEX?.nValue ?? 0;
      this.localInt += info.incINT?.nValue ?? 0;
      this.localLuk += info.incLUK?.nValue ?? 0;
      this.localWatk += (info.incPAD?.nValue ?? 0) + (info.attack?.nValue ?? 0);
      equipMagic += info.incMAD?.nValue ?? 0;
      this.localPdd += info.incPDD?.nValue ?? 0;
      this.localMdd += info.incMDD?.nValue ?? 0;
      equipAcc += info.incACC?.nValue ?? 0;
      equipEva += info.incEVA?.nValue ?? 0;
      this.localMaxHp += info.incMHP?.nValue ?? 0;
      this.localMaxMp += info.incMMP?.nValue ?? 0;
      this.localSpeed += info.incSpeed?.nValue ?? 0;
      this.localJump += info.incJump?.nValue ?? 0;
    }

    // Per-instance scroll bonuses on worn equips (same inc* key space)
    if (equipBonuses) {
      for (const bonus of equipBonuses) {
        if (!bonus) continue;
        this.localStr += bonus.incSTR ?? 0;
        this.localDex += bonus.incDEX ?? 0;
        this.localInt += bonus.incINT ?? 0;
        this.localLuk += bonus.incLUK ?? 0;
        this.localWatk += bonus.incPAD ?? 0;
        equipMagic += bonus.incMAD ?? 0;
        this.localPdd += bonus.incPDD ?? 0;
        this.localMdd += bonus.incMDD ?? 0;
        equipAcc += bonus.incACC ?? 0;
        equipEva += bonus.incEVA ?? 0;
        this.localMaxHp += bonus.incMHP ?? 0;
        this.localMaxMp += bonus.incMMP ?? 0;
        this.localSpeed += bonus.incSpeed ?? 0;
        this.localJump += bonus.incJump ?? 0;
      }
    }

    this.localWatk += projectileWatk;

    // Magic = total INT + equip MATK (Cosmic recalcEquipStats), buffs added below
    this.localMagic = this.localInt + equipMagic;

    let buffAcc = 0;
    let buffEva = 0;
    if (buffBonuses) {
      this.localWatk += buffBonuses.pad;
      this.localMagic += buffBonuses.mad;
      this.localPdd += buffBonuses.pdd;
      this.localMdd += buffBonuses.mdd;
      buffAcc = buffBonuses.acc;
      buffEva = buffBonuses.eva;
      this.localSpeed += buffBonuses.speed;
      this.localJump += buffBonuses.jump;
      if (buffBonuses.hyperBodyHpPct) {
        this.localMaxHp += Math.floor((this.localMaxHp * buffBonuses.hyperBodyHpPct) / 100);
      }
      if (buffBonuses.hyperBodyMpPct) {
        this.localMaxMp += Math.floor((this.localMaxMp * buffBonuses.hyperBodyMpPct) / 100);
      }
    }

    let passiveAcc = 0;
    let passiveEva = 0;
    if (passiveBonuses) {
      this.localWatk += passiveBonuses.pad;
      this.localMagic += passiveBonuses.mad;
      this.localPdd += passiveBonuses.pdd;
      this.localMdd += passiveBonuses.mdd;
      passiveAcc = passiveBonuses.acc;
      passiveEva = passiveBonuses.eva;
      this.localSpeed += passiveBonuses.speed;
      this.localJump += passiveBonuses.jump;
    }

    // v83 base accuracy/avoidability are uniform across jobs; gear/buff/passive add on top
    this.localAcc =
      Math.floor(this.localDex * 0.8 + this.localLuk * 0.5) + equipAcc + buffAcc + passiveAcc;
    this.localEva =
      Math.floor(this.localDex * 0.25 + this.localLuk * 0.5) + equipEva + buffEva + passiveEva;

    this.localMagic = Math.min(this.localMagic, 2000);
    this.localMaxHp = Math.min(this.localMaxHp, 30000);
    this.localMaxMp = Math.min(this.localMaxMp, 30000);
  }

  /**
   * The tier ids for a job, mirroring SkillData.getJobTierFileIds. Duplicated
   * rather than imported so Stats stays free of the skill layer.
   */
  static tiersFor(jobId: number): number[] {
    const base = Math.floor(jobId / 1000) * 1000;
    const tiers = [base];
    if (jobId === base) return tiers;
    const first = Math.floor(jobId / 100) * 100;
    tiers.push(first);
    if (jobId === first) return tiers;
    const second = Math.floor(jobId / 10) * 10;
    tiers.push(second);
    if (jobId === second) return tiers;
    // 3rd job is second+1 (131), 4th is second+2 (132) — a 4th-jobber owns
    // both; pushing only jobId left the 3rd-job pool out entirely
    if (jobId % 10 >= 1) tiers.push(second + 1);
    if (jobId % 10 >= 2) tiers.push(second + 2);
    return tiers;
  }

  /** SP available in one tier's pool. */
  getSp(tierJobId: number): number {
    return this.spByTier[tierJobId] ?? 0;
  }

  /** Add SP to a tier. */
  addSp(tierJobId: number, amount: number) {
    this.spByTier[tierJobId] = this.getSp(tierJobId) + amount;
  }

  /** Take one point from a tier. Returns false when that pool is empty. */
  spendSp(tierJobId: number): boolean {
    if (this.getSp(tierJobId) <= 0) return false;
    this.spByTier[tierJobId] = this.getSp(tierJobId) - 1;
    return true;
  }

  /**
   * Total across every tier. Kept because the character-select card and the
   * save payload both want a single number; anything that actually spends
   * points must go through the per-tier methods.
   */
  get sp(): number {
    return Object.values(this.spByTier).reduce((a, b) => a + (b || 0), 0);
  }

  /** Legacy assignment: a bare number belongs to the current job's tier. */
  set sp(value: number) {
    this.spByTier = { [this.jobId ?? 0]: value || 0 };
  }

  /**
   * Rebuild the pools for a character saved before the split existed.
   *
   * The old save is one number, so dumping it into the current tier left
   * Beginner empty and everything in the job pool. What each tier actually
   * earned is derivable — 1/level as a Beginner up to the advancement, 3 per
   * level after it plus 3 for the advancement itself — so subtract what has
   * already been spent in that tier and the split falls out.
   *
   * `spentByTier` is the sum of learned skill levels per tier, which the
   * caller has and this class does not.
   */
  rebuildSpPools(spentByTier: Record<number, number>) {
    const level = this.level || 1;
    // Magicians take 1st job at 8, everyone else at 10 — the one v83
    // exception, and the reason a level-10 Magician has 9 job SP
    // (3 x (10 - 8 + 1)) where a level-10 Warrior has 3.
    const isMagician = Math.floor(this.jobId / 100) === 2;
    const advancedAt: Record<number, number> = {
      1: isMagician ? 8 : 10, 2: 30, 3: 70, 4: 120,
    };
    const pools: Record<number, number> = {};

    // Beginner: 1 per level from 2, and it stops at 3 — that is the whole
    // Beginner allowance, enough for the three basics and no more. Levels
    // past that pay nothing until the character advances.
    const beginnerEarned = Math.min(Math.max(0, level - 1), BEGINNER_SP_TOTAL);
    pools[0] = Math.max(0, beginnerEarned - (spentByTier[0] ?? 0));

    // Job tiers: 3 per level from the advancement level onward, inclusive.
    const tiers = Stats.tiersFor(this.jobId);
    tiers.forEach((tierId, idx) => {
      if (idx === 0) return; // handled above
      const from = advancedAt[idx] ?? 10;
      const earned = Math.max(0, 3 * (level - from + 1));
      pools[tierId] = Math.max(0, earned - (spentByTier[tierId] ?? 0));
    });

    this.spByTier = pools;
    this.spPoolsRebuilt = true;
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
    this.onStatsChanged?.();
  };

  addDex = (amount = 1) => {
    if (this.abilityPoints < amount) {
      return;
    }

    this.dex += amount;
    this.abilityPoints -= amount;
    this.onStatsChanged?.();
  };

  addInt = (amount = 1) => {
    if (this.abilityPoints < amount) {
      return;
    }

    this.int += amount;
    this.abilityPoints -= amount;
    this.onStatsChanged?.();
  };

  addLuk = (amount = 1) => {
    if (this.abilityPoints < amount) {
      return;
    }

    this.luk += amount;
    this.abilityPoints -= amount;
    this.onStatsChanged?.();
  };

  getAttackRange(
    weaponType: WeaponType,
    attackType: AttackType,
    skillMastery: number = 0.1
  ) {
    let primary = 0;
    let secondary = 0;

    const weaponAttack = this.localWatk;

    switch (weaponType) {
      case WeaponType.SWORD:
        primary = this.localStr * 4.0;
        secondary = this.localDex;
        break;
      case WeaponType.AXE:
      case WeaponType.MACE:
        if (attackType === AttackType.Swing) {
          primary = this.localStr * 4.4;
        } else {
          primary = this.localStr * 3.2;
        }
        secondary = this.localDex;
        break;
      case WeaponType.WAND:
      case WeaponType.STAFF:
        primary = this.localStr * 4.0;
        secondary = this.localDex;
        break;
      case WeaponType.SWORD_2H:
        primary = this.localStr * 4.6;
        secondary = this.localDex;
        break;
      case WeaponType.AXE_2H:
      case WeaponType.MACE_2H:
        if (attackType === AttackType.Swing) {
          primary = this.localStr * 4.8;
        } else {
          primary = this.localStr * 3.4;
        }
        secondary = this.localDex;
        break;
      case WeaponType.SPEAR:
        if (attackType === AttackType.Stab) {
          primary = this.localStr * 5.0;
        } else {
          primary = this.localStr * 3.0;
        }
        secondary = this.localDex;
        break;
      case WeaponType.POLEARM:
        if (attackType === AttackType.Swing) {
          primary = this.localStr * 5.0;
        } else {
          primary = this.localStr * 3.0;
        }
        secondary = this.localDex;
        break;
      case WeaponType.DAGGER:
        if (this.jobType === JobsType.Thief) {
          primary = this.localLuk * 3.6;
          secondary = this.localStr + this.localDex;
        } else {
          primary = this.localStr * 4.0;
          secondary = this.localDex;
        }
        break;
      case WeaponType.BOW:
        primary = this.localDex * 3.4;
        secondary = this.localStr;
        break;
      case WeaponType.CROSSBOW:
        primary = this.localDex * 3.6;
        secondary = this.localStr;
        break;
      case WeaponType.CLAW:
        primary = this.localLuk * 3.6;
        secondary = this.localStr + this.localDex;
        break;
      case WeaponType.KNUCKLER:
        primary = this.localStr * 4.8;
        secondary = this.localDex;
        break;
      case WeaponType.PISTOL:
        primary = this.localDex * 3.6;
        secondary = this.localStr;
        break;
    }

    const maxDamage = Math.floor(((primary + secondary) * weaponAttack) / 100);
    const minDamage = Math.floor(
      ((primary * 0.9 * skillMastery + secondary) * weaponAttack) / 100
    );

    return new DamageRange(minDamage, maxDamage);
  }

  getRandomAttack(
    weaponType: WeaponType,
    attackType: AttackType,
    skillMastery: number = 0.1
  ) {
    const damageRange = this.getAttackRange(weaponType, attackType, skillMastery);
    const minDamage = damageRange.min;
    const maxDamage = damageRange.max;
    const chosenAttack = Math.floor(
      Math.random() * (maxDamage - minDamage + 1) + minDamage
    );
    return chosenAttack;
  }

  /**
   * v83 magic damage: ((magic²/1000 + magic·mastery·0.9)/30 + INT/200) · spellAttack.
   * Max uses mastery = 1.0 (Cosmic calcDmgMax); magic = localMagic (INT+MATK, capped 2000).
   */
  getMagicAttackRange(spellAttack: number, spellMastery: number) {
    const magic = this.localMagic;
    const intStat = this.localInt;
    const max = Math.floor(
      ((magic * magic) / 1000 + magic) / 30 + intStat / 200
    ) * spellAttack;
    const min = Math.floor(
      ((magic * magic) / 1000 + magic * spellMastery * 0.9) / 30 + intStat / 200
    ) * spellAttack;
    return new DamageRange(Math.max(1, Math.floor(min)), Math.max(1, Math.floor(max)));
  }

  static getRandomAttackDamageFromAttackRange(damageRange: DamageRange) {
    const minDamage = damageRange.min;
    const maxDamage = damageRange.max;
    const chosenAttack = Math.floor(
      Math.random() * (maxDamage - minDamage + 1) + minDamage
    );
    return chosenAttack;
  }

  // v83 accuracy is uniform across jobs (dex·0.8 + luk·0.5) plus gear/buff/passive
  // bonuses — all folded into localAcc by recalcLocalStats
  getAccuracy() {
    // Darkness (mob skill 121) cuts the local player's accuracy for its
    // duration — read off the status module rather than folded into
    // localAcc so recalcLocalStats never has to know about diseases
    const status = (window as any).charecter?.status;
    const mul = status && status.owner?.stats === this ? status.accuracyMultiplier : 1;
    return mul === 1 ? this.localAcc : Math.floor(this.localAcc * mul);
  }

  getAvoidability() {
    return this.localEva;
  }

  getHands() {
    return this.dex + this.int + this.luk;
  }

  getWeaponDefense() {
    return this.localPdd;
  }

  getMagicDefense() {
    const minMagicDefense = 4;
    return Math.max(minMagicDefense, this.localMdd);
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
      damageRange.min - monsterMagicDef * 0.6 * (1 + 0.01 * levelDifference)
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

  getSpeedPrecetnage() {
    return this.localSpeed;
  }

  getJumpPrecetnage() {
    return this.localJump;
  }
}

export default Stats;
