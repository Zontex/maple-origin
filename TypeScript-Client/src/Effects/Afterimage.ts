import WZManager from '../wz-utils/WZManager';

/**
 * Weapon afterimage trails — the streak that follows a swing.
 *
 * WZ layout (Character.wz/Afterimage/<name>.img):
 *   <attackSpeed 0..10>/<stance>/<triggerFrame>/<0..n canvases>
 * plus `lt`/`rb` vectors on the stance node describing the hit range.
 *
 * The numeric key under the stance is the frame of the attack animation at
 * which the trail appears — the swing's apex, not frame 0. Barehands stabO1
 * triggers at 1, swordOS swingO1 at 2.
 */

export interface AfterimageAnim {
  frames: any[];
  triggerFrame: number;
}

// Character.wz/Weapon/<id>.img/info — afterImage name + attackSpeed
interface WeaponAfterimageInfo {
  name: string;
  speed: number;
}

const animCache = new Map<string, AfterimageAnim | null>();
const weaponCache = new Map<number, WeaponAfterimageInfo | null>();

/** Bare hands (and anything with no afterImage property) use barehands.img. */
const BAREHANDS: WeaponAfterimageInfo = { name: 'barehands', speed: 4 };

/**
 * Read `afterImage` and `attackSpeed` straight off the weapon, the way the
 * original client does — a per-type table would get wands wrong (they use
 * `mace`, not a wand-specific sheet).
 */
export async function getWeaponAfterimageInfo(
  weaponItemId: number | null | undefined
): Promise<WeaponAfterimageInfo> {
  if (!weaponItemId) return BAREHANDS;
  if (weaponCache.has(weaponItemId)) return weaponCache.get(weaponItemId) || BAREHANDS;

  let info: WeaponAfterimageInfo | null = null;
  try {
    const padded = String(weaponItemId).padStart(8, '0');
    const node: any = await WZManager.get(`Character.wz/Weapon/${padded}.img`);
    const wzInfo: any = node?.nGet?.('info');
    const name = wzInfo?.nGet?.('afterImage')?.nValue;
    if (name && name !== 'blank') {
      info = {
        name: String(name),
        speed: Number(wzInfo?.nGet?.('attackSpeed')?.nValue ?? 4),
      };
    }
  } catch (e) {
    // A weapon with no afterimage data is normal — fall through to barehands
  }

  weaponCache.set(weaponItemId, info);
  return info || BAREHANDS;
}

/**
 * Load the trail for one weapon/stance. Returns null when the sheet has no
 * entry for that stance, which is common — not every swing has a trail.
 */
export async function loadAfterimage(
  weaponItemId: number | null | undefined,
  stance: string
): Promise<AfterimageAnim | null> {
  const { name, speed } = await getWeaponAfterimageInfo(weaponItemId);
  const key = `${name}/${speed}/${stance}`;
  if (animCache.has(key)) return animCache.get(key) || null;

  let anim: AfterimageAnim | null = null;
  try {
    const root: any = await WZManager.get(`Character.wz/Afterimage/${name}.img`);
    // Speed groups run 0..10; clamp rather than risk an empty node
    const group: any = root?.nGet?.(String(Math.max(0, Math.min(10, speed))));
    const stanceNode: any = group?.nGet?.(stance);
    const children = stanceNode?.nChildren || [];

    // Children are the numeric trigger-frame dir(s) plus the lt/rb vectors
    const trigger = children.find((c: any) => /^\d+$/.test(String(c.nName)));
    if (trigger) {
      const frames = (trigger.nChildren || []).filter((f: any) => f?.nGetImage);
      if (frames.length > 0) {
        anim = { frames, triggerFrame: Number(trigger.nName) };
      }
    }
  } catch (e) {
    console.error('[Afterimage] load failed:', name, stance, e);
  }

  animCache.set(key, anim);
  return anim;
}

/** Live trail attached to a character. */
export class AfterimageState {
  frames: any[] = [];
  frame: number = 0;
  delay: number = 0;
  triggerFrame: number = 0;
  armed: boolean = false;
  active: boolean = false;
  // Latched at ignition so the trail keeps its place if the character turns
  x: number = 0;
  y: number = 0;
  flipped: boolean = false;

  /** Queue a trail to fire once the attack animation reaches its apex. */
  arm(anim: AfterimageAnim) {
    this.frames = anim.frames;
    this.triggerFrame = anim.triggerFrame;
    this.armed = true;
    this.active = false;
    this.frame = 0;
    this.delay = 0;
  }

  cancel() {
    this.armed = false;
    this.active = false;
  }

  /** Fire when the body animation reaches the trigger frame. */
  tryIgnite(bodyFrame: number, x: number, y: number, flipped: boolean) {
    if (!this.armed || bodyFrame < this.triggerFrame) return;
    this.armed = false;
    this.active = true;
    this.frame = 0;
    this.delay = 0;
    this.x = x;
    this.y = y;
    this.flipped = flipped;
  }

  update(msPerTick: number) {
    if (!this.active) return;
    const cur = this.frames[this.frame];
    const frameDelay = cur?.delay?.nValue ?? cur?.nGet?.('delay')?.nValue ?? 90;
    this.delay += msPerTick;
    if (this.delay > frameDelay) {
      this.delay -= frameDelay;
      this.frame += 1;
    }
    if (this.frame >= this.frames.length || !this.frames[this.frame]) {
      this.active = false;
      this.frame = 0;
      this.delay = 0;
    }
  }

  /**
   * Per-frame alpha: WZ gives a0/a1 as the fade endpoints, so the streak
   * thins out instead of vanishing on the last frame.
   */
  private frameAlpha(f: any): number {
    const a0 = f?.a0?.nValue ?? f?.nGet?.('a0')?.nValue;
    const a1 = f?.a1?.nValue ?? f?.nGet?.('a1')?.nValue;
    if (a0 == null && a1 == null) return 1;
    const start = (a0 ?? 255) / 255;
    const end = (a1 ?? a0 ?? 255) / 255;
    const cur = this.frames[this.frame];
    const d = cur?.delay?.nValue ?? 90;
    const t = d > 0 ? Math.min(1, this.delay / d) : 0;
    return start + (end - start) * t;
  }

  draw(canvas: any, camera: { x: number; y: number }) {
    if (!this.active) return;
    const f = this.frames[this.frame];
    if (!f?.nGetImage) return;
    const img = f.nGetImage();
    if (!img || (img instanceof HTMLImageElement && !img.complete) || !img.width) return;

    const ox = f.origin?.nX ?? 0;
    const oy = f.origin?.nY ?? 0;
    // Sprites are authored facing left; mirror the origin when facing right
    const dx = this.flipped ? this.x - (img.width - ox) : this.x - ox;

    canvas.drawImage({
      img,
      dx: dx - camera.x,
      dy: this.y - oy - camera.y,
      flipped: this.flipped,
      alpha: this.frameAlpha(f),
    });
  }
}
