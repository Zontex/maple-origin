import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import { MapleStanceButton } from './MapleStanceButton';
import ClickManager from './ClickManager';
import config from '../Config';

/**
 * Fame prompt — "Would you like to raise or drop the fame of <name>?" with
 * Raise / Drop choices, opened by clicking the FAME row of another player's
 * Character Info window. v83 has no dedicated fame art, so this is the
 * generic ask dialog: Basic.img/YesNo3 frame (the three-piece 266-wide blue
 * panel), CheckBox sprites as the two radio choices, and BtOK2 / BtCancel2
 * in the grey strip. Server replies that need a popup ("You have already
 * given fame today." ...) reuse the same class in message mode on the
 * Notice3 frame, which is the same panel with a plain bottom piece.
 */

const WIDTH = 266;
const TOP_H = 21;
const CENTER_H = 20;
const BOTTOM_H = 55;
const CENTER_REPEATS = 3;
const HEIGHT = TOP_H + CENTER_H * CENTER_REPEATS + BOTTOM_H;

// Blue panel interior: the top piece is frame + grey down to row 11 and the
// bottom piece stays blue for 11 rows before its border
const BLUE_TOP = 11;
const BLUE_TAIL = 11;
const LINE_H = 16;

// Button strip inside the bottom piece (grey runs 12..49)
const BTN_Y = 21;
const BTN_W = 47;
const BTN_GAP = 6;

// Radio row: CheckBox is 12x12, label to its right
const CHECK_SIZE = 12;
const CHECK_LABEL_GAP = 5;
const CHOICE_GAP = 40;

type Mode = 'ask' | 'message';
type FrameParts = { t: any; c: any; s: any };

export default class UIFameDialog {
  isHidden: boolean = true;

  private basic: any = null;
  private askFrame: FrameParts | null = null;
  private messageFrame: FrameParts | null = null;
  private checkOff: HTMLImageElement | null = null;
  private checkOn: HTMLImageElement | null = null;
  private buttons: MapleStanceButton[] = [];
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private canvas: GameCanvas;

  private mode: Mode = 'ask';
  private targetName: string = '';
  private raise: boolean = true;
  private messageLines: string[] = [];
  private onChoice: ((raise: boolean) => void) | null = null;
  private wasClicked: boolean = false;

  static async fromOpts(opts: { canvas: GameCanvas }) {
    const dialog = new UIFameDialog(opts);
    await dialog.load();
    return dialog;
  }

  constructor(opts: { canvas: GameCanvas }) {
    this.canvas = opts.canvas;
  }

  // Always centred on the canvas
  get x(): number {
    return Math.floor((config.width - WIDTH) / 2);
  }

  get y(): number {
    return Math.floor((config.height - HEIGHT) / 2);
  }

  async load() {
    this.basic = await WZManager.get('UI.wz/Basic.img');
    const pieces = (name: string): FrameParts => {
      const node = this.basic.nGet(name);
      const frame = { t: node.nGet('t'), c: node.nGet('c'), s: node.nGet('s') };
      frame.t.nGetImage();
      frame.c.nGetImage();
      frame.s.nGetImage();
      return frame;
    };
    this.askFrame = pieces('YesNo3');
    this.messageFrame = pieces('Notice3');
    // CheckBox frames: 0 unchecked, 1 checked (2/3 are the disabled pair)
    const check = this.basic.nGet('CheckBox');
    this.checkOff = check.nGet('0').nGetImage();
    this.checkOn = check.nGet('1').nGetImage();
  }

  private get frame(): FrameParts | null {
    return this.mode === 'message' ? this.messageFrame : this.askFrame;
  }

  containsPoint(px: number, py: number): boolean {
    return !this.isHidden &&
      px >= this.x && px < this.x + WIDTH && py >= this.y && py < this.y + HEIGHT;
  }

  /** Ask whether to raise or drop `targetName`'s fame */
  show(targetName: string, onChoice: (raise: boolean) => void) {
    this.hide();
    this.mode = 'ask';
    this.targetName = targetName;
    this.raise = true;
    this.onChoice = onChoice;
    this.isHidden = false;
    this.wasClicked = !!this.canvas.clicked;
    this.createButtons();
    this.bindKeys();
  }

  /** Plain notice with an OK button — the server's refusal reasons */
  showMessage(text: string) {
    this.hide();
    this.mode = 'message';
    this.messageLines = this.wrap(text, WIDTH - 40);
    this.onChoice = null;
    this.isHidden = false;
    this.createButtons();
    this.bindKeys();
  }

  hide() {
    this.buttons.forEach((btn) => ClickManager.removeButton(btn));
    this.buttons = [];
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    this.onChoice = null;
    this.isHidden = true;
  }

  private confirm() {
    if (this.mode === 'message') {
      this.hide();
      return;
    }
    const cb = this.onChoice;
    const raise = this.raise;
    this.hide();
    cb?.(raise);
  }

  private bindKeys() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (this.isHidden) return;
      if (e.key === 'Enter') {
        this.confirm();
      } else if (e.key === 'Escape') {
        this.hide();
      } else if (this.mode === 'ask' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        this.raise = !this.raise;
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', this.keydownHandler, true);
  }

  private createButtons() {
    const btnY = this.y + TOP_H + CENTER_H * CENTER_REPEATS + BTN_Y;
    const ok = new MapleStanceButton(null, {
      x: 0,
      y: btnY,
      isRelativeToCamera: true,
      isPartOfUI: true,
      img: this.basic.nGet('BtOK2').nChildren,
      onClick: () => this.confirm(),
    });
    if (this.mode === 'message') {
      ok.x = this.x + Math.floor((WIDTH - BTN_W) / 2);
      this.buttons = [ok];
    } else {
      const startX = this.x + Math.floor((WIDTH - (BTN_W * 2 + BTN_GAP)) / 2);
      ok.x = startX;
      const cancel = new MapleStanceButton(null, {
        x: startX + BTN_W + BTN_GAP,
        y: btnY,
        isRelativeToCamera: true,
        isPartOfUI: true,
        img: this.basic.nGet('BtCancel2').nChildren,
        onClick: () => this.hide(),
      });
      this.buttons = [ok, cancel];
    }
    this.buttons.forEach((btn) => ClickManager.addButton(btn));
  }

  // ---- radio row geometry --------------------------------------------------
  private choiceRects(): { raise: boolean; x: number; y: number; w: number; h: number }[] {
    const ctx = this.canvas.context;
    ctx.save();
    ctx.font = '12px Arial';
    const raiseW = Math.ceil(ctx.measureText('Raise').width);
    const dropW = Math.ceil(ctx.measureText('Drop').width);
    ctx.restore();
    const itemW = (label: number) => CHECK_SIZE + CHECK_LABEL_GAP + label;
    const total = itemW(raiseW) + CHOICE_GAP + itemW(dropW);
    const rowY = this.y + TOP_H + LINE_H * 2 + 10;
    const startX = this.x + Math.floor((WIDTH - total) / 2);
    return [
      { raise: true, x: startX, y: rowY, w: itemW(raiseW), h: CHECK_SIZE },
      { raise: false, x: startX + itemW(raiseW) + CHOICE_GAP, y: rowY, w: itemW(dropW), h: CHECK_SIZE },
    ];
  }

  update(_msPerTick: number) {
    if (this.isHidden) return;
    // Radio clicks: rising edge of the mouse button over a choice
    const clicked = !!this.canvas.clicked;
    if (clicked && !this.wasClicked && this.mode === 'ask') {
      const mx = this.canvas.mouseX;
      const my = this.canvas.mouseY;
      for (const r of this.choiceRects()) {
        if (mx >= r.x - 2 && mx <= r.x + r.w + 2 && my >= r.y - 3 && my <= r.y + r.h + 3) {
          this.raise = r.raise;
          break;
        }
      }
    }
    this.wasClicked = clicked;
  }

  draw(canvas: GameCanvas, _camera: CameraInterface, _lag: number, _ms: number, _t: number) {
    if (this.isHidden) return;
    const frame = this.frame;
    if (!frame) return;

    const x = this.x;
    let y = this.y;
    canvas.drawImage({ img: frame.t.nGetImage(), dx: x, dy: y });
    y += TOP_H;
    for (let i = 0; i < CENTER_REPEATS; i++) {
      canvas.drawImage({ img: frame.c.nGetImage(), dx: x, dy: y });
      y += CENTER_H;
    }
    canvas.drawImage({ img: frame.s.nGetImage(), dx: x, dy: y });

    const centerX = x + Math.floor(WIDTH / 2);

    if (this.mode === 'message') {
      const blueTop = this.y + BLUE_TOP;
      const blueBottom = this.y + TOP_H + CENTER_H * CENTER_REPEATS + BLUE_TAIL;
      const blockTop = Math.floor((blueTop + blueBottom - this.messageLines.length * LINE_H) / 2);
      this.messageLines.forEach((line, i) => {
        canvas.drawText({
          text: line, x: centerX, y: blockTop + i * LINE_H,
          color: '#000000', fontSize: 12, align: 'center',
        });
      });
      return;
    }

    const textTop = this.y + TOP_H + 2;
    canvas.drawText({
      text: 'Would you like to raise or drop',
      x: centerX, y: textTop, color: '#000000', fontSize: 12, align: 'center',
    });
    canvas.drawText({
      text: `the fame of ${this.targetName}?`,
      x: centerX, y: textTop + LINE_H, color: '#000000', fontSize: 12, align: 'center',
    });

    for (const r of this.choiceRects()) {
      const img = (r.raise === this.raise) ? this.checkOn : this.checkOff;
      if (img?.width) canvas.drawImage({ img, dx: r.x, dy: r.y });
      canvas.drawText({
        text: r.raise ? 'Raise' : 'Drop',
        x: r.x + CHECK_SIZE + CHECK_LABEL_GAP, y: r.y - 1,
        color: '#000000', fontSize: 12,
      });
    }
  }

  private wrap(text: string, maxW: number): string[] {
    const ctx = this.canvas.context;
    ctx.save();
    ctx.font = '12px Arial';
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    ctx.restore();
    return lines;
  }
}
