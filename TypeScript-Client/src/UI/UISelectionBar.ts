import WZManager from '../wz-utils/WZManager';

/**
 * Selected-row highlight for the list windows (party, buddy, guild, quest
 * log).
 *
 * None of those windows ships its own selection art in v83 — UserList's
 * partyN / friendN / guildinfoN canvases are headers, column rows and rules —
 * so
 * the bar comes from the one list highlight the v83 UI.wz does carry,
 * `UIWindow.img/Teleport/select` (158x17, a flat (51,102,153) field). It is
 * stretched to the row and drawn translucent so the row's own art and black
 * text stay readable underneath, which is also how the highlight looked.
 */

let bar: HTMLImageElement | null = null;
let loading = false;

function ensureLoaded(): void {
  if (bar || loading) return;
  loading = true;
  WZManager.get('UI.wz/UIWindow.img/Teleport/select')
    .then((node: any) => {
      bar = node?.nGetImage?.() || null;
    })
    .catch((e) => console.warn('[UISelectionBar] Teleport/select missing:', e))
    .finally(() => { loading = false; });
}

/**
 * Draw the highlight over a row rect. Nothing is drawn until the sprite has
 * decoded (first call kicks the load), which is at most a frame or two.
 */
export function drawSelectionBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number = 0.3,
): void {
  if (!bar) { ensureLoaded(); return; }
  if (!bar.complete || bar.naturalWidth === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(bar, 0, 0, bar.width, bar.height, x, y, w, h);
  ctx.restore();
}
