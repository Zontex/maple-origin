/**
 * Sprite warm-up helpers.
 *
 * Every WZ canvas becomes an HTMLImageElement the first time something calls
 * `nGetImage()`, and `drawImage` of an image that has not finished loading
 * draws nothing — so whatever is composed lazily on the draw path (a
 * character's walk frames, a skill's effect) is invisible for its first few
 * renders. Warming = creating the images ahead of time and `decode()`-ing
 * them off the main thread, sliced across idle time so the game loop never
 * stalls on it.
 */

/** Resolves in the next idle period (or the next tick where idle callbacks don't exist). */
export function nextIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as any).requestIdleCallback;
    if (typeof ric === 'function') ric(() => resolve(), { timeout: 250 });
    else setTimeout(resolve, 16);
  });
}

/** Decode a batch of images; never throws, never blocks the caller's frame. */
export function decodeImages(imgs: Iterable<any>): Promise<void> {
  const work: Promise<void>[] = [];
  for (const img of imgs) {
    if (img instanceof HTMLImageElement && typeof img.decode === 'function') {
      work.push(img.decode().catch(() => {}));
    }
  }
  return Promise.all(work).then(() => undefined);
}

/**
 * Every canvas image under a WZ node (UOLs followed), excluding icon
 * nodes. Creates the HTMLImageElements as a side effect — that is the point.
 */
export function collectNodeImages(node: any, out: any[] = [], depth = 0): any[] {
  if (!node || depth > 8) return out;
  const name = String(node.nName ?? '');
  if (/^icon/i.test(name)) return out;
  if (node.nTagName === 'canvas') {
    try { out.push(node.nGetImage()); } catch { /* broken canvas */ }
    return out;
  }
  if (node.nTagName === 'uol') {
    try { return collectNodeImages(node.nResolveUOL(), out, depth + 1); } catch { return out; }
  }
  for (const child of node.nChildren || []) collectNodeImages(child, out, depth + 1);
  return out;
}
