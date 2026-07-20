import SkillData, { SkillInfo, SkillLevelEffect } from './SkillData';
import type MapleCharacter from '../MapleCharacter';

export interface SkillEntry {
  level: number;
  masterLevel: number;
}

export default class SkillManager {
  skills: Map<number, SkillEntry> = new Map();
  cooldowns: Map<number, number> = new Map(); // skillId -> expiry timestamp (Date.now())
  private character: MapleCharacter;

  constructor(character: MapleCharacter) {
    this.character = character;
  }

  async initialize(): Promise<void> {
    await SkillData.initialize();
  }

  getSkillLevel(skillId: number): number {
    return this.skills.get(skillId)?.level ?? 0;
  }

  getMasterLevel(skillId: number): number {
    return this.skills.get(skillId)?.masterLevel ?? 0;
  }

  hasSkill(skillId: number): boolean {
    return (this.skills.get(skillId)?.level ?? 0) > 0;
  }

  async getSkillEffect(skillId: number): Promise<SkillLevelEffect | null> {
    const level = this.getSkillLevel(skillId);
    if (level <= 0) return null;
    const info = await SkillData.getSkill(skillId);
    if (!info || level > info.maxLevel) return null;
    return info.effects[level - 1];
  }

  getSkillEffectSync(skillId: number): SkillLevelEffect | null {
    const level = this.getSkillLevel(skillId);
    if (level <= 0) return null;
    return SkillData.getEffect(skillId, level);
  }

  changeSkillLevel(skillId: number, level: number, masterLevel?: number): void {
    const existing = this.skills.get(skillId);
    const ml = masterLevel ?? existing?.masterLevel ?? 0;

    if (level <= 0) {
      this.skills.delete(skillId);
    } else {
      this.skills.set(skillId, { level, masterLevel: ml });
    }

    console.log(`[Skill] ${SkillData.getSkillName(skillId)} (#${skillId}) → level ${level}, masterLevel ${ml}`);
    (this.character as any).recalcLocalStats?.();
  }

  // Convenience: learn a skill at level 1 with maxLevel as masterLevel
  async teachSkill(skillId: number, level: number = 1): Promise<void> {
    const info = await SkillData.getSkill(skillId);
    const ml = info?.maxLevel ?? level;
    this.changeSkillLevel(skillId, level, ml);
  }

  // Cooldown management
  isOnCooldown(skillId: number): boolean {
    const expiry = this.cooldowns.get(skillId);
    if (!expiry) return false;
    if (Date.now() >= expiry) {
      this.cooldowns.delete(skillId);
      return false;
    }
    return true;
  }

  startCooldown(skillId: number, durationSec: number): void {
    if (durationSec <= 0) return;
    this.cooldowns.set(skillId, Date.now() + durationSec * 1000);
  }

  getCooldownRemaining(skillId: number): number {
    const expiry = this.cooldowns.get(skillId);
    if (!expiry) return 0;
    return Math.max(0, expiry - Date.now());
  }

  // Get all passive skill stat bonuses (aggregated)
  getPassiveBonuses(): {
    pad: number; pdd: number; mad: number; mdd: number;
    acc: number; eva: number; speed: number; jump: number;
    mastery: number;
  } {
    const bonuses = {
      pad: 0, pdd: 0, mad: 0, mdd: 0,
      acc: 0, eva: 0, speed: 0, jump: 0,
      mastery: 0,
    };

    for (const [skillId, entry] of this.skills) {
      if (entry.level <= 0) continue;
      const info = SkillData.getSkillSync(skillId);
      if (!info || !info.isPassive) continue;

      const effect = info.effects[entry.level - 1];
      if (!effect) continue;

      bonuses.pad += effect.pad;
      bonuses.pdd += effect.pdd;
      bonuses.mad += effect.mad;
      bonuses.mdd += effect.mdd;
      bonuses.acc += effect.acc;
      bonuses.eva += effect.eva;
      bonuses.speed += effect.speed;
      bonuses.jump += effect.jump;
      if (effect.mastery > bonuses.mastery) {
        bonuses.mastery = effect.mastery; // Use highest mastery, not sum
      }
    }

    return bonuses;
  }

  // Serialize for DB save
  serialize(): { skillId: number; skillLevel: number; masterLevel: number }[] {
    const result: { skillId: number; skillLevel: number; masterLevel: number }[] = [];
    for (const [skillId, entry] of this.skills) {
      result.push({
        skillId,
        skillLevel: entry.level,
        masterLevel: entry.masterLevel,
      });
    }
    return result;
  }

  // Deserialize from DB load
  deserialize(data: { skillId: number; skillLevel: number; masterLevel: number }[]): void {
    this.skills.clear();
    for (const row of data) {
      if (row.skillLevel > 0) {
        this.skills.set(row.skillId, {
          level: row.skillLevel,
          masterLevel: row.masterLevel,
        });
      }
    }
    console.log(`[Skill] Loaded ${this.skills.size} skills`);
    (this.character as any).recalcLocalStats?.();
  }

  // Get all learned skills grouped by job file ID (for UI tabs)
  getSkillsByJob(): Map<number, { skillId: number; level: number; masterLevel: number }[]> {
    const grouped = new Map<number, { skillId: number; level: number; masterLevel: number }[]>();
    for (const [skillId, entry] of this.skills) {
      const jobFileId = Math.floor(skillId / 10000);
      if (!grouped.has(jobFileId)) grouped.set(jobFileId, []);
      grouped.get(jobFileId)!.push({
        skillId,
        level: entry.level,
        masterLevel: entry.masterLevel,
      });
    }
    return grouped;
  }
}
