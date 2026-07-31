import WZManager from "../wz-utils/WZManager";
import ClickManager from "./ClickManager";
import { MapleStanceButton } from "./MapleStanceButton";
import GameCanvas from "../GameCanvas";
import { CameraInterface } from "../Camera";
import config from "../Config";
import KeyBindings, { ACTIONS, ActionInfo, BindableAction } from "../KeyBindings";

// KEYBOARD SETTING, opened from the status bar's KeySet button.
//
// UI.wz/UIWindow.img/KeyConfig/backgrnd (629x373) draws the whole keyboard and
// the empty palette beneath it, so the only things painted over it are the
// 32x32 action icons (KeyConfig/icon/<id>) and the buttons.
const WIN_W = 629;
const WIN_H = 373;

// Measured off the background: six key rows, and the palette below them.
const ROW_Y = [28, 68, 100, 132, 164, 196];
const KEY_H = 24;
const KEY_W = 30;
const PITCH = 34;
const LEFT = 14;

// Each row lists [scancode, slot offset from the row's left edge, width units].
// Offsets are in PITCH units so the stagger matches a real keyboard.
type KeySlot = { code: number; x: number; w: number; row: number };

function buildLayout(): KeySlot[] {
  const out: KeySlot[] = [];
  const put = (row: number, code: number, xUnits: number, wUnits = 1) => {
    out.push({
      code,
      x: LEFT + Math.round(xUnits * PITCH),
      w: Math.round(wUnits * PITCH) - (PITCH - KEY_W),
      row,
    });
  };
  // function row — Esc sits alone, then F1..F12 in three groups
  const fRow = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88];
  fRow.forEach((c, i) => put(0, c, 1.9 + i * 1.05 + Math.floor(i / 4) * 0.25));
  // number row: ` 1..0 - =
  [41, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].forEach((c, i) => put(1, c, i));
  put(1, 82, 14.4); put(1, 71, 15.4); put(1, 73, 16.4);      // Ins Home PgUp
  // qwerty row (Tab is 1.5 wide, so keys start 1.5 units in)
  [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 43].forEach((c, i) =>
    put(2, c, 1.5 + i));
  put(2, 83, 14.4); put(2, 79, 15.4); put(2, 81, 16.4);      // Del End PgDn
  // home row (Caps is 1.8 wide)
  [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40].forEach((c, i) =>
    put(3, c, 1.8 + i));
  // shift row (Shift is 2.3 wide)
  [44, 45, 46, 47, 48, 49, 50, 51, 52].forEach((c, i) => put(4, c, 2.3 + i));
  // bottom row: Ctrl, then Alt, Space
  put(5, 29, 0, 1.3);
  put(5, 56, 2.6);
  put(5, 57, 3.6, 5.5);
  return out;
}
const LAYOUT = buildLayout();

// Palette of draggable actions beneath the keyboard.
const PAL_X = 22;
const PAL_Y = 262;
const PAL_PITCH = 36;
const PAL_COLS = 16;

const ICON = 32;
const BTN_Y = 344;

interface UIKeyConfigInterface {
  isVisible: boolean;
  x: number;
  y: number;
  background: HTMLImageElement | null;
  icons: Record<number, HTMLImageElement>;
  buttons: MapleStanceButton[];
  dragging: ActionInfo | null;
  dragX: number;
  dragY: number;
  _clickHeld: boolean;
  _restore: Record<number, BindableAction> | null;
  initialize: (canvas: GameCanvas) => Promise<void>;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  doUpdate: (canvas: GameCanvas) => void;
  draw: (canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) => void;
}

const UIKeyConfig = {} as UIKeyConfigInterface;

UIKeyConfig.isVisible = false;
UIKeyConfig.x = 0;
UIKeyConfig.y = 0;
UIKeyConfig.background = null;
UIKeyConfig.icons = {};
UIKeyConfig.buttons = [];
UIKeyConfig.dragging = null;
UIKeyConfig.dragX = 0;
UIKeyConfig.dragY = 0;
UIKeyConfig._clickHeld = false;
UIKeyConfig._restore = null;

const slotRect = (s: KeySlot) => ({
  x: UIKeyConfig.x + s.x,
  y: UIKeyConfig.y + ROW_Y[s.row],
  w: s.w,
  h: KEY_H,
});
const palRect = (i: number) => ({
  x: UIKeyConfig.x + PAL_X + (i % PAL_COLS) * PAL_PITCH,
  y: UIKeyConfig.y + PAL_Y + Math.floor(i / PAL_COLS) * PAL_PITCH,
  w: ICON,
  h: ICON,
});
const inside = (r: any, mx: number, my: number) =>
  mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;

UIKeyConfig.initialize = async function (canvas: GameCanvas) {
  this.buttons = [];
  this.isVisible = false;
  this.dragging = null;
  this._clickHeld = false;

  const uiWindow: any = await WZManager.get("UI.wz/UIWindow.img");
  const kc = uiWindow.nGet("KeyConfig");
  this.background = kc.nGet("backgrnd").nGetImage();

  this.icons = {};
  const iconRoot = kc.nGet("icon");
  for (const a of ACTIONS) {
    const node = iconRoot.nGet(String(a.icon));
    if (node && node.nGetImage) this.icons[a.icon] = node.nGetImage();
  }

  this.x = Math.round((config.width - WIN_W) / 2);
  this.y = Math.round((config.height - WIN_H) / 2);

  const mk = (dx: number, node: any, onClick: () => void) => {
    const b = new MapleStanceButton(canvas, {
      x: this.x + dx,
      y: this.y + BTN_Y,
      img: node.nChildren,
      isRelativeToCamera: true,
      isPartOfUI: true,
      isHidden: true,
      onClick,
    });
    ClickManager.addButton(b);
    this.buttons.push(b);
  };
  // Bindings apply as you drop them, so OK just closes.
  mk(392, kc.nGet("BtOK"), () => this.hide());
  mk(444, kc.nGet("BtCancel"), () => {
    if (this._restore) KeyBindings.replaceAll(this._restore);
    this.hide();
  });
  mk(496, kc.nGet("BtDefault"), () => KeyBindings.resetToDefault());
  mk(560, kc.nGet("BtDelete"), () => KeyBindings.replaceAll({}));
};

UIKeyConfig.show = function () {
  if (this.isVisible) return;
  this.isVisible = true;
  this.dragging = null;
  this._clickHeld = false;
  this._restore = KeyBindings.snapshot();
  this.buttons.forEach((b) => (b.isHidden = false));
};

UIKeyConfig.hide = function () {
  if (!this.isVisible) return;
  this.isVisible = false;
  this.dragging = null;
  this.buttons.forEach((b) => (b.isHidden = true));
};

UIKeyConfig.toggle = function () {
  this.isVisible ? this.hide() : this.show();
};

UIKeyConfig.doUpdate = function (canvas: GameCanvas) {
  if (!this.isVisible) return;
  const mx = canvas.mouseX;
  const my = canvas.mouseY;
  this.dragX = mx;
  this.dragY = my;

  if (!canvas.clicked) {
    // Drop: onto a key binds it, anywhere else discards (which unbinds, since
    // picking a bound key up removed it).
    if (this.dragging) {
      const slot = LAYOUT.find((s) => inside(slotRect(s), mx, my));
      if (slot) KeyBindings.bind(slot.code, this.dragging.action);
      else KeyBindings.save();
      this.dragging = null;
    }
    this._clickHeld = false;
    return;
  }
  if (this._clickHeld) return;
  this._clickHeld = true;

  // Pick up from a key…
  const slot = LAYOUT.find((s) => inside(slotRect(s), mx, my));
  if (slot) {
    const action = KeyBindings.bindings[slot.code];
    if (action) {
      const info = ACTIONS.find((a) => a.action === action);
      if (info) {
        KeyBindings.clear(slot.code);
        this.dragging = info;
      }
    }
    return;
  }
  // …or from the palette.
  for (let i = 0; i < ACTIONS.length; i++) {
    if (inside(palRect(i), mx, my)) {
      this.dragging = ACTIONS[i];
      return;
    }
  }
};

UIKeyConfig.draw = function (canvas, camera, lag, msPerTick, tdelta) {
  if (!this.isVisible || !this.background) return;
  canvas.drawImage({ img: this.background, dx: this.x, dy: this.y });

  // icons sitting on their bound keys
  for (const s of LAYOUT) {
    const action = KeyBindings.bindings[s.code];
    if (!action) continue;
    const info = ACTIONS.find((a) => a.action === action);
    const img = info && this.icons[info.icon];
    if (!img) continue;
    const r = slotRect(s);
    canvas.drawImage({
      img,
      dx: Math.round(r.x + (r.w - ICON) / 2),
      dy: Math.round(r.y + (r.h - ICON) / 2),
    });
  }

  // the palette — an action already on a key is not offered again
  for (let i = 0; i < ACTIONS.length; i++) {
    const a = ACTIONS[i];
    if (KeyBindings.keyFor(a.action) !== undefined) continue;
    const img = this.icons[a.icon];
    if (!img) continue;
    const r = palRect(i);
    canvas.drawImage({ img, dx: r.x, dy: r.y });
  }

  this.buttons.forEach((b) => b.draw(canvas, camera, lag, msPerTick, tdelta));

  // the icon under the cursor draws last so it rides above everything
  if (this.dragging) {
    const img = this.icons[this.dragging.icon];
    if (img) {
      canvas.drawImage({
        img,
        dx: Math.round(this.dragX - ICON / 2),
        dy: Math.round(this.dragY - ICON / 2),
      });
    }
  }
};

export default UIKeyConfig;
