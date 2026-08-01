/**
 * Impact animations for melee attack skills.
 *
 * Projectile skills already draw their own `hit` node (Projectile.startHitEffect),
 * but melee skills like Magic Claw had nothing — createHitEffect was a stub that
 * only logged. These are short, fire-and-forget animations anchored to the mob
 * they landed on.
 *
 * WZ layout: <skill>/hit/<variant>/<0..n canvases>. Energy Bolt ships two
 * variants, Magic Claw one; the variant is picked at random like the original.
 */

interface ActiveHit {
  frames: any[];
  frame: number;
  delay: number;
  x: number;
  y: number;
  flipped: boolean;
}

const active: ActiveHit[] = [];
let lastTick = 0;

/** Spawn the skill's own impact animation on a mob. No-op without a hit node. */
export function spawnSkillHit(
  hitNode: any,
  x: number,
  y: number,
  flipped: boolean = false
): void {
  const variants = (hitNode?.nChildren || []).filter(
    (v: any) => (v?.nChildren || []).length > 0
  );
  if (variants.length === 0) return;

  const variant = variants[Math.floor(Math.random() * variants.length)];
  const frames = (variant.nChildren || []).filter((f: any) => f?.nGetImage);
  if (frames.length === 0) return;

  active.push({ frames, frame: 0, delay: 0, x, y, flipped });
}

export function clearSkillHits(): void {
  active.length = 0;
}

/**
 * Advance and draw. Time is tracked here so this needs only a single hook in
 * the map's render path rather than a second one in its update path.
 */
export function drawSkillHits(canvas: any, camera: { x: number; y: number }): void {
  const now = performance.now();
  const dt = lastTick === 0 ? 16 : Math.min(100, now - lastTick);
  lastTick = now;

  for (let i = active.length - 1; i >= 0; i--) {
    const h = active[i];
    const cur = h.frames[h.frame];

    const frameDelay = cur?.delay?.nValue ?? cur?.nGet?.('delay')?.nValue ?? 90;
    h.delay += dt;
    if (h.delay > frameDelay) {
      h.delay -= frameDelay;
      h.frame += 1;
    }
    if (h.frame >= h.frames.length || !h.frames[h.frame]) {
      active.splice(i, 1);
      continue;
    }

    const f = h.frames[h.frame];
    if (!f?.nGetImage) continue;
    const img = f.nGetImage();
    if (!img || (img instanceof HTMLImageElement && !img.complete) || !img.width) continue;

    const ox = f.origin?.nX ?? 0;
    const oy = f.origin?.nY ?? 0;
    canvas.drawImage({
      img,
      dx: h.x - ox - camera.x,
      dy: h.y - oy - camera.y,
    });
  }
}
