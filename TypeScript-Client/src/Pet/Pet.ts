import { Physics } from '../Physics';
import GameCanvas from '../GameCanvas';
import PLAY_AUDIO from '../Audio/PlayAudio';
import Item from '../Inventory/Item';
import {
  PetWz,
  EffectAnim,
  loadPetData,
  loadWarpEffect,
  loadDefaultBalloon,
  BalloonArt,
} from './PetWzData';
import { drawPetNameTag, drawPetBalloon } from './PetOverlayUI';
import {
  PET_WALK_SPEED,
  PET_START_DIST,
  PET_STOP_DIST,
  PET_TELEPORT_X,
  PET_TELEPORT_Y,
  PET_STUCK_MS,
  PET_JUMP_DY,
  PET_JUMP_DX_MAX,
  PET_JUMP_COOLDOWN_MS,
  PET_HANG_Y_OFFSET,
  PET_IDLE_MIN_MS,
  PET_IDLE_MAX_MS,
  PET_HUNGRY_STANCE_AT,
  PET_BALLOON_MS,
} from './PetConstants';

interface ActiveEffect {
  frames: any[];
  i: number;
  delay: number;
  x: number; // world coords; ignored when followPet
  y: number;
  followPet: boolean;
}

/**
 * A summoned pet on the map. Runs real Physics (gravity + footholds) and a
 * follow AI toward its target — the owner for the first pet in the train,
 * the preceding pet otherwise. Persistent state (name/level/closeness/
 * fullness) lives in the inventory item's equipData blob, reached through
 * itemRef so every mutation is picked up by the ordinary save pipeline.
 */
class Pet {
  itemRef: Item;
  petId: number;
  wz!: PetWz;
  owner: any; // MapleCharacter
  isRemote = false;

  pos: Physics;
  facingLeft = true;
  stance = 'stand0';
  frame = 0;
  delay = 0;
  nextDelay = 100;
  zigDir = 1;

  oneShotStance: string | null = null;
  hover = false;
  stuckMs = 0;
  destroyed = false;

  balloonText: string | null = null;
  balloonUntil = 0;
  balloonArt: BalloonArt | null = null;

  activeEffect: ActiveEffect | null = null;
  equipOverlayNode: any | null = null; // Character.wz/PetEquip/<id>.img/<petId> node
  // Functional-equip flags from the worn item's info (pickupItem,
  // pickupMeso, consumeHP, consumeMP, longRange, ignorePickup, ...)
  equipFlags: Record<string, number> = {};

  // Extra stack offset while riding the climbing owner's back (train index)
  hangYExtra = 0;

  // Manager-driven timers (PetManager owns the logic, the state rides here)
  nextDecayAt = 0;
  nextRandActAt = 0;
  warnedHungry = false;
  lifeCheckpointAt = 0;
  nextLootAt = 0;
  nextPotionAt = 0;

  private _lastX = 0;
  private _nextJumpAt = 0;
  private _idleStance = 'stand0';
  private _idleRerollAt = 0;
  private _warpEffect: EffectAnim | null = null;

  // Filled by draw() for overlay anchoring / loot rects
  lastDrawTopY = 0;
  lastDrawWidth = 0;
  lastDrawHeight = 0;

  get data() {
    return this.itemRef.equipData as any;
  }

  static async fromItem(item: Item, owner: any): Promise<Pet> {
    const pet = new Pet(item, owner);
    await pet.load();
    return pet;
  }

  constructor(item: Item, owner: any) {
    this.itemRef = item;
    this.petId = item.itemId;
    this.owner = owner;
    this.pos = new Physics(owner.pos.x, owner.pos.y, PET_WALK_SPEED, true);
    this._lastX = this.pos.x;
  }

  async load() {
    this.wz = await loadPetData(this.petId);
    this.balloonArt = this.wz.balloonArt ?? (await loadDefaultBalloon());
    this._warpEffect = await loadWarpEffect(this.petId);
    this.setFrame(this.pickIdle(), 0);
  }

  // -------------------------------------------------------------- stances

  private hasStance(name: string): boolean {
    return !!this.wz?.stances[name]?.frames.length;
  }

  private pickIdle(): string {
    if ((this.data?.fullness ?? 100) <= PET_HUNGRY_STANCE_AT && this.hasStance('hungry')) {
      return 'hungry';
    }
    return this._idleStance && this.hasStance(this._idleStance) ? this._idleStance : 'stand0';
  }

  setFrame(stance: string, frame = 0, carryOverDelay = 0) {
    if (!this.hasStance(stance)) return;
    const frames = this.wz.stances[stance].frames;
    const f = frames[frame] ? frame : 0;
    this.stance = stance;
    this.frame = f;
    this.delay = carryOverDelay;
    this.zigDir = this.zigDir || 1;
    this.nextDelay = frames[f].nGet('delay').nGet('nValue', 100);
  }

  /** Play a stance once (command reactions, eating, level up), then resume AI stances */
  playOneShot(stance: string): boolean {
    if (!this.hasStance(stance)) return false;
    this.oneShotStance = stance;
    this.zigDir = 1;
    this.setFrame(stance, 0);
    const sound = this.wz.sounds[stance];
    if (sound) PLAY_AUDIO(sound);
    return true;
  }

  say(text: string, ms = PET_BALLOON_MS) {
    if (!text) return;
    this.balloonText = text;
    this.balloonUntil = Date.now() + ms;
  }

  playEffect(anim: EffectAnim | null, followPet: boolean) {
    if (!anim?.frames.length) return;
    this.activeEffect = {
      frames: anim.frames,
      i: 0,
      delay: 0,
      x: this.pos.x,
      y: this.pos.y,
      followPet,
    };
  }

  private advanceFrame(ms: number) {
    this.delay += ms;
    const stanceData = this.wz.stances[this.stance];
    if (!stanceData) return;
    while (this.delay > this.nextDelay) {
      const carry = this.delay - this.nextDelay;
      let next = this.frame + (stanceData.zigzag ? this.zigDir : 1);
      if (stanceData.zigzag) {
        if (next >= stanceData.frames.length || next < 0) {
          this.zigDir = -this.zigDir;
          next = this.frame + this.zigDir;
          if (next < 0 || next >= stanceData.frames.length) next = 0;
        }
      } else if (!stanceData.frames[next]) {
        // Completed a full pass
        if (this.oneShotStance) {
          this.oneShotStance = null;
          this.setFrame(this.pickIdle(), 0, carry);
          return;
        }
        next = 0;
      }
      this.setFrame(this.stance, next, carry);
      if (this.nextDelay <= 0) break; // defensive: zero-delay frame
    }
  }

  // -------------------------------------------------------------- update

  teleportToOwner(withWarpFx: boolean) {
    const t = this.owner;
    this.pos.x = t.pos.x;
    this.pos.y = t.pos.y - 10;
    this.pos.vx = 0;
    this.pos.vy = 0;
    this.pos.fh = null as any;
    this.pos.left = false;
    this.pos.right = false;
    this.stuckMs = 0;
    this._lastX = this.pos.x;
    if (withWarpFx) this.playEffect(this._warpEffect, false);
  }

  update(msPerTick: number, target: any) {
    if (this.destroyed || !this.wz) return;
    const now = Date.now();

    if (this.balloonText && now > this.balloonUntil) this.balloonText = null;

    // Effect animation clock (independent of the pet's stance clock)
    if (this.activeEffect) {
      const eff = this.activeEffect;
      eff.delay += msPerTick;
      const frameDelay = eff.frames[eff.i]?.nGet('delay').nGet('nValue', 100) ?? 100;
      if (eff.delay > frameDelay) {
        eff.delay -= frameDelay;
        eff.i++;
        if (!eff.frames[eff.i]) this.activeEffect = null;
      }
    }

    if (now > this._idleRerollAt) {
      this._idleRerollAt =
        now + PET_IDLE_MIN_MS + Math.random() * (PET_IDLE_MAX_MS - PET_IDLE_MIN_MS);
      this._idleStance =
        this.hasStance('stand1') && Math.random() < 0.35 ? 'stand1' : 'stand0';
    }

    const t = target ?? this.owner;

    // 1. Rope/ladder follow: cling to the climber's back. Hard-locked, no
    // easing — the pet must not trail or wobble while riding (pets tick
    // after their owner, so this is the owner's post-move position). Pets
    // draw before the player, so the torso covers the pet's front.
    // Local owners flag pos.isClimbing; remote owners only carry the stance
    if (t.pos?.isClimbing || t.stance === 'ladder' || t.stance === 'rope') {
      this.hover = true;
      this.pos.flying = true;
      this.pos.x = t.pos.x;
      this.pos.y = t.pos.y - PET_HANG_Y_OFFSET - this.hangYExtra;
      this.pos.vx = 0;
      this.pos.vy = 0;
      if (!this.oneShotStance && this.hasStance('hang') && this.stance !== 'hang') {
        this.setFrame('hang', 0);
      }
      this.advanceFrame(msPerTick);
      return;
    }
    if (this.hover) {
      this.hover = false;
      this.pos.flying = false;
      this.pos.fh = null as any;
    }

    const dx = t.pos.x - this.pos.x;
    const dy = t.pos.y - this.pos.y;

    // 2. Give-up teleport (always to the OWNER, not the chain target)
    if (
      Math.abs(dx) > PET_TELEPORT_X ||
      Math.abs(dy) > PET_TELEPORT_Y ||
      this.stuckMs > PET_STUCK_MS
    ) {
      this.teleportToOwner(true);
      this.advanceFrame(msPerTick);
      return;
    }

    // 3. Walk decision with hysteresis
    const walking = this.pos.left || this.pos.right;
    const wantWalk = Math.abs(dx) > (walking ? PET_STOP_DIST : PET_START_DIST);
    const moveAllowed = !this.oneShotStance; // acting pets stand still
    this.pos.left = moveAllowed && wantWalk && dx < 0;
    this.pos.right = moveAllowed && wantWalk && dx > 0;
    if (this.pos.left || this.pos.right) this.facingLeft = dx < 0;

    // 4. Ledge hop toward a target clearly above and near
    if (
      (this.pos.left || this.pos.right) &&
      this.pos.fh &&
      dy < -PET_JUMP_DY &&
      Math.abs(dx) < PET_JUMP_DX_MAX &&
      now > this._nextJumpAt
    ) {
      this.pos.jump();
      this._nextJumpAt = now + PET_JUMP_COOLDOWN_MS;
    }

    // 5. Stuck detection (blocked by wall — teleport via step 2 next passes)
    this.stuckMs =
      (this.pos.left || this.pos.right) && Math.abs(this.pos.x - this._lastX) < 0.5
        ? this.stuckMs + msPerTick
        : 0;
    this._lastX = this.pos.x;

    this.pos.update(msPerTick);

    // 6. Stance selection (frozen during one-shots)
    if (!this.oneShotStance) {
      const airborne = !this.pos.fh;
      const wanted = airborne
        ? this.hasStance('jump')
          ? 'jump'
          : this.hasStance('fly')
            ? 'fly'
            : this.stance
        : this.pos.left || this.pos.right
          ? 'move'
          : this.pickIdle();
      if (wanted !== this.stance) this.setFrame(wanted, 0);
    }
    this.advanceFrame(msPerTick);
  }

  // -------------------------------------------------------------- draw

  draw(canvas: GameCanvas, camera: any) {
    if (this.destroyed || !this.wz) return;
    const frames = this.wz.stances[this.stance]?.frames;
    const currentFrame = frames?.[this.frame];
    if (!currentFrame) return;

    const img = currentFrame.nGetImage();
    const originX = currentFrame.nGet('origin').nGet('nX', 0);
    const originY = currentFrame.nGet('origin').nGet('nY', 0);
    // Pet sprites face left in the WZ; flip when facing right
    const flipped = !this.facingLeft;
    const adjustX = !flipped ? originX : currentFrame.nWidth - originX;

    const dx = this.pos.x - camera.x - adjustX;
    const dy = this.pos.y - camera.y - originY;
    canvas.drawImage({ img, dx, dy, flipped });

    this.lastDrawTopY = this.pos.y - originY;
    this.lastDrawWidth = currentFrame.nWidth;
    this.lastDrawHeight = currentFrame.nHeight;

    // Cosmetic pet equip overlay: same stance/frame index, its own origin
    if (this.equipOverlayNode) {
      let overlayFrame = this.equipOverlayNode[this.stance]?.[String(this.frame)];
      if (overlayFrame?.nTagName === 'uol') overlayFrame = overlayFrame.nResolveUOL?.();
      if (overlayFrame?.nTagName === 'canvas') {
        const oImg = overlayFrame.nGetImage();
        const oX = overlayFrame.nGet('origin').nGet('nX', 0);
        const oY = overlayFrame.nGet('origin').nGet('nY', 0);
        const oAdjustX = !flipped ? oX : overlayFrame.nWidth - oX;
        canvas.drawImage({
          img: oImg,
          dx: this.pos.x - camera.x - oAdjustX,
          dy: this.pos.y - camera.y - oY,
          flipped,
        });
      }
    }

    // Effect (warp/levelup/evolution) — plays over the pet
    if (this.activeEffect) {
      const eff = this.activeEffect;
      const frame = eff.frames[eff.i];
      if (frame) {
        const eImg = frame.nGetImage();
        const eX = frame.nGet('origin').nGet('nX', 0);
        const eY = frame.nGet('origin').nGet('nY', 0);
        const ax = eff.followPet ? this.pos.x : eff.x;
        const ay = eff.followPet ? this.pos.y : eff.y;
        canvas.drawImage({
          img: eImg,
          dx: ax - camera.x - eX,
          dy: ay - camera.y - eY,
        });
      }
    }
  }

  drawOverlays(canvas: GameCanvas, camera: any) {
    if (this.destroyed || !this.wz) return;
    const screenX = this.pos.x - camera.x;
    drawPetNameTag(
      canvas,
      this.wz.nameTagArt,
      this.data?.petName ?? this.wz.name,
      screenX,
      this.pos.y - camera.y
    );
    if (this.balloonText && this.balloonArt) {
      drawPetBalloon(
        canvas,
        this.balloonArt,
        this.balloonText,
        screenX,
        this.lastDrawTopY - camera.y
      );
    }
  }

  destroy() {
    this.destroyed = true;
  }
}

export default Pet;
