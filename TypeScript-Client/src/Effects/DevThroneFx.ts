/**
 * The maker's cigar: while a character sits on Roni's Developer Throne a
 * cigar rests at the mouth and smoke drifts up from its ember. Art comes from
 * the custom overlay (custom-items.json `fx`, drawn by tools/custom-assets/
 * throne.py); the mouth is found from the composed frames' `brow` map point.
 * Runs for the local player and for remotes alike — the chair id is relayed.
 */
import { loadCustomOverlay } from '../CustomWz';

export const DEV_THRONE_ID = 3019999;

type Puff = { x: number; y: number; vx: number; born: number; life: number; seed: number };

let cigar: HTMLImageElement | null = null;
let smoke: HTMLImageElement[] = [];
let loading = false;

function ensureArt() {
  if (cigar || loading) return;
  loading = true;
  void loadCustomOverlay().then((o: any) => {
    const fx = o?.fx;
    if (!fx) return;
    const img = (node: any) => { const i = new Image(); i.src = `data:image/png;base64,${node.basedata}`; return i; };
    cigar = img(fx.cigar);
    smoke = (fx.smoke || []).map(img);
  });
}

const PUFF_EVERY_MS = 700;
const PUFF_LIFE_MS = 1800;

/**
 * Draw the cigar and advance the smoke for `ch` (a MapleCharacter), given the
 * composed frames (each carries its layer's zName and drawn rect). The mouth
 * is read off the FACE layer's rectangle: v83 faces are 26x16 with the lips
 * in the bottom rows, a few px toward the way the character looks. Call
 * right after the body is drawn.
 */
export function drawDevThroneFx(ch: any, canvas: any, camera: any, frames: any[], moveX: number, moveY: number, facingRight: boolean) {
  ensureArt();
  if (!cigar) return;
  const face = (frames || []).find((f: any) => f?.zName === 'face');
  const dir = facingRight ? 1 : -1;
  let mx: number, my: number;
  if (face) {
    const w = Number(face.width) || face.img?.width || 26;
    const h = Number(face.height) || face.img?.height || 16;
    mx = ch.pos.x + face.x + moveX + w / 2 + dir * 4;
    my = ch.pos.y + face.y + moveY + h - 3;
  } else {
    // No face layer composed (shouldn't happen seated): the usual seated head
    mx = ch.pos.x + dir * 4;
    my = ch.pos.y - 40;
  }

  // Cigar: anchored at the lips, pointing out of the mouth, ember outward
  if (cigar.complete && cigar.width > 0) {
    canvas.drawImage({
      img: cigar,
      dx: Math.round(mx - camera.x - (facingRight ? 1 : cigar.width - 1)),
      dy: Math.round(my - camera.y - 2),
      flipped: !facingRight,
    });
  }

  // Smoke: puffs born at the ember, rising and drifting with a slow wobble,
  // growing through the four frames as they fade
  const now = Date.now();
  const puffs: Puff[] = (ch._cigarPuffs ||= []);
  if (!ch._cigarLast || now - ch._cigarLast > PUFF_EVERY_MS) {
    ch._cigarLast = now;
    puffs.push({ x: mx + dir * cigar.width, y: my, vx: dir * 4, born: now, life: PUFF_LIFE_MS, seed: Math.random() * Math.PI * 2 });
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    const t = (now - p.born) / p.life;
    if (t >= 1) { puffs.splice(i, 1); continue; }
    const frame = smoke[Math.min(smoke.length - 1, Math.floor(t * smoke.length))];
    if (!frame?.complete || frame.width === 0) continue;
    const rise = 34 * t;
    const wobble = Math.sin(p.seed + t * 6) * 3;
    const px = p.x + p.vx * t + wobble;
    const py = p.y - rise;
    canvas.drawImage({
      img: frame,
      dx: Math.round(px - camera.x - frame.width / 2),
      dy: Math.round(py - camera.y - frame.height / 2),
      alpha: Math.max(0, 1 - t) * 0.9,
    });
  }
}

/** Drop the smoke state when the character stands up. */
export function clearDevThroneFx(ch: any) {
  ch._cigarPuffs = [];
  ch._cigarLast = 0;
}
