import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import { isPositionInsideRect } from '../Physics/Collision';

const MOB_PROJECTILE_SPEED = 400; // px/s
const MOB_PROJECTILE_LIFETIME_MS = 3000;

/**
 * A mob's ranged attack projectile (attackN type 2 "ball" frames).
 * Travels horizontally from the mob; each client collides it against its own
 * local player only, matching the client-authoritative damage model.
 */
class MobProjectile {
  x: number;
  y: number;
  vx: number;
  flipped: boolean;
  frames: any[];
  frameIdx: number = 0;
  delay: number = 0;
  traveled: number = 0;
  lifetime: number = 0;
  maxDistance: number;
  sourceMob: any;
  padOverride: number | undefined;
  isMagic: boolean;
  destroyed: boolean = false;

  constructor(opts: {
    x: number;
    y: number;
    facingRight: boolean;
    ballNode: any;
    maxDistance?: number;
    sourceMob: any;
    padOverride?: number;
    isMagic?: boolean;
  }) {
    this.x = opts.x;
    this.y = opts.y;
    this.flipped = opts.facingRight;
    this.vx = opts.facingRight ? MOB_PROJECTILE_SPEED : -MOB_PROJECTILE_SPEED;
    this.frames = (opts.ballNode?.nChildren || []).filter((f: any) => f.nGetImage);
    this.maxDistance = opts.maxDistance || 600;
    this.sourceMob = opts.sourceMob;
    this.padOverride = opts.padOverride;
    this.isMagic = opts.isMagic || false;
  }

  update(msPerTick: number) {
    if (this.destroyed) return;

    const dx = this.vx * (msPerTick / 1000);
    this.x += dx;
    this.traveled += Math.abs(dx);
    this.lifetime += msPerTick;

    // Animate ball frames
    if (this.frames.length > 1) {
      this.delay += msPerTick;
      const frameDelay = this.frames[this.frameIdx]?.nGet?.('delay')?.nValue ?? 100;
      if (this.delay > frameDelay) {
        this.delay -= frameDelay;
        this.frameIdx = (this.frameIdx + 1) % this.frames.length;
      }
    }

    if (this.traveled >= this.maxDistance || this.lifetime >= MOB_PROJECTILE_LIFETIME_MS) {
      this.destroyed = true;
      return;
    }

    // Collide against the local player only
    const player = (window as any).charecter;
    if (!player || player.isDead || !player.bodyRects?.length) return;
    for (const rect of player.bodyRects) {
      if (isPositionInsideRect({ x: this.x, y: this.y }, rect)) {
        player.applyMobAttack?.(this.sourceMob, this.padOverride, this.isMagic);
        this.destroyed = true;
        return;
      }
    }
  }

  draw(canvas: GameCanvas, camera: CameraInterface) {
    if (this.destroyed) return;
    const frame = this.frames[this.frameIdx];
    if (!frame) return;
    try {
      const img = frame.nGetImage();
      const originX = frame.nGet('origin').nGet('nX', 0);
      const originY = frame.nGet('origin').nGet('nY', 0);
      const adjustX = !this.flipped ? originX : frame.nWidth - originX;
      canvas.drawImage({
        img,
        dx: Math.round(this.x - camera.x - adjustX),
        dy: Math.round(this.y - camera.y - originY),
        flipped: this.flipped,
      });
    } catch { /* skip broken frame */ }
  }
}

export default MobProjectile;
