/**
 * UI Development Tools — helps position UI elements accurately.
 *
 * F8  — Screenshot + Layout Dump
 *       Saves canvas as PNG + dumps all tracked UI element positions to console & JSON file.
 *
 * F11 — Reference Image Overlay
 *       Loads a reference image and draws it semi-transparently over the game.
 *       Use to compare against GMS screenshots.
 *
 * wzInspect(path) — Console utility
 *       Dumps WZ node tree with types, dimensions, origins.
 *       Example: wzInspect('UI.wz/Basic.img/Notice4')
 */

import GameCanvas from '../GameCanvas';
import WZManager from '../wz-utils/WZManager';
import WZNode from '../wz-utils/WZNode';
import config from '../Config';

// ─── Element Tracker ────────────────────────────────────────────────
// UI code calls UIDevTools.track() each frame to register what's being drawn and where.
// F8 dumps all tracked elements.

interface TrackedElement {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  wzPath?: string;
  /** 'screen' = fixed UI, 'world' = camera-relative */
  space: 'screen' | 'world';
  /** optional parent element name */
  parent?: string;
}

const _tracked: Map<string, TrackedElement> = new Map();
let _trackingFrame = 0;
const _lastSeenFrame: Map<string, number> = new Map();

// ─── Reference Overlay ──────────────────────────────────────────────
let _refImage: HTMLImageElement | null = null;
let _refAlpha = 0.4;
let _refVisible = false;
let _refOffsetX = 0;
let _refOffsetY = 0;

// ─── Screenshot state ───────────────────────────────────────────────
let _screenshotRequested = false;
let _dumpRequested = false;

// ─── Keyboard listeners ─────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  // F8 — Screenshot + dump
  if (e.key === 'F8') {
    e.preventDefault();
    _screenshotRequested = true;
    _dumpRequested = true;
    console.log('[UIDevTools] F8 — capturing screenshot + layout dump...');
  }

  // F11 — Toggle reference overlay
  if (e.key === 'F11') {
    e.preventDefault();
    if (!_refImage) {
      // Prompt user to pick a file
      _pickReferenceImage();
    } else {
      _refVisible = !_refVisible;
      console.log(`[UIDevTools] Reference overlay ${_refVisible ? 'ON' : 'OFF'} (alpha=${_refAlpha})`);
      if (_refVisible) {
        console.log('[UIDevTools] Shift+F11 to unload. +/- to adjust opacity. Arrow keys to nudge position.');
      }
    }
  }

  // Shift+F11 — Unload reference image
  if (e.key === 'F11' && e.shiftKey) {
    e.preventDefault();
    _refImage = null;
    _refVisible = false;
    console.log('[UIDevTools] Reference image unloaded.');
  }

  // When overlay is visible, adjust with keys
  if (_refVisible) {
    if (e.key === '=' || e.key === '+') {
      _refAlpha = Math.min(1, _refAlpha + 0.1);
      console.log(`[UIDevTools] Ref overlay alpha: ${_refAlpha.toFixed(1)}`);
    }
    if (e.key === '-') {
      _refAlpha = Math.max(0.05, _refAlpha - 0.1);
      console.log(`[UIDevTools] Ref overlay alpha: ${_refAlpha.toFixed(1)}`);
    }
    // Shift+arrows nudge reference image position
    if (e.shiftKey && e.key === 'ArrowLeft') { _refOffsetX -= 1; }
    if (e.shiftKey && e.key === 'ArrowRight') { _refOffsetX += 1; }
    if (e.shiftKey && e.key === 'ArrowUp') { _refOffsetY -= 1; }
    if (e.shiftKey && e.key === 'ArrowDown') { _refOffsetY += 1; }
  }
});

function _pickReferenceImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        _refImage = img;
        _refVisible = true;
        _refOffsetX = 0;
        _refOffsetY = 0;
        console.log(`[UIDevTools] Reference loaded: ${img.width}x${img.height}. F11 to toggle, Shift+F11 to unload.`);
        console.log('[UIDevTools] +/- adjust opacity. Shift+arrows nudge position.');
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);
}

// ─── Public API ─────────────────────────────────────────────────────

const UIDevTools = {
  /**
   * Track a UI element being drawn this frame.
   * Call this from draw code to register element positions.
   *
   * @example
   * UIDevTools.track('statusBar', dx, dy, width, height, 'screen');
   * UIDevTools.track('npcDialog.top', this.x, this.y, topW, topH, 'screen', 'UI.wz/Chat/Notice');
   */
  track(
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    space: 'screen' | 'world' = 'screen',
    wzPath?: string,
    parent?: string,
  ) {
    _tracked.set(name, { name, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), space, wzPath, parent });
    _lastSeenFrame.set(name, _trackingFrame);
  },

  /**
   * Call once per frame at the START of the render loop to advance tracking.
   */
  beginFrame() {
    _trackingFrame++;
    // Prune elements not seen for 2+ frames (they stopped being drawn)
    for (const [name, lastFrame] of _lastSeenFrame) {
      if (_trackingFrame - lastFrame > 2) {
        _tracked.delete(name);
        _lastSeenFrame.delete(name);
      }
    }
  },

  /**
   * Call at the END of the render loop (after all drawing).
   * Handles screenshot capture, layout dump, and reference overlay.
   */
  endFrame(canvas: GameCanvas) {
    // Draw reference overlay (before screenshot so it's captured too if desired)
    if (_refVisible && _refImage) {
      canvas.context.save();
      canvas.context.globalAlpha = _refAlpha;
      canvas.context.drawImage(_refImage, _refOffsetX, _refOffsetY, config.width, config.height);
      canvas.context.restore();

      // Draw crosshair at center + offset info
      canvas.context.save();
      canvas.context.globalAlpha = 0.8;
      canvas.context.fillStyle = '#ff00ff';
      canvas.context.font = 'bold 12px monospace';
      canvas.context.fillText(
        `REF OVERLAY  alpha:${_refAlpha.toFixed(1)}  offset:(${_refOffsetX},${_refOffsetY})`,
        8, 14
      );
      canvas.context.restore();
    }

    // Screenshot + dump
    if (_screenshotRequested) {
      _screenshotRequested = false;
      _captureScreenshot(canvas);
    }
    if (_dumpRequested) {
      _dumpRequested = false;
      _dumpLayout();
    }
  },

  /** Whether reference overlay is currently visible */
  get refVisible() { return _refVisible; },
};

// ─── Screenshot capture ─────────────────────────────────────────────

function _captureScreenshot(canvas: GameCanvas) {
  try {
    const dataUrl = canvas.game.toDataURL('image/png');
    // Download as file
    const link = document.createElement('a');
    link.download = `maple-screenshot-${Date.now()}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log('[UIDevTools] Screenshot saved.');
  } catch (e) {
    console.error('[UIDevTools] Screenshot failed:', e);
  }
}

// ─── Layout dump ────────────────────────────────────────────────────

function _dumpLayout() {
  const elements = Array.from(_tracked.values());

  // Console table
  console.log('[UIDevTools] ═══ Layout Dump ═══');
  console.log(`[UIDevTools] Canvas: ${config.width}x${config.height}`);
  console.log(`[UIDevTools] ${elements.length} tracked elements:`);

  // Group by parent
  const roots = elements.filter(e => !e.parent);
  const children = elements.filter(e => !!e.parent);

  for (const el of roots) {
    _logElement(el, 0);
    for (const child of children.filter(c => c.parent === el.name)) {
      _logElement(child, 1);
    }
  }
  // Orphaned children (parent not tracked)
  for (const child of children.filter(c => !roots.find(r => r.name === c.parent))) {
    _logElement(child, 0);
  }

  // Also dump as JSON for Claude to read
  const json = {
    canvas: { width: config.width, height: config.height },
    elements: elements.map(e => ({
      name: e.name,
      x: e.x,
      y: e.y,
      w: e.width,
      h: e.height,
      right: e.x + e.width,
      bottom: e.y + e.height,
      space: e.space,
      ...(e.wzPath ? { wz: e.wzPath } : {}),
      ...(e.parent ? { parent: e.parent } : {}),
    })),
  };

  // Save to downloadable JSON file
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = `maple-layout-${Date.now()}.json`;
  link.href = URL.createObjectURL(blob);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  console.log('[UIDevTools] Layout JSON saved.');
  console.log('[UIDevTools] ═══════════════════');
}

function _logElement(el: TrackedElement, indent: number) {
  const pad = '  '.repeat(indent);
  const pos = `(${el.x}, ${el.y})`;
  const size = `${el.width}x${el.height}`;
  const right = `right:${el.x + el.width} bottom:${el.y + el.height}`;
  const wz = el.wzPath ? ` [${el.wzPath}]` : '';
  console.log(`${pad}  ${el.name}: ${pos} ${size} ${right} (${el.space})${wz}`);
}

// ─── WZ Inspector (global console utility) ──────────────────────────

async function wzInspect(path: string, maxDepth: number = 3): Promise<void> {
  console.log(`[wzInspect] Loading "${path}"...`);

  const node = await WZManager.get(path);
  if (!node) {
    console.error(`[wzInspect] Node not found: ${path}`);
    return;
  }

  console.log(`[wzInspect] ═══ ${path} ═══`);
  _inspectNode(node, 0, maxDepth);
  console.log(`[wzInspect] ═══════════════════`);
}

function _inspectNode(node: WZNode, depth: number, maxDepth: number) {
  const pad = '  '.repeat(depth);
  const tag = node.nTagName || '?';
  const name = node.nName || '(root)';

  // Build info string based on node type
  let info = '';

  if (tag === 'canvas') {
    const w = (node as any).nWidth || '?';
    const h = (node as any).nHeight || '?';
    info = `${w}x${h}`;

    // Check for origin
    const origin = (node as any).origin;
    if (origin) {
      info += ` origin:(${origin.nX ?? '?'}, ${origin.nY ?? '?'})`;
    }
  } else if (tag === 'vector') {
    info = `(${(node as any).nX ?? '?'}, ${(node as any).nY ?? '?'})`;
  } else if (tag === 'int' || tag === 'string' || tag === 'float') {
    info = `= ${node.nValue}`;
  } else if (tag === 'uol') {
    info = `-> ${node.nValue}`;
  }

  const childCount = node.nChildren?.length || 0;
  const childInfo = childCount > 0 ? ` (${childCount} children)` : '';

  console.log(`${pad}[${tag}] ${name}  ${info}${childInfo}`);

  // Recurse into children
  if (depth < maxDepth && node.nChildren) {
    for (const child of node.nChildren) {
      _inspectNode(child, depth + 1, maxDepth);
    }
  } else if (depth >= maxDepth && childCount > 0) {
    console.log(`${pad}  ... (${childCount} children, use wzInspect('${node.nGetPath()}', ${maxDepth + 2}) for more)`);
  }
}

// ─── WZ Layout Analyzer (pixel-level region detection) ──────────────

/**
 * wzLayout(path) — Analyzes a WZ background image pixel-by-pixel to find
 * all layout regions (title bar, tab area, content area, etc.)
 *
 * How it works:
 * 1. Renders the image to an offscreen canvas
 * 2. Scans every row to compute average color
 * 3. Detects color transitions = region boundaries
 * 4. Scans columns within each region for sub-regions (like boxes)
 * 5. Outputs exact pixel coordinates for each region
 *
 * Usage: wzLayout('UI.wz/UIWindow.img/Skill/backgrnd')
 */
async function wzLayout(path: string): Promise<void> {
  console.log(`[wzLayout] Analyzing "${path}"...`);

  const node = await WZManager.get(path);
  if (!node) {
    console.error(`[wzLayout] Node not found: ${path}`);
    return;
  }

  const img = (node as any).nGetImage() as HTMLImageElement;
  if (!img || !(img instanceof HTMLImageElement)) {
    console.error(`[wzLayout] Not a canvas node: ${path}`);
    return;
  }

  // Wait for image to load
  await new Promise<void>((resolve) => {
    if (img.complete && img.naturalWidth > 0) { resolve(); return; }
    img.onload = () => resolve();
    setTimeout(resolve, 2000); // timeout fallback
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w === 0 || h === 0) {
    console.error(`[wzLayout] Image has zero dimensions`);
    return;
  }

  // Render to offscreen canvas and get pixel data
  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = imageData.data; // RGBA flat array

  console.log(`[wzLayout] Image: ${w}x${h}`);
  console.log(`[wzLayout] ═══ Horizontal bands (row scan) ═══`);

  // ─── Step 1: Compute average color per row ───
  const rowColors: { r: number; g: number; b: number; a: number }[] = [];
  for (let y = 0; y < h; y++) {
    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      rSum += pixels[idx];
      gSum += pixels[idx + 1];
      bSum += pixels[idx + 2];
      aSum += pixels[idx + 3];
    }
    rowColors.push({
      r: Math.round(rSum / w),
      g: Math.round(gSum / w),
      b: Math.round(bSum / w),
      a: Math.round(aSum / w),
    });
  }

  // ─── Step 2: Detect horizontal bands (groups of similar rows) ───
  const THRESHOLD = 25; // color distance threshold for "same region"
  interface Band {
    y: number;
    h: number;
    color: string;
    r: number; g: number; b: number; a: number;
  }
  const bands: Band[] = [];
  let bandStart = 0;
  let bandColor = rowColors[0];

  for (let y = 1; y < h; y++) {
    const c = rowColors[y];
    const dist = Math.abs(c.r - bandColor.r) + Math.abs(c.g - bandColor.g) +
                 Math.abs(c.b - bandColor.b) + Math.abs(c.a - bandColor.a);
    if (dist > THRESHOLD) {
      bands.push({
        y: bandStart,
        h: y - bandStart,
        color: `rgb(${bandColor.r},${bandColor.g},${bandColor.b})`,
        ...bandColor,
      });
      bandStart = y;
      bandColor = c;
    }
  }
  bands.push({
    y: bandStart,
    h: h - bandStart,
    color: `rgb(${bandColor.r},${bandColor.g},${bandColor.b})`,
    ...bandColor,
  });

  // Print bands
  for (const band of bands) {
    const end = band.y + band.h - 1;
    const alpha = band.a < 255 ? ` alpha:${band.a}` : '';
    console.log(
      `  y=${band.y}-${end} (${band.h}px)  color:${band.color}${alpha}`
    );
  }

  // ─── Step 3: Find notable features within each band ───
  console.log(`[wzLayout] ═══ Column analysis (vertical features) ═══`);

  // Scan columns to find vertical region boundaries
  const colColors: { r: number; g: number; b: number; a: number }[] = [];
  for (let x = 0; x < w; x++) {
    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 4;
      rSum += pixels[idx];
      gSum += pixels[idx + 1];
      bSum += pixels[idx + 2];
      aSum += pixels[idx + 3];
    }
    colColors.push({
      r: Math.round(rSum / h),
      g: Math.round(gSum / h),
      b: Math.round(bSum / h),
      a: Math.round(aSum / h),
    });
  }

  const colBands: { x: number; w: number; color: string }[] = [];
  let colStart = 0;
  let colColor = colColors[0];
  for (let x = 1; x < w; x++) {
    const c = colColors[x];
    const dist = Math.abs(c.r - colColor.r) + Math.abs(c.g - colColor.g) +
                 Math.abs(c.b - colColor.b) + Math.abs(c.a - colColor.a);
    if (dist > THRESHOLD) {
      colBands.push({ x: colStart, w: x - colStart, color: `rgb(${colColor.r},${colColor.g},${colColor.b})` });
      colStart = x;
      colColor = c;
    }
  }
  colBands.push({ x: colStart, w: w - colStart, color: `rgb(${colColor.r},${colColor.g},${colColor.b})` });

  for (const col of colBands) {
    const end = col.x + col.w - 1;
    console.log(`  x=${col.x}-${end} (${col.w}px)  color:${col.color}`);
  }

  // ─── Step 4: Find "box" regions (rectangles of distinct color) ───
  console.log(`[wzLayout] ═══ Detected boxes (distinct rectangular regions) ═══`);

  // Scan for rectangular regions that differ from surroundings
  // Focus on the bottom area where SP boxes typically are, and any embedded rectangles
  const boxes = _findBoxes(pixels, w, h);
  for (const box of boxes) {
    console.log(
      `  Box at (${box.x}, ${box.y}) size ${box.w}x${box.h}  color:rgb(${box.r},${box.g},${box.b})`
    );
  }

  // ─── Step 5: Find text-like regions (darker pixels on lighter background) ───
  console.log(`[wzLayout] ═══ Text regions (dark-on-light areas) ═══`);
  const textRegions = _findTextRegions(pixels, w, h, bands);
  for (const tr of textRegions) {
    console.log(`  Text area: y=${tr.y}-${tr.y + tr.h - 1}, x=${tr.x}-${tr.x + tr.w - 1} (${tr.w}x${tr.h})`);
  }

  // ─── Step 6: Summary with suggested layout constants ───
  console.log(`[wzLayout] ═══ Suggested layout regions ═══`);
  console.log(`  Image size: ${w}x${h}`);

  // Classify bands by color characteristics
  const labeled: { label: string; y: number; h: number }[] = [];
  for (const band of bands) {
    if (band.h < 2) continue; // skip 1px lines
    const brightness = (band.r + band.g + band.b) / 3;
    const isTransparent = band.a < 128;
    let label = 'unknown';
    if (isTransparent) label = 'transparent';
    else if (brightness < 80) label = 'dark (title/header)';
    else if (brightness < 140) label = 'medium (tab area/separator)';
    else if (band.r > band.g + 20 && band.r > band.b + 20) label = 'warm (gold/brown bar)';
    else if (brightness > 200) label = 'light (content area)';
    else label = 'medium-light';

    labeled.push({ label, y: band.y, h: band.h });
    console.log(`  y=${band.y}-${band.y + band.h - 1}: ${label} (${band.h}px)`);
  }

  console.log(`[wzLayout] ═══════════════════`);
  console.log(`[wzLayout] Done. Use these values to set layout constants.`);
}

function _findBoxes(pixels: Uint8ClampedArray, w: number, h: number): { x: number; y: number; w: number; h: number; r: number; g: number; b: number }[] {
  const boxes: { x: number; y: number; w: number; h: number; r: number; g: number; b: number }[] = [];

  // Look for rectangular regions by sampling the image in a grid
  // A "box" is a rectangular area where the color is notably different from its immediate surroundings
  const STEP = 4;
  const visited = new Set<string>();

  for (let sy = 2; sy < h - 2; sy += STEP) {
    for (let sx = 2; sx < w - 2; sx += STEP) {
      const key = `${Math.floor(sx / 8)},${Math.floor(sy / 8)}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const idx = (sy * w + sx) * 4;
      const pr = pixels[idx], pg = pixels[idx + 1], pb = pixels[idx + 2], pa = pixels[idx + 3];
      if (pa < 128) continue; // skip transparent

      // Check if this pixel's color differs from pixels 4px in each direction
      const neighbors = [
        [sx - 4, sy], [sx + 4, sy], [sx, sy - 4], [sx, sy + 4],
      ];
      let diffCount = 0;
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = (ny * w + nx) * 4;
        const dist = Math.abs(pixels[ni] - pr) + Math.abs(pixels[ni + 1] - pg) + Math.abs(pixels[ni + 2] - pb);
        if (dist > 60) diffCount++;
      }

      // If this pixel differs from at least 2 neighbors, it might be part of a box
      if (diffCount >= 2) {
        // Flood-fill to find the extent of this region
        const box = _floodExtent(pixels, w, h, sx, sy, pr, pg, pb, 30);
        if (box.w >= 8 && box.h >= 8) { // minimum box size
          // Check not already found
          const dup = boxes.find(b =>
            Math.abs(b.x - box.x) < 4 && Math.abs(b.y - box.y) < 4 &&
            Math.abs(b.w - box.w) < 4 && Math.abs(b.h - box.h) < 4
          );
          if (!dup) {
            boxes.push({ ...box, r: pr, g: pg, b: pb });
          }
        }
      }
    }
  }

  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

function _floodExtent(
  pixels: Uint8ClampedArray, w: number, h: number,
  startX: number, startY: number,
  tr: number, tg: number, tb: number,
  tolerance: number
): { x: number; y: number; w: number; h: number } {
  let minX = startX, maxX = startX, minY = startY, maxY = startY;

  // Expand in each direction while color matches
  // Left
  for (let x = startX - 1; x >= 0; x--) {
    const idx = (startY * w + x) * 4;
    const dist = Math.abs(pixels[idx] - tr) + Math.abs(pixels[idx + 1] - tg) + Math.abs(pixels[idx + 2] - tb);
    if (dist > tolerance) break;
    minX = x;
  }
  // Right
  for (let x = startX + 1; x < w; x++) {
    const idx = (startY * w + x) * 4;
    const dist = Math.abs(pixels[idx] - tr) + Math.abs(pixels[idx + 1] - tg) + Math.abs(pixels[idx + 2] - tb);
    if (dist > tolerance) break;
    maxX = x;
  }
  // Up
  for (let y = startY - 1; y >= 0; y--) {
    const idx = (y * w + startX) * 4;
    const dist = Math.abs(pixels[idx] - tr) + Math.abs(pixels[idx + 1] - tg) + Math.abs(pixels[idx + 2] - tb);
    if (dist > tolerance) break;
    minY = y;
  }
  // Down
  for (let y = startY + 1; y < h; y++) {
    const idx = (y * w + startX) * 4;
    const dist = Math.abs(pixels[idx] - tr) + Math.abs(pixels[idx + 1] - tg) + Math.abs(pixels[idx + 2] - tb);
    if (dist > tolerance) break;
    maxY = y;
  }

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function _findTextRegions(
  pixels: Uint8ClampedArray, w: number, h: number,
  bands: { y: number; h: number; r: number; g: number; b: number; a: number }[]
): { x: number; y: number; w: number; h: number }[] {
  const regions: { x: number; y: number; w: number; h: number }[] = [];

  // For each band, check if it contains dark pixels (text) on a lighter background
  for (const band of bands) {
    const bgBrightness = (band.r + band.g + band.b) / 3;
    if (bgBrightness < 100) continue; // skip dark bands

    // Scan rows within this band for text-like patterns
    let textMinX = w, textMaxX = 0, textMinY = h, textMaxY = 0;
    let hasText = false;

    for (let y = band.y; y < band.y + band.h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const brightness = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
        const alpha = pixels[idx + 3];
        // Dark pixel on light background = likely text
        if (alpha > 128 && brightness < bgBrightness - 60) {
          hasText = true;
          if (x < textMinX) textMinX = x;
          if (x > textMaxX) textMaxX = x;
          if (y < textMinY) textMinY = y;
          if (y > textMaxY) textMaxY = y;
        }
      }
    }

    if (hasText && textMaxX - textMinX > 5 && textMaxY - textMinY > 3) {
      regions.push({
        x: textMinX,
        y: textMinY,
        w: textMaxX - textMinX + 1,
        h: textMaxY - textMinY + 1,
      });
    }
  }

  return regions;
}

// Expose to browser console
declare global {
  interface Window {
    wzInspect: (path: string, maxDepth?: number) => Promise<void>;
    wzLayout: (path: string) => Promise<void>;
    UIDevTools: typeof UIDevTools;
  }
}
window.wzInspect = wzInspect;
window.wzLayout = wzLayout;
window.UIDevTools = UIDevTools;

export default UIDevTools;
