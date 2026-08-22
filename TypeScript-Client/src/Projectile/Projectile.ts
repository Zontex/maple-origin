import WZManager from "../wz-utils/WZManager";
import WZFiles from "../Constants/enums/WZFiles";
import ProjectilePhysics from "./ProjectilePhysics";
import {
  areAnyRectanglesOverlapping,
  isPositionInsideRect,
} from "../Physics/Collision";
import Stats, { DamageRange } from "../Stats/Stats";
import getEquipTypeById from "../Constants/EquipType";
import MapleCharacter from "../MapleCharacter";
import { Position } from "../Effects/DamageIndicator";
import Monster from "../Monster";
import GameCanvas from "../GameCanvas";
import { CameraInterface } from "../Camera";
import { SINGLE_TARGET_REACH } from "../Skills/SkillData";
import { playSkillSound } from "../Skills/SkillSound";

// bullets locations
// Item.wz/Consume/206.img/ID/bullet - arrow
// Item.wz/Consume/207.img/ID/bullet - throwing star
// info
// IncPAD = increase physical attack damage

const default_target_angle = Math.PI / 6; // 30 degrees

class Projectile {
  opts: any;
  id: number = 0;
  charecter: MapleCharacter | null = null;
  pos: ProjectilePhysics | null = null;
  originX: number = 0;
  originY: number = 0;
  maxDistance: number = 0;
  isMovementEnabled: boolean = false;
  destroyed: boolean = false;
  targetMonsters: any = [];
  willHitkill: boolean = false;
  lastPositionCenter: Position = { x: 0, y: 0 };
  weaponAttackRange: DamageRange = { min: 0, max: 0 };
  finalDamangeAfterTargetDefense: number = 0;
  stance: any = null;
  target: Monster | null = null;
  frame: any = null;
  delay: number = 0;
  nextDelay: number = 0;
  flipped: boolean = false;
  dying: boolean = false;
  // Skill projectile fields
  fixedDamage: number = 0;
  // When true, the ball keeps a single frame instead of animating (e.g., Three
  // Snails, where the ball frames are the three different shell sprites)
  lockedFrame: boolean = false;
  // GMS thrown-skill behavior: fly straight and horizontal, hit the first mob
  // whose hitbox the ball enters, disappear at max distance (no homing)
  straightFlight: boolean = false;
  magicAttack: { spellAttack: number; mastery: number; element: string | null } | null = null;
  hitNode: any = null;
  isCritical: boolean = false;
  // Hit effect animation (plays at impact point after hitting target)
  hitEffectFrames: any[] | null = null;
  hitEffectFrame: number = 0;
  hitEffectDelay: number = 0;
  // Skill that fired this projectile (0 = plain weapon shot) — carried so a
  // killing blow can be credited to the right skill-tutorial quest
  skillId: number = 0;
  // Damage lines per impact (Wind Shot 3, Combo Penril 2) and the cadence the
  // later lines follow — see MapleCharacter.attackHitTimes; a projectile has
  // no body frames to pace by, so it keeps its Hit art's frame delay
  attackCount: number = 1;
  hitCadenceMs: number = 90;
  // Skill damage multiplier on a weapon shot (Double Shot: 0.61..0.80)
  damagePercent: number = 1;
  hitEffectActive: boolean = false;
  hitEffectX: number = 0;
  hitEffectY: number = 0;

  // needed to enable await on constructor
  static async fromOpts(opts: any) {
    const projectile = new Projectile(opts);
    await projectile.load();
    return projectile;
  }

  // Create a skill projectile from pre-loaded WZ ball node (no async WZ fetch needed)
  static fromSkill(opts: {
    skillId?: number;
    charecter: MapleCharacter;
    x: number;
    y: number;
    right: boolean;
    ballNode: any;
    hitNode?: any;
    ballFrame?: number | null;
    fixedDamage: number;
    magicAttack?: { spellAttack: number; mastery: number; element: string | null } | null;
    targetMonsters: Monster[];
    maxDistance?: number;
    attackCount?: number;
    hitCadenceMs?: number;
  }): Projectile {
    const p = new Projectile({});
    p.skillId = opts.skillId || 0;
    p.attackCount = Math.max(1, opts.attackCount || 1);
    p.hitCadenceMs = opts.hitCadenceMs || 90;
    p.charecter = opts.charecter;
    p.pos = new ProjectilePhysics({
      x: opts.x,
      y: opts.y,
      right: opts.right,
      left: !opts.right,
    });
    p.originX = opts.x;
    p.originY = opts.y;
    p.maxDistance = opts.maxDistance || SINGLE_TARGET_REACH;
    p.isMovementEnabled = true;
    p.destroyed = false;
    p.targetMonsters = opts.targetMonsters;
    p.willHitkill = false;
    p.lastPositionCenter = { x: opts.x, y: opts.y };
    p.fixedDamage = opts.fixedDamage;
    p.magicAttack = opts.magicAttack || null;
    p.hitNode = opts.hitNode || null;

    // Use the skill's ball WZ node directly as the sprite source
    p.stance = opts.ballNode;
    if (opts.ballFrame != null && opts.ballNode.nChildren?.[opts.ballFrame]) {
      p.frame = opts.ballFrame;
      p.lockedFrame = true;
    } else {
      p.frame = 0;
    }
    p.delay = 0;
    const firstFrame = opts.ballNode.nChildren?.[p.frame];
    p.nextDelay = firstFrame?.nGet?.('delay')?.nValue ?? 90;

    if (p.magicAttack) {
      // Magic balls (Energy Bolt, Magic Claw) are target-locked at cast time
      p.findTargetForSkill();
    } else {
      // Thrown skill balls (Three Snails) fly straight — GMS behavior
      p.straightFlight = true;
    }
    return p;
  }

  constructor(opts: any) {
    this.opts = opts;
  }
  async load() {
    const opts = this.opts;
    this.id = opts.id;
    this.charecter = opts.charecter;
    this.pos = new ProjectilePhysics({
      x: opts.x,
      y: opts.y,
      right: opts.right || false,
      left: opts.left || false,
    });
    this.originX = opts.x;
    this.originY = opts.y;
    this.maxDistance = opts.maxDistance || SINGLE_TARGET_REACH;
    this.isMovementEnabled = true;
    this.destroyed = false;
    this.targetMonsters = opts.targetMonsters || [];
    this.willHitkill = false;
    this.lastPositionCenter = {
      x: this.pos.x,
      y: this.pos.y,
    };
    this.weaponAttackRange = opts.weaponAttackRange || 0;
    this.finalDamangeAfterTargetDefense = 0;

    let strId = `${this.id}`.padStart(8, "0");
    const idFirst4digits = strId.slice(0, 4);
    let projectileFile: any = await WZManager.get(
      `${WZFiles.Item}/Consume/${idFirst4digits}.img/${strId}`
    );

    this.stance = projectileFile.bullet;
    this.setFrame(projectileFile.bullet, 0);

    // A weapon skill (Double Shot) fires real ammo but shows the skill's own
    // `ball` art, and carries its hit art, multiplier and id for the sound
    this.skillId = opts.skillId || 0;
    this.damagePercent = opts.damagePercent ?? 1;
    this.hitNode = opts.hitNode || null;
    this.attackCount = Math.max(1, opts.attackCount || 1);
    this.hitCadenceMs = opts.hitCadenceMs || 90;
    if (opts.ballNode?.nChildren?.length) {
      this.stance = opts.ballNode;
      this.setFrame(opts.ballNode, 0);
    }

    this.checkIfFindTarget();
  }

  // Target finding for skill projectiles — uses fixed damage instead of weapon calc
  /**
   * Nearest live monster in front of the projectile, or null.
   *
   * `centerPosition` starts null and is only filled in by Monster.load(), so
   * a mob still loading — or one whose position has gone non-finite — has to
   * be dropped before any geometry touches it. Both the range test and the
   * distance test compare with `>` and `<`, and every comparison against NaN
   * is false, so such a monster would slip through the range filter and then
   * never win the closest-distance loop. That left the loop returning null
   * for a non-empty candidate list, which is how casting at a slime could
   * throw "Cannot read properties of null (reading 'centerPosition')".
   */
  private pickNearestTarget(): Monster | null {
    const usable = (m: Monster) => {
      const c = (m as any)?.centerPosition;
      return !!c && Number.isFinite(c.x) && Number.isFinite(c.y);
    };
    let closest: Monster | null = null;
    let closestDistance = Infinity;
    for (const monster of this.targetMonsters) {
      if (!usable(monster)) continue;
      if (!this.pos!.isWithinRange(monster.centerPosition, default_target_angle, this.maxDistance)) {
        continue;
      }
      const distance = this.pos!.distanceTo(monster.centerPosition);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = monster;
      }
    }
    return closest;
  }

  findTargetForSkill() {
    const closestMonster = this.pickNearestTarget();
    if (!closestMonster) return;

    this.target = closestMonster;
    this.pos!.setTarget(
      closestMonster.centerPosition.x,
      closestMonster.centerPosition.y
    );

    if (this.magicAttack) {
      // Magic ball skill (Energy Bolt, Magic Claw): v83 magic formula per target
      const stats = this.charecter!.stats;
      const rawRange = stats.getMagicAttackRange(
        this.magicAttack.spellAttack,
        this.magicAttack.mastery
      );
      const monsterMdd = this.target!.mobFile?.info?.MDDamage?.nValue ?? 0;
      const monsterLevel = this.target!.mobFile?.info?.level?.nValue ?? 1;
      const defRange = stats.getMagicDamageAfterMonsterDefense(rawRange, monsterMdd, monsterLevel);
      const isMiss = stats.getRandomIsMiss(monsterLevel, this.target!.eva ?? 0);
      if (isMiss) {
        this.finalDamangeAfterTargetDefense = 0;
      } else {
        const elemMult = this.target!.getElementalMultiplier?.(this.magicAttack.element) ?? 1;
        const baseDmg = Math.max(1, Stats.getRandomAttackDamageFromAttackRange(defRange));
        this.finalDamangeAfterTargetDefense = Math.max(1, Math.floor(baseDmg * elemMult));
      }
    } else {
      this.finalDamangeAfterTargetDefense = this.fixedDamage;
    }

    this.willHitkill = this.target!.willHitkill(this.finalDamangeAfterTargetDefense);
    if (this.willHitkill) {
      this.landLines(this.target!, this.pos!.x < this.target!.centerPosition.x ? 1 : -1);
    }
  }

  /**
   * One fresh damage line against `target` — the formula the first line used
   * (magic / fixed / weapon ammo), rolled again for the later lines of a
   * multi-line impact.
   */
  rollLine(target: Monster): { damage: number; crit: boolean } {
    const stats = this.charecter!.stats;
    const monsterLevel = target.mobFile?.info?.level?.nValue ?? 1;
    if (this.magicAttack) {
      const rawRange = stats.getMagicAttackRange(this.magicAttack.spellAttack, this.magicAttack.mastery);
      const monsterMdd = target.mobFile?.info?.MDDamage?.nValue ?? 0;
      const defRange = stats.getMagicDamageAfterMonsterDefense(rawRange, monsterMdd, monsterLevel);
      if (stats.getRandomIsMiss(monsterLevel, target.eva ?? 0)) return { damage: 0, crit: false };
      const elemMult = target.getElementalMultiplier?.(this.magicAttack.element) ?? 1;
      const baseDmg = Math.max(1, Stats.getRandomAttackDamageFromAttackRange(defRange));
      return { damage: Math.max(1, Math.floor(baseDmg * elemMult)), crit: false };
    }
    if (this.fixedDamage > 0 || !(this.weaponAttackRange?.max > 0)) {
      return { damage: this.fixedDamage, crit: false };
    }
    const attackRange = stats.getAttackDamageRangeAfterMonsterDefense(
      this.weaponAttackRange,
      target.mobFile?.info?.PDDamage?.nValue ?? 0,
      monsterLevel
    );
    if (stats.getRandomIsMiss(monsterLevel, target.mobFile?.info?.eva?.nValue ?? 0)) {
      return { damage: 0, crit: false };
    }
    let damage = Math.floor(Stats.getRandomAttackDamageFromAttackRange(attackRange) * this.damagePercent);
    let crit = false;
    if (damage > 0) {
      const weaponType = getEquipTypeById((this.charecter as any).weaponEquipId);
      const c = (this.charecter as any).skillManager?.getCritical?.(weaponType) ?? null;
      if (c && Math.random() < c.chance) {
        damage = Math.floor(damage * c.damagePct);
        crit = true;
      }
    }
    return { damage, crit };
  }

  /**
   * Land this projectile's damage on `target`: the rolled first line now,
   * then one more line per `attackCount` at the Hit art's cadence, each
   * stacked a row higher and without a second knockback. Later lines still
   * print on a mob the first one killed.
   */
  landLines(target: Monster, knockbackDir: number) {
    const first = this.finalDamangeAfterTargetDefense;
    target.hit(first, knockbackDir, this.charecter, this.isCritical, this.skillId);
    let stackOffset = Monster.damageRowHeight(this.isCritical);
    for (let h = 1; h < this.attackCount; h++) {
      const offset = stackOffset;
      setTimeout(() => {
        if (target.destroyed) return;
        const line = this.rollLine(target);
        target.hit(line.damage, 0, this.charecter, line.crit, this.skillId, null, offset);
        if (this.skillId) void playSkillSound(this.skillId, 'Hit');
      }, h * this.hitCadenceMs);
      // Row height is decided by the line's crit roll only when it lands;
      // reserve a normal row here so the column never overlaps
      stackOffset += Monster.damageRowHeight(false);
    }
  }

  checkIfFindTarget() {
    const closestMonster = this.pickNearestTarget();

    if (closestMonster) {
      this.target = closestMonster;
      this.pos!.setTarget(
        closestMonster.centerPosition.x,
        closestMonster.centerPosition.y
      );

      const attackRange =
        this.charecter!.stats.getAttackDamageRangeAfterMonsterDefense(
          this.weaponAttackRange,
          this.target!.mobFile.info.PDDamage.nValue,
          this.target!.mobFile.info.level.nValue
        );

      const isMiss = this.charecter!.stats.getRandomIsMiss(
        this.target!.mobFile.info.level.nValue,
        this.target!.mobFile.info.eva.nValue
      );
      this.finalDamangeAfterTargetDefense = isMiss
        ? 0
        : Math.floor(
            Stats.getRandomAttackDamageFromAttackRange(attackRange) * this.damagePercent
          );

      // Critical Shot / Critical Throw roll for ranged weapons
      if (this.finalDamangeAfterTargetDefense > 0) {
        const weaponType = getEquipTypeById((this.charecter as any).weaponEquipId);
        const crit = (this.charecter as any).skillManager?.getCritical?.(weaponType) ?? null;
        if (crit && Math.random() < crit.chance) {
          this.finalDamangeAfterTargetDefense = Math.floor(
            this.finalDamangeAfterTargetDefense * crit.damagePct
          );
          this.isCritical = true;
        }
      }

      // This follows the real maple, where if a projectile will kill a mob, it will hit it instantly
      this.willHitkill = this.target!.willHitkill(
        this.finalDamangeAfterTargetDefense
      );

      if (this.willHitkill) {
        this.landLines(this.target!, this.pos!.x < this.target!.centerPosition.x ? 1 : -1);
      } else {
        // will happen when projectile hits the mob
      }
    }
  }

  playAudio() {
    // if (!!this.sounds[name]) {
    //   PLAY_AUDIO(this.sounds[name]);
    // }ss
  }
  setFrame(stance: any, frame = 0, carryOverDelay = 0) {
    const f = !this.stance.nChildren[frame] ? 0 : frame;
    const stanceFrame = this.stance.nChildren[f];
    this.stance = stance;
    this.frame = f;
    this.delay = carryOverDelay;
    this.nextDelay = stanceFrame.nGet("delay").nGet("nValue", 100);
  }

  getTravelDistance() {
    return Math.sqrt(
      Math.pow(this.pos!.x - this.originX, 2) +
        Math.pow(this.pos!.y - this.originY, 2)
    );
  }

  destroy() {
    this.destroyed = true;
  }

  startHitEffect() {
    // A skill's shot lands with its own Hit clip (plain ammo stays silent
    // here, as before — the mob's own hit sound covers it)
    if (this.skillId) void playSkillSound(this.skillId, 'Hit');
    if (!this.hitNode?.nChildren) return;
    // Hit node structure: hit/0/{0,1,2,3,4,5} — first child is the frame set
    const frameSet = this.hitNode.nChildren[0];
    if (!frameSet?.nChildren || frameSet.nChildren.length === 0) return;
    this.hitEffectFrames = frameSet.nChildren;
    this.hitEffectFrame = 0;
    this.hitEffectDelay = 0;
    this.hitEffectActive = true;
    this.hitEffectX = this.pos!.x;
    this.hitEffectY = this.pos!.y;
  }

  // Returns true if projectile can be fully removed (no pending animations)
  isFullyDone(): boolean {
    return this.destroyed && !this.hitEffectActive;
  }

  // Straight-flight collision: hit the first living mob whose hitbox the ball
  // enters (no pre-selected target, damage rolled at impact)
  checkForStraightHit() {
    for (const monster of this.targetMonsters) {
      if (!monster || monster.dying || monster.isFake) continue;
      const rect = monster.getHitRect?.() ?? {
        x: monster.x,
        y: monster.y,
        width: monster.width,
        height: monster.height,
      };
      if (!isPositionInsideRect(this.pos!, rect)) continue;

      const knockbackDir = this.pos!.vx > 0 ? 1 : -1;
      this.finalDamangeAfterTargetDefense = this.fixedDamage;
      this.isCritical = false;
      this.landLines(monster, knockbackDir);
      this.startHitEffect();
      this.isMovementEnabled = false;
      this.destroy();
      return;
    }
  }

  checkForHittingTarget() {
    if (this.straightFlight) {
      this.checkForStraightHit();
      return;
    }
    if (!this.target) {
      return;
    }

    const targetRect = {
      x: this.target.x,
      y: this.target.y,
      width: this.target.width,
      height: this.target.height,
    };

    const isHit = isPositionInsideRect(this.pos!, targetRect);

    if (isHit) {
      if (!this.willHitkill) {
        this.landLines(this.target, this.pos!.x < this.target.centerPosition.x ? 1 : -1);
      }
      // Start skill hit effect animation if available
      this.startHitEffect();
      this.isMovementEnabled = false;
      this.destroy();
    }
  }

  update(msPerTick: number) {
    // Update hit effect animation (runs even after projectile is destroyed)
    if (this.hitEffectActive && this.hitEffectFrames) {
      this.hitEffectDelay += msPerTick;
      const curFrame = this.hitEffectFrames[this.hitEffectFrame];
      const frameDelay = curFrame?.nGet?.('delay')?.nValue ?? 100;
      if (this.hitEffectDelay > frameDelay) {
        this.hitEffectDelay -= frameDelay;
        this.hitEffectFrame++;
        if (this.hitEffectFrame >= this.hitEffectFrames.length) {
          this.hitEffectActive = false;
        }
      }
    }

    if (this.destroyed) return;

    this.delay += msPerTick;

    if (this.delay > this.nextDelay && !this.lockedFrame) {
      const hasNextFrame = !!this.stance.nChildren[this.frame + 1];
      if (!!this.dying && !hasNextFrame) {
        this.destroy();
        return;
      }
      this.setFrame(this.stance, this.frame + 1, this.delay - this.nextDelay);
    }

    if (this.isMovementEnabled) {
      this.pos!.update(msPerTick);
    }

    if (!this.destroyed) {
      if (this.getTravelDistance() > this.maxDistance) {
        this.destroy();
      } else {
        this.checkForHittingTarget();
      }
    }
  }

  draw(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    // Draw hit effect animation (plays even after projectile ball is destroyed)
    if (this.hitEffectActive && this.hitEffectFrames) {
      const hFrame = this.hitEffectFrames[this.hitEffectFrame];
      if (hFrame?.nGetImage) {
        const hImg = hFrame.nGetImage();
        if (hImg && hImg instanceof HTMLImageElement && hImg.complete && hImg.width > 0) {
          const ox = hFrame.origin?.nX ?? hFrame.nGet?.('origin')?.nGet?.('nX', 0) ?? 0;
          const oy = hFrame.origin?.nY ?? hFrame.nGet?.('origin')?.nGet?.('nY', 0) ?? 0;
          canvas.drawImage({
            img: hImg,
            dx: this.hitEffectX - ox - camera.x,
            dy: this.hitEffectY - oy - camera.y,
          });
        }
      }
    }

    // Don't draw the ball sprite if destroyed
    if (this.destroyed) return;

    if (this.pos!.vx > 0) {
      this.flipped = true;
    } else if (this.pos!.vx < 0) {
      this.flipped = false;
    }
    const currentFrame = this.stance.nChildren[this.frame];
    if (!currentFrame) return;
    const currentImage = currentFrame.nGetImage();

    const angle = this.flipped
      ? this.pos!.getNormalAngle()
      : this.pos!.getNormalAngle() + 180;

    canvas.drawImage({
      img: currentImage,
      dx: this.pos!.x - camera.x - currentFrame.nWidth / 2,
      dy: this.pos!.y - camera.y - currentFrame.nHeight / 2,
      flipped: !!this.flipped,
      angle,
    });

    this.lastPositionCenter = {
      x: this.pos!.x - camera.x,
      y: this.pos!.y - camera.y,
    };

    // draw body middle point - usefull for debugging
    // canvas.context.fillStyle = "red";
    // canvas.context.fillRect(
    //   this.pos.x - camera.x - 2,
    //   this.pos.y - camera.y - 2,
    //   4,
    //   4
    // );

    // draw a box around the projectile usefull for debugging
    // const boxColor = "orange"; // You can set the desired box color
    // const borderWidth = 2; // You can adjust the border width as needed
    // canvas.context.strokeStyle = boxColor;
    // canvas.context.lineWidth = borderWidth;
    // canvas.context.strokeRect(
    //   this.pos.x - camera.x - currentFrame.nWidth / 2,
    //   this.pos.y - camera.y - currentFrame.nHeight / 2,
    //   currentFrame.nWidth,
    //   currentFrame.nHeight
    // );

    // draw a line from the projectile to the target usefull for debugging
    // if (this.target) {
    //   console.log(this.target.centerPosition);
    //   canvas.context.strokeStyle = "red";
    //   canvas.context.beginPath();
    //   canvas.context.moveTo(this.pos.x - camera.x, this.pos.y - camera.y);
    //   canvas.context.lineTo(
    //     this.target.centerPosition.x - camera.x,
    //     this.target.centerPosition.y - camera.y
    //   );
    //   canvas.context.stroke();
    // }
  }
}

export default Projectile;
