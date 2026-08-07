import WZManager from "../wz-utils/WZManager";
import ClickManager from "./ClickManager";
import { MapleStanceButton } from "./MapleStanceButton";
import GameCanvas from "../GameCanvas";
import { CameraInterface } from "../Camera";
import config from "../Config";

// CHANGE CHANNEL window, opened from the game menu.
// Assets: UI.wz/UIWindow.img/Channel — a vertically composed frame
//   t (436x67) title + first band, c (436x10) repeatable middle, s (436x36) footer
// with 68x20 channel plates (channel0/1/2) and 20x10 digit strips (ch/0..29)
// drawn over the middle section.
const WIN_W = 436;
const T_H = 67;
const C_H = 10;
const S_H = 36;

const CHANNEL_COUNT = 20;
const COLS = 6;
const PLATE_W = 68;
const PLATE_H = 20;
const GRID_X = 8;
const GRID_GAP_X = 3;

// Plate variants baked into the art.
const PLATE_NORMAL = "channel0";
const PLATE_HOVER = "channel1";
const PLATE_SELECTED = "channel2";

const ROWS = Math.ceil(CHANNEL_COUNT / COLS);
// The middle section is built from 10px strips, so round the grid up to fit.
const MIDDLE_STRIPS = Math.ceil((ROWS * PLATE_H) / C_H);
const WIN_H = T_H + MIDDLE_STRIPS * C_H + S_H;

interface UIChannelSelectInterface {
  isVisible: boolean;
  /** Channel the player is on. Client-side only — the server has no channels. */
  currentChannel: number;
  selectedChannel: number;
  hoveredChannel: number;
  x: number;
  y: number;
  node: any;
  plates: Record<string, HTMLImageElement>;
  digits: HTMLImageElement[];
  frame: { t: HTMLImageElement | null; c: HTMLImageElement | null; s: HTMLImageElement | null };
  buttons: MapleStanceButton[];
  _canvas: GameCanvas | null;
  onChanged: ((channel: number) => void) | null;
  initialize: (canvas: GameCanvas) => Promise<void>;
  show: () => void;
  hide: () => void;
  doUpdate: (canvas: GameCanvas) => void;
  draw: (
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) => void;
}

const UIChannelSelect = {} as UIChannelSelectInterface;

UIChannelSelect.isVisible = false;
UIChannelSelect.currentChannel = 0;
UIChannelSelect.selectedChannel = 0;
UIChannelSelect.hoveredChannel = -1;
UIChannelSelect.x = 0;
UIChannelSelect.y = 0;
UIChannelSelect.plates = {};
UIChannelSelect.digits = [];
UIChannelSelect.frame = { t: null, c: null, s: null };
UIChannelSelect.buttons = [];
UIChannelSelect._canvas = null;
UIChannelSelect.onChanged = null;

function plateRect(index: number) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return {
    x: UIChannelSelect.x + GRID_X + col * (PLATE_W + GRID_GAP_X),
    y: UIChannelSelect.y + T_H + row * PLATE_H,
    width: PLATE_W,
    height: PLATE_H,
  };
}

UIChannelSelect.initialize = async function (canvas: GameCanvas) {
  // Rebuilt each time, like UIMap.addButtons — entering a state clears
  // ClickManager, so reused buttons would draw but never register a click.
  this._canvas = canvas;
  this.buttons = [];
  this.isVisible = false;

  const uiWindow: any = await WZManager.get("UI.wz/UIWindow.img");
  const ch = uiWindow.nGet("Channel");
  this.node = ch;

  this.frame = {
    t: ch.nGet("t").nGetImage(),
    c: ch.nGet("c").nGetImage(),
    s: ch.nGet("s").nGetImage(),
  };
  this.plates = {
    [PLATE_NORMAL]: ch.nGet(PLATE_NORMAL).nGetImage(),
    [PLATE_HOVER]: ch.nGet(PLATE_HOVER).nGetImage(),
    [PLATE_SELECTED]: ch.nGet(PLATE_SELECTED).nGetImage(),
  };
  this.digits = [];
  const chDir = ch.nGet("ch");
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    this.digits.push(chDir.nGet(String(i)).nGetImage());
  }

  this.x = Math.round((config.width - WIN_W) / 2);
  this.y = Math.round((config.height - WIN_H) / 2);

  // BtChange (91x18) and BtCancel (47x18) sit on the footer band.
  const footerY = this.y + WIN_H - S_H + 9;
  const change = new MapleStanceButton(canvas, {
    x: this.x + WIN_W - 91 - 47 - 16,
    y: footerY,
    img: ch.nGet("BtChange").nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    isHidden: true,
    onClick: () => {
      const picked = this.selectedChannel;
      this.hide();
      if (picked !== this.currentChannel) {
        this.currentChannel = picked;
        this.onChanged?.(picked);
      }
    },
  });
  const cancel = new MapleStanceButton(canvas, {
    x: this.x + WIN_W - 47 - 8,
    y: footerY,
    img: ch.nGet("BtCancel").nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    isHidden: true,
    onClick: () => this.hide(),
  });
  ClickManager.addButton(change);
  ClickManager.addButton(cancel);
  this.buttons.push(change, cancel);
};

UIChannelSelect.show = function () {
  if (this.isVisible) return;
  this.isVisible = true;
  this.selectedChannel = this.currentChannel;
  this.hoveredChannel = -1;
  this.buttons.forEach((b) => (b.isHidden = false));
};

UIChannelSelect.hide = function () {
  if (!this.isVisible) return;
  this.isVisible = false;
  this.hoveredChannel = -1;
  this.buttons.forEach((b) => (b.isHidden = true));
};

UIChannelSelect.doUpdate = function (canvas: GameCanvas) {
  if (!this.isVisible) return;

  const mx = canvas.mouseX;
  const my = canvas.mouseY;
  this.hoveredChannel = -1;

  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const r = plateRect(i);
    if (mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height) {
      this.hoveredChannel = i;
      // canvas.clicked stays true for the whole time the button is held, so
      // this runs on every frame of one click — assigning the same value is
      // idempotent, unlike anything that would advance state.
      if (canvas.clicked) this.selectedChannel = i;
      break;
    }
  }
};

UIChannelSelect.draw = function (canvas, camera, lag, msPerTick, tdelta) {
  if (!this.isVisible || !this.frame.t) return;

  canvas.drawImage({ img: this.frame.t, dx: this.x, dy: this.y });
  for (let i = 0; i < MIDDLE_STRIPS; i++) {
    canvas.drawImage({ img: this.frame.c!, dx: this.x, dy: this.y + T_H + i * C_H });
  }
  canvas.drawImage({
    img: this.frame.s!,
    dx: this.x,
    dy: this.y + T_H + MIDDLE_STRIPS * C_H,
  });

  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const r = plateRect(i);
    const variant =
      i === this.selectedChannel
        ? PLATE_SELECTED
        : i === this.hoveredChannel
        ? PLATE_HOVER
        : PLATE_NORMAL;
    canvas.drawImage({ img: this.plates[variant], dx: r.x, dy: r.y });

    const digit = this.digits[i];
    if (digit) {
      canvas.drawImage({
        img: digit,
        dx: r.x + Math.round((PLATE_W - (digit.width || 20)) / 2) + 6,
        dy: r.y + Math.round((PLATE_H - (digit.height || 10)) / 2),
      });
    }
  }

  this.buttons.forEach((b) => b.draw(canvas, camera, lag, msPerTick, tdelta));
};

export default UIChannelSelect;
