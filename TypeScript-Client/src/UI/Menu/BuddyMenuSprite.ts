import WZManager from '../../wz-utils/WZManager';
import DragableMenu from './DragableMenu';
import ClickManager from '../ClickManager';
import GameCanvas from '../../GameCanvas';
import MapleInput from '../MapleInput';
import config from '../../Config';
import { CameraInterface } from '../../Camera';
import BuddyManager, { BuddyEntry } from '../../Buddy/BuddyManager';
import { getJobNameById } from '../../Constants/Jobs';

/**
 * Buddy list — the BUDDY tab of v83's UIWindow.img/UserList window (R key).
 * A sibling of PartyMenuSprite: both draw the same 312x389 frame with their
 * own tab lit; clicking the other tab here hands over to the party window.
 *
 * Art, all from UserList/Friend and measured off the sprites:
 *   backgrnd2      the frame variant with the grey toolbar (y 51-77), the
 *                  list groove (y 101-110) and the three-cell footer (y 306+)
 *   friend0/friend4  ONLINE / OFFLINE section headers (281x27)
 *   friend1        SAME CH. | OTHER CH. column header (281x19)
 *   friend2        two-column online row (281x18, divider at x=140)
 *   friend3        section bottom cap (281x6)
 *   friend5        full-width offline row (281x18)
 *   icon0 / icon1  online / offline mushroom glyphs
 *   Popup/AddFriend  the "Enter the Character Name..." dialog (266x141) with
 *                  its entry box baked in at (24..242, 71..85)
 *
 * Rows hold the name, and online rows the level; MAP (BtWhere) answers with
 * the buddy's map and channel in the chat log, WHISPER pre-fills "/w Name ".
 * Groups (ADD GROUP / EDIT), chat rooms (TALK), notes and blocking exist as
 * disabled buttons only — v83 had them, this client does not.
 */

const W = 312;
const H = 389;

const TAB_BASE_Y = 44; // tabs hang from the red underline
const TAB_X = 10;
const TAB_GAP = 6;

const TOOLBAR_Y = 55;
const LIST_X = 15; // 281-wide pieces centred in the 312 frame
const LIST_TOP = 112;
const HEADER_H = 27;
const COLS_H = 19;
const CAP_H = 6;
const ROW_H = 18;
const COL_W = 140;
const TOTAL_ROWS = 6; // 194px of list minus the 79px of headers

const FOOTER_ROW1_Y = 314;
const FOOTER_ROW2_Y = 350;

const ADD_POPUP_W = 266;
const ADD_POPUP_H = 141;
const ADD_INPUT_X = 24;
const ADD_INPUT_Y = 71;
const ADD_INPUT_W = 218;
const ADD_INPUT_H = 14;
const ADD_BTN_Y = 107;

interface BtnSprites {
  normal: HTMLImageElement | null;
  mouseOver: HTMLImageElement | null;
  disabled: HTMLImageElement | null;
  pressed: HTMLImageElement | null;
}

interface BtnPlace {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
}

interface RowHit {
  buddy: BuddyEntry;
  x: number;
  y: number;
  w: number;
}

class BuddyMenuSprite extends DragableMenu {
  opts: any;
  GameCanvas: GameCanvas | null = null;

  private bg: HTMLImageElement | null = null;
  private tabImgs: { enabled: (HTMLImageElement | null)[]; disabled: (HTMLImageElement | null)[] } =
    { enabled: [], disabled: [] };
  private pieces: Record<string, HTMLImageElement | null> = {};
  private buttons: Record<string, BtnSprites> = {};
  private btClose: HTMLImageElement | null = null;
  private addPopupBg: HTMLImageElement | null = null;
  private btOk2: BtnSprites | null = null;
  private btCancel2: BtnSprites | null = null;
  private yesNoBg: HTMLImageElement | null = null;
  private btYes: BtnSprites | null = null;
  private btNo: BtnSprites | null = null;

  selectedId: number | null = null;
  showOnlineOnly = false;
  private onlineScroll = 0;
  private offlineScroll = 0;

  private addOpen = false;
  private addInput: MapleInput | null = null;

  static async fromOpts(opts: any) {
    const obj = new BuddyMenuSprite(opts);
    await obj.load();
    return obj;
  }

  constructor(opts: any) {
    super(opts);
    this.opts = opts;
  }

  private btnOf(node: any): BtnSprites {
    return {
      normal: node?.normal?.['0']?.nGetImage?.() ?? null,
      mouseOver: node?.mouseOver?.['0']?.nGetImage?.() ?? null,
      disabled: node?.disabled?.['0']?.nGetImage?.() ?? null,
      pressed: node?.pressed?.['0']?.nGetImage?.() ?? null,
    };
  }

  async load() {
    this.x = this.opts.x;
    this.y = this.opts.y;
    this.isHidden = this.opts.isHidden ?? true;
    this.GameCanvas = this.opts.canvas ?? null;

    try {
      const uiw: any = await WZManager.get('UI.wz/UIWindow.img');
      const ul = uiw?.UserList;
      this.bg = ul?.backgrnd2?.nGetImage?.() ?? ul?.backgrnd?.nGetImage?.() ?? null;
      for (let i = 0; i < 5; i++) {
        this.tabImgs.enabled.push(ul?.Tab?.enabled?.[String(i)]?.nGetImage?.() ?? null);
        this.tabImgs.disabled.push(ul?.Tab?.disabled?.[String(i)]?.nGetImage?.() ?? null);
      }
      const fr = ul?.Friend;
      for (const n of ['friend0', 'friend1', 'friend2', 'friend3', 'friend4', 'friend5', 'icon0', 'icon1']) {
        this.pieces[n] = fr?.[n]?.nGetImage?.() ?? null;
      }
      for (const n of [
        'BtAddFriend', 'BtAddGroup', 'BtShowAll', 'BtShowOnline', 'BtMod',
        'BtWhisper', 'BtWhere', 'BtParty', 'BtDelete', 'BtChat', 'BtMessage', 'BtBlock',
      ]) {
        this.buttons[n] = this.btnOf(fr?.[n]);
      }
      this.addPopupBg = fr?.Popup?.AddFriend?.nGetImage?.() ?? null;

      const basic: any = await WZManager.get('UI.wz/Basic.img');
      this.btClose =
        uiw?.BtUIClose?.normal?.['0']?.nGetImage?.() ??
        basic?.BtClose?.normal?.['0']?.nGetImage?.() ?? null;
      this.btOk2 = this.btnOf(basic?.BtOK2);
      this.btCancel2 = this.btnOf(basic?.BtCancel2);
      this.yesNoBg = basic?.YesNo?.backgrnd?.nGetImage?.() ?? null;
      this.btYes = this.btnOf(basic?.BtYes);
      this.btNo = this.btnOf(basic?.BtNo);
    } catch (e) {
      console.error('[BuddyMenu] Failed to load UserList assets:', e);
    }

    BuddyManager.sync();
    ClickManager.addDragableMenu(this);
  }

  // ---- geometry --------------------------------------------------------------

  getRect(_camera: CameraInterface) {
    // A request popup owns its screen area even while the window is closed
    if (this.isHidden) {
      return BuddyManager.pendingRequest
        ? this.requestRect()
        : { x: this.x, y: this.y, width: W, height: H };
    }
    if (this.addOpen) {
      // Window plus the centred add dialog, so a click on the dialog that
      // lands outside the frame still belongs to us
      const r = this.addRect();
      const x0 = Math.min(this.x, r.x);
      const y0 = Math.min(this.y, r.y);
      const x1 = Math.max(this.x + W, r.x + r.width);
      const y1 = Math.max(this.y + H, r.y + r.height);
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
    return { x: this.x, y: this.y, width: W, height: H };
  }

  private requestRect() {
    const w = this.yesNoBg?.width || 264;
    const h = this.yesNoBg?.height || 132;
    return {
      x: Math.floor((config.width - w) / 2),
      y: Math.floor((config.height - h) / 2) - 40,
      width: w,
      height: h,
    };
  }

  private addRect() {
    return {
      x: Math.floor((config.width - ADD_POPUP_W) / 2),
      y: Math.floor((config.height - ADD_POPUP_H) / 2) - 40,
      width: ADD_POPUP_W,
      height: ADD_POPUP_H,
    };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
    if (isHidden) this.closeAddPopup();
  }

  private onlineRowCount(online: number): number {
    if (this.showOnlineOnly) return TOTAL_ROWS;
    return Math.max(1, Math.min(3, Math.ceil(online / 2)));
  }

  /** Y offsets of the list bands for the current row split */
  private bands(onlineRows: number) {
    const headerY = LIST_TOP;
    const colsY = headerY + HEADER_H;
    const onlineY = colsY + COLS_H;
    const capY = onlineY + onlineRows * ROW_H;
    const offlineHeaderY = capY + CAP_H;
    const offlineY = offlineHeaderY + HEADER_H;
    return { headerY, colsY, onlineY, capY, offlineHeaderY, offlineY };
  }

  /** Where every visible buddy row is drawn — shared by draw and click */
  private visibleRows(): RowHit[] {
    const online = BuddyManager.onlineBuddies();
    const offline = BuddyManager.offlineBuddies();
    const onlineRows = this.onlineRowCount(online.length);
    const offlineRows = this.showOnlineOnly ? 0 : TOTAL_ROWS - onlineRows;
    const b = this.bands(onlineRows);

    const maxOnlineScroll = Math.max(0, Math.ceil(online.length / 2) - onlineRows);
    this.onlineScroll = Math.max(0, Math.min(maxOnlineScroll, this.onlineScroll));
    const maxOfflineScroll = Math.max(0, offline.length - offlineRows);
    this.offlineScroll = Math.max(0, Math.min(maxOfflineScroll, this.offlineScroll));

    const rows: RowHit[] = [];
    const firstOnline = this.onlineScroll * 2;
    for (let i = 0; i < onlineRows * 2; i++) {
      const buddy = online[firstOnline + i];
      if (!buddy) break;
      rows.push({
        buddy,
        x: this.x + LIST_X + (i % 2) * COL_W,
        y: this.y + b.onlineY + Math.floor(i / 2) * ROW_H,
        w: COL_W - 1,
      });
    }
    for (let i = 0; i < offlineRows; i++) {
      const buddy = offline[this.offlineScroll + i];
      if (!buddy) break;
      rows.push({ buddy, x: this.x + LIST_X, y: this.y + b.offlineY + i * ROW_H, w: 281 });
    }
    return rows;
  }

  private selected(): BuddyEntry | null {
    return this.selectedId == null ? null : BuddyManager.getBuddy(this.selectedId);
  }

  private buttonPlaces(): BtnPlace[] {
    const sel = this.selected();
    const hasSel = !!sel;
    const selOnline = !!sel?.online;
    return [
      { key: 'BtAddFriend', x: 8, y: TOOLBAR_Y, w: 65, h: 18, enabled: true },
      { key: this.showOnlineOnly ? 'BtShowAll' : 'BtShowOnline', x: 77, y: TOOLBAR_Y, w: 74, h: 18, enabled: true },
      { key: 'BtAddGroup', x: 155, y: TOOLBAR_Y, w: 65, h: 18, enabled: false },
      { key: 'BtMod', x: 224, y: TOOLBAR_Y, w: 38, h: 18, enabled: false },
      { key: 'BtWhisper', x: 10, y: FOOTER_ROW1_Y, w: 48, h: 18, enabled: selOnline },
      { key: 'BtWhere', x: 64, y: FOOTER_ROW1_Y, w: 53, h: 18, enabled: selOnline },
      { key: 'BtParty', x: 156, y: FOOTER_ROW1_Y, w: 71, h: 18, enabled: selOnline },
      { key: 'BtDelete', x: 247, y: FOOTER_ROW1_Y, w: 47, h: 18, enabled: hasSel },
      { key: 'BtChat', x: 10, y: FOOTER_ROW2_Y, w: 46, h: 17, enabled: false },
      { key: 'BtMessage', x: 64, y: FOOTER_ROW2_Y, w: 48, h: 18, enabled: false },
      { key: 'BtBlock', x: 156, y: FOOTER_ROW2_Y, w: 60, h: 18, enabled: false },
    ];
  }

  // ---- input -----------------------------------------------------------------

  update(_msPerTick: number, _camera?: any, canvas?: GameCanvas) {
    const c = canvas ?? this.GameCanvas;
    if (!c || this.isHidden) return;

    // Mouse wheel scrolls whichever section the pointer is over
    const up = (c as any).scrolledUp;
    const down = (c as any).scrolledDown;
    if (up || down) {
      const mx = c.mouseX;
      const my = c.mouseY;
      if (mx >= this.x + LIST_X && mx <= this.x + LIST_X + 281) {
        const onlineRows = this.onlineRowCount(BuddyManager.onlineBuddies().length);
        const b = this.bands(onlineRows);
        const step = up ? -1 : 1;
        if (my >= this.y + b.headerY && my < this.y + b.capY + CAP_H) {
          this.onlineScroll += step;
        } else if (!this.showOnlineOnly && my >= this.y + b.offlineHeaderY && my < this.y + LIST_TOP + 194) {
          this.offlineScroll += step;
        }
      }
    }

    if (this.addInput) this.syncAddInput();
  }

  onMouseDown(mouseX: number, mouseY: number): boolean {
    // Incoming request popup first — it works even while the window is closed
    if (BuddyManager.pendingRequest) {
      const r = this.requestRect();
      const btnY = r.y + r.height - 34;
      const yesX = r.x + Math.floor(r.width / 2) - 70;
      const noX = r.x + Math.floor(r.width / 2) + 5;
      if (mouseY >= btnY && mouseY <= btnY + 24) {
        if (mouseX >= yesX && mouseX <= yesX + 65) {
          BuddyManager.respondRequest(true);
          return true;
        }
        if (mouseX >= noX && mouseX <= noX + 65) {
          BuddyManager.respondRequest(false);
          return true;
        }
      }
      if (mouseX >= r.x && mouseX <= r.x + r.width && mouseY >= r.y && mouseY <= r.y + r.height) {
        return true;
      }
    }

    if (this.isHidden || !this.ownsPoint(mouseX, mouseY)) return false;

    // Add-buddy dialog is modal over the window
    if (this.addOpen) {
      const r = this.addRect();
      const okX = r.x + 83;
      const cancelX = r.x + 136;
      const by = r.y + ADD_BTN_Y;
      if (mouseY >= by && mouseY < by + 18) {
        if (mouseX >= okX && mouseX < okX + 47) {
          this.submitAdd();
          return true;
        }
        if (mouseX >= cancelX && mouseX < cancelX + 47) {
          this.closeAddPopup();
          return true;
        }
      }
      return true; // swallow everything else while it is up
    }

    // Close button
    if (
      mouseX >= this.x + W - 21 && mouseX <= this.x + W - 5 &&
      mouseY >= this.y + 5 && mouseY <= this.y + 20
    ) {
      this.setIsHidden(true);
      return true;
    }

    // Tab strip — the PARTY tab opens the party window in our place
    let tx = this.x + TAB_X;
    for (let i = 0; i < 5; i++) {
      const img = this.tabImgs.enabled[i] ?? this.tabImgs.disabled[i];
      const tw = img?.width || 40;
      const th = img?.height || 12;
      if (
        mouseX >= tx && mouseX < tx + tw &&
        mouseY >= this.y + TAB_BASE_Y - th && mouseY < this.y + TAB_BASE_Y
      ) {
        if (i === 1) {
          const party = (window as any).MapStateInstance?.partyMenu;
          if (party) {
            party.moveTo({ x: this.x, y: this.y });
            party.setIsHidden(false);
            this.setIsHidden(true);
          }
        }
        return true;
      }
      tx += tw + TAB_GAP;
    }

    // Buddy rows
    for (const row of this.visibleRows()) {
      if (mouseX >= row.x && mouseX < row.x + row.w && mouseY >= row.y && mouseY < row.y + ROW_H) {
        this.selectedId = row.buddy.characterId;
        return true;
      }
    }

    // Buttons
    for (const def of this.buttonPlaces()) {
      const bx = this.x + def.x;
      const by = this.y + def.y;
      if (mouseX >= bx && mouseX < bx + def.w && mouseY >= by && mouseY < by + def.h) {
        if (def.enabled) this.onButton(def.key);
        return true;
      }
    }

    return false; // drag the window
  }

  private onButton(key: string) {
    const sel = this.selected();
    switch (key) {
      case 'BtAddFriend':
        this.openAddPopup();
        break;
      case 'BtShowAll':
      case 'BtShowOnline':
        this.showOnlineOnly = !this.showOnlineOnly;
        this.onlineScroll = 0;
        this.offlineScroll = 0;
        break;
      case 'BtWhisper':
        if (sel) BuddyManager.startWhisper(sel.name);
        break;
      case 'BtWhere':
        if (sel) BuddyManager.where(sel.characterId);
        break;
      case 'BtParty':
        // The party server accepts a name, so no socket id is needed here
        if (sel) (window as any).__mySocket?.sendMessage?.({ type: 'party_invite', data: { targetName: sel.name } });
        break;
      case 'BtDelete':
        if (sel) BuddyManager.remove(sel.characterId);
        this.selectedId = null;
        break;
    }
  }

  // ---- add-buddy popup ---------------------------------------------------------

  private openAddPopup() {
    if (this.addOpen) return;
    this.addOpen = true;
    this.syncAddInput();
    this.addInput?.input?.focus?.();
  }

  private closeAddPopup() {
    this.addOpen = false;
    if (!this.addInput) return;
    if (this.GameCanvas) this.GameCanvas.focusInput = false;
    this.addInput.remove();
    this.addInput = null;
    this.GameCanvas?.releaseFocusInput?.();
  }

  private submitAdd() {
    const name = this.addInput?.input?.value ?? '';
    this.closeAddPopup();
    if (name.trim()) BuddyManager.add(name);
  }

  /**
   * The entry box is a DOM input the way every other text entry in this
   * client is (login, Monster Book search): MapleInput maps canvas
   * coordinates through the CSS scale. Created with the popup and removed
   * with it so it can never float over the game.
   */
  private syncAddInput() {
    if (!this.addOpen || this.isHidden || !this.GameCanvas) {
      if (this.addInput) this.closeAddPopup();
      return;
    }
    const r = this.addRect();
    if (!this.addInput) {
      this.addInput = new MapleInput(this.GameCanvas, {
        x: r.x + ADD_INPUT_X,
        y: r.y + ADD_INPUT_Y,
        width: ADD_INPUT_W,
        height: ADD_INPUT_H,
        fontSize: 12,
        color: '#000000',
        cursor: 'text',
        submitListeners: [() => this.submitAdd()],
      });
      this.addInput.input.maxLength = 12;
    }
    this.addInput.setCanvasPos(r.x + ADD_INPUT_X, r.y + ADD_INPUT_Y);
  }

  // ---- drawing ---------------------------------------------------------------

  draw(canvas: GameCanvas, _camera: CameraInterface, _lag: number, _ms: number, _t: number) {
    if (!this.isHidden) {
      this.drawWindow(canvas);
      if (this.addOpen) this.drawAddPopup(canvas);
    }
    this.drawRequestPopup(canvas);
  }

  private drawWindow(canvas: GameCanvas) {
    if (!this.bg?.width) return;
    canvas.drawImage({ img: this.bg, dx: this.x, dy: this.y });

    if (this.btClose?.width) {
      canvas.drawImage({ img: this.btClose, dx: this.x + W - 21, dy: this.y + 6 });
    }

    // Tabs in the blue band, hung from the red underline; only BUDDY is live
    let tx = this.x + TAB_X;
    for (let i = 0; i < 5; i++) {
      const img = i === 0 ? this.tabImgs.enabled[i] : this.tabImgs.disabled[i];
      if (img?.width) {
        canvas.drawImage({ img, dx: tx, dy: this.y + TAB_BASE_Y - img.height });
        tx += img.width + TAB_GAP;
      } else {
        tx += 40 + TAB_GAP;
      }
    }

    const online = BuddyManager.onlineBuddies();
    const offline = BuddyManager.offlineBuddies();
    const onlineRows = this.onlineRowCount(online.length);
    const offlineRows = this.showOnlineOnly ? 0 : TOTAL_ROWS - onlineRows;
    const b = this.bands(onlineRows);
    const lx = this.x + LIST_X;

    const put = (name: string, dy: number) => {
      const img = this.pieces[name];
      if (img?.width) canvas.drawImage({ img, dx: lx, dy: this.y + dy });
    };
    put('friend0', b.headerY);
    put('friend1', b.colsY);
    for (let i = 0; i < onlineRows; i++) put('friend2', b.onlineY + i * ROW_H);
    put('friend3', b.capY);
    if (!this.showOnlineOnly) {
      put('friend4', b.offlineHeaderY);
      for (let i = 0; i < offlineRows; i++) put('friend5', b.offlineY + i * ROW_H);
    }

    // Rows
    const myCh = BuddyManager.myChannel();
    const onIcon = this.pieces['icon0'];
    const offIcon = this.pieces['icon1'];
    for (const row of this.visibleRows()) {
      const bd = row.buddy;
      if (bd.characterId === this.selectedId) {
        const ctx = canvas.context;
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#3366cc';
        ctx.fillRect(row.x + 1, row.y + 1, row.w - 2, ROW_H - 2);
        ctx.restore();
      }
      const icon = bd.online ? onIcon : offIcon;
      if (icon?.width) canvas.drawImage({ img: icon, dx: row.x + 4, dy: row.y + 4 });
      canvas.drawText({
        text: bd.name, x: row.x + 17, y: row.y + 3,
        color: bd.online ? '#000000' : '#808080', fontSize: 11,
      });
      if (bd.online) {
        canvas.drawText({
          text: `Lv.${bd.level}`, x: row.x + row.w - 4, y: row.y + 4,
          color: bd.channel === myCh ? '#cc3300' : '#336699', fontSize: 10, align: 'right',
        });
      }
    }
    // Online buddies sort into SAME CH. / OTHER CH. by colour rather than by
    // column (the art gives two columns, the list fills them in order)

    // Capacity, in the spare footer cell
    canvas.drawText({
      text: `${BuddyManager.buddies.length} / ${BuddyManager.capacity}`,
      x: this.x + 271, y: this.y + FOOTER_ROW2_Y + 4, color: '#000000', fontSize: 11, align: 'center',
    });

    // Buttons
    const mx = this.GameCanvas?.mouseX ?? -1;
    const my = this.GameCanvas?.mouseY ?? -1;
    for (const def of this.buttonPlaces()) {
      const sprites = this.buttons[def.key];
      if (!sprites) continue;
      const bx = this.x + def.x;
      const by = this.y + def.y;
      const hover = !this.addOpen && mx >= bx && mx < bx + def.w && my >= by && my < by + def.h;
      const img = !def.enabled
        ? sprites.disabled ?? sprites.normal
        : hover
          ? sprites.mouseOver ?? sprites.normal
          : sprites.normal;
      if (img?.width) canvas.drawImage({ img, dx: bx, dy: by });
    }
  }

  private drawAddPopup(canvas: GameCanvas) {
    const r = this.addRect();
    if (this.addPopupBg?.width) {
      canvas.drawImage({ img: this.addPopupBg, dx: r.x, dy: r.y });
    }
    // Only one group exists — name it next to the baked SELECT GROUP: label
    canvas.drawText({ text: 'Default Group', x: r.x + 106, y: r.y + 44, color: '#000000', fontSize: 11 });

    const mx = this.GameCanvas?.mouseX ?? -1;
    const my = this.GameCanvas?.mouseY ?? -1;
    const by = r.y + ADD_BTN_Y;
    const okX = r.x + 83;
    const cancelX = r.x + 136;
    const hovOk = mx >= okX && mx < okX + 47 && my >= by && my < by + 18;
    const hovCancel = mx >= cancelX && mx < cancelX + 47 && my >= by && my < by + 18;
    const ok = hovOk ? this.btOk2?.mouseOver ?? this.btOk2?.normal : this.btOk2?.normal;
    const cancel = hovCancel ? this.btCancel2?.mouseOver ?? this.btCancel2?.normal : this.btCancel2?.normal;
    if (ok?.width) canvas.drawImage({ img: ok, dx: okX, dy: by });
    if (cancel?.width) canvas.drawImage({ img: cancel, dx: cancelX, dy: by });
  }

  private drawRequestPopup(canvas: GameCanvas) {
    const req = BuddyManager.pendingRequest;
    if (!req) return;
    const r = this.requestRect();
    if (this.yesNoBg?.width) {
      canvas.drawImage({ img: this.yesNoBg, dx: r.x, dy: r.y });
    }
    const job = getJobNameById(req.job) || 'Beginner';
    canvas.drawText({
      text: `'${req.name}' (Lv. ${req.level} ${job})`,
      x: r.x + Math.floor(r.width / 2), y: r.y + 38,
      color: '#000000', fontSize: 12, align: 'center',
    });
    canvas.drawText({
      text: 'wants to add you as a buddy.',
      x: r.x + Math.floor(r.width / 2), y: r.y + 56,
      color: '#000000', fontSize: 12, align: 'center',
    });
    const btnY = r.y + r.height - 34;
    const yesX = r.x + Math.floor(r.width / 2) - 70;
    const noX = r.x + Math.floor(r.width / 2) + 5;
    const mx = this.GameCanvas?.mouseX ?? -1;
    const my = this.GameCanvas?.mouseY ?? -1;
    const hovYes = mx >= yesX && mx <= yesX + 65 && my >= btnY && my <= btnY + 24;
    const hovNo = mx >= noX && mx <= noX + 65 && my >= btnY && my <= btnY + 24;
    const yes = hovYes ? this.btYes?.mouseOver ?? this.btYes?.normal : this.btYes?.normal;
    const no = hovNo ? this.btNo?.mouseOver ?? this.btNo?.normal : this.btNo?.normal;
    if (yes?.width) canvas.drawImage({ img: yes, dx: yesX, dy: btnY });
    if (no?.width) canvas.drawImage({ img: no, dx: noX, dy: btnY });
  }
}

export default BuddyMenuSprite;
