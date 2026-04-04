import SkillData, { SkillLevelEffect } from './SkillData';
import GameCanvas from '../GameCanvas';

export interface ActiveBuff {
  skillId: number;
  effect: SkillLevelEffect;
  expiresAt: number;    // Date.now() + duration
  icon: HTMLImageElement | null;
}

export default class BuffManager {
  activeBuffs: Map<number, ActiveBuff> = new Map();

  applyBuff(skillId: number, effect: SkillLevelEffect): void {
    const info = SkillData.getSkillSync(skillId);
    const durationMs = (effect.time || 0) * 1000;
    if (durationMs <= 0) return;

    this.activeBuffs.set(skillId, {
      skillId,
      effect,
      expiresAt: Date.now() + durationMs,
      icon: info?.icon || null,
    });

    console.log(`[Buff] Applied ${info?.name || skillId} for ${effect.time}s`);
  }

  removeBuff(skillId: number): void {
    const buff = this.activeBuffs.get(skillId);
    if (buff) {
      const name = SkillData.getSkillName(skillId);
      console.log(`[Buff] Expired: ${name}`);
      this.activeBuffs.delete(skillId);
    }
  }

  update(msPerTick: number): void {
    const now = Date.now();
    for (const [skillId, buff] of this.activeBuffs) {
      if (now >= buff.expiresAt) {
        this.removeBuff(skillId);
      }
    }
  }

  hasBuff(skillId: number): boolean {
    return this.activeBuffs.has(skillId);
  }

  // Aggregate all active buff stat bonuses
  getTotalPad(): number {
    let total = 0;
    for (const buff of this.activeBuffs.values()) total += buff.effect.pad;
    return total;
  }

  getTotalPdd(): number {
    let total = 0;
    for (const buff of this.activeBuffs.values()) total += buff.effect.pdd;
    return total;
  }

  getTotalMad(): number {
    let total = 0;
    for (const buff of this.activeBuffs.values()) total += buff.effect.mad;
    return total;
  }

  getTotalMdd(): number {
    let total = 0;
    for (const buff of this.activeBuffs.values()) total += buff.effect.mdd;
    return total;
  }

  getTotalAcc(): number {
    let total = 0;
    for (const buff of this.activeBuffs.values()) total += buff.effect.acc;
    return total;
  }

  getTotalEva(): number {
    let total = 0;
    for (const buff of this.activeBuffs.values()) total += buff.effect.eva;
    return total;
  }

  getTotalSpeed(): number {
    let total = 0;
    for (const buff of this.activeBuffs.values()) total += buff.effect.speed;
    return total;
  }

  getTotalJump(): number {
    let total = 0;
    for (const buff of this.activeBuffs.values()) total += buff.effect.jump;
    return total;
  }

  // Draw buff icons above HP bar area
  renderBuffIcons(canvas: GameCanvas, baseX: number, baseY: number): void {
    let x = baseX;
    const ctx = canvas.context;

    for (const buff of this.activeBuffs.values()) {
      if (buff.icon && buff.icon.complete && buff.icon.width > 0) {
        // Draw icon at 24x24
        ctx.drawImage(buff.icon, x, baseY, 24, 24);

        // Remaining time indicator (shrinking bar under icon)
        const remaining = Math.max(0, buff.expiresAt - Date.now());
        const total = (buff.effect.time || 1) * 1000;
        const ratio = remaining / total;
        ctx.fillStyle = '#44cc44';
        ctx.fillRect(x, baseY + 24, Math.floor(24 * ratio), 2);

        x += 26;
      }
    }
  }

  // Get number of active buffs
  get count(): number {
    return this.activeBuffs.size;
  }
}
