import WZManager from "../wz-utils/WZManager";
import ClickManager from "./ClickManager";
import { MapleStanceButton } from "./MapleStanceButton";
import GameCanvas from "../GameCanvas";
import { CameraInterface } from "../Camera";
import config from "../Config";
import Settings, { GAME_OPTION_KEYS, GameOptionKey, GameOptions } from "../Settings";

// GAME OPTION, opened from the game menu.
//
// UI.wz/UIWindow.img/GameOpt/backgrnd (158x284) bakes in the title, all twelve
// row labels and the word "ALLOW" on every row. It carries no REFUSE art
// because the original never had any: the row's state is the checkbox drawn to
// the right of the label, ticked for allow and empty for refuse. That checkbox
// is Basic.img/CheckBox, whose four 12x12 frames are
// 0 = unticked, 1 = ticked (red), 2/3 = the same pair greyed out for disabled.
const WIN_W = 158;
const WIN_H = 284;

// Measured off the background: twelve 12px label plates on an 18px pitch
// starting at y=34, so row i spans y = 34 + i*18 .. +11.
const ROW_TOP = 34;
const ROW_PITCH = 18;
const ROW_COUNT = 12;

// Also measured: "ALLOW" ends at x=119 and its cell interior runs to x=148,
// leaving a 29px gap. The checkbox is 12px and centres in it at x=128. It is
// the same height as the row plate, so its top is just the row top.
const CHECK_X = 128;
const CHECK_SIZE = 12;
// A little slack so the box is not a pixel-hunt to click.
const CHECK_PAD = 3;

// The blue footer band runs y=256..280.
const BTN_W = 65;
const BTN_H = 24;
const BTN_Y = 256;

interface UIGameOptionInterface {
  isVisible: boolean;
  x: number;
  y: number;
  background: HTMLImageElement | null;
  checkOff: HTMLImageElement | null;
  checkOn: HTMLImageElement | null;
  buttons: MapleStanceButton[];
  _restore: GameOptions | null;
  _clickLatched: boolean;
  _canvas: GameCanvas | null;
  initialize: (canvas: GameCanvas) => Promise<void>;
  show: () => void;
  hide: () => void;
  doUpdate: (canvas: GameCanvas) => void;
  draw: (canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) => void;
}

const UIGameOption = {} as UIGameOptionInterface;

UIGameOption.isVisible = false;
UIGameOption.x = 0;
UIGameOption.y = 0;
UIGameOption.background = null;
UIGameOption.checkOff = null;
UIGameOption.checkOn = null;
UIGameOption.buttons = [];
UIGameOption._restore = null;
UIGameOption._clickLatched = false;
UIGameOption._canvas = null;

const rowTop = (i: number) => UIGameOption.y + ROW_TOP + i * ROW_PITCH;
const keyAt = (i: number): GameOptionKey => GAME_OPTION_KEYS[i];

UIGameOption.initialize = async function (canvas: GameCanvas) {
  // Rebuilt every time, like the other windows — entering a state clears
  // ClickManager, so retained buttons would draw but never take a click.
  this._canvas = canvas;
  this.buttons = [];
  this.isVisible = false;
  this._clickLatched = false;

  const uiWindow: any = await WZManager.get("UI.wz/UIWindow.img");
  const basic: any = await WZManager.get("UI.wz/Basic.img");

  this.background = uiWindow.nGet("GameOpt").nGet("backgrnd").nGetImage();
  const checkBox = basic.nGet("CheckBox");
  this.checkOff = checkBox.nGet("0").nGetImage();
  this.checkOn = checkBox.nGet("1").nGetImage();

  this.x = Math.round((config.width - WIN_W) / 2);
  this.y = Math.round((config.height - WIN_H) / 2);

  const btnY = this.y + BTN_Y;
  const ok = new MapleStanceButton(canvas, {
    x: this.x + Math.round(WIN_W / 2) - BTN_W - 4,
    y: btnY,
    img: basic.nGet("BtOK").nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    isHidden: true,
    // Toggles already wrote through to Settings, so OK just confirms.
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
        for (const key of GAME_OPTION_KEYS) {
          Settings.setGameOption(key, this._restore[key]);
        }
      }
      this.hide();
    },
  });
  ClickManager.addButton(ok);
  ClickManager.addButton(cancel);
  this.buttons.push(ok, cancel);
};

UIGameOption.show = function () {
  if (this.isVisible) return;
  this.isVisible = true;
  this._clickLatched = false;
  // Captured so Cancel can put the flags back — they apply as you click.
  this._restore = { ...Settings.gameOptions };
  this.buttons.forEach((b) => (b.isHidden = false));
};

UIGameOption.hide = function () {
  if (!this.isVisible) return;
  this.isVisible = false;
  this._clickLatched = false;
  this.buttons.forEach((b) => (b.isHidden = true));
};

UIGameOption.doUpdate = function (canvas: GameCanvas) {
  if (!this.isVisible) return;

  // canvas.clicked stays true for the whole press, so without a latch a single
  // click would toggle the row once per rendered frame.
  if (!canvas.clicked) {
    this._clickLatched = false;
    return;
  }
  if (this._clickLatched) return;
  this._clickLatched = true;

  const mx = canvas.mouseX;
  const my = canvas.mouseY;
  const bx = this.x + CHECK_X;
  if (mx < bx - CHECK_PAD || mx > bx + CHECK_SIZE + CHECK_PAD) return;

  for (let i = 0; i < ROW_COUNT; i++) {
    const ty = rowTop(i);
    if (my < ty - CHECK_PAD || my > ty + CHECK_SIZE + CHECK_PAD) continue;
    const key = keyAt(i);
    Settings.setGameOption(key, !Settings.gameOptions[key]);
    return;
  }
};

UIGameOption.draw = function (canvas, camera, lag, msPerTick, tdelta) {
  if (!this.isVisible || !this.background) return;

  canvas.drawImage({ img: this.background, dx: this.x, dy: this.y });

  for (let i = 0; i < ROW_COUNT; i++) {
    const img = Settings.gameOptions[keyAt(i)] ? this.checkOn : this.checkOff;
    canvas.drawImage({ img: img!, dx: this.x + CHECK_X, dy: rowTop(i) });
  }

  this.buttons.forEach((b) => b.draw(canvas, camera, lag, msPerTick, tdelta));
};

export default UIGameOption;
