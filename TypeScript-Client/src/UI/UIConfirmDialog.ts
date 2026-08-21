import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import { MapleStanceButton } from './MapleStanceButton';
import ClickManager from './ClickManager';
import config from '../Config';

/**
 * The generic in-game "are you sure?" prompt: Basic.img/YesNo3 (the
 * three-piece 266-wide blue panel) with BtOK2 / BtCancel2 in its grey strip —
 * the same dialog the fame prompt is built on. Used for dropping untradeable
 * items, where v83 warns that the item will be gone.
 */
const WIDTH = 266;
const TOP_H = 21;
const CENTER_H = 20;
const BOTTOM_H = 55;
const CENTER_REPEATS = 3;
const HEIGHT = TOP_H + CENTER_H * CENTER_REPEATS + BOTTOM_H;
const BLUE_TOP = 11;
const BLUE_TAIL = 11;
const LINE_H = 16;
const BTN_Y = 21;
const BTN_W = 47;
const BTN_GAP = 6;

type FrameParts = { t: any; c: any; s: any };

export default class UIConfirmDialog {
  isHidden: boolean = true;
  private basic: any = null;
  private frame: FrameParts | null = null;
  private buttons: MapleStanceButton[] = [];
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private canvas: GameCanvas;
  private lines: string[] = [];
  private onChoice: ((yes: boolean) => void) | null = null;

  static async fromOpts(opts: { canvas: GameCanvas }) {
    const dialog = new UIConfirmDialog(opts);
    await dialog.load();
    return dialog;
  }

  constructor(opts: { canvas: GameCanvas }) {
    this.canvas = opts.canvas;
  }

  get x(): number { return Math.floor((config.width - WIDTH) / 2); }
  get y(): number { return Math.floor((config.height - HEIGHT) / 2); }

  async load() {
    this.basic = await WZManager.get('UI.wz/Basic.img');
    const node = this.basic.nGet('YesNo3');
    this.frame = { t: node.nGet('t'), c: node.nGet('c'), s: node.nGet('s') };
    this.frame.t.nGetImage();
    this.frame.c.nGetImage();
    this.frame.s.nGetImage();
  }

  containsPoint(px: number, py: number): boolean {
    return !this.isHidden &&
      px >= this.x && px < this.x + WIDTH && py >= this.y && py < this.y + HEIGHT;
  }

  /** Ask `text`; `onChoice(true)` on OK/Enter, `onChoice(false)` on Cancel/Esc */
  show(text: string, onChoice: (yes: boolean) => void) {
    this.hide();
    this.lines = this.wrap(text, WIDTH - 40);
    this.onChoice = onChoice;
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
    this.isHidden = true;
  }

  private answer(yes: boolean) {
    const cb = this.onChoice;
    this.onChoice = null;
    this.hide();
    cb?.(yes);
  }

  private bindKeys() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (this.isHidden) return;
      if (e.key === 'Enter') this.answer(true);
      else if (e.key === 'Escape') this.answer(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', this.keydownHandler, true);
  }

  private createButtons() {
    const btnY = this.y + TOP_H + CENTER_H * CENTER_REPEATS + BTN_Y;
    const startX = this.x + Math.floor((WIDTH - (BTN_W * 2 + BTN_GAP)) / 2);
    const ok = new MapleStanceButton(null, {
      x: startX, y: btnY, isRelativeToCamera: true, isPartOfUI: true,
      img: this.basic.nGet('BtOK2').nChildren,
      onClick: () => this.answer(true),
    });
    const cancel = new MapleStanceButton(null, {
      x: startX + BTN_W + BTN_GAP, y: btnY, isRelativeToCamera: true, isPartOfUI: true,
      img: this.basic.nGet('BtCancel2').nChildren,
      onClick: () => this.answer(false),
    });
    this.buttons = [ok, cancel];
    this.buttons.forEach((btn) => ClickManager.addButton(btn));
  }

  update(_msPerTick: number) { /* buttons are ClickManager-driven */ }

  draw(canvas: GameCanvas, _camera: CameraInterface, _lag: number, _ms: number, _t: number) {
    if (this.isHidden || !this.frame) return;
    const x = this.x;
    let y = this.y;
    canvas.drawImage({ img: this.frame.t.nGetImage(), dx: x, dy: y });
    y += TOP_H;
    for (let i = 0; i < CENTER_REPEATS; i++) {
      canvas.drawImage({ img: this.frame.c.nGetImage(), dx: x, dy: y });
      y += CENTER_H;
    }
    canvas.drawImage({ img: this.frame.s.nGetImage(), dx: x, dy: y });
    const centerX = x + Math.floor(WIDTH / 2);
    const blueTop = this.y + BLUE_TOP;
    const blueBottom = this.y + TOP_H + CENTER_H * CENTER_REPEATS + BLUE_TAIL;
    const blockTop = Math.floor((blueTop + blueBottom - this.lines.length * LINE_H) / 2);
    this.lines.forEach((line, i) => {
      canvas.drawText({ text: line, x: centerX, y: blockTop + i * LINE_H, color: '#000000', fontSize: 12, align: 'center' });
    });
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
