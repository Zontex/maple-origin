import { Physics } from '../Physics';
import GameCanvas from '../GameCanvas';
import Stats from '../Stats/Stats';
import getEquipTypeById from '../Constants/EquipType';
import { AttackType } from '../Constants/AttackType';
import Projectile from '../Projectile/Projectile';
import SkillData, { SkillLevelEffect } from '../Skills/SkillData';
import { SummonWz, SummonAttack, frameDelay } from './SummonData';

// Follow tuning. v83 keeps a flyer hovering just behind and above the
// owner's shoulder; walkers trail like a pet. None of these are WZ values.
const FLY_BEHIND_X = 50;
const FLY_Y_OFFSET = 20;
const FLY_BOB_PX = 6;
const FLY_EASE = 5; // 1/s — exponential approach rate toward the hover point
const WALK_SPEED = 125;
const WALK_START_DIST = 80;
const WALK_STOP_DIST = 28;
const TELEPORT_DIST_X = 640;
const TELEPORT_DIST_Y = 350;
const STUCK_MS = 3000;
const JUMP_DY = 30;
const JUMP_DX_MAX = 120;
const JUMP_COOLDOWN_MS = 800;
const REMOTE_EASE = 8;
// Pause between two blows once the attack stance has played out. Observed
// v83 summons strike roughly every 1.5-3 s; the stance itself covers the rest.
const ATTACK_REST_MS = 1200;
// How far a locked target may drift before the landing blow gives up on it
const TARGET_SLACK = 1.5;
// A mob leaning on the Puppet chips at it once a second with its touch damage
const PUPPET_CONTACT_MS = 1000;
// Beholder companions
const BEHOLDER_HEAL_SKILL = 1320008;
const BEHOLDER_BUFF_SKILL = 1320009;

export interface SummonOpts {
  skillId: number;
  level: number;
  owner: any; // MapleCharacter
  wz: SummonWz;
  effect: SkillLevelEffect;
  x: number;
  y: number;
  facingLeft: boolean;
  isRemote: boolean;
  durationMs: number;
}

interface Fx {
  frames: any[];
  i: number;
  delay: number;
  x: number;
  y: number;
}

type Phase = 'active' | 'dying' | 'done';

/**
 * Physical summon damage. The WZ gives a summon `pad` (Silver Hawk 23..100,
 * Phoenix 305..550) and nothing else, so it scales the owner's own weapon
 * range the way a skill's `damage` percentage does; magic summons (Summon
 * Dragon, Ifrit, Bahamut) carry `mad` and roll the v83 spell formula.
 */
export function rollSummonDamage(owner: any, effect: SkillLevelEffect, element: string | null, monster: any): number {
  const stats = owner?.stats;
  if (!stats) return 1;
  const info = monster?.mobFile?.info;
  const level = Number(info?.level?.nValue ?? 1);
  const eva = Number(monster?.eva ?? info?.eva?.nValue ?? 0);
  if ((effect.mad || 0) > 0) {
    const raw = stats.getMagicAttackRange(effect.mad, (effect.mastery || 10) / 100);
    const def = stats.getMagicDamageAfterMonsterDefense(raw, Number(info?.MDDamage?.nValue ?? 0), level);
    if (stats.getRandomIsMiss(level, eva)) return 0;
    const mult = monster?.getElementalMultiplier?.(element) ?? 1;
    return Math.max(1, Math.floor(Math.max(1, Stats.getRandomAttackDamageFromAttackRange(def)) * mult));
  }
  const weaponType = getEquipTypeById(owner.weaponEquipId);
  const mastery = owner.skillManager?.getWeaponMastery?.(weaponType) ?? 0.1;
  const raw = stats.getAttackRange(weaponType, AttackType.Swing, mastery);
  const def = stats.getAttackDamageRangeAfterMonsterDefense(raw, Number(info?.PDDamage?.nValue ?? 0), level);
  if (stats.getRandomIsMiss(level, eva)) return 0;
  const pct = ((effect.pad || 0) > 0 ? effect.pad : 100) / 100;
  return Math.max(1, Math.floor(Math.max(1, Stats.getRandomAttackDamageFromAttackRange(def)) * pct));
}

/**
 * One summoned creature on the map: Silver Hawk, Puppet, Octopus, Beholder...
 * Drives its own stance clock off the skill's `summon` frames, follows the
 * owner according to its kind, and — for the local owner only — picks
 * targets and deals damage through the same Monster.hit the player uses.
 * Remote summons run no AI: they ease toward relayed positions and replay
 * relayed attack stances.
 */
class Summon {
  skillId: number;
  level: number;
  owner: any;
  wz: SummonWz;
  effect: SkillLevelEffect;
  isRemote: boolean;

  pos: Physics;
  facingLeft: boolean;
  stance = 'stand';
  frame = 0;
  delay = 0;
  nextDelay = 100;
  oneShot: string | null = null;

  phase: Phase = 'active';
  expiresAt: number;
  // Puppet HP (`x` of the level data); other summons never take damage
  hp = 0;
  maxHp = 0;

  // Remote easing target
  targetX: number;
  targetY: number;

  private currentAttack: SummonAttack | null = null;
  private attackStartedAt = 0;
  private attackLanded = false;
  private attackEffectPlayed = false;
  private lockedTarget: any = null;
  private nextAttackAt = 0;
  private fx: Fx[] = [];
  private bobT = Math.random() * Math.PI * 2;
  private stuckMs = 0;
  private lastX: number;
  private nextJumpAt = 0;
  private contactAt = new Map<number, number>();
  private nextHealAt = 0;
  private nextBuffAt = 0;

  // Filled by draw() for the puppet's contact rectangle
  lastDrawWidth = 0;
  lastDrawHeight = 0;
  lastDrawTopY = 0;

  constructor(opts: SummonOpts) {
    this.skillId = opts.skillId;
    this.level = opts.level;
    this.owner = opts.owner;
    this.wz = opts.wz;
    this.effect = opts.effect;
    this.isRemote = opts.isRemote;
    this.facingLeft = opts.facingLeft;
    this.pos = new Physics(opts.x, opts.y, WALK_SPEED, true);
    this.targetX = opts.x;
    this.targetY = opts.y;
    this.lastX = opts.x;
    this.expiresAt = Date.now() + opts.durationMs;
    // Flyers, stationaries and every remote summon steer themselves —
    // Physics gravity and footholds only apply to a local walker
    this.pos.flying = this.wz.kind !== 'walker' || this.isRemote;
    if (this.wz.kind === 'puppet') {
      this.maxHp = Math.max(1, Number(opts.effect.x) || 1);
      this.hp = this.maxHp;
    }
    const now = Date.now();
    this.nextAttackAt = now + 600;
    this.nextHealAt = now + 3000;
    this.nextBuffAt = now + 5000;
    if (!this.playOneShot('summoned')) this.setFrame(this.idleStance(), 0);
  }

  get kind() {
    return this.wz.kind;
  }

  get x() {
    return this.pos.x;
  }

  get y() {
    return this.pos.y;
  }

  // -------------------------------------------------------------- stances

  private hasStance(name: string): boolean {
    return !!this.wz.stances[name]?.length;
  }

  private idleStance(): string {
    if (this.kind === 'flying') return this.hasStance('fly') ? 'fly' : 'stand';
    return this.hasStance('stand') ? 'stand' : this.hasStance('move') ? 'move' : 'fly';
  }

  setFrame(stance: string, frame = 0, carry = 0) {
    const frames = this.wz.stances[stance];
    if (!frames?.length) return;
    const f = frames[frame] ? frame : 0;
    this.stance = stance;
    this.frame = f;
    this.delay = carry;
    this.nextDelay = frameDelay(frames[f]);
  }

  playOneShot(stance: string): boolean {
    if (!this.hasStance(stance)) return false;
    this.oneShot = stance;
    this.setFrame(stance, 0);
    return true;
  }

  private advanceFrame(ms: number) {
    const frames = this.wz.stances[this.stance];
    if (!frames) return;
    this.delay += ms;
    while (this.delay > this.nextDelay) {
      const carry = this.delay - this.nextDelay;
      const next = this.frame + 1;
      if (!frames[next]) {
        if (this.oneShot) {
          const finished = this.oneShot;
          this.oneShot = null;
          this.onOneShotDone(finished);
          if (this.phase === 'done') return;
          this.setFrame(this.idleStance(), 0, carry);
          return;
        }
        this.setFrame(this.stance, 0, carry);
      } else {
        this.setFrame(this.stance, next, carry);
      }
      if (this.nextDelay <= 0) break;
    }
  }

  private onOneShotDone(stance: string) {
    if (stance === 'die') {
      this.phase = 'done';
      return;
    }
    if (this.currentAttack && stance === this.currentAttack.stance) {
      // A blow whose landing frame the stance never reached still lands
      if (!this.attackLanded) this.landAttack();
      this.currentAttack = null;
      this.lockedTarget = null;
      this.nextAttackAt = Date.now() + ATTACK_REST_MS;
    }
  }

  // -------------------------------------------------------------- lifecycle

  /** Play the death clip, then mark done; instant when the art is missing */
  die(instant = false) {
    if (this.phase !== 'active') return;
    this.currentAttack = null;
    this.lockedTarget = null;
    if (instant || !this.playOneShot('die')) {
      this.phase = 'done';
      return;
    }
    this.phase = 'dying';
  }

  /** Puppet: absorb a blow. Returns true when it broke. */
  takeDamage(amount: number): boolean {
    if (this.kind !== 'puppet' || this.phase !== 'active') return false;
    this.hp = Math.max(0, this.hp - Math.max(1, Math.floor(amount)));
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    if (!this.oneShot) this.playOneShot('hit');
    return false;
  }

  /** World-space box of the current sprite (from the last draw) */
  getRect(): { x: number; y: number; width: number; height: number } {
    const w = this.lastDrawWidth || 40;
    const h = this.lastDrawHeight || 60;
    return { x: this.pos.x - w / 2, y: this.lastDrawTopY || this.pos.y - h, width: w, height: h };
  }

  // -------------------------------------------------------------- update

  /**
   * @param monsters live map monsters — only consulted by a local summon
   */
  update(ms: number, monsters: any[], now: number) {
    if (this.phase === 'done') return;
    this.tickFx(ms);

    if (this.phase === 'dying') {
      this.advanceFrame(ms);
      return;
    }

    if (this.isRemote) this.easeRemote(ms);
    else this.move(ms, now);

    if (!this.isRemote) {
      if (this.currentAttack) this.tickAttack(now, monsters);
      else if (this.wz.attacks.length) this.tryAttack(now, monsters);
      if (this.kind === 'puppet') this.tickPuppetContact(now, monsters);
      if (this.wz.isBeholder) this.tickBeholder(now);
    }

    // Stance selection outside one-shots: fly/move while travelling, else stand
    if (!this.oneShot) {
      const moving = this.isRemote
        ? Math.abs(this.targetX - this.pos.x) > 2
        : this.kind === 'walker'
          ? this.pos.left || this.pos.right
          : this.kind === 'flying' && this.isTravelling;
      let wanted = this.idleStance();
      if (moving && this.kind === 'walker' && this.hasStance('move')) wanted = 'move';
      if (!moving && this.kind === 'flying' && this.hasStance('stand')) wanted = 'stand';
      if (wanted !== this.stance) this.setFrame(wanted, 0);
    }
    this.advanceFrame(ms);
  }

  private isTravelling = false;

  private ownerFacingRight(): boolean {
    return !!this.owner?.flipped;
  }

  private move(ms: number, now: number) {
    const o = this.owner;
    if (!o?.pos) return;
    if (this.kind === 'puppet' || this.kind === 'stationary') return;

    if (this.kind === 'flying') {
      const behind = this.ownerFacingRight() ? -FLY_BEHIND_X : FLY_BEHIND_X;
      this.bobT += ms / 1000 * 2.2;
      const tx = o.pos.x + behind;
      // The art already floats above its anchor (Silver Hawk's origin sits
      // 37px below the sprite), so the anchor hovers barely above the feet
      const ty = o.pos.y - FLY_Y_OFFSET + Math.sin(this.bobT) * FLY_BOB_PX;
      const dx = tx - this.pos.x;
      const dy = ty - this.pos.y;
      if (Math.abs(dx) > TELEPORT_DIST_X || Math.abs(dy) > TELEPORT_DIST_Y) {
        this.pos.x = tx;
        this.pos.y = ty;
      } else {
        const step = 1 - Math.exp(-(ms / 1000) * FLY_EASE);
        this.pos.x += dx * step;
        this.pos.y += dy * step;
      }
      this.isTravelling = Math.abs(dx) > 12;
      if (!this.currentAttack) {
        if (Math.abs(dx) > 12) this.facingLeft = dx < 0;
        else this.facingLeft = !this.ownerFacingRight();
      }
      return;
    }

    // Walker: real physics, pet-style follow
    const dx = o.pos.x - this.pos.x;
    const dy = o.pos.y - this.pos.y;
    if (Math.abs(dx) > TELEPORT_DIST_X || Math.abs(dy) > TELEPORT_DIST_Y || this.stuckMs > STUCK_MS) {
      this.pos.x = o.pos.x;
      this.pos.y = o.pos.y - 10;
      this.pos.vx = 0;
      this.pos.vy = 0;
      this.pos.fh = null as any;
      this.pos.left = false;
      this.pos.right = false;
      this.stuckMs = 0;
      this.lastX = this.pos.x;
      return;
    }
    const walking = this.pos.left || this.pos.right;
    const wantWalk = Math.abs(dx) > (walking ? WALK_STOP_DIST : WALK_START_DIST);
    const allowed = !this.currentAttack && !this.oneShot;
    this.pos.left = allowed && wantWalk && dx < 0;
    this.pos.right = allowed && wantWalk && dx > 0;
    if (this.pos.left || this.pos.right) this.facingLeft = dx < 0;
    else if (!this.currentAttack) this.facingLeft = !this.ownerFacingRight();
    if ((this.pos.left || this.pos.right) && this.pos.fh && dy < -JUMP_DY && Math.abs(dx) < JUMP_DX_MAX && now > this.nextJumpAt) {
      this.pos.jump();
      this.nextJumpAt = now + JUMP_COOLDOWN_MS;
    }
    this.stuckMs = (this.pos.left || this.pos.right) && Math.abs(this.pos.x - this.lastX) < 0.5
      ? this.stuckMs + ms
      : 0;
    this.lastX = this.pos.x;
    this.pos.update(ms);
  }

  private easeRemote(ms: number) {
    const dx = this.targetX - this.pos.x;
    const dy = this.targetY - this.pos.y;
    if (Math.abs(dx) > TELEPORT_DIST_X || Math.abs(dy) > TELEPORT_DIST_Y) {
      this.pos.x = this.targetX;
      this.pos.y = this.targetY;
      return;
    }
    const step = 1 - Math.exp(-(ms / 1000) * REMOTE_EASE);
    this.pos.x += dx * step;
    this.pos.y += dy * step;
  }

  /** Relayed position for a remote summon */
  setRemoteTarget(x: number, y: number, facingLeft: boolean) {
    this.targetX = x;
    this.targetY = y;
    this.facingLeft = facingLeft;
  }

  /** Relayed attack for a remote summon: stance only, no damage */
  playRemoteAttack(stance: string, facingLeft: boolean) {
    this.facingLeft = facingLeft;
    const atk = this.wz.attacks.find(a => a.stance === stance) ?? this.wz.attacks[0];
    if (!atk) return;
    this.playOneShot(atk.stance);
    if (atk.effectFrames) {
      this.fx.push({ frames: atk.effectFrames, i: 0, delay: -atk.effectAfter, x: this.pos.x, y: this.pos.y });
    }
  }

  // -------------------------------------------------------------- attacks

  private usable(m: any): boolean {
    const c = m?.centerPosition;
    return !!m && !m.dying && !m.destroyed && !m.isFriendly && !!c && Number.isFinite(c.x) && Number.isFinite(c.y);
  }

  private distanceTo(m: any): number {
    const c = m.centerPosition;
    return Math.hypot(c.x - this.pos.x, c.y - this.pos.y);
  }

  private tryAttack(now: number, monsters: any[]) {
    if (now < this.nextAttackAt || this.oneShot) return;
    // Alternate attack stances when a summon has several (Octopus 4th job)
    const atk = this.wz.attacks[Math.floor(Math.random() * this.wz.attacks.length)];
    let best: any = null;
    let bestD = Infinity;
    for (const m of monsters) {
      if (!this.usable(m)) continue;
      const d = this.distanceTo(m);
      if (d < atk.radius && d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best) return;
    this.currentAttack = atk;
    this.lockedTarget = best;
    this.attackStartedAt = now;
    this.attackLanded = false;
    this.attackEffectPlayed = !atk.effectFrames;
    this.facingLeft = best.centerPosition.x < this.pos.x;
    if (this.kind === 'walker') {
      this.pos.left = false;
      this.pos.right = false;
    }
    this.playOneShot(atk.stance);
    this.onAttackStarted?.(this, atk, best);
  }

  /** Hook for the manager to relay the attack */
  onAttackStarted: ((s: Summon, atk: SummonAttack, target: any) => void) | null = null;

  private tickAttack(now: number, monsters: any[]) {
    const atk = this.currentAttack!;
    const elapsed = now - this.attackStartedAt;
    if (!this.attackEffectPlayed && elapsed >= atk.effectAfter) {
      this.attackEffectPlayed = true;
      if (atk.effectFrames) this.fx.push({ frames: atk.effectFrames, i: 0, delay: 0, x: this.pos.x, y: this.pos.y });
    }
    if (!this.attackLanded && elapsed >= atk.attackAfter) this.landAttack(monsters);
  }

  /** World-space rectangle of the attack's lt/rb box for the current facing */
  private attackBox(atk: SummonAttack) {
    const b = atk.box!;
    const left = this.facingLeft ? b.left : -b.right;
    const right = this.facingLeft ? b.right : -b.left;
    return { x: this.pos.x + left, y: this.pos.y + b.top, width: right - left, height: b.bottom - b.top };
  }

  private mobRect(m: any) {
    if (m.width > 0 && m.height > 0) return { x: m.x, y: m.y, width: m.width, height: m.height };
    const c = m.centerPosition;
    return { x: c.x - 1, y: c.y - 1, width: 2, height: 2 };
  }

  private overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  private landAttack(monsters: any[] = []) {
    this.attackLanded = true;
    const atk = this.currentAttack;
    if (!atk || this.isRemote) return;

    if (atk.ballNode) {
      this.fireBall(atk, monsters);
      return;
    }

    const targets: any[] = [];
    const locked = this.lockedTarget;
    if (this.usable(locked) && this.distanceTo(locked) < atk.radius * TARGET_SLACK) targets.push(locked);
    if (atk.box && atk.mobCount > targets.length) {
      const box = this.attackBox(atk);
      for (const m of monsters) {
        if (targets.length >= atk.mobCount) break;
        if (!this.usable(m) || targets.includes(m)) continue;
        if (this.overlaps(box, this.mobRect(m))) targets.push(m);
      }
    }
    const hitFrames = atk.hitFrames ?? this.wz.hitFrames;
    for (const m of targets) {
      try {
        const dmg = rollSummonDamage(this.owner, this.effect, this.wz.element, m);
        const knock = m.centerPosition.x >= this.pos.x ? 1 : -1;
        m.hit(dmg, knock, this.owner, false, this.skillId);
        if (hitFrames) this.fx.push({ frames: hitFrames, i: 0, delay: 0, x: m.centerPosition.x, y: m.centerPosition.y });
      } catch (e) {
        console.error('[Summon] hit failed:', e);
      }
    }
  }

  /** Octopus-style ranged blow: a ball from the skill's own art */
  private fireBall(atk: SummonAttack, monsters: any[]) {
    const target = this.usable(this.lockedTarget) ? this.lockedTarget : null;
    if (!target) return;
    const dmg = rollSummonDamage(this.owner, this.effect, this.wz.element, target);
    const sx = this.pos.x + (this.facingLeft ? atk.sp.x : -atk.sp.x);
    const sy = this.pos.y + atk.sp.y;
    try {
      const rootHit = (this.wz.info as any).effects?.[0]?.hitNode ?? null;
      const p = Projectile.fromSkill({
        skillId: this.skillId,
        charecter: this.owner,
        x: sx,
        y: sy,
        right: !this.facingLeft,
        ballNode: atk.ballNode,
        hitNode: rootHit,
        fixedDamage: dmg,
        magicAttack: null,
        targetMonsters: monsters.filter(m => this.usable(m)),
        maxDistance: atk.radius,
      });
      this.owner.projectiles?.push(p);
    } catch (e) {
      console.error('[Summon] ball failed:', e);
    }
  }

  // -------------------------------------------------------------- puppet

  private tickPuppetContact(now: number, monsters: any[]) {
    if (this.phase !== 'active') return;
    const rect = this.getRect();
    for (const m of monsters) {
      if (!this.usable(m)) continue;
      if (!this.overlaps(rect, this.mobRect(m))) continue;
      const last = this.contactAt.get(m.oId) ?? 0;
      if (now - last < PUPPET_CONTACT_MS) continue;
      this.contactAt.set(m.oId, now);
      const touch = Number(m.pad ?? m.mobFile?.info?.PADamage?.nValue ?? 1);
      if (this.takeDamage(Math.max(1, touch))) return;
    }
  }

  // -------------------------------------------------------------- beholder

  /**
   * Beholder's Healing (1320008) restores `hp` every `x` s; Beholder's Buff
   * (1320009) applies its stat block for `time` s every `x` s. Both are
   * invisible passives the Dark Knight levels separately.
   */
  private tickBeholder(now: number) {
    const sm = this.owner?.skillManager;
    if (!sm) return;
    if (now >= this.nextHealAt) {
      const lvl = sm.getSkillLevel?.(BEHOLDER_HEAL_SKILL) ?? 0;
      const eff = lvl > 0 ? SkillData.getEffect(BEHOLDER_HEAL_SKILL, lvl) : null;
      const interval = Math.max(1, eff?.x || 10) * 1000;
      this.nextHealAt = now + interval;
      if (eff && eff.hp > 0 && !this.oneShot && this.owner.hp > 0 && this.owner.hp < this.owner.maxHp) {
        this.owner.hp = Math.min(this.owner.maxHp, this.owner.hp + eff.hp);
        this.playOneShot('skill1');
      }
    }
    if (now >= this.nextBuffAt) {
      const lvl = sm.getSkillLevel?.(BEHOLDER_BUFF_SKILL) ?? 0;
      const eff = lvl > 0 ? SkillData.getEffect(BEHOLDER_BUFF_SKILL, lvl) : null;
      const interval = Math.max(1, eff?.x || 20) * 1000;
      this.nextBuffAt = now + interval;
      if (eff && this.owner.buffManager && !this.oneShot) {
        try {
          this.owner.buffManager.applyBuff(BEHOLDER_BUFF_SKILL, eff);
          const casts = Object.keys(this.wz.stances).filter(s => /^skill[2-9]$/.test(s));
          this.playOneShot(casts[Math.floor(Math.random() * casts.length)] ?? 'skill2');
        } catch (e) {
          console.warn('[Summon] Beholder buff failed:', e);
        }
      }
    }
  }

  // -------------------------------------------------------------- fx

  private tickFx(ms: number) {
    for (const f of this.fx) {
      f.delay += ms;
      while (f.i < f.frames.length && f.delay > frameDelay(f.frames[f.i])) {
        f.delay -= frameDelay(f.frames[f.i]);
        f.i++;
      }
    }
    this.fx = this.fx.filter(f => f.i < f.frames.length);
  }

  // -------------------------------------------------------------- draw

  draw(canvas: GameCanvas, camera: any) {
    if (this.phase === 'done') return;
    const frames = this.wz.stances[this.stance];
    const cur = frames?.[this.frame];
    if (cur) {
      const img = cur.nGetImage();
      const originX = cur.nGet('origin').nGet('nX', 0);
      const originY = cur.nGet('origin').nGet('nY', 0);
      // Summon art faces left in the WZ, like mobs and pets
      const flipped = !this.facingLeft;
      const adjustX = !flipped ? originX : cur.nWidth - originX;
      canvas.drawImage({
        img,
        dx: this.pos.x - camera.x - adjustX,
        dy: this.pos.y - camera.y - originY,
        flipped,
      });
      this.lastDrawWidth = cur.nWidth;
      this.lastDrawHeight = cur.nHeight;
      this.lastDrawTopY = this.pos.y - originY;
    }
    for (const f of this.fx) {
      if (f.delay < 0) continue; // scheduled, not yet started
      const fr = f.frames[f.i];
      if (!fr) continue;
      const img = fr.nGetImage();
      const ox = fr.nGet('origin').nGet('nX', 0);
      const oy = fr.nGet('origin').nGet('nY', 0);
      canvas.drawImage({ img, dx: f.x - camera.x - ox, dy: f.y - camera.y - oy });
    }
  }
}

export default Summon;
