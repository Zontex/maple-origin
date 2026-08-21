/**
 * The one tooltip plate every hover panel draws on.
 *
 * v83 has no tooltip frame sprite: UI.wz/UIWindow.img/ToolTip carries only
 * the equip glyphs, and UIToolTip.img does not exist in this version — the
 * copy under public/wz_client (fetched from a ~v140 client for its classic
 * REQ/job sprites) ships an `Item/Frame` that is that later client's opaque
 * black rounded frame, fixed at 261 wide, which is not what v83 drew. The
 * pre-Big-Bang client painted the panel itself: a translucent navy field with
 * a thin light rule, the scene still visible through it. Values were sampled
 * off reference captures — the body reads (68,74,125) and the skill tooltip's
 * header band (85,85,130) in captures with completely different scenes behind
 * them, a spread of ~17 that pins the alpha near 0.9.
 *
 * Keep every tooltip on this one routine so the look cannot drift per window.
 */

export const TOOLTIP_BODY = 'rgba(68, 74, 125, 0.9)';
export const TOOLTIP_HEADER = 'rgba(85, 85, 130, 0.9)';
export const TOOLTIP_RULE = 'rgba(150, 158, 200, 0.85)';

export interface PlateOptions {
  /** Height of the slightly lighter header band along the top (skill tooltip). */
  headerH?: number;
}

/**
 * Paint the tooltip panel at (x, y) sized w x h. Content is drawn by the
 * caller afterwards; this only owns the backdrop and its hairline.
 */
export function drawPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: PlateOptions = {},
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = TOOLTIP_BODY;
  ctx.fillRect(x, y, w, h);
  if (opts.headerH && opts.headerH > 0) {
    ctx.fillStyle = TOOLTIP_HEADER;
    ctx.fillRect(x, y, w, Math.min(h, opts.headerH));
  }
  ctx.strokeStyle = TOOLTIP_RULE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}
