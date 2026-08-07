import { CameraInterface } from "./Camera";
import { Position } from "./Effects/DamageIndicator";
import { Rectangle } from "./Physics/Collision";

/**
 * Checks if a point is within a rectangle.
 *
 * @param {int} point.x - X coordinate of point.
 * @param {int} point.y - Y coordinate of point.
 * @param {int} rectangle.x - Left position of rectangle.
 * @param {int} rectangle.y - Top position of rectangle.
 * @param {int} rectangle.width - Width of rectangle.
 * @param {int} rectangle.height - Height of rectangle.
 * @return {Boolean} True if point is within rectangle, false otherwise.
 */
const pointInRectangle = function (
  point: Position,
  rectangle: Rectangle
): boolean {
  return (
    point.x >= rectangle.x &&
    point.x < rectangle.x + rectangle.width &&
    point.y >= rectangle.y &&
    point.y < rectangle.y + rectangle.height
  );
};

/**
 * Checks if two rectangles overlap.
 *
 * @param {int} r1.x - Left position of rectangle 1.
 * @param {int} r1.y - Top position of rectangle 1.
 * @param {int} r1.width - Width of rectangle 1.
 * @param {int} r2.height - Height of rectangle 1.
 * @param {int} r2.x - Left position of rectangle 2.
 * @param {int} r2.y - Top position of rectangle 2.
 * @param {int} r2.width - Width of rectangle 2.
 * @param {int} r2.height - Height of rectangle 2.
 * @return {Boolean} True if rectangles overlap, false otherwise.
 */
const rectanglesOverlap = function (r1: Rectangle, r2: Rectangle): boolean {
  const xOverlap =
    (r1.x >= r2.x && r1.x < r2.x + r2.width) ||
    (r2.x >= r1.x && r2.x < r1.x + r1.width);
  const yOverlap =
    (r1.y >= r2.y && r1.y < r2.y + r2.height) ||
    (r2.y >= r1.y && r2.y < r1.y + r1.height);
  return xOverlap && yOverlap;
};

/**
 * Checks if an image is within a camera's viewport.
 *
 * @param {int} camera.x - Left offset of camera.
 * @param {int} camera.y - Top offset of camera.
 * @param {int} camera.width - Width of camera.
 * @param {int} camera.height - Height of camera.
 * @param {Image} img - Image object.
 * @param {int} dx - Destination x.
 * @param {int} dy - Destination y.
 * @return {Boolean} True if image is within viewport, false otherwise.
 */
const imageInView = function (
  camera: CameraInterface,
  img: any,
  dx: number,
  dy: number
) {
  const r1 = {
    x: camera.x,
    y: camera.y,
    width: camera.width,
    height: camera.height,
  };
  const r2 = {
    x: dx,
    y: dy,
    width: dx + img.width,
    height: dy + img.height,
  };
  return GUIUtil.rectanglesOverlap(r1, r2);
};

/**
 * Steps across a 9-patch edge or fill, calling cb at each tile position.
 *
 * These loops step by a source image's own width/height, which is 0 until
 * the image decodes — and stepping by 0 never terminates, which hangs the
 * whole tab, not just the frame. A non-positive step draws nothing and the
 * next frame retries once the image is ready.
 *
 * @param {int} start - First tile position.
 * @param {int} end - Exclusive end position.
 * @param {int} step - Tile size; non-positive means "not ready, skip".
 * @param {function} cb - Called with each tile position.
 */
const tileRange = function (
  start: number,
  end: number,
  step: number,
  cb: (v: number) => void
) {
  if (!(step > 0)) return;
  for (let v = start; v < end; v += step) cb(v);
};

/**
 * Width/height of a WZ canvas node, preferring the dimensions baked into the
 * JSON. Those are correct the instant the file parses, whereas
 * nGetImage().width is 0 until the image decodes — long enough that layout
 * and hit-test rectangles computed once at construction got baked wrong and
 * never recovered. Resolves UOLs and falls back to the image if a node lacks
 * the metadata.
 */
const wzSize = function (node: any): { width: number; height: number } {
  const n = node?.nTagName === "uol" ? node.nResolveUOL() : node;
  if (!n) return { width: 0, height: 0 };
  if (n.nWidth !== undefined && n.nHeight !== undefined) {
    return { width: n.nWidth, height: n.nHeight };
  }
  // Fall back to the image only for $canvas nodes — nGetImage() on an
  // $imgdir corrupts rendering, so a node without dimensions and without a
  // canvas tag simply has no size
  if (n.nTagName !== "canvas") return { width: 0, height: 0 };
  const img = n.nGetImage?.();
  return { width: img?.width ?? 0, height: img?.height ?? 0 };
};

/**
 * The rows of a sprite that actually have ink in them.
 *
 * A handful of WZ canvases are far taller than the art they hold — the Lost
 * Kid (NPC 1209006) is authored as 43x477 with the child occupying only the
 * bottom 52px and the rest filled with near-invisible alpha. Anything that
 * sizes itself to `nHeight` ends up reserving room for emptiness, which is
 * how one NPC could stretch the dialog frame past the top and bottom of the
 * screen.
 *
 * Returns null while the image is still decoding — callers should fall back
 * to the declared canvas size until then.
 */
const INK_ALPHA = 24;  // the padding rows top out around 32; real art is 255
const inkBoundsCache = new WeakMap<HTMLImageElement, { top: number; height: number }>();

function verticalInkBounds(
  img: HTMLImageElement | null | undefined
): { top: number; height: number } | null {
  if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return null;
  const cached = inkBoundsCache.get(img);
  if (cached) return cached;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  let bounds = { top: 0, height: h };
  try {
    const scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, w, h);
      let first = -1;
      let last = -1;
      for (let y = 0; y < h; y++) {
        const rowStart = y * w * 4;
        for (let x = 0; x < w; x++) {
          if (data[rowStart + x * 4 + 3] > INK_ALPHA) {
            if (first < 0) first = y;
            last = y;
            break;
          }
        }
      }
      if (first >= 0) bounds = { top: first, height: last - first + 1 };
    }
  } catch {
    // Reading pixels can throw on a tainted canvas — keep the full height
  }
  inkBoundsCache.set(img, bounds);
  return bounds;
}

const GUIUtil = {
  pointInRectangle,
  rectanglesOverlap,
  imageInView,
  tileRange,
  wzSize,
  verticalInkBounds,
};

export default GUIUtil;
