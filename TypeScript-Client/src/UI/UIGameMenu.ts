import WZManager from "../wz-utils/WZManager";
import ClickManager from "./ClickManager";
import { MapleStanceButton, BUTTON_STANCE } from "./MapleStanceButton";
import GameCanvas from "../GameCanvas";
import { CameraInterface } from "../Camera";
import config from "../Config";

// The GAME MENU popup opened by the MENU button on the status bar.
// Assets: UI.wz/UIWindow.img/GameMenu — a 93x140 panel whose title bar is
// baked into `backgrnd`, plus five 81x25 buttons stacked below it.
const PANEL_W = 93;
const PANEL_H = 140;

// Measured off the background art: the dark well inside the frame runs y=19
// to y=130 (112px) and x=3 to x=89, so an 81px button centres at an inset of
// 6px on each side.
//
// Five 25px buttons come to 125px and do not fit the 112px well -- stacking
// them flush overflowed the frame by 13px and spilled past the bottom border.
// They are meant to overlap: each button's art carries its own 1-2px border,
// exactly like the original client. Distributing them across the well pins the
// first to the top and the last to the bottom (19, 41, 63, 84, 106).
const WELL_LEFT = 3;
const WELL_TOP = 19;
const WELL_H = 112;
const BTN_X_INSET = 6;
const BTN_H = 25;

// The well is 87px wide and the button 81px, so centring leaves 3px of dark
// showing between the button edge and the white frame on each side. Matching
// that margin above the first entry and below the last one frames the stack
// the same way all round; the entries overlap a little more to pay for it,
// which their border art is drawn to absorb.
const MARGIN = BTN_X_INSET - WELL_LEFT;

function buttonY(index: number, count: number): number {
  const top = WELL_TOP + MARGIN;
  if (count <= 1) return top;
  const span = WELL_H - MARGIN * 2 - BTN_H;
  return top + Math.round((index * span) / (count - 1));
}

// Status bar art is 800x71 and sits flush with the bottom of the screen; the
// panel pops up directly above it.
const STATUS_BAR_H = 71;

type MenuAction =
  | "channel"
  | "gameOption"
  | "systemOption"
  | "quit";

// Top-to-bottom, matching the order of the WZ nodes.
//
// CHANGE SKIN (BtSkin) is drawn from its `disabled` frame and never activates:
// v83 GMS shipped no UI skins — UI.wz holds a single UIWindow.img and nothing
// else named "skin" besides this one button — so the entry had nothing to open.
// The art ships the greyed frame for exactly that state.
const MENU_ITEMS: { node: string; action: MenuAction | null }[] = [
  { node: "BtChannel", action: "channel" },
  { node: "BtSkin", action: null },
  { node: "BtGameOpt", action: "gameOption" },
  { node: "BtSysOpt", action: "systemOption" },
  { node: "BtQuit", action: "quit" },
];

interface UIGameMenuInterface {
  isVisible: boolean;
  background: HTMLImageElement | null;
  buttons: MapleStanceButton[];
  x: number;
  y: number;
  /** Keyboard cursor. -1 when nothing is highlighted. */
  selectedIndex: number;
  /**
   * True from the moment Enter confirms an entry until that key is released.
   * activateSelected() closes the panel, so a later check of `isVisible` in the
   * same frame would already read false and let the same keypress fall through
   * to the chat box. Cleared by MapState once Enter comes back up.
   */
  swallowEnter: boolean;
  _canvas: GameCanvas | null;
  /** Set by whoever owns the actions (UIMap) — keeps this module presentation-only. */
  onAction: ((action: MenuAction) => void) | null;
  initialize: (canvas: GameCanvas) => Promise<void>;
  open: () => void;
  toggle: () => void;
  hide: () => void;
  moveSelection: (delta: number) => void;
  activateSelected: () => void;
  draw: (
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) => void;
}

const UIGameMenu = {} as UIGameMenuInterface;

UIGameMenu.isVisible = false;
UIGameMenu.background = null;
UIGameMenu.buttons = [];
UIGameMenu.x = 0;
UIGameMenu.y = 0;
UIGameMenu.selectedIndex = -1;
UIGameMenu.swallowEnter = false;
UIGameMenu._canvas = null;
UIGameMenu.onAction = null;

UIGameMenu.initialize = async function (canvas: GameCanvas) {
  // Rebuilt from scratch every time, mirroring UIMap.addButtons: entering a
  // state runs ClickManager.clearButton(), so holding on to the old buttons
  // would leave the panel drawn but dead to clicks.
  this._canvas = canvas;
  this.buttons = [];
  this.isVisible = false;
  this.selectedIndex = -1;

  const uiWindow: any = await WZManager.get("UI.wz/UIWindow.img");
  const gameMenu = uiWindow.nGet("GameMenu");
  this.background = gameMenu.nGet("backgrnd").nGetImage();

  // Anchored above the status bar, horizontally centred on the MENU button
  // (54 wide at x=682 in the 800x600 layout; the bar itself is centered on
  // wider screens, so the button rides the same offset).
  const menuButtonX = 682 + Math.floor((config.width - 800) / 2);
  this.x = Math.round(menuButtonX + (54 - PANEL_W) / 2);
  this.y = config.height - STATUS_BAR_H - PANEL_H - 2;

  MENU_ITEMS.forEach((item, i) => {
    const action = item.action;
    const button = new MapleStanceButton(canvas, {
      x: this.x + BTN_X_INSET,
      y: this.y + buttonY(i, MENU_ITEMS.length),
      img: gameMenu.nGet(item.node).nChildren,
      isRelativeToCamera: true,
      isPartOfUI: true,
      isHidden: true,
      stance: action ? BUTTON_STANCE.NORMAL : "disabled",
      onClick: () => {
        if (!action) return;
        // v83 closes the menu as soon as an entry is chosen.
        this.hide();
        this.onAction?.(action);
      },
    });
    // A disabled entry stays out of ClickManager so it neither lights up on
    // hover nor swallows a click; it is only drawn.
    if (action) ClickManager.addButton(button);
    this.buttons.push(button);
  });
};

UIGameMenu.open = function () {
  if (this.isVisible) return;
  this.isVisible = true;
  // Start on the first entry so Enter is meaningful the moment ESC opens it.
  this.selectedIndex = 0;
  this.buttons.forEach((b) => (b.isHidden = false));
};

UIGameMenu.toggle = function () {
  if (this.isVisible) this.hide();
  else this.open();
};

UIGameMenu.hide = function () {
  if (!this.isVisible) return;
  this.isVisible = false;
  this.selectedIndex = -1;
  this.buttons.forEach((b) => (b.isHidden = true));
};

UIGameMenu.moveSelection = function (delta: number) {
  if (!this.isVisible) return;
  const count = MENU_ITEMS.length;
  const step = delta < 0 ? -1 : 1;
  // Wraps, like the original client's keyboard cursor, and steps over the
  // disabled entry the way a greyed button is skipped by keyboard focus.
  let index = this.selectedIndex;
  for (let n = 0; n < count; n++) {
    index = (((index + step) % count) + count) % count;
    if (MENU_ITEMS[index].action) break;
  }
  this.selectedIndex = index;
};

UIGameMenu.activateSelected = function () {
  if (!this.isVisible) return;
  const item = MENU_ITEMS[this.selectedIndex];
  if (!item || !item.action) return;
  // Claim this keypress so closing the panel below doesn't hand the very same
  // Enter to the chat box further along the frame.
  this.swallowEnter = true;
  this.hide();
  this.onAction?.(item.action);
};

UIGameMenu.draw = function (canvas, camera, lag, msPerTick, tdelta) {
  if (!this.isVisible || !this.background) return;

  canvas.drawImage({ img: this.background, dx: this.x, dy: this.y });

  this.buttons.forEach((b, i) => {
    // Reuse each button's own mouseOver art for the keyboard cursor rather than
    // painting a highlight of our own. Every button's stance is set explicitly
    // on every frame: ClickManager only clears stances on the frames where it
    // has an active button, so relying on it left every visited entry stuck lit
    // as the cursor moved down the list.
    const hoveredByMouse = (ClickManager as any).activeButton === b;
    if (!MENU_ITEMS[i].action) {
      b.stance = "disabled";
    } else if (i === this.selectedIndex) {
      b.stance = BUTTON_STANCE.MOUSE_OVER;
    } else if (!hoveredByMouse) {
      b.stance = BUTTON_STANCE.NORMAL;
    }
    b.draw(canvas, camera, lag, msPerTick, tdelta);
  });
};

export default UIGameMenu;
export type { MenuAction };
