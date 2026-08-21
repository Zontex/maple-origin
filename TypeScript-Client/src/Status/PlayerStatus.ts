import GameCanvas from '../GameCanvas';
import MobSkillData, { MobSkillId, MobSkillLevel } from '../Mob/MobSkillData';

/**
 * A disease a mob skill put on the player. The art is the skill's
 * `affected` node (looping when the WZ says `repeat`); the icon shown in
 * the buff bar is that art's first frame, since v83's UI.wz carries no
 * dedicated debuff icons (BuffIcon.img only holds the generic stat-up set).
 */
export interface ActiveStatus {
  skillId: number;
  level: number;
  x: number;
  expiresAt: number;
  durationMs: number;
  frames: any[] | null;
  frame: number;
  frameDelay: number;
  /** WZ anchor code of the art: 0 = feet, 1/2 = above the head, 3 = body centre */
  pos: number;
  repeat: boolean;
  /** Art stopped (one-shot that finished); status itself still runs */
  artDone: boolean;
  /** Seduce: which way the legs go, -1 left / 1 right */
  dir: number;
}

// Bishop's Holy Shield makes the party immune to every disease except
// Seduce and Stun (the v83 emulator's giveDebuff rule)
const HOLY_SHIELD_SKILL_ID = 2321005;
// v83 carries at most two diseases at a time (Character.giveDebuff)
const MAX_DISEASES = 2;
// Darkness: no x in the WZ — the original client just cuts accuracy. The
// fraction is a judgement call (UNVERIFIED against the real client).
const DARKNESS_ACCURACY_MUL = 0.5;
// Curse halves EXP gain for its duration
const CURSE_EXP_MUL = 0.5;
// Slow never walks the player below this Speed stat
const SLOW_MIN_SPEED = 10;
// Poison ticks once a second, and cannot kill (stops at 1 HP)
const POISON_TICK_MS = 1000;
// Head-top offset for pos 1/2 art (standing character is ~60px tall)
const HEAD_TOP_OFFSET = 60;
const BODY_CENTRE_OFFSET = 30;

/**
 * Mob-skill diseases on one character. Gameplay consequences are read by
 * MapleCharacter at its gates (input, attack, jump, speed, EXP, accuracy);
 * this class only keeps the timers and the art. Remote characters carry an
 * instance too so their diseases draw, but nothing ticks their HP.
 */
export default class PlayerStatus {
  owner: any;
  active: Map<number, ActiveStatus> = new Map();
  private poisonTimer: number = 0;

  constructor(owner: any) {
    this.owner = owner;
  }

  get count(): number {
    return this.active.size;
  }

  has(skillId: number): boolean {
    return this.active.has(skillId);
  }

  /** Stun: no walking, no jumping, no attacks or skills */
  get isStunned(): boolean {
    return this.active.has(MobSkillId.STUN);
  }

  /** Seal: no skills (plain attacks still swing) */
  get isSealed(): boolean {
    return this.active.has(MobSkillId.SEAL);
  }

  get blocksAttack(): boolean {
    return this.isStunned;
  }

  /** Weakness: no jumping; stun also pins the feet */
  get blocksJump(): boolean {
    return this.isStunned || this.active.has(MobSkillId.WEAKNESS);
  }

  get accuracyMultiplier(): number {
    return this.active.has(MobSkillId.DARKNESS) ? DARKNESS_ACCURACY_MUL : 1;
  }

  /** Curse: half EXP. Applied by MapleCharacter.addExp to positive gains. */
  scaleExp(exp: number): number {
    if (exp <= 0 || !this.active.has(MobSkillId.CURSE)) return exp;
    return Math.max(1, Math.floor(exp * CURSE_EXP_MUL));
  }

  /** Slow: the Speed stat drops by the skill's x (80 at every v83 level) */
  applySpeed(speed: number): number {
    const slow = this.active.get(MobSkillId.SLOW);
    if (!slow) return speed;
    return Math.max(SLOW_MIN_SPEED, speed - slow.x);
  }

  /**
   * Force the movement flags for the diseases that own the legs. Runs every
   * frame right before physics, after the key handlers have had their say:
   * stun clears every direction, seduce presses one, reverse-input swaps
   * left and right.
   */
  applyToPhysics(pos: any): void {
    if (this.active.size === 0 || !pos) return;
    if (this.isStunned) {
      pos.left = false;
      pos.right = false;
      pos.up = false;
      pos.down = false;
      return;
    }
    const seduce = this.active.get(MobSkillId.SEDUCE);
    if (seduce) {
      pos.left = seduce.dir < 0;
      pos.right = seduce.dir > 0;
      pos.down = false;
      return;
    }
    if (this.active.has(MobSkillId.REVERSE_INPUT) && pos.left !== pos.right) {
      const l = pos.left;
      pos.left = pos.right;
      pos.right = l;
    }
  }

  /**
   * Put a disease on the character. The mob host already rolled the
   * skill's prop; this only enforces the v83 caps (two at once, Holy
   * Shield) and starts the art. Returns whether it took.
   */
  apply(entry: MobSkillLevel): boolean {
    const id = entry.skillId;
    const shielded =
      id !== MobSkillId.SEDUCE && id !== MobSkillId.STUN &&
      !!this.owner?.buffManager?.hasBuff?.(HOLY_SHIELD_SKILL_ID);
    if (shielded) return false;
    if (!this.active.has(id) && this.active.size >= MAX_DISEASES) return false;
    const durationMs = entry.timeMs > 0 ? entry.timeMs : 1000;
    const art = entry.affected;
    let dir = 0;
    if (id === MobSkillId.SEDUCE) {
      // x: 1 = walk left, 2 = walk right, anything else = either
      dir = entry.x === 1 ? -1 : entry.x === 2 ? 1 : (Math.random() < 0.5 ? -1 : 1);
      // Seduce stands a seated character up (v83: sitChair(-1))
      if (this.owner?.chairId) this.owner.chairId = 0;
    }
    this.active.set(id, {
      skillId: id,
      level: entry.level,
      x: entry.x,
      expiresAt: Date.now() + durationMs,
      durationMs,
      frames: art?.frames ?? null,
      frame: 0,
      frameDelay: 0,
      pos: art?.pos ?? 0,
      repeat: art?.repeat ?? false,
      artDone: false,
      dir,
    });
    if (id === MobSkillId.POISON) this.poisonTimer = 0;
    if (id === MobSkillId.STUN && this.owner) {
      // A stunned character drops the swing it was in
      this.owner.isInAttack = false;
    }
    return true;
  }

  remove(skillId: number): void {
    this.active.delete(skillId);
  }

  /** Dispel / Holy Shield / Heal-all: every disease goes at once */
  clearAll(): void {
    this.active.clear();
    this.poisonTimer = 0;
  }

  update(msPerTick: number): void {
    if (this.active.size === 0) return;
    const now = Date.now();
    for (const [id, st] of this.active) {
      if (now >= st.expiresAt) {
        this.active.delete(id);
        continue;
      }
      if (st.frames && !st.artDone) {
        st.frameDelay += msPerTick;
        const cur = st.frames[st.frame];
        const delay = cur?.nGet?.('delay')?.nGet?.('nValue', 100) ?? 100;
        if (st.frameDelay > (typeof delay === 'number' ? delay : 100)) {
          st.frameDelay = 0;
          st.frame += 1;
          if (st.frame >= st.frames.length) {
            if (st.repeat) st.frame = 0;
            else { st.frame = st.frames.length - 1; st.artDone = true; }
          }
        }
      }
    }
    this.tickPoison(msPerTick);
  }

  private tickPoison(msPerTick: number): void {
    const poison = this.active.get(MobSkillId.POISON);
    const owner = this.owner;
    if (!poison || !owner || owner.isRemote || owner.isDead) return;
    this.poisonTimer += msPerTick;
    if (this.poisonTimer < POISON_TICK_MS) return;
    this.poisonTimer -= POISON_TICK_MS;
    const hp = Number(owner.hp) || 0;
    if (hp <= 1) return;
    owner.hp = Math.max(1, hp - poison.x);
  }

  /**
   * Draw every disease's art through the map's effect painter — the same
   * closure that draws skill casts, so anchoring and mirroring match.
   */
  drawWith(
    drawEffectAt: (x: number, y: number, frames: any, frameIndex: number, flipped?: boolean) => void
  ): void {
    if (this.active.size === 0) return;
    const pos = this.owner?.pos;
    if (!pos) return;
    for (const st of this.active.values()) {
      if (!st.frames || (st.artDone && !st.repeat)) continue;
      const y =
        st.pos === 3 ? pos.y - BODY_CENTRE_OFFSET
        : st.pos === 1 || st.pos === 2 ? pos.y - HEAD_TOP_OFFSET
        : pos.y;
      drawEffectAt(pos.x, y, st.frames, st.frame, false);
    }
  }

  /**
   * Buff-bar entries for the diseases, to the right of the real buffs:
   * the `affected` art's first frame fitted into the 24px slot, with the
   * same shrinking timer bar BuffManager.renderBuffIcons draws.
   */
  renderIcons(canvas: GameCanvas, baseX: number, baseY: number): void {
    if (this.active.size === 0) return;
    const ctx = canvas.context;
    let x = baseX;
    for (const st of this.active.values()) {
      const frame = st.frames?.[0];
      const img = frame?.nGetImage?.();
      if (img && (img as HTMLImageElement).complete && img.width > 0) {
        const scale = Math.min(24 / img.width, 24 / img.height, 1);
        const w = Math.max(1, Math.floor(img.width * scale));
        const h = Math.max(1, Math.floor(img.height * scale));
        ctx.drawImage(img, x + Math.floor((24 - w) / 2), baseY + Math.floor((24 - h) / 2), w, h);
      }
      const remaining = Math.max(0, st.expiresAt - Date.now());
      const ratio = remaining / (st.durationMs || 1);
      ctx.fillStyle = '#cc4444';
      ctx.fillRect(x, baseY + 24, Math.floor(24 * ratio), 2);
      x += 26;
    }
  }

  /** Resolve a (skill, level) to its WZ record — null when MobSkill.img is not in yet */
  static lookup(skillId: number, level: number): MobSkillLevel | null {
    return MobSkillData.get(skillId, level);
  }
}
