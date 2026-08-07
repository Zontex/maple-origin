import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import { MapleStanceButton } from './MapleStanceButton';
import ClickManager from './ClickManager';
import config from '../Config';

// Notice3 and Notice4 known dimensions from WZ data. The two frames are the
// same 266-wide panel and differ only in the bottom piece: Notice4/s has the
// white entry box drawn into the sprite, Notice3/s is a plain panel. A dialog
// that only reports something ("You cannot sell this item.") therefore has to
// be built from Notice3 — hiding the input value is not enough, the box itself
// is part of the frame and shows up under text with nothing to type into it.
const NOTICE_WIDTH = 266;
const NOTICE_TOP_H = 21;
const NOTICE_CENTER_H = 20;
const INPUT_BOTTOM_H = 78;   // Notice4/s — entry box above the button strip
const MESSAGE_BOTTOM_H = 55; // Notice3/s — button strip only
const CENTER_REPEATS = 2;

// Blue panel interior, measured from the dialog's top-left: the top piece is
// frame + grey down to row 11, and Notice3's bottom piece stays blue for 11
// more rows before its border. Message text is centred in that band.
const BLUE_TOP = 11;
const BLUE_TAIL = 11;
const LINE_H = 16;

// Button strip offsets within the bottom piece: Notice4's grey runs 35..72
// (below the entry box), Notice3's runs 12..49.
const INPUT_BTN_Y = 50;
const MESSAGE_BTN_Y = 21;

// Button sizes: both BtOK2 and BtCancel2 are 47x18 in Basic.img. OK was down
// as 41 here, which ate the whole gap between the pair and left it 3px off
// centre.
const BTN_OK_W = 47;
const BTN_CANCEL_W = 47;
const BTN_GAP = 6;

export type DropDialogMode = 'meso' | 'item' | 'message';

export default class UIMesoDropDialog {
  private basicImg: any = null;
  private inputFrame: { t: any; c: any; s: any } | null = null;
  private messageFrame: { t: any; c: any; s: any } | null = null;
  isHidden: boolean = true;
  private buttons: MapleStanceButton[] = [];
  private canvas: GameCanvas;
  private onConfirm: ((amount: number) => void) | null = null;
  private maxAmount: number = 0;
  private errorMessage: string = '';
  private errorTimer: number = 0;
  private inputValue: string = '0';
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private mode: DropDialogMode = 'meso';
  private messageLines: string[] = [];
  private itemName: string = '';
  private showInput: boolean = true;
  private verb: string = 'drop';

  static async fromOpts(opts: { canvas: GameCanvas }) {
    const dialog = new UIMesoDropDialog(opts);
    await dialog.load();
    return dialog;
  }

  constructor(opts: { canvas: GameCanvas }) {
    this.canvas = opts.canvas;
  }

  // Dialog is always centered on the canvas
  private get x(): number {
    return Math.floor((config.width - NOTICE_WIDTH) / 2);
  }

  private get y(): number {
    return Math.floor((config.height - this.dialogHeight) / 2);
  }

  /** Frame pieces for the current mode — Notice3 reports, Notice4 asks. */
  private get frame(): { t: any; c: any; s: any } {
    return (this.mode === 'message' ? this.messageFrame : this.inputFrame)!;
  }

  private get bottomHeight(): number {
    return this.mode === 'message' ? MESSAGE_BOTTOM_H : INPUT_BOTTOM_H;
  }

  private get dialogHeight(): number {
    return NOTICE_TOP_H + NOTICE_CENTER_H * CENTER_REPEATS + this.bottomHeight;
  }

  async load() {
    this.basicImg = await WZManager.get('UI.wz/Basic.img');

    const pieces = (name: string) => {
      const node = this.basicImg.nGet(name);
      const frame = { t: node.nGet('t'), c: node.nGet('c'), s: node.nGet('s') };
      // Pre-decode images so they're ready when we draw
      frame.t.nGetImage();
      frame.c.nGetImage();
      frame.s.nGetImage();
      return frame;
    };

    this.inputFrame = pieces('Notice4');
    this.messageFrame = pieces('Notice3');
  }

  private createButtons() {
    // Remove old buttons
    this.buttons.forEach(btn => ClickManager.removeButton(btn));
    this.buttons = [];

    // Bottom piece starts here. Buttons sit in its grey strip, which begins
    // below the entry box on Notice4 and right under the panel on Notice3.
    const bottomY = this.y + NOTICE_TOP_H + NOTICE_CENTER_H * CENTER_REPEATS;
    const btnY = bottomY + (this.mode === 'message' ? MESSAGE_BTN_Y : INPUT_BTN_Y);
    const totalBtnW = BTN_OK_W + BTN_GAP + BTN_CANCEL_W;
    const btnStartX = this.x + Math.floor((NOTICE_WIDTH - totalBtnW) / 2);

    const okButton = new MapleStanceButton(null, {
      x: btnStartX,
      y: btnY,
      isRelativeToCamera: true,
      isPartOfUI: true,
      img: this.basicImg.nGet('BtOK2').nChildren,
      onClick: () => {
        this.confirm();
      },
    });

    // A plain message carries only its OK button, centered
    if (this.mode === 'message') {
      okButton.x = this.x + Math.floor((NOTICE_WIDTH - BTN_OK_W) / 2);
      this.buttons = [okButton];
      this.buttons.forEach(btn => ClickManager.addButton(btn));
      return;
    }

    const cancelButton = new MapleStanceButton(null, {
      x: btnStartX + BTN_OK_W + BTN_GAP,
      y: btnY,
      isRelativeToCamera: true,
      isPartOfUI: true,
      img: this.basicImg.nGet('BtCancel2').nChildren,
      onClick: () => {
        this.hide();
      },
    });

    this.buttons = [okButton, cancelButton];
    this.buttons.forEach(btn => ClickManager.addButton(btn));
  }

  show(maxAmount: number, onConfirm: (amount: number) => void, mode: DropDialogMode = 'meso', itemName: string = '', verb: string = 'drop') {
    this.isHidden = false;
    this.maxAmount = maxAmount;
    this.onConfirm = onConfirm;
    this.mode = mode;
    this.itemName = itemName;
    this.verb = verb;
    this.errorMessage = '';
    this.errorTimer = 0;

    // For single non-stackable items, no input needed
    this.showInput = mode === 'meso' || maxAmount > 1;
    this.inputValue = this.showInput ? '0' : '1';

    // Create buttons at current position (centered)
    this.createButtons();

    // Capture keyboard input directly
    this.keydownHandler = (e: KeyboardEvent) => {
      if (this.isHidden) return;

      if (this.showInput && e.key >= '0' && e.key <= '9') {
        if (this.inputValue === '0') {
          this.inputValue = e.key;
        } else {
          this.inputValue += e.key;
        }
        if (this.inputValue.length > 10) {
          this.inputValue = this.inputValue.slice(0, 10);
        }
        e.preventDefault();
        e.stopPropagation();
      } else if (this.showInput && e.key === 'Backspace') {
        if (this.inputValue.length > 1) {
          this.inputValue = this.inputValue.slice(0, -1);
        } else {
          this.inputValue = '0';
        }
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === 'Enter') {
        this.confirm();
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === 'Escape') {
        this.hide();
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', this.keydownHandler, true);
  }

  /** Plain notice with an OK button — e.g. "You cannot sell this item." */
  showMessage(lines: string[]) {
    this.isHidden = false;
    this.mode = 'message';
    this.messageLines = lines;
    this.onConfirm = null;
    this.showInput = false;
    this.errorMessage = '';
    this.errorTimer = 0;

    this.createButtons();

    this.keydownHandler = (e: KeyboardEvent) => {
      if (this.isHidden) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        this.hide();
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', this.keydownHandler, true);
  }

  hide() {
    this.buttons.forEach(btn => ClickManager.removeButton(btn));
    this.buttons = [];
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    this.onConfirm = null;
    this.errorMessage = '';
    this.isHidden = true;
  }

  private confirm() {
    if (this.mode === 'message') {
      this.hide();
      return;
    }
    const amount = parseInt(this.inputValue) || 0;
    if (amount <= 0) {
      this.errorMessage = 'Please enter a valid amount.';
      this.errorTimer = 2000;
      return;
    }
    if (amount > this.maxAmount) {
      this.errorMessage = this.mode === 'meso'
        ? "You don't have enough mesos!"
        : `You only have ${this.maxAmount}!`;
      this.errorTimer = 2000;
      return;
    }
    if (this.onConfirm) {
      this.onConfirm(amount);
    }
    this.hide();
  }

  update(msPerTick: number) {
    if (this.isHidden) return;
    if (this.errorTimer > 0) {
      this.errorTimer -= msPerTick;
      if (this.errorTimer <= 0) {
        this.errorMessage = '';
        this.errorTimer = 0;
      }
    }
  }

  draw(canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) {
    if (this.isHidden) return;

    const x = this.x;
    let y = this.y;
    const frame = this.frame;
    if (!frame) return;

    // Draw top piece
    canvas.drawImage({ img: frame.t.nGetImage(), dx: x, dy: y });
    y += NOTICE_TOP_H;

    // Draw repeated center strips
    for (let i = 0; i < CENTER_REPEATS; i++) {
      canvas.drawImage({ img: frame.c.nGetImage(), dx: x, dy: y });
      y += NOTICE_CENTER_H;
    }

    // Draw bottom piece
    canvas.drawImage({ img: frame.s.nGetImage(), dx: x, dy: y });

    // Draw dialog text centered in the top + center area
    const textX = x + Math.floor(NOTICE_WIDTH / 2);
    const textAreaTop = this.y + NOTICE_TOP_H + 2;

    if (this.mode === 'message') {
      // Nothing follows the text on a message, so it sits centred in the blue
      // panel rather than pinned under the top edge with dead space below.
      const blueTop = this.y + BLUE_TOP;
      const blueBottom = this.y + NOTICE_TOP_H + NOTICE_CENTER_H * CENTER_REPEATS + BLUE_TAIL;
      const blockTop = Math.floor(
        (blueTop + blueBottom - this.messageLines.length * LINE_H) / 2
      );
      this.messageLines.forEach((line, i) => {
        canvas.drawText({
          text: line,
          x: textX,
          y: blockTop + i * LINE_H,
          color: '#000000',
          fontSize: 12,
          align: 'center',
        });
      });
    } else if (this.mode === 'meso') {
      canvas.drawText({
        text: 'How many mesos would you',
        x: textX,
        y: textAreaTop,
        color: '#000000',
        fontSize: 12,
        align: 'center',
      });
      canvas.drawText({
        text: 'like to drop?',
        x: textX,
        y: textAreaTop + 16,
        color: '#000000',
        fontSize: 12,
        align: 'center',
      });
    } else if (this.showInput) {
      // Stackable item
      canvas.drawText({
        text: `How many would you`,
        x: textX,
        y: textAreaTop,
        color: '#000000',
        fontSize: 12,
        align: 'center',
      });
      canvas.drawText({
        text: `like to ${this.verb}?`,
        x: textX,
        y: textAreaTop + 16,
        color: '#000000',
        fontSize: 12,
        align: 'center',
      });
    } else {
      // Single item confirmation
      canvas.drawText({
        text: 'Are you sure you want to',
        x: textX,
        y: textAreaTop,
        color: '#000000',
        fontSize: 12,
        align: 'center',
      });
      canvas.drawText({
        text: `${this.verb} this item?`,
        x: textX,
        y: textAreaTop + 16,
        color: '#000000',
        fontSize: 12,
        align: 'center',
      });
    }

    // Draw the input value inside the white box in the bottom piece
    // The white box in the 's' piece is roughly at y+8 to y+28 from bottom piece top
    if (this.showInput) {
      const bottomPieceY = this.y + NOTICE_TOP_H + NOTICE_CENTER_H * CENTER_REPEATS;
      canvas.drawText({
        text: this.inputValue,
        x: x + NOTICE_WIDTH - 20,
        y: bottomPieceY + 10,
        color: '#000000',
        fontSize: 12,
        align: 'right',
      });
    }

    // Draw error message if any
    if (this.errorMessage) {
      const errorY = this.y + NOTICE_TOP_H + NOTICE_CENTER_H * CENTER_REPEATS + 10;
      canvas.drawText({
        text: this.errorMessage,
        x: textX,
        y: errorY,
        color: '#CC0000',
        fontSize: 11,
        align: 'center',
      });
    }

    // Draw buttons
    this.buttons.forEach(btn => {
      btn.draw(canvas, camera, lag, msPerTick, tdelta);
    });
  }

  destroy() {
    this.hide();
  }
}
