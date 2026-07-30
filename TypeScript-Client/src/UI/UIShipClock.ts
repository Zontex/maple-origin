// Departure-countdown clock for transport stations (map `clock` nodes) and
// remaining-time display on instanced timed rides.
//
// v83 renders the station clock from UI.wz/Basic.img/Clock; that node is
// missing from our extraction (see plan), so we try it and fall back to text
// digits that match the original's placement. Swapping in the real sprites
// later only touches ensureAssets()/draw().

import { CameraInterface } from '../Camera';
import config from '../Config';
import GameCanvas from '../GameCanvas';
import WZManager from '../wz-utils/WZManager';
import TransportationManager from '../Transport/TransportationManager';
import { CLOCK_ROUTE_BY_MAP, TIMED_RIDES } from '../Transport/TransportRoutes';

const UIShipClock = {
  mapId: -1,
  worldPos: null as { x: number; y: number } | null,
  screenMode: false,
  _clockAssetChecked: false,
  _clockBackgrnd: null as any,
  _clockDigits: null as any[] | null,

  // Called from MapleMap.load for every map
  setFromMap(mapWzNode: any, mapId: number) {
    this.mapId = mapId;
    this.worldPos = null;
    this.screenMode = false;

    if (TIMED_RIDES.some((r) => r.rideMap === mapId)) {
      this.screenMode = true;
      return;
    }
    if (!CLOCK_ROUTE_BY_MAP[mapId]) return;
    const clockNode = mapWzNode?.nGet?.('clock');
    const x = clockNode?.nGet?.('x')?.nGet?.('nValue', null);
    const y = clockNode?.nGet?.('y')?.nGet?.('nValue', null);
    if (x === null || x === undefined) return;
    this.worldPos = { x, y: y ?? 0 };
  },

  async ensureAssets() {
    if (this._clockAssetChecked) return;
    this._clockAssetChecked = true;
    try {
      const clock: any = await WZManager.get('UI.wz/Basic.img');
      const node = clock?.Clock;
      if (!node) return;
      this._clockBackgrnd = node.nGet('backgrnd').nGetImage ? node.backgrnd : null;
      const digitParent = node.number || node;
      const digits: any[] = [];
      for (let i = 0; i <= 9; i++) {
        const d = digitParent?.[String(i)];
        if (!d?.nGetImage) { return; }
        digits.push(d);
      }
      this._clockDigits = digits;
    } catch {
      // asset genuinely missing — text fallback stays active
    }
  },

  draw(canvas: GameCanvas, camera: CameraInterface) {
    if (!this.worldPos && !this.screenMode) return;
    const remaining = TransportationManager.getClockRemainingMs(this.mapId);
    if (remaining === null) return;
    void this.ensureAssets();

    const totalSec = Math.max(0, Math.floor(remaining / 1000));
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    const text = `${mm}:${ss}`;

    let dx: number;
    let dy: number;
    if (this.worldPos) {
      dx = this.worldPos.x - camera.x;
      dy = this.worldPos.y - camera.y;
      if (dx < -120 || dx > config.width + 120 || dy < -120 || dy > config.height + 120) return;
    } else {
      dx = config.width / 2;
      dy = 48;
    }

    if (this._clockDigits) {
      if (this._clockBackgrnd) {
        const bg = this._clockBackgrnd;
        canvas.drawImage({
          img: bg.nGetImage(),
          dx: Math.round(dx - bg.nWidth / 2),
          dy: Math.round(dy - bg.nHeight / 2),
        });
      }
      const chars = `${mm}${ss}`.split('').map((c) => this._clockDigits![Number(c)]);
      const dw = chars[0].nWidth;
      const gap = 2;
      const colonGap = 6;
      const total = dw * 4 + gap * 2 + colonGap;
      let cx = Math.round(dx - total / 2);
      chars.forEach((d, i) => {
        canvas.drawImage({ img: d.nGetImage(), dx: cx, dy: Math.round(dy - d.nHeight / 2) });
        cx += dw + (i === 1 ? colonGap : gap);
      });
      canvas.drawText({
        text: ':', x: Math.round(dx - colonGap / 2), y: Math.round(dy - 6),
        color: '#FFFFFF', align: 'center', fontWeight: 'bold',
      });
      return;
    }

    // Text fallback — dark plate so it reads against any map art
    const plateW = 56;
    const plateH = 20;
    canvas.drawRect?.({
      x: Math.round(dx - plateW / 2), y: Math.round(dy - plateH / 2),
      width: plateW, height: plateH, color: '#000000', alpha: 0.55,
    });
    canvas.drawText({
      text,
      x: Math.round(dx),
      y: Math.round(dy - 7),
      color: '#FFFFFF',
      align: 'center',
      fontSize: 14,
      fontWeight: 'bold',
      fontFamily: 'monospace',
    });
  },
};

export default UIShipClock;
