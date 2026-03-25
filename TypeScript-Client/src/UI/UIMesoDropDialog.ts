import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import { MapleStanceButton } from './MapleStanceButton';
import ClickManager from './ClickManager';
import config from '../Config';

// Notice4 known dimensions from WZ data
const NOTICE_WIDTH = 266;
const NOTICE_TOP_H = 21;
const NOTICE_CENTER_H = 20;
const NOTICE_BOTTOM_H = 78;
const CENTER_REPEATS = 2;

// Total dialog height
const DIALOG_H = NOTICE_TOP_H + NOTICE_CENTER_H * CENTER_REPEATS + NOTICE_BOTTOM_H;

// Button sizes: BtOK2=41x18, BtCancel2=47x18
const BTN_OK_W = 41;
const BTN_CANCEL_W = 47;
const BTN_GAP = 6;

export type DropDialogMode = 'meso' | 'item';

export default class UIMesoDropDialog {
  private basicImg: any = null;
  private noticeTopNode: any = null;
  private noticeCenterNode: any = null;
  private noticeBottomNode: any = null;
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
  private itemName: string = '';
  private showInput: boolean = true;

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
    return Math.floor((config.height - DIALOG_H) / 2);
  }

  async load() {
    this.basicImg = await WZManager.get('UI.wz/Basic.img');

    this.noticeTopNode = this.basicImg.nGet('Notice4').nGet('t');
    this.noticeCenterNode = this.basicImg.nGet('Notice4').nGet('c');
    this.noticeBottomNode = this.basicImg.nGet('Notice4').nGet('s');

    // Pre-decode images so they're ready when we draw
    this.noticeTopNode.nGetImage();
    this.noticeCenterNode.nGetImage();
    this.noticeBottomNode.nGetImage();
  }

  private createButtons() {
    // Remove old buttons
    this.buttons.forEach(btn => ClickManager.removeButton(btn));
    this.buttons = [];

    // Bottom piece starts here
    const bottomY = this.y + NOTICE_TOP_H + NOTICE_CENTER_H * CENTER_REPEATS;
    // Buttons centered in the bottom piece, below the input box
    // The input box area is roughly at y+14 to y+32 in the bottom piece
    // Buttons sit at roughly y+50 in the bottom piece
    const btnY = bottomY + 50;
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

  show(maxAmount: number, onConfirm: (amount: number) => void, mode: DropDialogMode = 'meso', itemName: string = '') {
    this.isHidden = false;
    this.maxAmount = maxAmount;
    this.onConfirm = onConfirm;
    this.mode = mode;
    this.itemName = itemName;
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

    // Draw top piece
    canvas.drawImage({ img: this.noticeTopNode.nGetImage(), dx: x, dy: y });
    y += NOTICE_TOP_H;

    // Draw repeated center strips
    for (let i = 0; i < CENTER_REPEATS; i++) {
      canvas.drawImage({ img: this.noticeCenterNode.nGetImage(), dx: x, dy: y });
      y += NOTICE_CENTER_H;
    }

    // Draw bottom piece
    canvas.drawImage({ img: this.noticeBottomNode.nGetImage(), dx: x, dy: y });

    // Draw dialog text centered in the top + center area
    const textX = x + Math.floor(NOTICE_WIDTH / 2);
    const textAreaTop = this.y + NOTICE_TOP_H + 2;

    if (this.mode === 'meso') {
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
        text: `like to drop?`,
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
        text: 'drop this item?',
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
