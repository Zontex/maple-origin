import WZManager from "./wz-utils/WZManager";

/**
 * Wood-desk surround for the login flow, MapleStory-Classic style: the v83
 * book stays at its native 800x600 (see LoginState) and the widescreen
 * letterbox around it is dressed as a wooden desk. Painted as a CSS
 * background on #game-wrapper — outside the canvas — so the login layout,
 * camera math and click mapping are untouched.
 */

let woodUrl: string | null = null;
let active = false;
let cursorCss: string | null = null;
let vignette: HTMLDivElement | null = null;

/** Deterministic PRNG so the desk looks identical every boot. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws a tileable slab of continuous wood: one surface of long flowing
 * horizontal grain in warm honey tones — no plank seams or end joints.
 * Everything is periodic by construction: tone bands use whole sine cycles
 * of y; fiber dashes and wavy grain lines are drawn with wrapped copies
 * (x±SIZE / y±SIZE) so strokes crossing an edge re-enter on the other side.
 * Displayed 1:1 at 1024 CSS px so the fibers stay crisp.
 */
function generateWoodTexture(): string {
  const SIZE = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(0x5eed);
  const TAU = Math.PI * 2;

  // Broad tone bands flowing down the surface (like sap/heartwood zones).
  // Dark grain below clusters inside the dark bands, tying it all together.
  const p1 = rand() * TAU;
  const p2 = rand() * TAU;
  const p3 = rand() * TAU;
  const tone = (y: number) =>
    1 +
    0.13 * Math.sin((TAU * y) / SIZE + p1) +
    0.09 * Math.sin((TAU * 2 * y) / SIZE + p2) +
    0.05 * Math.sin((TAU * 5 * y) / SIZE + p3);
  for (let y = 0; y < SIZE; y++) {
    const t = tone(y);
    ctx.fillStyle = `rgb(${Math.round(172 * t)}, ${Math.round(
      84 * t
    )}, ${Math.round(24 * t)})`;
    ctx.fillRect(0, y, SIZE, 1);
  }

  // Fibrous body: thousands of short horizontal strokes
  for (let i = 0; i < 6000; i++) {
    const y = rand() * SIZE;
    const len = 30 + rand() * 220;
    const x = rand() * SIZE;
    let alpha = 0.03 + 0.09 * rand();
    let dark = rand() < 0.6;
    if (tone(y) < 0.97 && rand() < 0.5) {
      dark = true;
      alpha *= 1.4;
    }
    ctx.fillStyle = dark
      ? `rgba(72, 30, 8, ${Math.min(alpha, 0.16)})`
      : `rgba(232, 140, 64, ${alpha * 0.8})`;
    for (const xo of [x - SIZE, x, x + SIZE]) {
      ctx.fillRect(xo, y, len, 1);
    }
  }

  // Long wavering grain lines — the connected, flowing figure of the wood
  for (let i = 0; i < 160; i++) {
    const yc = rand() * SIZE;
    const amp = 2 + rand() * 8;
    const cycles = 1 + Math.floor(rand() * 4);
    const phase = rand() * TAU;
    // Second harmonic makes the wave organic instead of a clean sine
    const amp2 = amp * (0.2 + rand() * 0.4);
    const cycles2 = cycles * 2 + Math.floor(rand() * 2);
    const phase2 = rand() * TAU;
    const dark = rand() < 0.75;
    let alpha = dark ? 0.08 + rand() * 0.12 : 0.06 + rand() * 0.08;
    if (tone(yc) < 0.97) alpha *= 1.35;
    ctx.strokeStyle = dark
      ? `rgba(64, 26, 6, ${Math.min(alpha, 0.22)})`
      : `rgba(232, 140, 64, ${alpha})`;
    ctx.lineWidth = 0.8 + rand() * 1.4;
    // Draw at y and wrapped copies so edge-crossing waves tile vertically
    for (const base of [yc - SIZE, yc, yc + SIZE]) {
      ctx.beginPath();
      for (let x = 0; x <= SIZE; x += 6) {
        const y =
          base +
          amp * Math.sin((TAU * cycles * x) / SIZE + phase) +
          amp2 * Math.sin((TAU * cycles2 * x) / SIZE + phase2);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  return canvas.toDataURL("image/png");
}

/**
 * The canvas draws its own cursor sprite, so #game-wrapper hides the OS
 * cursor — which made the mouse invisible over the letterbox. Reuse the same
 * WZ hand cursor as a CSS cursor over the wood; hotspot = the sprite origin,
 * matching UICommon's mouse - origin draw position.
 */
async function applyWoodCursor(wrapper: HTMLElement): Promise<void> {
  if (!cursorCss) {
    try {
      const cursor: any = await WZManager.get("UI.wz/Basic.img/Cursor");
      const img = cursor[0][0].nGetImage();
      const origin = cursor[0][0].origin;
      const hx = Math.max(0, origin?.nX ?? 0);
      const hy = Math.max(0, origin?.nY ?? 0);
      cursorCss = `url(${img.src}) ${hx} ${hy}, default`;
    } catch (e) {
      console.error("LoginBackdrop: failed to load WZ cursor", e);
      cursorCss = "default";
    }
  }
  if (active) wrapper.style.cursor = cursorCss;
}

export function showLoginBackdrop(): void {
  const wrapper = document.getElementById("game-wrapper");
  const game = document.getElementById("game");
  if (!wrapper || !game) return;
  active = true;

  if (!woodUrl) woodUrl = generateWoodTexture();
  wrapper.style.backgroundImage = `url(${woodUrl})`;
  wrapper.style.backgroundSize = "1024px 1024px";
  wrapper.style.backgroundRepeat = "repeat";

  // Vignette between the desk and the canvas, like Classic's darkened desk
  // edges. Painting order = DOM order (both positioned, z-index auto):
  // vignette < #game < #joyDiv, with MapleInput above at z 10.
  if (!vignette) {
    vignette = document.createElement("div");
    vignette.id = "login-vignette";
    vignette.style.position = "absolute";
    vignette.style.inset = "0";
    vignette.style.pointerEvents = "none";
    vignette.style.background =
      "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)";
    wrapper.insertBefore(vignette, game);
  }
  // The canvas must be positioned to paint above the vignette
  game.style.position = "relative";
  game.style.boxShadow = "0 0 48px rgba(0, 0, 0, 0.6)";

  applyWoodCursor(wrapper);
}

export function hideLoginBackdrop(): void {
  const wrapper = document.getElementById("game-wrapper");
  const game = document.getElementById("game");
  active = false;
  if (wrapper) {
    // Back to the stylesheet's plain black + hidden OS cursor
    wrapper.style.backgroundImage = "";
    wrapper.style.backgroundSize = "";
    wrapper.style.backgroundRepeat = "";
    wrapper.style.cursor = "";
  }
  if (game) {
    game.style.boxShadow = "";
    game.style.position = "";
  }
  if (vignette) {
    vignette.remove();
    vignette = null;
  }
}
