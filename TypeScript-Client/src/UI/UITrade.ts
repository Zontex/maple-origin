import WZManager from '../wz-utils/WZManager';
import DragableMenu from './Menu/DragableMenu';
import ClickManager from './ClickManager';
import DragManager from './DragManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import config from '../Config';
import Item from '../Inventory/Item';
import MapleMap from '../MapleMap';
import CashShopUI from './CashShopUI';
import UIMesoDropDialog from './UIMesoDropDialog';
import UIChatLog from './UIChatLog';
import TradeManager, { TradeItem, tradeMesoFee } from '../Trade/TradeManager';

/**
 * Trade window — v83 UIWindow.img/TradingRoom.
 *
 * `backgrnd` is one 565x474 L-shaped composite: the trade area top-left
 * (both players standing on their shadows over dark/blue name plates, a 3x3
 * grid each — OURS on the left, the partner's in the middle — and under each
 * grid the coin row for the mesos entered plus the arrow row for what the
 * other side actually receives), the chat box with its input on the right,
 * and the meso trade-fee table bottom-left. The bottom-right of the art is
 * transparent. Every coordinate below was measured off that art:
 *   cells   36x35 at x = 6 + 38c (ours) / 169 + 38c (partner), y = 129 + 37r
 *   plates  ours 20..104 x 107..121 (dark)   partner 185..269 (blue)
 *   shadows feet at (62,101) and (224,101)
 *   fields  coin row y 244..257, arrow row y 259..272; x 24..117 / 187..280
 *   chat    log 294..535 x 24..228, input 296..487 x 245..259
 * TRADE / CANCEL TRADE sit on the chat panel's bottom band, under the input.
 *
 * Items arrive by dragging them out of the inventory window: the inventory
 * runs its own mouseup listener that ends a drag by offering to DROP the
 * item on the floor whenever it lands outside the inventory, so while this
 * window is open a capture-phase listener claims drops that land on it
 * first. Mesos are typed into the coin field after clicking BtCoin; the chat
 * field takes focus on click. Both are canvas-rendered (no DOM inputs).
 *
 * The window registers itself in the menu stack while open so clicks on it
 * do not fall through to NPCs, the ESC chain closes it (= cancel) like any
 * other window, and MapState draws it in stack order.
 */

const W = 565;
const H = 474;

const MY_FEET = { x: 62, y: 101 };
const PARTNER_FEET = { x: 224, y: 101 };
const MY_PLATE = { x: 20, y: 107, w: 85, h: 15 };
const PARTNER_PLATE = { x: 185, y: 107, w: 85, h: 13 };

const CELL_W = 36;
const CELL_H = 35;
const CELL_PITCH_X = 38;
const CELL_PITCH_Y = 37;
const GRID_Y = 129;
const MY_GRID_X = 6;
const PARTNER_GRID_X = 169;
const GRID_COLS = 3;
const GRID_ROWS = 3;

const MY_MESO = { x: 24, y: 244, w: 94, h: 14 };
const MY_NET = { x: 24, y: 259, w: 94, h: 14 };
const PARTNER_MESO = { x: 187, y: 244, w: 94, h: 14 };
const PARTNER_NET = { x: 187, y: 259, w: 94, h: 14 };
const BT_COIN = { x: 8, y: 244, w: 14, h: 14 };

const CHAT_LOG = { x: 297, y: 26, w: 238, h: 202 };
const CHAT_INPUT = { x: 298, y: 246, w: 188, h: 12 };
const CHAT_LINE_H = 13;
const CHAT_FONT = 11;

const BT_TRADE = { x: 296, y: 265, w: 60, h: 19 };
const BT_CANCEL = { x: 360, y: 265, w: 60, h: 18 };
const BT_CLOSE = { x: W - 32 - 3, y: 0, w: 32, h: 15 };

const MESO_CAP = 2147483647;
const CHAT_MAX = 70;

type Mode = 'none' | 'popup' | 'trade';
type Focus = 'none' | 'chat' | 'meso';

interface BtnSprites {
  normal: HTMLImageElement | null;
  mouseOver: HTMLImageElement | null;
  pressed: HTMLImageElement | null;
  disabled: HTMLImageElement | null;
}

function inRect(mx: number, my: number, x: number, y: number, w: number, h: number): boolean {
  return mx >= x && mx < x + w && my >= y && my < y + h;
}

class UITradeWindow extends DragableMenu {
  private canvas: GameCanvas | null = null;
  private mode: Mode = 'none';
  private focus: Focus = 'none';

  private bg: HTMLImageElement | null = null;
  private btTrade: BtnSprites | null = null;
  private btCancel: BtnSprites | null = null;
  private btCoin: BtnSprites | null = null;
  private btClose: BtnSprites | null = null;
  private yesNoBg: HTMLImageElement | null = null;
  private btYes: BtnSprites | null = null;
  private btNo: BtnSprites | null = null;
  private itemNoDigits: (HTMLImageElement | null)[] = [];

  private iconCache = new Map<number, HTMLImageElement | null>();
  private iconLoading = new Set<number>();

  private chatInput = '';
  private mesoInput = '';
  private caretTime = 0;
  private mapIdAtOpen = 0;

  private qtyDialog: UIMesoDropDialog | null = null;
  private pendingDrop: { tab: number; slot: number } | null = null;

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private mouseupHandler: ((e: MouseEvent) => void) | null = null;
  private loaded = false;

  constructor() {
    super({ x: 0, y: 0, isHidden: true });
    this.isHidden = true;
  }

  /** The trade window proper is on screen (not just a request popup) */
  get isVisible(): boolean {
    return this.mode === 'trade';
  }

  /** A "X has requested a trade" prompt is up */
  get isRequestPopupVisible(): boolean {
    return this.mode === 'popup';
  }

  private btnOf(node: any): BtnSprites {
    return {
      normal: node?.normal?.['0']?.nGetImage?.() ?? null,
      mouseOver: node?.mouseOver?.['0']?.nGetImage?.() ?? null,
      pressed: node?.pressed?.['0']?.nGetImage?.() ?? null,
      disabled: node?.disabled?.['0']?.nGetImage?.() ?? null,
    };
  }

  /**
   * Called from UIMap.initialize on every entry into the map state. Assets
   * load once; the ClickManager registration and the manager hooks are
   * re-applied each time because entering a state clears the former.
   */
  async initialize(canvas: GameCanvas) {
    this.canvas = canvas;
    this.x = Math.round((config.width - W) / 2);
    this.y = 40;

    if (!this.loaded) {
      this.loaded = true;
      try {
        const uiWindow: any = await WZManager.get('UI.wz/UIWindow.img');
        const tr = uiWindow.nGet('TradingRoom');
        this.bg = tr.nGet('backgrnd').nGetImage();
        this.btTrade = this.btnOf(tr.BtTrade);
        this.btCancel = this.btnOf(tr.BtCancel);
        this.btCoin = this.btnOf(tr.BtCoin);
        this.btClose = this.btnOf(uiWindow.BtUIClose);
        const basic: any = await WZManager.get('UI.wz/Basic.img');
        this.yesNoBg = basic?.YesNo?.backgrnd?.nGetImage?.() ?? null;
        this.btYes = this.btnOf(basic?.BtYes);
        this.btNo = this.btnOf(basic?.BtNo);
        for (let i = 0; i <= 9; i++) {
          this.itemNoDigits.push(basic?.ItemNo?.[String(i)]?.nGetImage?.() ?? null);
        }
      } catch (e) {
        console.error('[Trade] Failed to load TradingRoom assets:', e);
      }
      try {
        this.qtyDialog = await UIMesoDropDialog.fromOpts({ canvas });
      } catch (e) {
        console.error('[Trade] Failed to load quantity dialog:', e);
      }
    }

    if (!ClickManager.dragableMenus?.includes(this)) ClickManager.addDragableMenu(this);

    TradeManager.env = {
      cashShopOpen: () => !!CashShopUI.isVisible,
      mapId: () => Number(MapleMap.mapId ?? 0),
    };
    TradeManager.onRequest = () => this.showPopup();
    TradeManager.onOpen = () => this.showWindow();
    TradeManager.onClose = () => this.close();
    TradeManager.hookSocket();
  }

  // ---- open / close ------------------------------------------------------
  private enterStack() {
    this.isHidden = false;
    const stack = DragableMenu.stack;
    if (!stack.includes(this)) stack.push(this);
  }

  private leaveStack() {
    const stack = DragableMenu.stack;
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
  }

  private showPopup() {
    if (this.mode === 'trade') return;
    this.mode = 'popup';
    this.mapIdAtOpen = Number(MapleMap.mapId ?? 0);
    this.enterStack();
  }

  private showWindow() {
    this.mode = 'trade';
    this.chatInput = '';
    this.mesoInput = '';
    this.focus = 'none';
    this.mapIdAtOpen = Number(MapleMap.mapId ?? 0);
    this.x = Math.round((config.width - W) / 2);
    this.y = 40;
    this.enterStack();
    this.installListeners();
  }

  /** Tear the UI down (the manager has already ended the session) */
  close() {
    this.mode = 'none';
    this.blur();
    this.removeListeners();
    this.qtyDialog?.hide();
    this.pendingDrop = null;
    this.leaveStack();
    this.isHidden = true;
  }

  /**
   * The menu-stack contract: hiding the window is how ESC, closeAllMenus and
   * the close button all dismiss it — and dismissing a trade means
   * cancelling it (nothing has changed hands yet).
   */
  setIsHidden(isHidden: boolean) {
    if (!isHidden) {
      this.isHidden = false;
      return;
    }
    if (this.mode === 'popup') {
      TradeManager.respond(false);
      this.close();
    } else if (this.mode === 'trade') {
      TradeManager.cancel(); // onClose -> close(); a second close() is a no-op
      this.close();
    } else {
      this.isHidden = true;
    }
  }

  /** ESC from the map state's chain */
  escape() {
    if (this.focus !== 'none') {
      this.blur();
      return;
    }
    this.setIsHidden(true);
  }

  getRect(_camera: CameraInterface) {
    if (this.mode === 'popup') return this.popupRect();
    if (this.mode === 'trade') {
      // While the quantity prompt is up it owns the whole screen
      if (this.qtyDialog && !this.qtyDialog.isHidden) {
        return { x: 0, y: 0, width: config.width, height: config.height };
      }
      return { x: this.x, y: this.y, width: W, height: H };
    }
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  moveTo(position: { x: number; y: number }) {
    // The popup is centred and the quantity prompt is modal — neither drags
    if (this.mode !== 'trade') return;
    if (this.qtyDialog && !this.qtyDialog.isHidden) return;
    this.x = position.x;
    this.y = position.y;
  }

  private popupRect() {
    const w = this.yesNoBg?.width || 264;
    const h = this.yesNoBg?.height || 132;
    return {
      x: Math.floor((config.width - w) / 2),
      y: Math.floor((config.height - h) / 2) - 40,
      width: w,
      height: h,
    };
  }

  // ---- listeners ---------------------------------------------------------
  private installListeners() {
    if (!this.mouseupHandler) {
      this.mouseupHandler = () => this.onWindowMouseUp();
      window.addEventListener('mouseup', this.mouseupHandler, true);
    }
    if (!this.keydownHandler) {
      this.keydownHandler = (e: KeyboardEvent) => this.onKeyDown(e);
      window.addEventListener('keydown', this.keydownHandler, true);
    }
  }

  private removeListeners() {
    if (this.mouseupHandler) {
      window.removeEventListener('mouseup', this.mouseupHandler, true);
      this.mouseupHandler = null;
    }
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }

  /**
   * Claim inventory drags that end over this window before the inventory's
   * own mouseup handler turns them into a floor drop. The inventory keeps
   * its drag state on public fields (isDragging / draggingItem /
   * draggingSlotIndex / currentTab); clearing isDragging makes its handler
   * return early.
   */
  private onWindowMouseUp() {
    if (this.mode !== 'trade' || !this.canvas) return;
    const inv = (window as any).MapStateInstance?.inventoryMenu;
    if (!inv?.isDragging || !inv.draggingItem) return;
    const mx = this.canvas.mouseX;
    const my = this.canvas.mouseY;
    if (!inRect(mx, my, this.x, this.y, W, H)) return;
    // A press that never travelled is a click on the inventory, not a drop;
    // and a release over the inventory itself (stacked above us) is its own
    // slot-to-slot move
    const dist = Math.hypot(mx - Number(inv.dragStartX || 0), my - Number(inv.dragStartY || 0));
    if (dist < 4) return;
    if (inv.ownsPoint?.(mx, my)) return;

    const item = inv.draggingItem;
    const slot = Number(inv.draggingSlotIndex);
    const tab = Number(inv.currentTab);
    inv.isDragging = false;
    inv.draggingItem = null;
    inv.draggingIcon = null;
    inv.draggingSlotIndex = -1;
    ClickManager.isDraggingItem = false;
    DragManager.cancel();

    if (!item || slot < 0) return;
    const s = TradeManager.session;
    if (!s) return;
    if (s.myLocked) {
      UIChatLog.system('You cannot change your offer after confirming.');
      return;
    }
    const remaining = Math.max(0, Number(item.quantity || 1) - TradeManager.offeredFromSlot(tab, slot));
    if (remaining <= 0) {
      UIChatLog.system('That item is already in the trade window.');
      return;
    }
    if (remaining === 1 || (item.getSlotMax?.() ?? 100) <= 1) {
      void this.offer(tab, slot, 1);
      return;
    }
    // A stack: ask how many, the same prompt the inventory uses for drops
    this.blur();
    this.pendingDrop = { tab, slot };
    this.qtyDialog?.show(
      remaining,
      (amount: number) => {
        const drop = this.pendingDrop;
        this.pendingDrop = null;
        if (drop) void this.offer(drop.tab, drop.slot, amount);
      },
      'item',
      '',
      'trade',
    );
  }

  private async offer(tab: number, slot: number, qty: number) {
    const err = await TradeManager.offerItem(tab, slot, qty);
    if (err) UIChatLog.system(err);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (this.mode !== 'trade' || this.focus === 'none') return;
    // Modifier chords (alt+enter fullscreen etc.) are not ours
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === 'Escape') {
      this.blur();
    } else if (e.key === 'Enter') {
      if (this.focus === 'chat') {
        const text = this.chatInput.trim();
        this.chatInput = '';
        if (text) TradeManager.chat(text);
      } else {
        this.commitMesos();
      }
    } else if (e.key === 'Backspace') {
      if (this.focus === 'chat') this.chatInput = this.chatInput.slice(0, -1);
      else this.mesoInput = this.mesoInput.slice(0, -1);
    } else if (e.key.length === 1) {
      if (this.focus === 'chat') {
        if (this.chatInput.length < CHAT_MAX) this.chatInput += e.key;
      } else if (e.key >= '0' && e.key <= '9') {
        const next = (this.mesoInput + e.key).replace(/^0+(?=\d)/, '');
        if (next.length <= 10 && Number(next) <= MESO_CAP) this.mesoInput = next;
      }
    } else {
      return; // arrows, function keys: leave them alone
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  private setFocus(f: Focus) {
    if (this.focus === f) return;
    if (f === 'none') {
      this.blur();
      return;
    }
    this.focus = f;
    this.caretTime = 0;
    if (f === 'meso') this.mesoInput = TradeManager.session?.myMesos ? String(TradeManager.session.myMesos) : '';
    // Keep the game from reading the typed keys as movement
    if (this.canvas) this.canvas.focusInput = true;
  }

  private blur() {
    if (this.focus === 'meso') this.commitMesos();
    if (this.focus === 'none') return;
    this.focus = 'none';
    if (this.canvas) {
      this.canvas.focusInput = false;
      this.canvas.releaseFocusInput();
    }
  }

  private commitMesos() {
    const s = TradeManager.session;
    this.focus = 'none';
    if (this.canvas) {
      this.canvas.focusInput = false;
      this.canvas.releaseFocusInput();
    }
    if (!s) return;
    const amount = Number(this.mesoInput) || 0;
    if (amount === s.myMesos) return;
    const err = TradeManager.setMesos(amount);
    if (err) {
      UIChatLog.system(err);
      this.mesoInput = String(s.myMesos || '');
    }
  }

  // ---- input -------------------------------------------------------------
  onMouseDown(mouseX: number, mouseY: number): boolean {
    if (this.mode === 'popup') {
      const r = this.popupRect();
      const btnY = r.y + r.height - 34;
      const yesX = r.x + Math.floor(r.width / 2) - 70;
      const noX = r.x + Math.floor(r.width / 2) + 5;
      if (mouseY >= btnY && mouseY <= btnY + 24) {
        if (mouseX >= yesX && mouseX <= yesX + 65) {
          TradeManager.respond(true);
          // The window opens when the server answers with trade_open; until
          // then keep the popup's stack slot so nothing slips underneath
          this.mode = 'none';
          this.leaveStack();
          this.isHidden = true;
          return true;
        }
        if (mouseX >= noX && mouseX <= noX + 65) {
          TradeManager.respond(false);
          this.close();
          return true;
        }
      }
      return inRect(mouseX, mouseY, r.x, r.y, r.width, r.height);
    }

    if (this.mode !== 'trade') return false;

    if (this.qtyDialog && !this.qtyDialog.isHidden) {
      // Modal: its own buttons are ClickManager buttons; swallow the rest
      return true;
    }
    if (!this.ownsPoint(mouseX, mouseY)) {
      if (!inRect(mouseX, mouseY, this.x, this.y, W, H)) this.blur();
      return false;
    }

    const lx = mouseX - this.x;
    const ly = mouseY - this.y;
    const s = TradeManager.session;

    if (inRect(lx, ly, BT_CLOSE.x, BT_CLOSE.y, BT_CLOSE.w, BT_CLOSE.h)) {
      this.setIsHidden(true);
      return true;
    }
    if (inRect(lx, ly, BT_CANCEL.x, BT_CANCEL.y, BT_CANCEL.w, BT_CANCEL.h)) {
      this.setIsHidden(true);
      return true;
    }
    if (inRect(lx, ly, BT_TRADE.x, BT_TRADE.y, BT_TRADE.w, BT_TRADE.h)) {
      if (s && !s.myLocked) {
        this.blur();
        TradeManager.confirm();
      }
      return true;
    }
    if (inRect(lx, ly, BT_COIN.x, BT_COIN.y, BT_COIN.w, BT_COIN.h) ||
        inRect(lx, ly, MY_MESO.x, MY_MESO.y, MY_MESO.w, MY_MESO.h)) {
      if (s && !s.myLocked) {
        if (this.focus === 'chat') this.blur();
        this.setFocus('meso');
      } else if (s?.myLocked) {
        UIChatLog.system('You cannot change your offer after confirming.');
      }
      return true;
    }
    if (inRect(lx, ly, CHAT_INPUT.x - 2, CHAT_INPUT.y - 2, CHAT_INPUT.w + 4, CHAT_INPUT.h + 4)) {
      if (this.focus === 'meso') this.blur();
      this.setFocus('chat');
      return true;
    }

    // Anything else on the window: drop focus, let the frame drag
    this.blur();
    return false;
  }

  // ---- per frame -----------------------------------------------------------
  update(msPerTick: number, _camera?: any, _canvas?: GameCanvas) {
    if (this.mode === 'none') return;
    this.caretTime += msPerTick;
    this.qtyDialog?.update(msPerTick);

    // The request was withdrawn, expired or answered elsewhere
    if (this.mode === 'popup' && !TradeManager.pendingRequest) {
      this.close();
      return;
    }

    // Leaving the map ends the trade on the spot — the server's sweep would
    // catch it within seconds, but the window must not linger over a new map
    const mapId = Number(MapleMap.mapId ?? 0);
    if (mapId && this.mapIdAtOpen && mapId !== this.mapIdAtOpen) {
      this.setIsHidden(true);
      return;
    }
    // Death while trading cancels it (v83 closes the room)
    if (this.mode === 'trade' && (window as any).charecter?.isDead) {
      this.setIsHidden(true);
    }
  }

  // ---- icons ---------------------------------------------------------------
  private iconFor(itemId: number): HTMLImageElement | null {
    if (this.iconCache.has(itemId)) return this.iconCache.get(itemId) ?? null;
    if (!this.iconLoading.has(itemId)) {
      this.iconLoading.add(itemId);
      Item.fromOpts({ itemId, quantity: 1 })
        .then((item: any) => {
          const node =
            item.node?.info?.iconRaw ?? item.node?.info?.icon ??
            item.node?.iconRaw ?? item.node?.icon;
          this.iconCache.set(itemId, node?.nGetImage ? node.nGetImage() : null);
        })
        .catch(() => this.iconCache.set(itemId, null))
        .finally(() => this.iconLoading.delete(itemId));
    }
    return null;
  }

  // ---- drawing -------------------------------------------------------------
  draw(canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) {
    if (this.mode === 'popup') {
      this.drawPopup(canvas);
      return;
    }
    if (this.mode !== 'trade' || !this.bg?.width) return;
    const s = TradeManager.session;
    if (!s) return;

    canvas.drawImage({ img: this.bg, dx: this.x, dy: this.y });

    const mx = canvas.mouseX - this.x;
    const my = canvas.mouseY - this.y;

    this.drawCharacters(canvas, s);
    this.drawGrid(canvas, MY_GRID_X, s.myItems);
    this.drawGrid(canvas, PARTNER_GRID_X, s.partnerItems);
    this.drawMesoFields(canvas, s);
    this.drawChat(canvas, s);

    // Buttons
    this.drawButton(canvas, this.btCoin, BT_COIN, mx, my, s.myLocked, this.focus === 'meso');
    this.drawButton(canvas, this.btTrade, BT_TRADE, mx, my, s.myLocked, false);
    this.drawButton(canvas, this.btCancel, BT_CANCEL, mx, my, false, false);
    this.drawButton(canvas, this.btClose, BT_CLOSE, mx, my, false, false);

    // Quantity prompt over everything on the window
    this.qtyDialog?.draw(canvas, camera, lag, msPerTick, tdelta);
  }

  private drawButton(
    canvas: GameCanvas,
    sprites: BtnSprites | null,
    r: { x: number; y: number; w: number; h: number },
    mx: number,
    my: number,
    disabled: boolean,
    pressed: boolean,
  ) {
    if (!sprites) return;
    const hover = inRect(mx, my, r.x, r.y, r.w, r.h);
    const img = disabled
      ? sprites.disabled ?? sprites.normal
      : pressed
        ? sprites.pressed ?? sprites.normal
        : hover
          ? sprites.mouseOver ?? sprites.normal
          : sprites.normal;
    if (img?.width) canvas.drawImage({ img, dx: this.x + r.x, dy: this.y + r.y });
  }

  private drawCharacters(canvas: GameCanvas, s: NonNullable<typeof TradeManager.session>) {
    const me = (window as any).charecter;
    const partner = (window as any).__mySocket?.otherPlayers?.get?.(s.partnerId) ?? null;
    this.drawStanding(canvas, me, MY_FEET);
    this.drawStanding(canvas, partner, PARTNER_FEET);

    // Name plates; a side that has confirmed turns its name yellow
    canvas.drawText({
      text: TradeManager.myName(),
      x: this.x + MY_PLATE.x + Math.floor(MY_PLATE.w / 2),
      y: this.y + MY_PLATE.y + 2,
      color: s.myLocked ? '#FFFF66' : '#FFFFFF',
      fontSize: 11,
      align: 'center',
    });
    canvas.drawText({
      text: s.partnerName,
      x: this.x + PARTNER_PLATE.x + Math.floor(PARTNER_PLATE.w / 2),
      y: this.y + PARTNER_PLATE.y + 1,
      color: s.partnerLocked ? '#FFFF66' : '#FFFFFF',
      fontSize: 11,
      align: 'center',
    });
  }

  private drawStanding(canvas: GameCanvas, ch: any, feet: { x: number; y: number }) {
    if (!ch?.getDrawableFrames) return;
    const stance = ch.weaponStandType === 2 ? 'stand2' : 'stand1';
    let frames: any[] | null = null;
    try {
      frames = ch.getDrawableFrames(stance, 0, false);
    } catch {
      frames = null;
    }
    if (!frames) return;
    for (const frame of frames) {
      if (frame.img?.complete && frame.img.naturalWidth > 0) {
        canvas.drawImage({
          img: frame.img,
          dx: this.x + feet.x + (frame.x || 0),
          dy: this.y + feet.y + (frame.y || 0),
        });
      }
    }
  }

  private drawGrid(canvas: GameCanvas, gridX: number, items: TradeItem[]) {
    for (let i = 0; i < Math.min(items.length, GRID_COLS * GRID_ROWS); i++) {
      const it = items[i];
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const cx = this.x + gridX + col * CELL_PITCH_X;
      const cy = this.y + GRID_Y + row * CELL_PITCH_Y;
      const icon = this.iconFor(it.itemId);
      if (icon?.width) {
        canvas.drawImage({
          img: icon,
          dx: cx + Math.floor((CELL_W - icon.width) / 2),
          dy: cy + Math.floor((CELL_H - icon.height) / 2),
        });
      }
      if (it.qty > 1) this.drawQuantity(canvas, cx, cy, it.qty);
    }
  }

  /** Stack count, bottom-right of the cell, in Basic.img/ItemNo digits */
  private drawQuantity(canvas: GameCanvas, cx: number, cy: number, qty: number) {
    const digits = String(qty);
    let total = 0;
    for (const d of digits) total += this.itemNoDigits[Number(d)]?.width || 8;
    let dx = cx + CELL_W - total - 2;
    const dy = cy + CELL_H - (this.itemNoDigits[0]?.height || 11) - 2;
    for (const d of digits) {
      const img = this.itemNoDigits[Number(d)];
      if (img?.width) {
        canvas.drawImage({ img, dx, dy });
        dx += img.width;
      } else {
        canvas.drawText({ text: d, x: dx, y: dy, color: '#ffffff', fontSize: 10 });
        dx += 8;
      }
    }
  }

  private drawMesoFields(canvas: GameCanvas, s: NonNullable<typeof TradeManager.session>) {
    const field = (r: { x: number; y: number; w: number; h: number }, text: string, color = '#000000') => {
      if (!text) return;
      canvas.drawText({
        text,
        x: this.x + r.x + r.w - 3,
        y: this.y + r.y + 1,
        color,
        fontSize: 11,
        align: 'right',
      });
    };

    // Coin row: mesos put up by each side; ours shows the live entry while
    // the field has focus
    if (this.focus === 'meso') {
      const caret = Math.floor(this.caretTime / 500) % 2 === 0 ? '|' : ' ';
      field(MY_MESO, `${Number(this.mesoInput || 0).toLocaleString()}${caret}`);
    } else {
      field(MY_MESO, s.myMesos ? s.myMesos.toLocaleString() : '');
    }
    field(PARTNER_MESO, s.partnerMesos ? s.partnerMesos.toLocaleString() : '');

    // Arrow row: what the OTHER side receives after the v83 trade fee
    if (s.myMesos) field(MY_NET, (s.myMesos - tradeMesoFee(s.myMesos)).toLocaleString(), '#444444');
    if (s.partnerMesos) {
      field(PARTNER_NET, (s.partnerMesos - tradeMesoFee(s.partnerMesos)).toLocaleString(), '#444444');
    }
  }

  private drawChat(canvas: GameCanvas, s: NonNullable<typeof TradeManager.session>) {
    const ctx = canvas.context;
    const maxRows = Math.floor(CHAT_LOG.h / CHAT_LINE_H);

    // Wrap each line to the log width, newest at the bottom
    ctx.save();
    ctx.font = `${CHAT_FONT}px Arial`;
    const rows: { text: string; color: string }[] = [];
    for (const line of s.chat) {
      const color = line.from ? '#000000' : '#6A6A6A';
      const full = line.from ? `${line.from} : ${line.text}` : line.text;
      for (const piece of this.wrap(ctx, full, CHAT_LOG.w - 4)) rows.push({ text: piece, color });
    }
    ctx.restore();
    const visible = rows.slice(-maxRows);
    let y = this.y + CHAT_LOG.y + 2;
    for (const row of visible) {
      canvas.drawText({ text: row.text, x: this.x + CHAT_LOG.x + 2, y, color: row.color, fontSize: CHAT_FONT });
      y += CHAT_LINE_H;
    }

    // Input field — the baked white box; clip so long text stays inside
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + CHAT_INPUT.x, this.y + CHAT_INPUT.y - 1, CHAT_INPUT.w, CHAT_INPUT.h + 2);
    ctx.clip();
    ctx.font = `${CHAT_FONT}px Arial`;
    let text = this.chatInput;
    const caret = this.focus === 'chat' && Math.floor(this.caretTime / 500) % 2 === 0 ? '|' : '';
    text += caret;
    // Scroll the tail into view while typing past the box
    let width = ctx.measureText(text).width;
    let start = 0;
    while (width > CHAT_INPUT.w - 4 && start < text.length) {
      start++;
      width = ctx.measureText(text.slice(start)).width;
    }
    canvas.drawText({
      text: text.slice(start),
      x: this.x + CHAT_INPUT.x + 2,
      y: this.y + CHAT_INPUT.y,
      color: '#000000',
      fontSize: CHAT_FONT,
    });
    ctx.restore();
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const out: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // A single word wider than the box is broken by character
      let chunk = '';
      for (const ch of word) {
        if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
          out.push(chunk);
          chunk = '';
        }
        chunk += ch;
      }
      line = chunk;
    }
    if (line) out.push(line);
    return out;
  }

  private drawPopup(canvas: GameCanvas) {
    const req = TradeManager.pendingRequest;
    if (!req) return;
    const r = this.popupRect();
    if (this.yesNoBg?.width) canvas.drawImage({ img: this.yesNoBg, dx: r.x, dy: r.y });
    canvas.drawText({
      text: `'${req.fromName}' has requested`,
      x: r.x + Math.floor(r.width / 2), y: r.y + 38,
      color: '#000000', fontSize: 12, align: 'center',
    });
    canvas.drawText({
      text: 'a trade with you.',
      x: r.x + Math.floor(r.width / 2), y: r.y + 56,
      color: '#000000', fontSize: 12, align: 'center',
    });
    const btnY = r.y + r.height - 34;
    const yesX = r.x + Math.floor(r.width / 2) - 70;
    const noX = r.x + Math.floor(r.width / 2) + 5;
    const mx = canvas.mouseX;
    const my = canvas.mouseY;
    const hovYes = mx >= yesX && mx <= yesX + 65 && my >= btnY && my <= btnY + 24;
    const hovNo = mx >= noX && mx <= noX + 65 && my >= btnY && my <= btnY + 24;
    const yes = hovYes ? this.btYes?.mouseOver ?? this.btYes?.normal : this.btYes?.normal;
    const no = hovNo ? this.btNo?.mouseOver ?? this.btNo?.normal : this.btNo?.normal;
    if (yes?.width) canvas.drawImage({ img: yes, dx: yesX, dy: btnY });
    if (no?.width) canvas.drawImage({ img: no, dx: noX, dy: btnY });
  }
}

const UITrade = new UITradeWindow();
export default UITrade;
