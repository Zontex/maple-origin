import WZManager from '../wz-utils/WZManager';
import config from '../Config';
import GameCanvas from '../GameCanvas';

/**
 * The v83 event countdown: the "Time Left" plate from
 * Map.wz/Obj/etc.img/timer/backgrnd (258x58, `backgrndhour` with Hr/Min
 * labels for hour-long timers) with the red LCD glyphs of
 * Map.wz/Obj/etc.img/clock/fontTime (26x35, `comma` = the colon, 17 wide)
 * centred in its black display window (x 62..250, y 9..50 of the plate).
 * Drawn top-centre of the screen like the original. Shared by every timed
 * event (Henesys PQ, Kerning PQ).
 */

const PLATE_W = 258;
const WINDOW_CX = 156;
const WINDOW_TOP = 12;
const PLATE_Y = 6;

let plate: HTMLImageElement | null = null;
let plateHour: HTMLImageElement | null = null;
let digits: Record<string, HTMLImageElement> | null = null;
let loading = false;

function ensureArt(): void {
  if (digits || loading) return;
  loading = true;
  void (async () => {
    try {
      const etc: any = await WZManager.get('Map.wz/Obj/etc.img');
      plate = etc?.timer?.backgrnd?.nGetImage?.() ?? null;
      plateHour = etc?.timer?.backgrndhour?.nGetImage?.() ?? null;
      const font = etc?.clock?.fontTime;
      const out: Record<string, HTMLImageElement> = {};
      for (const key of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'comma']) {
        const c = font?.[key];
        if (c?.nGetImage) out[key] = c.nGetImage();
      }
      digits = out;
    } catch {
      loading = false;
    }
  })();
}

/** Draw the countdown for `remainingMs` (MM:SS, or H:MM on the hour plate past 59:59). */
export function drawEventClock(canvas: GameCanvas, remainingMs: number): void {
  ensureArt();
  if (!digits) return;
  const totalSec = Math.ceil(Math.max(0, remainingMs) / 1000);
  const hourMode = totalSec >= 3600 && !!plateHour;
  const text = hourMode
    ? `${Math.floor(totalSec / 3600)}:${String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')}`
    : `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;

  const x0 = Math.floor((config.width - PLATE_W) / 2);
  const bg = hourMode ? plateHour : plate;
  if (bg?.width) canvas.drawImage({ img: bg, dx: x0, dy: PLATE_Y });

  const glyphs = text.split('');
  let totalW = 0;
  for (const g of glyphs) totalW += digits[g === ':' ? 'comma' : g]?.width || 26;
  let x = x0 + WINDOW_CX - Math.floor(totalW / 2);
  for (const g of glyphs) {
    const img = digits[g === ':' ? 'comma' : g];
    if (img?.width) {
      canvas.drawImage({ img, dx: x, dy: PLATE_Y + WINDOW_TOP });
      x += img.width;
    } else {
      x += 26;
    }
  }
}
