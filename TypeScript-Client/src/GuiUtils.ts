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

const GUIUtil = {
  pointInRectangle,
  rectanglesOverlap,
  imageInView,
  tileRange,
  wzSize,
};

export default GUIUtil;
