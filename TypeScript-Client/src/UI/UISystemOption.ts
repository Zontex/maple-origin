import WZManager from "../wz-utils/WZManager";
import ClickManager from "./ClickManager";
import { MapleStanceButton } from "./MapleStanceButton";
import GameCanvas from "../GameCanvas";
import { CameraInterface } from "../Camera";
import config from "../Config";
import Settings from "../Settings";

// SYSTEM OPTION, opened from the game menu.
// Assets: UI.wz/UIWindow.img/SysOpt/backgrnd (299x366) — every label and the
// row plates are baked into that one image, so the only things drawn over it
// are the sliders (Basic.img/Slider) and the OK/Cancel buttons (Basic.img).
const WIN_W = 299;
const WIN_H = 366;

// Measured off the background: ten 28px label plates on a 30px pitch starting
// at y=32, so row i is centred at 46 + i*30.
const ROW_TOP = 32;
const ROW_PITCH = 30;
const ROW_H = 28;
const rowMid = (i: number) => ROW_TOP + i * ROW_PITCH + Math.floor(ROW_H / 2);

const ROW_BGM = 1;
const ROW_SOUND = 2;

// Also measured: "SOFT" ends at x=87 and "LOUD" begins at x=213 on both rows,
// so the track lives between them. "MUTE" occupies x=259..277.
const TRACK_X = 95;
const TRACK_W = 110;
const TRACK_H = 8;
const THUMB_W = 22;
const THUMB_H = 14;
const MUTE_X = 259;
const MUTE_W = 19;

const BTN_W = 65;
const BTN_H = 24;

type Row = { row: number; get: () => number; set: (v: number) => void };

interface UISystemOptionInterface {
  isVisible: boolean;
  x: number;
  y: number;
  background: HTMLImageElement | null;
  track: { left: HTMLImageElement | null; mid: HTMLImageElement | null; right: HTMLImageElement | null };
  thumb: HTMLImageElement | null;
  buttons: MapleStanceButton[];
  dragging: number;
  _restore: { bgm: number; sfx: number } | null;
  _canvas: GameCanvas | null;
  initialize: (canvas: GameCanvas) => Promise<void>;
  show: () => void;
  hide: () => void;
  doUpdate: (canvas: GameCanvas) => void;
  draw: (canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) => void;
}

const UISystemOption = {} as UISystemOptionInterface;

UISystemOption.isVisible = false;
UISystemOption.x = 0;
UISystemOption.y = 0;
UISystemOption.background = null;
UISystemOption.track = { left: null, mid: null, right: null };
UISystemOption.thumb = null;
UISystemOption.buttons = [];
UISystemOption.dragging = -1;
UISystemOption._restore = null;
UISystemOption._canvas = null;

const ROWS: Row[] = [
  { row: ROW_BGM, get: () => Settings.bgmVolume, set: (v) => Settings.setBgmVolume(v) },
  { row: ROW_SOUND, get: () => Settings.sfxVolume, set: (v) => Settings.setSfxVolume(v) },
];

const trackY = (i: number) => UISystemOption.y + rowMid(ROWS[i].row) - Math.floor(TRACK_H / 2);
const thumbY = (i: number) => UISystemOption.y + rowMid(ROWS[i].row) - Math.floor(THUMB_H / 2);
const thumbX = (i: number) =>
  UISystemOption.x + TRACK_X + Math.round(ROWS[i].get() * (TRACK_W - THUMB_W));

// Value under a given canvas x, from the thumb's travel rather than the full
// track, so dragging to either end reaches exactly 0 and 1.
function valueAt(canvasX: number): number {
  const travel = TRACK_W - THUMB_W;
  const rel = canvasX - (UISystemOption.x + TRACK_X) - THUMB_W / 2;
  return Math.min(1, Math.max(0, rel / travel));
}

UISystemOption.initialize = async function (canvas: GameCanvas) {
  // Rebuilt every time, like the other windows — entering a state clears
  // ClickManager, so retained buttons would draw but never take a click.
  this._canvas = canvas;
  this.buttons = [];
  this.isVisible = false;
  this.dragging = -1;

  const uiWindow: any = await WZManager.get("UI.wz/UIWindow.img");
  const basic: any = await WZManager.get("UI.wz/Basic.img");

  this.background = uiWindow.nGet("SysOpt").nGet("backgrnd").nGetImage();
  const slider = basic.nGet("Slider");
  this.track = {
    left: slider.nGet("left").nGetImage(),
    mid: slider.nGet("mid").nGetImage(),
    right: slider.nGet("right").nGetImage(),
  };
  this.thumb = slider.nGet("thumbNormal").nGetImage();

  this.x = Math.round((config.width - WIN_W) / 2);
  this.y = Math.round((config.height - WIN_H) / 2);

  const btnY = this.y + WIN_H - BTN_H - 8;
  const ok = new MapleStanceButton(canvas, {
    x: this.x + Math.round(WIN_W / 2) - BTN_W - 4,
    y: btnY,
    img: basic.nGet("BtOK").nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    isHidden: true,
    // Settings already applied live while dragging, so OK just confirms.
    onClick: () => this.hide(),
  });
  const cancel = new MapleStanceButton(canvas, {
    x: this.x + Math.round(WIN_W / 2) + 4,
    y: btnY,
    img: basic.nGet("BtCancel").nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    isHidden: true,
    onClick: () => {
      if (this._restore) {
        Settings.setBgmVolume(this._restore.bgm);
        Settings.setSfxVolume(this._restore.sfx);
      }
      this.hide();
    },
  });
  ClickManager.addButton(ok);
  ClickManager.addButton(cancel);
  this.buttons.push(ok, cancel);
};

UISystemOption.show = function () {
  if (this.isVisible) return;
  this.isVisible = true;
  this.dragging = -1;
  // Captured so Cancel can put the volumes back — they change as you drag.
  this._restore = { bgm: Settings.bgmVolume, sfx: Settings.sfxVolume };
  this.buttons.forEach((b) => (b.isHidden = false));
};

UISystemOption.hide = function () {
  if (!this.isVisible) return;
  this.isVisible = false;
  this.dragging = -1;
  this.buttons.forEach((b) => (b.isHidden = true));
};

UISystemOption.doUpdate = function (canvas: GameCanvas) {
  if (!this.isVisible) return;

  const mx = canvas.mouseX;
  const my = canvas.mouseY;

  if (!canvas.clicked) {
    this.dragging = -1;
    return;
  }

  // Already dragging — keep following the mouse even outside the track.
  if (this.dragging >= 0) {
    ROWS[this.dragging].set(valueAt(mx));
    return;
  }

  for (let i = 0; i < ROWS.length; i++) {
    const ty = trackY(i);
    // Generous vertical band: the thumb is taller than the track it rides.
    const withinRow = my >= ty - 6 && my <= ty + TRACK_H + 6;
    if (!withinRow) continue;

    if (mx >= this.x + TRACK_X && mx <= this.x + TRACK_X + TRACK_W) {
      this.dragging = i;
      ROWS[i].set(valueAt(mx));
      return;
    }
    // MUTE drops the row to silence; clicking it again is a no-op, matching
    // the original — the slider is how you come back up.
    if (mx >= this.x + MUTE_X && mx <= this.x + MUTE_X + MUTE_W) {
      ROWS[i].set(0);
      return;
    }
  }
};

UISystemOption.draw = function (canvas, camera, lag, msPerTick, tdelta) {
  if (!this.isVisible || !this.background) return;

  canvas.drawImage({ img: this.background, dx: this.x, dy: this.y });

  for (let i = 0; i < ROWS.length; i++) {
    const ty = trackY(i);
    const tx = this.x + TRACK_X;
    canvas.drawImage({ img: this.track.left!, dx: tx, dy: ty });
    // `mid` is 1px wide and tiled to length.
    for (let px = 3; px < TRACK_W - 3; px++) {
      canvas.drawImage({ img: this.track.mid!, dx: tx + px, dy: ty });
    }
    canvas.drawImage({ img: this.track.right!, dx: tx + TRACK_W - 3, dy: ty });
    canvas.drawImage({ img: this.thumb!, dx: thumbX(i), dy: thumbY(i) });
  }

  this.buttons.forEach((b) => b.draw(canvas, camera, lag, msPerTick, tdelta));
};

export default UISystemOption;
