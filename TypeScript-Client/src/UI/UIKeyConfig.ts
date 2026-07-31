import WZManager from "../wz-utils/WZManager";
import ClickManager from "./ClickManager";
import { MapleStanceButton } from "./MapleStanceButton";
import GameCanvas from "../GameCanvas";
import { CameraInterface } from "../Camera";
import config from "../Config";
import KeyBindings, { ACTIONS, ActionInfo, BindableAction } from "../KeyBindings";

// KEYBOARD SETTING, opened from the status bar's KeySet button.
//
// UI.wz/UIWindow.img/KeyConfig/backgrnd (629x373) already draws the whole
// keyboard, every key label and the empty palette below it, so the only
// things painted on top are the 32x32 action icons and the four buttons.
const WIN_W = 629;
const WIN_H = 373;

// Icons are 32x32; the key faces they sit on are mostly 28x25, so an icon
// slightly overhangs its key. That is how the original looks too.
const ICON = 32;

/**
 * Every bindable key box, in background-image coordinates.
 *
 * These are not estimated from a pitch: the background was thresholded and
 * connected-component labelled, which recovered all 139 key faces exactly,
 * and each box below is the rectangle that scan produced. The rows come out
 * on a 34px pitch with 28x25 faces, but the stagger, the wide modifiers and
 * the navigation cluster all differ per row, so the table is explicit.
 *
 * The set is exactly the 68 keys that have a KeyConfig/key/<n> label sprite.
 * Deliberately absent, because the original ships no sprite for them and so
 * treats them as furniture: Esc and Tab (drawn in mauve as reserved), Caps
 * Lock, Backspace, Enter, right Shift, right Ctrl/Alt, the Windows and menu
 * keys, the arrow cluster, and Psc/Slk/Brk.
 */
type KeySlot = { code: number; x: number; y: number; w: number; h: number };

function buildLayout(): KeySlot[] {
  const out: KeySlot[] = [];
  // row(y, height, [[scancode, x, width], ...])
  const row = (y: number, h: number, keys: [number, number, number?][]) => {
    for (const [code, x, w] of keys) out.push({ code, x, y, w: w ?? 28, h });
  };

  // Function row — F1..F12 in three groups of four.
  row(29, 25, [
    [59, 83], [60, 117], [61, 151], [62, 185],
    [63, 227], [64, 261], [65, 295], [66, 329],
    [67, 371], [68, 405], [87, 439], [88, 473],
  ]);
  // Number row. The backtick sits proud of the row on a taller face, and the
  // Ins/Home/PgUp cluster is off to the right.
  out.push({ code: 41, x: 13, y: 67, w: 32, h: 30 });
  row(68, 25, [
    [2, 49], [3, 83], [4, 117], [5, 151], [6, 185], [7, 219], [8, 253],
    [9, 287], [10, 321], [11, 355], [12, 389], [13, 423],
    [82, 515], [71, 549], [73, 583],
  ]);
  // QWERTY row, then Del/End/PgDn.
  row(101, 25, [
    [16, 65], [17, 99], [18, 133], [19, 167], [20, 201], [21, 235],
    [22, 269], [23, 303], [24, 337], [25, 371], [26, 405], [27, 439],
    [43, 473],
    [83, 515], [79, 549], [81, 583],
  ]);
  // Home row.
  row(134, 25, [
    [30, 82], [31, 116], [32, 150], [33, 184], [34, 218], [35, 252],
    [36, 286], [37, 320], [38, 354], [39, 388], [40, 422],
  ]);
  // Shift row. Left Shift is bindable and 78 wide; the '/' key next to the
  // right Shift has no label sprite, so it is not a slot.
  row(167, 25, [
    [42, 15, 78],
    [44, 99], [45, 133], [46, 167], [47, 201], [48, 235], [49, 269],
    [50, 303], [51, 337], [52, 371],
  ]);
  // Bottom row — only the left Ctrl/Alt and the space bar are bindable.
  row(200, 25, [
    [29, 15, 43], [56, 114, 47], [57, 167, 164],
  ]);
  return out;
}
const KEY_SLOTS = buildLayout();

// The palette below the keyboard: 18 columns on a 34px pitch, three rows,
// measured the same way as the keys.
const PAL_X = 10;
const PAL_ROW_Y = [268, 303, 337];
const PAL_PITCH = 34;
const PAL_COLS = 18;
const PAL_CELL = 28;

// The band between the keyboard and the palette is the only free strip in
// the art, and the buttons are right-aligned in it.
const BTN_Y = 238;
const BTN_X = { default: 370, delete: 436, ok: 519, cancel: 572 };

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
  /** Horizontal offset of each button from the window's left edge. */
  _buttonDx: number[];
  /** Grab offset while the title bar is being dragged, null when it is not. */
  _windowDrag: { dx: number; dy: number } | null;
  syncButtons: () => void;
  /** itemId -> inventory icon, for items bound straight onto a key. */
  itemIcons: Record<number, HTMLImageElement>;
  loadItemIcon: (itemId: number) => void;
  handleDrop: (drop: { type: string; id: number; mouseX: number; mouseY: number }) => boolean;
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
UIKeyConfig._buttonDx = [];
UIKeyConfig._windowDrag = null;

/** The title plate across the top of the background, used as the drag handle. */
const TITLE_H = 26;

UIKeyConfig.itemIcons = {};

/**
 * Item icons come from the same place the inventory gets them, and are only
 * fetched once per item.
 */
UIKeyConfig.loadItemIcon = function (itemId: number) {
  if (this.itemIcons[itemId]) return;
  void (async () => {
    try {
      const Item = (await import("../Inventory/Item")).default;
      const obj: any = await Item.fromOpts({ itemId, quantity: 1 });
      const node = obj?.node?.info?.iconRaw || obj?.node?.info?.icon;
      if (node?.nGetImage) this.itemIcons[itemId] = node.nGetImage();
    } catch (e) {
      console.warn(`[UIKeyConfig] no icon for item ${itemId}`, e);
    }
  })();
};

/**
 * Take an item dragged out of the inventory and drop it onto a key.
 *
 * This is what makes "put the chair on X" possible at all: the quickslot bar
 * is fixed to the eight v83 keys, so anything outside that set has to be
 * bound here. Returns true when the drop was consumed.
 */
UIKeyConfig.handleDrop = function (drop) {
  if (!this.isVisible || drop.type !== "item") return false;
  const slot = KEY_SLOTS.find((s) => inside(slotRect(s), drop.mouseX, drop.mouseY));
  if (!slot) return false;
  KeyBindings.bindItem(slot.code, drop.id);
  this.loadItemIcon(drop.id);
  return true;
};

/** Buttons carry absolute coordinates, so they have to follow the window. */
UIKeyConfig.syncButtons = function () {
  this.buttons.forEach((b, i) => {
    b.x = this.x + (this._buttonDx[i] ?? 0);
    b.y = this.y + BTN_Y;
  });
};

const slotRect = (s: KeySlot) => ({
  x: UIKeyConfig.x + s.x,
  y: UIKeyConfig.y + s.y,
  w: s.w,
  h: s.h,
});
const palRect = (i: number) => ({
  x: UIKeyConfig.x + PAL_X + (i % PAL_COLS) * PAL_PITCH,
  y: UIKeyConfig.y + PAL_ROW_Y[Math.floor(i / PAL_COLS)],
  w: PAL_CELL,
  h: PAL_CELL,
});
const inside = (r: { x: number; y: number; w: number; h: number }, mx: number, my: number) =>
  mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;

/** Unbound actions, packed into the palette from the top-left with no gaps. */
const paletteActions = (): ActionInfo[] =>
  ACTIONS.filter((a) => KeyBindings.keyFor(a.action) === undefined);

/** Centre a 32x32 icon on a key face or palette cell. */
const iconAt = (r: { x: number; y: number; w: number; h: number }) => ({
  dx: Math.round(r.x + (r.w - ICON) / 2),
  dy: Math.round(r.y + (r.h - ICON) / 2),
});

UIKeyConfig.initialize = async function (canvas: GameCanvas) {
  // Rebuilt every time, like the other windows — entering a state clears
  // ClickManager, so retained buttons would draw but never take a click.
  this.buttons = [];
  this.isVisible = false;
  this.dragging = null;
  this._clickHeld = false;

  try {
    const uiWindow: any = await WZManager.get("UI.wz/UIWindow.img");
    const kc = uiWindow.nGet("KeyConfig");
    this.background = kc.nGet("backgrnd").nGetImage();

    this.icons = {};
    const iconRoot = kc.nGet("icon");
    for (const a of ACTIONS) {
      // nGet hands back an empty imgdir when the name is missing, and
      // nGetImage on a non-canvas corrupts rendering, so check the tag.
      const node = iconRoot.nGet(String(a.icon));
      if (node.nTagName === "canvas") this.icons[a.icon] = node.nGetImage();
      else console.warn(`[UIKeyConfig] no icon sprite ${a.icon} for ${a.action}`);
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
      this._buttonDx.push(dx);
    };
    this._buttonDx = [];
    // Bindings apply as they are dropped, so OK only has to close.
    mk(BTN_X.default, kc.nGet("BtDefault"), () => KeyBindings.resetToDefault());
    mk(BTN_X.delete, kc.nGet("BtDelete"), () => KeyBindings.replaceAll({}));
    mk(BTN_X.ok, kc.nGet("BtOK"), () => this.hide());
    mk(BTN_X.cancel, kc.nGet("BtCancel"), () => {
      if (this._restore) KeyBindings.replaceAll(this._restore);
      this.hide();
    });
  } catch (e) {
    // Without this the failure is swallowed by the `void` at the call site
    // and the window just silently never appears.
    console.error("[UIKeyConfig] initialize failed", e);
  }
};

UIKeyConfig.show = function () {
  if (this.isVisible) return;
  this.isVisible = true;
  this.dragging = null;
  this._clickHeld = false;
  // Captured so Cancel can put every binding back — they apply as you drop.
  this._restore = KeyBindings.snapshot();
  for (const code of Object.keys(KeyBindings.itemBindings)) {
    this.loadItemIcon(KeyBindings.itemBindings[Number(code)]);
  }
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

  // Moving the window itself, by its title plate. Handled before anything
  // else so a drag in progress owns the mouse.
  if (this._windowDrag) {
    if (canvas.clicked) {
      this.x = mx - this._windowDrag.dx;
      this.y = my - this._windowDrag.dy;
      // Keep it reachable — the title bar must stay on screen or there is no
      // way to drag it back.
      this.x = Math.max(-WIN_W + 80, Math.min(config.width - 80, this.x));
      this.y = Math.max(0, Math.min(config.height - TITLE_H, this.y));
      this.syncButtons();
      return;
    }
    this._windowDrag = null;
    this._clickHeld = false;
    return;
  }

  // canvas.clicked stays true for the whole press, so the pickup is latched
  // to the frame the button goes down and the drop to the frame it comes up.
  if (!canvas.clicked) {
    if (this.dragging) {
      const slot = KEY_SLOTS.find((s) => inside(slotRect(s), mx, my));
      // Dropping anywhere else discards the icon, which unbinds the action —
      // picking it up already removed it from its old key.
      if (slot) KeyBindings.bind(slot.code, this.dragging.action);
      else KeyBindings.save();
      this.dragging = null;
    }
    this._clickHeld = false;
    return;
  }
  if (this._clickHeld) return;
  this._clickHeld = true;

  // Grab the title plate to move the window.
  if (
    mx >= this.x && mx <= this.x + WIN_W &&
    my >= this.y && my <= this.y + TITLE_H
  ) {
    this._windowDrag = { dx: mx - this.x, dy: my - this.y };
    return;
  }

  // Pick up off a key…
  const slot = KEY_SLOTS.find((s) => inside(slotRect(s), mx, my));
  if (slot) {
    // An item on a key is cleared by clicking it — there is no palette for
    // items to go back to, they came from the inventory and still live there.
    if (KeyBindings.itemBindings[slot.code] !== undefined) {
      KeyBindings.clearItem(slot.code);
      return;
    }
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
  // …or out of the palette.
  const pal = paletteActions();
  for (let i = 0; i < pal.length; i++) {
    if (inside(palRect(i), mx, my)) {
      this.dragging = pal[i];
      return;
    }
  }
};

UIKeyConfig.draw = function (canvas, camera, lag, msPerTick, tdelta) {
  if (!this.isVisible || !this.background) return;
  canvas.drawImage({ img: this.background, dx: this.x, dy: this.y });

  // Items bound straight to a key (chairs, potions) draw their inventory icon.
  for (const s of KEY_SLOTS) {
    const itemId = KeyBindings.itemBindings[s.code];
    if (itemId === undefined) continue;
    const img = this.itemIcons[itemId];
    if (!img) { this.loadItemIcon(itemId); continue; }
    const r = slotRect(s);
    canvas.drawImage({
      img,
      dx: Math.round(r.x + (r.w - Math.min(img.width || ICON, ICON)) / 2),
      dy: Math.round(r.y + (r.h - Math.min(img.height || ICON, ICON)) / 2),
    });
  }

  // Icons sitting on the keys they are bound to.
  for (const s of KEY_SLOTS) {
    const action = KeyBindings.bindings[s.code];
    if (!action) continue;
    const info = ACTIONS.find((a) => a.action === action);
    const img = info && this.icons[info.icon];
    if (!img) continue;
    canvas.drawImage({ img, ...iconAt(slotRect(s)) });
  }

  // The palette holds whatever is not on a key.
  const pal = paletteActions();
  for (let i = 0; i < pal.length; i++) {
    const img = this.icons[pal[i].icon];
    if (!img) continue;
    canvas.drawImage({ img, ...iconAt(palRect(i)) });
  }

  this.buttons.forEach((b) => b.draw(canvas, camera, lag, msPerTick, tdelta));

  // The icon under the cursor draws last so it rides above everything else.
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
