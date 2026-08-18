import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import ClickManager from './ClickManager';
import { MapleStanceButton } from './MapleStanceButton';
import Config from '../Config';
import AudioManager from '../Audio/AudioManager';
import PLAY_AUDIO from '../Audio/PlayAudio';
import MapleStandingCharacter from '../MapleStandingCharacter';
import { ensureItemNames, getItemNameSync, getItemDescSync } from '../Quest/QuestData';
import {
  loadCommodities, getCategoryItems, computeExpireAt, makeNewPetBlob,
  CashCommodity, CASH_TAB_COUNT,
} from '../Shop/CashShopData';
import { getEquipWzPath } from '../Inventory/Item';
import MapleInventory, { isPetItemId } from '../Constants/Inventory/MapleInventory';
import UIChatLog from './UIChatLog';
import DirectionScene from '../Effects/DirectionScene';

/**
 * v83 Cash Shop — a full-screen overlay inside MapState (never a
 * StateManager state: the world must keep ticking so a mob-host player in
 * the shop doesn't freeze mobs for everyone on the map). All art from
 * UI.wz/CashShop.img; catalog from Etc.wz/Commodity.img via CashShopData.
 *
 * The 800x600 composition is centered on the canvas with a black matte —
 * the same "centered island" treatment as the status bar.
 */

// Layout, measured off the decoded Base/backgrnd (tuned in-game with F9)
const CS_W = 800;
const CS_H = 600;
// CSTab strip (508 wide, 9 bands) — its light-blue base bar starts at strip
// y=53 and the backdrop's matching bar at y=73, x=275: strip goes at (274,20)
const TAB_X = 274;
const TAB_Y = 20;
const TAB_BAND_W = 508 / 9;
const PREVIEW_X = 24;       // Base/Preview stage — the backdrop's black hole
const PREVIEW_Y = 40;       // measured at exactly (24,40)-(235,204), 212x165
// Preview mini-stage physics (the stage art bakes a floor and a ladder)
const STAGE_FLOOR_Y = 133;   // ledge top edge, measured off Preview/0
const STAGE_MIN_X = 14;
const STAGE_MAX_X = 198;
const LADDER_X0 = 126;       // ladder rails measured at x=128-133 / 167-172
const LADDER_X1 = 174;       // (grab band spans both rails; centre = 150)
const LADDER_TOP = 38;       // highest feet position while climbing
// Left-column inventories, measured off the backdrop pixels
const CASHINV_X = 21;        // 6 cols, stride 35
const CASHINV_Y = 349;       // 2 rows, stride 35
const ITEMINV_X = 23;        // 4 cols, stride 35
const ITEMINV_Y = 481;       // 3 rows, stride 35
const INV_CELL = 31;
const INV_STRIDE = 35;
const ITAB_Y = 461;          // tabs sit flush on the red line at y=473
// Best Item rail (right edge): five entries under the baked rank numbers
const BEST_X = 692;
const BEST_Y0 = 152;
const BEST_STRIDE = 70;
// CSInventory "+ ... Slot" buttons: 64x22 sprites on the baked seat column
const SLOTBTN_X = 177;
const SLOTBTN_Y0 = 455;
const SLOTBTN_STRIDE = 28;

/** Equip slot by item prefix — local copy to avoid an import cycle through
 *  EquipMenuSprite → mysocket → MapleMap → UIMap → CashShopUI */
function slotForEquip(itemId: number): number {
  const prefix = Math.floor(itemId / 10000);
  if (prefix >= 130 && prefix <= 170) return 10;
  const table: Record<number, number> = {
    100: 0, 101: 1, 102: 2, 103: 3, 104: 4, 105: 4, 106: 5, 107: 6,
    108: 7, 109: 9, 110: 8, 111: 11, 112: 16, 113: 18, 114: 15,
    180: 21, 181: 22, 182: 21, 183: 21, 190: 19, 191: 20,
  };
  return table[prefix] ?? -1;
}
const GRID_COL_X = [280, 484]; // CSList/Base cells, 200x80
const GRID_ROW_Y = 97;
const GRID_ROW_H = 80;
const GRID_ROWS = 5;
const GRID_COLS = 2;
const PAGE_SIZE = 10;       // GMS pages the catalog ("1 | 2 | 3") — no scrollbar
const NX_TEXT_X = 482;      // right-aligned on the "NX Credit" row itself
const NX_TEXT_Y = 545;      // label rows measured at y=546/560/574
const EXIT_X = 632;         // CSStatus/BtExit (168x49) pixel-matched to the baked EXIT art
const EXIT_Y = 545;
// CHARGE/CHECK CASH/CODE cluster: centered between the NX plate (ends 493)
// and the EXIT block (starts 632), sharing the EXIT art's vertical center
const CHARGE_X = 498;
const CHARGE_Y = 548;
const CHARGE_PITCH = 46;
const ICON_SIZE = 64;       // catalog icons pixel-doubled like GMS (32px art → 64px)

const CashShopUI: any = {
  isVisible: false,
  loaded: false,
  canvas: null as GameCanvas | null,

  // Composition origin (recomputed on show — resolution can change)
  ox: 0,
  oy: 0,

  // Catalog state
  activeTab: 1,
  items: [] as CashCommodity[],
  scrollOffset: 0, // in rows

  // WZ assets
  backgrnd: null as HTMLImageElement | null,
  tabStrips: [] as (HTMLImageElement | null)[], // index 1..9
  previewBgs: [] as (HTMLImageElement | null)[],
  cellImg: null as HTMLImageElement | null,
  iconFrameImg: null as HTMLImageElement | null,
  noItemImg: null as HTMLImageElement | null,
  saleBadge: null as HTMLImageElement | null,
  noticeBg: null as HTMLImageElement | null,
  buySfxNode: null as any,

  // Icon cache — keyed by itemId, so late async loads can never land on the
  // wrong cell; render always reads the cache for the item it is drawing
  _icons: new Map<number, HTMLImageElement | null>(),
  _iconLoading: new Set<number>(),

  // Try-on preview + its mini-stage simulation (walk/jump/climb/attack)
  preview: null as MapleStandingCharacter | null,
  previewOn: true,
  previewTab: 0, // Base/Preview background variant 0-2
  _sim: { x: 106, y: 0, vy: 0, climbing: false, attackMs: 0, stance: 'stand1' },

  // Left-column panels
  invTab: 4,     // Item Inventory tab: 0 equip / 1 use / 2 setup / 3 etc / 4 cash
  invScroll: 0,  // in rows of 4
  // Try-on tray (the CashInventory panel): slot -> itemId dressed on the
  // preview; _showBase=false after REMOVE ALL strips the base look
  _tryOn: {} as Record<number, number>,
  _baseLook: {} as Record<number, number>,
  _showBase: true,

  // Best Item rail — world top-5 sold, served by the server tally
  bestItems: [] as { itemId: number; count: number }[],

  // Buttons
  buttons: [] as MapleStanceButton[],
  buyButtons: [] as MapleStanceButton[],
  dialogButtons: [] as MapleStanceButton[],
  buttonsRegistered: false,
  _hudSnapshot: null as Map<any, boolean> | null,

  // Confirm dialog
  _confirm: null as CashCommodity | null,
  _busyBuying: false,

  // Hover state, resolved during cell draw for the tooltip pass
  _hoverItem: null as CashCommodity | null,
  _hoverX: 0,
  _hoverY: 0,

  async show(canvas: GameCanvas) {
    if (this.isVisible) return;
    const character = (window as any).charecter;
    if (!character || character.isDead) return;
    if (DirectionScene.isActive) return;

    this.canvas = canvas;
    (window as any).MapStateInstance?.closeAllMenus?.();

    if (!this.loaded) await this.loadAssets();
    if (!this.loaded) return;
    await ensureItemNames();
    const all = await loadCommodities();

    this.ox = Math.floor((Config.width - CS_W) / 2);
    this.oy = Math.floor((Config.height - CS_H) / 2);
    this.activeTab = 1;
    this._allCommodities = all;
    this.items = getCategoryItems(1, all);
    this.scrollOffset = 0;
    this._confirm = null;
    this._busyBuying = false;

    // The overlay covers the whole screen, but ClickManager resolves hover
    // by registration order — the status bar's buttons would swallow clicks
    // through the shop. Snapshot each button's own isHidden and hide it;
    // hide() restores the exact states (quickslot arrows manage their own).
    this._hudSnapshot = new Map();
    for (const btn of ClickManager.buttons) {
      this._hudSnapshot.set(btn, btn.isHidden);
      btn.isHidden = true;
    }

    this.previewOn = true;
    this.previewTab = 0;
    this.invTab = 4;
    this.invScroll = 0;
    this._sim = { x: 106, y: 0, vy: 0, climbing: false, attackMs: 0, stance: 'stand1' };
    this.bestItems = [];
    (window as any).__mySocket?.requestBestItems?.();

    this.registerButtons(canvas);
    await this.buildPreview();

    void AudioManager.playBackgroundMusic('BgmUI/ShopBgm');
    this.isVisible = true;
  },

  /** 'best_items' network reply — world top-5 sold */
  setBestItems(items: { itemId: number; count: number }[]) {
    this.bestItems = (items || []).slice(0, 5);
    for (const b of this.bestItems) this._kickIconLoad(b.itemId);
  },

  /** ESC: close the confirm dialog first; a second ESC leaves the shop. */
  escape() {
    if (this._confirm) this.closeConfirm();
    else this.hide();
  },

  hide() {
    if (!this.isVisible) return;
    this.closeConfirm();
    this.unregisterButtons();
    if (this._hudSnapshot) {
      for (const [btn, wasHidden] of this._hudSnapshot) {
        if (ClickManager.buttons.has?.(btn) ?? true) btn.isHidden = wasHidden;
      }
      this._hudSnapshot = null;
    }
    // Map BGM: the map node stayed resident (we never called MapleMap.load)
    const mapBgm = (window as any).__MapleMap?.wzNode?.info?.bgm?.nValue;
    if (mapBgm) void AudioManager.playBackgroundMusic(mapBgm);
    this.preview = null;
    this.isVisible = false;
    (window as any).__mySocket?.requestSave?.();
  },

  async loadAssets() {
    try {
      const cs: any = await WZManager.get('UI.wz/CashShop.img');
      this.backgrnd = cs.nGet('Base').nGet('backgrnd').nGetImage();
      this.previewBgs = [];
      for (let i = 0; i < 3; i++) {
        this.previewBgs[i] = cs.nGet('Base').nGet('Preview').nGet(String(i))?.nGetImage?.() || null;
      }
      this.prevOffBtn = cs.nGet('Base').nGet('PreviewOnOff').nGet('Off').nGet('0')?.nGetImage?.() || null;
      this.ptabEn = [];
      this.ptabDis = [];
      for (let i = 0; i < 3; i++) {
        this.ptabEn[i] = cs.nGet('Base').nGet('Tab').nGet('Enable').nGet(String(i))?.nGetImage?.() || null;
        this.ptabDis[i] = cs.nGet('Base').nGet('Tab').nGet('Disable').nGet(String(i))?.nGetImage?.() || null;
      }
      // Item Inventory tabs use the SAME plates as the in-game inventory
      // window: UIWindow.img/Item/Tab label sprites over drawn tab shapes
      const itemWin: any = await WZManager.get('UI.wz/UIWindow.img/Item');
      this._invTabNode = itemWin.nGet('Tab');
      this.tabStrips = [];
      for (let i = 1; i <= CASH_TAB_COUNT; i++) {
        this.tabStrips[i] = cs.nGet('CSTab').nGet('Tab').nGet(String(i))?.nGetImage?.() || null;
      }
      const list = cs.nGet('CSList');
      this.cellImg = list.nGet('Base')?.nGetImage?.() || null;
      this.iconFrameImg = list.nGet('ItemIcon')?.nGetImage?.() || null;
      this._btBuyNode = list.nGet('BtBuy');
      // GIFT/RESERVE are visual-only in v1, painted in their disabled stance
      this.giftDisabledImg = list.nGet('BtGift')?.nGet?.('disabled')?.nGet?.('0')?.nGetImage?.() || null;
      this.reserveDisabledImg = list.nGet('BtReserve')?.nGet?.('disabled')?.nGet?.('0')?.nGetImage?.() || null;
      const status = cs.nGet('CSStatus');
      this._btExitNode = status.nGet('BtExit');
      this._btChargeNode = status.nGet('BtCharge');
      this._btCheckNode = status.nGet('BtCheck');
      this._btCouponNode = status.nGet('BtCoupon');
      const csChar = cs.nGet('CSChar');
      this._btBuyAvatarNode = csChar.nGet('BtBuyAvatar');
      this._btDefaultAvatarNode = csChar.nGet('BtDefaultAvatar');
      this._btTakeoffAvatarNode = csChar.nGet('BtTakeoffAvatar');
      const csInv = cs.nGet('CSInventory');
      this._btExEquipNode = csInv.nGet('BtExEquip');
      this._btExConsumeNode = csInv.nGet('BtExConsume');
      this._btExInstallNode = csInv.nGet('BtExInstall');
      this._btExEtcNode = csInv.nGet('BtExEtc');
      this._btExTrunkNode = csInv.nGet('BtExTrunk');
      this.noItemImg = cs.nGet('PicturePlate').nGet('NoItem')?.nGetImage?.() || null;
      this._btSearchNode = cs.nGet('CSItemSearch').nGet('BtSearch');
      this.saleBadge = cs.nGet('CSEffect').nGet('sale')?.nGet?.('0')?.nGetImage?.() || null;
      this.noticeBg = cs.nGet('CSNotice').nGet('2')?.nGet?.('backgrnd')?.nGetImage?.() || null;

      const basic: any = await WZManager.get('UI.wz/Basic.img');
      this._btOkNode = basic.nGet('BtOK');
      this._btCancelNode = basic.nGet('BtCancel');
      // VScr4 pieces for the two little inventory scrollers
      const vscr = basic.nGet('VScr4');
      const en = vscr?.nGet?.('enabled');
      const dis = vscr?.nGet?.('disabled');
      this._scroll = {
        prev: en?.nGet?.('prev0')?.nGetImage?.() || null,
        next: en?.nGet?.('next0')?.nGetImage?.() || null,
        base: en?.nGet?.('base')?.nGetImage?.() || null,
        thumb: en?.nGet?.('thumb0')?.nGetImage?.() || null,
        prevDis: dis?.nGet?.('prev')?.nGetImage?.() || null,
        nextDis: dis?.nGet?.('next')?.nGetImage?.() || null,
        baseDis: dis?.nGet?.('base')?.nGetImage?.() || null,
      };

      try {
        const uiSound: any = await WZManager.get('Sound.wz/UI.img');
        this.buySfxNode = uiSound?.nGet?.('BuyShopItem') || null;
      } catch { /* sound is optional */ }

      this.loaded = true;
    } catch (e) {
      console.error('[CashShop] failed to load assets:', e);
    }
  },

  async buildPreview() {
    const character = (window as any).charecter;
    this._tryOn = {};
    this._showBase = true;
    // The player's visible look by slot (cash covers over base gear) — the
    // baseline the try-on layer composes over
    this._baseLook = {};
    const ids = character?.equippedItemIds || {};
    for (let s = 0; s <= 22; s++) {
      const id = ids[100 + s] ?? ids[s];
      if (id) this._baseLook[s] = id;
    }
    try {
      this.preview = await MapleStandingCharacter.fromAppearance({
        skinColor: character.skinColor ?? 0,
        faceId: character.face ?? 20000,
        hairId: character.hair ?? 30030,
        equipIds: Object.values(this._baseLook) as number[],
        flipped: false,
      });
    } catch (e) {
      console.warn('[CashShop] preview build failed:', e);
      this.preview = null;
    }
  },

  /** Base look (unless stripped) with try-ons layered per slot on top */
  async applyPreviewOutfit() {
    const merged: Record<number, number> = this._showBase ? { ...this._baseLook } : {};
    for (const [slot, id] of Object.entries(this._tryOn)) {
      merged[Number(slot)] = id as number;
    }
    await this.preview?.setEquipsByIds(Object.values(merged));
  },

  /** Catalog click: dress the preview and drop the item in the try-on tray */
  tryOnItem(itemId: number) {
    const slot = slotForEquip(itemId);
    if (slot < 0) return;
    this._tryOn[slot] = itemId;
    this._kickIconLoad(itemId);
    void this.applyPreviewOutfit();
  },

  async resetPreviewEquips() {
    this._tryOn = {};
    this._showBase = true;
    await this.applyPreviewOutfit();
  },

  registerButtons(canvas: GameCanvas) {
    this.unregisterButtons();

    // EXIT — return to game
    if (this._btExitNode) {
      const btn = new MapleStanceButton(canvas, {
        x: this.ox + EXIT_X, y: this.oy + EXIT_Y,
        img: this._btExitNode.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this.hide(),
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }

    // CHARGE — grants free NX (no real-money layer in this world), with the
    // authentic CHECK CASH / CODE buttons beside it
    if (this._btChargeNode) {
      const btn = new MapleStanceButton(canvas, {
        x: this.ox + CHARGE_X, y: this.oy + CHARGE_Y,
        img: this._btChargeNode.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => {
          const character = (window as any).charecter;
          character?.inventory?.gainNX?.(10000);
          UIChatLog.notice('You have received 10,000 NX.');
        },
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }
    if (this._btCheckNode) {
      const btn = new MapleStanceButton(canvas, {
        x: this.ox + CHARGE_X + CHARGE_PITCH, y: this.oy + CHARGE_Y,
        img: this._btCheckNode.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => {
          const inv = (window as any).charecter?.inventory;
          UIChatLog.notice(`NX Credit: ${(inv?.nx ?? 0).toLocaleString()} NX`);
        },
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }
    if (this._btCouponNode) {
      const btn = new MapleStanceButton(canvas, {
        x: this.ox + CHARGE_X + CHARGE_PITCH * 2, y: this.oy + CHARGE_Y,
        img: this._btCouponNode.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => UIChatLog.notice('Coupon codes cannot be redeemed in this world.'),
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }

    // SEARCH ITEM — the purple button above the Best Item rail
    if (this._btSearchNode) {
      const btn = new MapleStanceButton(canvas, {
        x: this.ox + 694, y: this.oy + 100,
        img: this._btSearchNode.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => UIChatLog.notice('Item search is coming soon.'),
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }

    // Preview action row (CSChar): BUY EQUIPPED ITEM / RETURN TO DEFAULT /
    // REMOVE ALL — the orange trio under the preview stage
    const addCharBtn = (node: any, x: number, onClick: () => void) => {
      if (!node) return;
      const btn = new MapleStanceButton(canvas, {
        x: this.ox + x, y: this.oy + 237,
        img: node.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick,
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    };
    // The backdrop bakes three seats at x=17/102/188 whose widths (83/84/55)
    // match these sprites exactly — pixel-measured, not eyeballed
    addCharBtn(this._btBuyAvatarNode, 17, () =>
      UIChatLog.notice('Buying the previewed outfit in one click is not supported yet.'));
    addCharBtn(this._btDefaultAvatarNode, 102, () => void this.resetPreviewEquips());
    addCharBtn(this._btTakeoffAvatarNode, 188, () => {
      this._tryOn = {};
      this._showBase = false;
      void this.applyPreviewOutfit();
    });

    // "+ ... Slot" column beside the Item Inventory (CSInventory art). In
    // this world purchases deliver straight to the inventory, so these are
    // informational
    const slotNodes = [
      this._btExEquipNode, this._btExConsumeNode, this._btExInstallNode,
      this._btExEtcNode, this._btExTrunkNode,
    ];
    slotNodes.forEach((node, i) => {
      if (!node) return;
      const btn = new MapleStanceButton(canvas, {
        x: this.ox + SLOTBTN_X, y: this.oy + SLOTBTN_Y0 + i * SLOTBTN_STRIDE,
        img: node.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => UIChatLog.notice('Purchases are delivered straight to your inventory.'),
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    });

    // Ten static per-cell BUY buttons — bound to the visible cell index;
    // onClick resolves the commodity at draw-time scroll position, so
    // scrolling never re-registers buttons. GMS order in the cell's button
    // row is BUY | GIFT | RESERVE — the latter two are painted disabled in
    // render() (no gifting/wishlist in v1).
    this.buyButtons = [];
    if (this._btBuyNode) {
      for (let cell = 0; cell < GRID_ROWS * GRID_COLS; cell++) {
        const col = cell % GRID_COLS;
        const row = Math.floor(cell / GRID_COLS);
        const btn = new MapleStanceButton(canvas, {
          x: this.ox + GRID_COL_X[col] + 78,
          y: this.oy + GRID_ROW_Y + row * GRID_ROW_H + 57,
          img: this._btBuyNode.nChildren,
          isRelativeToCamera: true, isPartOfUI: true,
          onClick: () => {
            const item = this.items[this.scrollOffset * PAGE_SIZE + cell];
            if (item && !this._confirm) this.openConfirm(item);
          },
        });
        this.buyButtons.push(btn);
        this.buttons.push(btn);
        ClickManager.addButton(btn);
      }
    }
    this.buttonsRegistered = true;
  },

  unregisterButtons() {
    for (const btn of this.buttons) ClickManager.removeButton(btn);
    this.buttons = [];
    this.buyButtons = [];
    this.closeConfirm();
    this.buttonsRegistered = false;
  },

  // --- Confirm dialog -------------------------------------------------------

  openConfirm(item: CashCommodity) {
    if (!this.canvas) return;
    this._confirm = item;
    // Buy buttons go dead while the dialog is up (double-purchase guard)
    for (const b of this.buyButtons) b.isHidden = true;

    const dw = this.noticeBg?.width ?? 266;
    const dh = this.noticeBg?.height ?? 142;
    const dx = Math.floor((Config.width - dw) / 2);
    const dy = Math.floor((Config.height - dh) / 2);
    const ok = new MapleStanceButton(this.canvas, {
      x: dx + Math.floor(dw / 2) - 70, y: dy + dh - 32,
      img: this._btOkNode.nChildren,
      isRelativeToCamera: true, isPartOfUI: true,
      onClick: () => void this.confirmBuy(),
    });
    const cancel = new MapleStanceButton(this.canvas, {
      x: dx + Math.floor(dw / 2) + 8, y: dy + dh - 32,
      img: this._btCancelNode.nChildren,
      isRelativeToCamera: true, isPartOfUI: true,
      onClick: () => this.closeConfirm(),
    });
    this.dialogButtons = [ok, cancel];
    ClickManager.addButton(ok);
    ClickManager.addButton(cancel);
  },

  closeConfirm() {
    for (const btn of this.dialogButtons) ClickManager.removeButton(btn);
    this.dialogButtons = [];
    this._confirm = null;
    for (const b of this.buyButtons) b.isHidden = false;
  },

  async confirmBuy() {
    const item = this._confirm;
    if (!item || this._busyBuying) return;
    const character = (window as any).charecter;
    const inv = character?.inventory;
    if (!inv) return;

    if (inv.nx < item.price) {
      this.closeConfirm();
      UIChatLog.notice('You do not have enough NX.');
      return;
    }
    if (!inv.canHold(item.itemId, item.count)) {
      this.closeConfirm();
      UIChatLog.notice('Please make room in your inventory first.');
      return;
    }

    this._busyBuying = true;
    try {
      inv.gainNX(-item.price);
      const expireAt = computeExpireAt(item.period);
      // Pets ship with Period=0 — their 90-day clock comes from WZ
      // info/life instead, seeded into a fresh pet blob at purchase
      const equipData = isPetItemId(item.itemId)
        ? await makeNewPetBlob(item.itemId)
        : expireAt
          ? { bonus: {}, tuc: 0, level: 0, expireAt }
          : undefined;
      const ok = await inv.addToInventory(item.itemId, item.count, equipData);
      if (ok === false) {
        inv.gainNX(item.price); // refund — tab filled up under us
      } else {
        // Rented equips: the placeholder tuc (0) must not clobber the WZ
        // upgrade-slot count the item would otherwise carry. Cash-flagged
        // equips route to the CASH tab, so look in both.
        if (expireAt && Math.floor(item.itemId / 1000000) === 1) {
          const bought = [...inv.cash, ...inv.equip].find(
            (it: any) => it?.itemId === item.itemId && it.equipData?.expireAt === expireAt
          );
          if (bought?.equipData) {
            bought.equipData.tuc = bought.node?.info?.tuc?.nValue ?? 0;
          }
        }
        if (this.buySfxNode?.nGetAudio) PLAY_AUDIO(this.buySfxNode.nGetAudio());
        UIChatLog.notice(`You have purchased ${getItemNameSync(item.itemId) || 'the item'}.`);
        // World sales tally for the Best Item rail
        const sock = (window as any).__mySocket;
        sock?.sendCashBuyLog?.(item.itemId);
        sock?.requestBestItems?.();
      }
    } finally {
      this._busyBuying = false;
      this.closeConfirm();
    }
  },

  // --- Icons (lazy, per visible page) --------------------------------------

  _kickIconLoad(itemId: number) {
    if (this._icons.has(itemId) || this._iconLoading.has(itemId)) return;
    this._iconLoading.add(itemId);
    void (async () => {
      let img: HTMLImageElement | null = null;
      try {
        const category = Math.floor(itemId / 1000000);
        let infoNode: any = null;
        if (category === 1) {
          const path = getEquipWzPath(itemId);
          if (path) infoNode = ((await WZManager.get(path)) as any)?.info;
        } else {
          const strId = `${itemId}`.padStart(8, '0');
          const wzType = MapleInventory.getWzNameFromInventoryId(strId);
          if (wzType === MapleInventory.WzInventoryType.Pet) {
            // Pets are whole .img files keyed by the unpadded id
            infoNode = await WZManager.get(`Item.wz/Pet/${itemId}.img/info`);
          } else if (wzType) {
            infoNode = await WZManager.get(
              `Item.wz/${wzType}/${strId.slice(0, 4)}.img/${strId}/info`
            );
          }
        }
        const iconNode = infoNode?.nGet?.('iconRaw') ?? infoNode?.nGet?.('icon');
        if (iconNode?.nGetImage) img = iconNode.nGetImage();
      } catch { /* missing sprite — cell renders without an icon */ }
      this._icons.set(itemId, img);
      this._iconLoading.delete(itemId);
    })();
  },

  // --- Per-frame ------------------------------------------------------------

  update(msPerTick: number) {
    if (!this.isVisible) return;
    this.preview?.update(msPerTick);
    this._updatePreviewSim(msPerTick);

    const canvas = this.canvas;
    if (!canvas) return;

    // Wheel scroll — over the Item Inventory panel it scrolls that grid,
    // anywhere else the catalog (dialog closed)
    if (!this._confirm) {
      const mx = canvas.mouseX;
      const my = canvas.mouseY;
      const overItemInv =
        mx >= this.ox + 8 && mx <= this.ox + 170 &&
        my >= this.oy + 440 && my <= this.oy + 595;
      if (overItemInv) {
        const rows = Math.ceil(this._invItems().length / 4);
        const maxInv = Math.max(0, rows - 3);
        if ((canvas as any).scrolledUp) this.invScroll = Math.max(0, this.invScroll - 1);
        if ((canvas as any).scrolledDown) this.invScroll = Math.min(maxInv, this.invScroll + 1);
      } else {
        // Wheel flips catalog pages (GMS paginates — no scrollbar)
        const maxPage = Math.max(0, Math.ceil(this.items.length / PAGE_SIZE) - 1);
        if ((canvas as any).scrolledUp) this.scrollOffset = Math.max(0, this.scrollOffset - 1);
        if ((canvas as any).scrolledDown) this.scrollOffset = Math.min(maxPage, this.scrollOffset + 1);
      }
    }
  },

  _invItems(): any[] {
    const inv = (window as any).charecter?.inventory;
    if (!inv) return [];
    return [inv.equip, inv.use, inv.setup, inv.etc, inv.cash][this.invTab] || [];
  },

  /**
   * The preview stage is playable, like the original: the stage art bakes a
   * floor and a ladder, and CashShopPreview.img (a real mini-map) defines
   * them. Walk with the arrows, jump with the jump key, climb the ladder,
   * attack with the attack key — all confined to the 212x165 box.
   */
  _updatePreviewSim(msPerTick: number) {
    const p = this.preview;
    const canvas = this.canvas;
    if (!p || !canvas || !this.previewOn || this._confirm) return;
    const s = this._sim;
    const dt = msPerTick / 1000;

    const left = canvas.isKeyDown('left');
    const right = canvas.isKeyDown('right');
    const up = canvas.isKeyDown('up');
    const down = canvas.isKeyDown('down');
    const jump = canvas.isKeyDown('alt');
    const attack = canvas.isKeyDown('ctrl');

    // Idle/walk poses come from the worn weapon, not a literal: two-handed
    // weapons ship stand2/walk2 and no stand1 node at all, so hardcoding it
    // here re-posed the preview a frame after attachEquipByItemId got it
    // right and the try-on went empty-handed the moment you moved.
    let stance = p.idleStance();
    const grounded = s.y >= 0 && s.vy === 0;

    if (s.attackMs > 0) {
      s.attackMs -= msPerTick;
      stance = s.attackStance || 'swingO1';
    }

    // Ladder grab — works mid-air too, like the real engine (hold up while
    // overlapping the rails)
    const inLadderBand = s.x >= LADDER_X0 && s.x <= LADDER_X1;
    if (!s.climbing && inLadderBand && up && s.attackMs <= 0) {
      s.climbing = true;
      s.vy = 0;
      s.x = (LADDER_X0 + LADDER_X1) / 2;
      s.y = Math.max(LADDER_TOP - STAGE_FLOOR_Y, Math.min(0, s.y));
    }

    // Constants match Physics.ts exactly: walk 125, jump 570, gravity 2000
    // with the float_drag_2/shoe_mass air drag (100/s), fall cap 670,
    // climb 150 — the stage is 1:1 world pixels
    if (s.climbing) {
      stance = 'ladder';
      const dy = (up ? -1 : down ? 1 : 0) * 150 * dt;
      s.y = Math.max(LADDER_TOP - STAGE_FLOOR_Y, Math.min(0, s.y + dy));
      // GMS animates the ladder only while moving
      if (!up && !down) p.delay = 0;
      if (s.y >= 0 && down) s.climbing = false;   // stepped off at the bottom
      if (jump && (left || right)) {              // rope jump-off (0.6 x jump)
        s.climbing = false;
        s.vy = -570 * 0.6;
      }
    } else if (s.attackMs <= 0) {
      if (down && grounded && !left && !right) {
        // v83 crouch — attack from here is the prone stab
        stance = 'prone';
        if (attack) {
          s.attackStance = 'proneStab';
          s.attackMs = this._stanceDuration('proneStab');
          stance = 'proneStab';
        }
      } else {
        // Horizontal
        if (left !== right) {
          s.x += (left ? -1 : 1) * 125 * dt;
          s.x = Math.max(STAGE_MIN_X, Math.min(STAGE_MAX_X, s.x));
          p.setFlipped(!left ? true : false);
          if (grounded) stance = p.walkStance();
        }
        // Jump + the engine's exact air integration: drag pulls vy toward 0
        // before gravity is added, fall speed capped
        if (jump && grounded) s.vy = -570;
        if (s.vy !== 0 || s.y < 0) {
          const shoefloat = 100 * dt;
          s.vy = s.vy < 0 ? Math.min(0, s.vy + shoefloat) : Math.max(0, s.vy - shoefloat);
          s.vy = Math.min(670, s.vy + 2000 * dt);
          s.y += s.vy * dt;
          stance = 'jump';
          if (s.y >= 0) { s.y = 0; s.vy = 0; }
        }
        // Attack — plays the full animation even after the key is released
        if (attack && grounded && s.attackMs <= 0) {
          s.attackStance = 'swingO1';
          s.attackMs = this._stanceDuration('swingO1');
          stance = 'swingO1';
        }
      }
    }

    if (stance !== s.stance) {
      s.stance = stance;
      p.setStance(stance, 0, stance.startsWith('stand'));
    }
  },

  /** Total duration of a body stance's frames — so attacks play out fully */
  _stanceDuration(stance: string): number {
    const seq = (this.preview as any)?.baseBody?.[stance];
    if (!Array.isArray(seq) || !seq.length) return 500;
    let total = 0;
    for (const node of seq) {
      total += Math.abs(node?.nGet?.('delay')?.nGet?.('nValue', 120)) || 120;
    }
    return total;
  },

  setTab(tab: number) {
    if (tab < 1 || tab > CASH_TAB_COUNT || tab === this.activeTab) return;
    this.activeTab = tab;
    this.scrollOffset = 0;
    void loadCommodities().then((all) => {
      if (this.activeTab === tab) this.items = getCategoryItems(tab, all);
    });
  },

  render(canvas: GameCanvas, _camera: CameraInterface) {
    if (!this.isVisible || !this.backgrnd) return;
    const ctx = canvas.context;
    this._hoverItem = null;

    // Black matte behind the centered 800x600 composition (screen matting,
    // like the fade overlay — not a UI panel)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.game.width, canvas.game.height);
    canvas.drawImage({ img: this.backgrnd, dx: this.ox, dy: this.oy });

    // Category strip for the active tab
    const strip = this.tabStrips[this.activeTab];
    if (strip) canvas.drawImage({ img: strip, dx: this.ox + TAB_X, dy: this.oy + TAB_Y });

    // Item grid
    if (this.items.length === 0) {
      // Nothing on sale: the BUY buttons must not linger over the plate
      for (const btn of this.buyButtons) btn.isHidden = true;
      if (this.noItemImg) {
        // Centered over the grid area (grid spans 280-684 x 97-497)
        canvas.drawImage({
          img: this.noItemImg,
          dx: this.ox + 279, dy: this.oy + 176,
        });
      }
    } else {
      const mx = canvas.mouseX;
      const my = canvas.mouseY;
      for (let cell = 0; cell < GRID_ROWS * GRID_COLS; cell++) {
        const item = this.items[this.scrollOffset * PAGE_SIZE + cell];
        const col = cell % GRID_COLS;
        const row = Math.floor(cell / GRID_COLS);
        const cx = this.ox + GRID_COL_X[col];
        const cy = this.oy + GRID_ROW_Y + row * GRID_ROW_H;
        // Keep the matching BUY button alive only for populated cells
        const buyBtn = this.buyButtons[cell];
        if (buyBtn) buyBtn.isHidden = !item || !!this._confirm;
        if (!item) continue;

        // CSList/ItemIcon is the yellow SELECTED frame — the plain white icon
        // box is baked into the cell art, so no frame overlay here
        if (this.cellImg) canvas.drawImage({ img: this.cellImg, dx: cx, dy: cy });

        this._kickIconLoad(item.itemId);
        const icon = this._icons.get(item.itemId);
        if (icon?.complete && icon.naturalWidth > 0) {
          // Pixel-doubled like the original (smoothing is off globally)
          const scale = Math.min(2, ICON_SIZE / Math.max(icon.width, icon.height));
          const dw = Math.round(icon.width * scale);
          const dh = Math.round(icon.height * scale);
          const ix = cx + 4 + Math.floor((72 - dw) / 2);
          const iy = cy + 4 + Math.floor((72 - dh) / 2);
          // Drop shadow under the item, like the original's display frames
          ctx.save();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
          ctx.beginPath();
          ctx.ellipse(cx + 40, iy + dh + 3, Math.max(12, dw / 2), 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          canvas.drawImage({ img: icon, dx: ix, dy: iy, dw, dh });
        }

        // GMS cell text: black name on the title strip, navy price under it
        let name = getItemNameSync(item.itemId) || `Item #${item.itemId}`;
        if (item.count > 1) name += ` (${item.count})`;
        if (name.length > 17) name = name.substring(0, 16) + '..';
        canvas.drawText({
          text: name, x: cx + 78, y: cy + 8, fontSize: 11, color: '#000000',
        });
        canvas.drawText({
          text: `${item.price.toLocaleString()} NX`,
          x: cx + 78, y: cy + 32, fontSize: 11, color: '#1e46b4', fontWeight: 'bold',
        });
        // GIFT / RESERVE seats after BUY, disabled like the reference client
        if (this.giftDisabledImg) {
          canvas.drawImage({ img: this.giftDisabledImg, dx: cx + 118, dy: cy + 57 });
        }
        if (this.reserveDisabledImg) {
          canvas.drawImage({ img: this.reserveDisabledImg, dx: cx + 158, dy: cy + 57 });
        }

        // Hover: tooltip + try-on hit zone (the icon area, so the BUY button
        // in the cell's corner stays a pure purchase control)
        if (mx >= cx && mx <= cx + 200 && my >= cy && my <= cy + GRID_ROW_H) {
          this._hoverItem = item;
          this._hoverX = mx;
          this._hoverY = my;
          if (
            (canvas as any).wasClicked && !this._confirm &&
            mx <= cx + 76 && Math.floor(item.itemId / 1000000) === 1
          ) {
            this.tryOnItem(item.itemId);
          }
        }
      }

      this.drawPagination(canvas);
    }

    // Tab strip clicks — 9 equal bands across the 508px strip
    if ((canvas as any).wasClicked && !this._confirm) {
      const mx = canvas.mouseX;
      const my = canvas.mouseY;
      if (
        my >= this.oy + TAB_Y && my <= this.oy + TAB_Y + 40 &&
        mx >= this.ox + TAB_X && mx <= this.ox + TAB_X + 508
      ) {
        this.setTab(1 + Math.floor((mx - (this.ox + TAB_X)) / TAB_BAND_W));
      }
    }

    // ---- Preview section: ON frame, background tabs, playable avatar ----
    const clicked = (canvas as any).wasClicked && !this._confirm;
    const mx2 = canvas.mouseX;
    const my2 = canvas.mouseY;
    if (this.previewOn) {
      const stageX = this.ox + PREVIEW_X;
      const stageY = this.oy + PREVIEW_Y;
      const bg = this.previewBgs?.[this.previewTab];
      if (bg) canvas.drawImage({ img: bg, dx: stageX, dy: stageY });
      if (this.preview) {
        this.preview.setPosition(stageX + this._sim.x, stageY + STAGE_FLOOR_Y + this._sim.y);
        // Clip to the stage so a jumping avatar can't poke out of the panel
        ctx.save();
        ctx.beginPath();
        ctx.rect(stageX, stageY, 212, 165);
        ctx.clip();
        this.preview.draw(canvas, { x: 0, y: 0 } as CameraInterface, 0, 16, 0);
        ctx.restore();
      }
    }
    // Background tabs on the Preview title row (bottom-aligned like the
    // baked notches); active tab uses the tall Enable sprite
    for (let i = 0; i < 3; i++) {
      const img = i === this.previewTab ? this.ptabEn?.[i] : this.ptabDis?.[i];
      const tx = this.ox + 160 + i * 24;
      const tyy = this.oy + (i === this.previewTab ? 5 : 12);
      if (img) canvas.drawImage({ img, dx: tx, dy: tyy });
      if (clicked && mx2 >= tx && mx2 <= tx + 24 && my2 >= this.oy + 3 && my2 <= this.oy + 30) {
        this.previewTab = i;
        this.previewOn = true;
      }
    }
    // ON/OFF: the OFF plate shows (and toggles) beside the title when the
    // preview is off; clicking the "Preview" title itself toggles too
    if (!this.previewOn && this.prevOffBtn) {
      canvas.drawImage({ img: this.prevOffBtn, dx: this.ox + 78, dy: this.oy + 6 });
    }
    if (clicked && mx2 >= this.ox + 10 && mx2 <= this.ox + 115 && my2 >= this.oy + 4 && my2 <= this.oy + 26) {
      this.previewOn = !this.previewOn;
    }

    // ---- Cash Inventory: the try-on tray — what the preview is wearing
    // from the shop; clicking an item takes it back off ----
    {
      const entries = Object.entries(this._tryOn) as [string, number][];
      for (let cell = 0; cell < Math.min(12, entries.length); cell++) {
        const [slot, itemId] = entries[cell];
        const col = cell % 6;
        const row = Math.floor(cell / 6);
        const cellX = this.ox + CASHINV_X + col * INV_STRIDE;
        const cellY = this.oy + CASHINV_Y + row * INV_STRIDE;
        this._kickIconLoad(itemId);
        const icon = this._icons.get(itemId);
        if (icon?.complete && icon.naturalWidth > 0) {
          canvas.drawImage({
            img: icon,
            dx: cellX + Math.floor((INV_CELL - Math.min(32, icon.width)) / 2),
            dy: cellY + Math.floor((INV_CELL - Math.min(32, icon.height)) / 2),
          });
        }
        if (
          clicked && mx2 >= cellX && mx2 <= cellX + INV_CELL &&
          my2 >= cellY && my2 <= cellY + INV_CELL
        ) {
          delete this._tryOn[Number(slot)];
          void this.applyPreviewOutfit();
        }
      }
      this.drawMiniScroll(canvas, this.ox + 244, this.oy + CASHINV_Y, 66, false, 0, 0);
    }

    // ---- Item Inventory: the player's tabs; non-cash items grayed out ----
    {
      // Tabs styled exactly like the inventory window: rounded plate (pink
      // active / grey inactive) + the UIWindow Item/Tab label sprite
      const tabW = 28;
      const tabH = 16;
      const tabY = this.oy + ITAB_Y - 4;
      for (let i = 0; i < 5; i++) {
        const tx = this.ox + 16 + i * tabW;
        const isActive = i === this.invTab;
        ctx.save();
        const r = 3;
        ctx.beginPath();
        ctx.moveTo(tx + r, tabY);
        ctx.lineTo(tx + tabW - r, tabY);
        ctx.arcTo(tx + tabW, tabY, tx + tabW, tabY + r, r);
        ctx.lineTo(tx + tabW, tabY + tabH);
        ctx.lineTo(tx, tabY + tabH);
        ctx.lineTo(tx, tabY + r);
        ctx.arcTo(tx, tabY, tx + r, tabY, r);
        ctx.closePath();
        ctx.fillStyle = isActive ? '#dd4466' : '#b8c4d8';
        ctx.fill();
        ctx.strokeStyle = '#8899bb';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        try {
          const stateNode = isActive ? this._invTabNode?.enabled : this._invTabNode?.disabled;
          const labelImg = stateNode?.nGet?.(`${i}`)?.nGetImage?.();
          if (labelImg?.width) {
            canvas.drawImage({
              img: labelImg,
              dx: tx + Math.floor((tabW - labelImg.width) / 2),
              dy: tabY + Math.floor((tabH - (labelImg.height || 11)) / 2),
            });
          }
        } catch { /* label sprite missing — plate alone reads fine */ }
        if (clicked && mx2 >= tx && mx2 <= tx + tabW && my2 >= tabY && my2 <= tabY + tabH) {
          this.invTab = i;
          this.invScroll = 0;
        }
      }
      const items = this._invItems();
      for (let cell = 0; cell < 12; cell++) {
        const item = items[this.invScroll * 4 + cell];
        if (!item) continue;
        const col = cell % 4;
        const row = Math.floor(cell / 4);
        let icon: HTMLImageElement | null = null;
        try {
          const iconNode = item.node?.info?.iconRaw ?? item.node?.info?.icon;
          icon = iconNode?.nGetImage?.() ?? null;
        } catch { /* no sprite */ }
        if (!icon?.complete) continue;
        const dx2 = this.ox + ITEMINV_X + col * INV_STRIDE + Math.floor((INV_CELL - Math.min(32, icon.width)) / 2);
        const dy2 = this.oy + ITEMINV_Y + row * INV_STRIDE + Math.floor((INV_CELL - Math.min(32, icon.height)) / 2);
        const isCash = item.isCashItem?.() || Math.floor(item.itemId / 1000000) === 5;
        if (isCash) {
          canvas.drawImage({ img: icon, dx: dx2, dy: dy2 });
        } else {
          // Normal items can't be handled in the cash shop — grayed out
          ctx.save();
          ctx.filter = 'grayscale(1)';
          ctx.globalAlpha = 0.45;
          ctx.drawImage(icon, dx2, dy2);
          ctx.restore();
        }
      }
      const invRows = Math.ceil(items.length / 4);
      const maxInvScroll = Math.max(0, invRows - 3);
      this.drawMiniScroll(
        canvas, this.ox + 162, this.oy + ITEMINV_Y, 3 * INV_STRIDE - 4,
        invRows > 3, this.invScroll, maxInvScroll,
        (dir: number) => {
          this.invScroll = Math.max(0, Math.min(maxInvScroll, this.invScroll + dir));
        }
      );
    }

    // ---- Best Item rail: world top-5 sold ----
    for (let i = 0; i < this.bestItems.length; i++) {
      const best = this.bestItems[i];
      const by = this.oy + BEST_Y0 + i * BEST_STRIDE;
      const icon = this._icons.get(best.itemId);
      if (icon?.complete && icon.naturalWidth > 0) {
        const scale = Math.min(1, 30 / Math.max(icon.width, icon.height));
        canvas.drawImage({
          img: icon,
          dx: this.ox + BEST_X + 30, dy: by,
          dw: Math.round(icon.width * scale), dh: Math.round(icon.height * scale),
        });
      }
      let bname = getItemNameSync(best.itemId) || `Item #${best.itemId}`;
      if (bname.length > 12) bname = bname.substring(0, 11) + '..';
      canvas.drawText({
        text: bname, x: this.ox + BEST_X + 2, y: by + 36, fontSize: 10, color: '#000000',
      });
      const priced = (this._allCommodities || []).find((c: any) => c.itemId === best.itemId);
      canvas.drawText({
        text: priced ? `${priced.price.toLocaleString()} NX` : `x${best.count}`,
        x: this.ox + BEST_X + 96, y: by + 52, fontSize: 10, color: '#FFE65C', align: 'right',
      });
    }

    // NX balance, right-aligned on the baked "NX Credit" dotted row
    const inv = (window as any).charecter?.inventory;
    canvas.drawText({
      text: (inv?.nx ?? 0).toLocaleString(),
      x: this.ox + NX_TEXT_X, y: this.oy + NX_TEXT_Y,
      fontSize: 11, color: '#000000', align: 'right',
    });

    // The shop's own buttons — ClickManager only handles their clicks;
    // drawing is the owner's job, same as ShopUI
    for (const btn of this.buttons) {
      btn.draw(canvas, { x: 0, y: 0 } as CameraInterface, 0, 16, 0);
    }

    // Hover tooltip (skip while the dialog is up)
    if (this._hoverItem && !this._confirm) this.drawTooltip(canvas);

    // Confirm dialog on top
    if (this._confirm) this.drawConfirm(canvas);
  },

  _scroll: null as any,

  /**
   * Slim VScr4 scroller for the left-column inventories. Arrow clicks step
   * a row; the whole thing draws disabled when there is nothing to scroll.
   */
  drawMiniScroll(
    canvas: GameCanvas, x: number, top: number, height: number,
    scrollable: boolean, offset: number, maxOffset: number,
    onStep?: (dir: number) => void
  ) {
    const s = this._scroll;
    if (!s) return;
    const arrowH = 13;
    const bottom = top + height - arrowH;
    const prev = scrollable ? s.prev : s.prevDis;
    const next = scrollable ? s.next : s.nextDis;
    const base = scrollable ? s.base : s.baseDis;
    if (base?.complete) {
      for (let ty = top + arrowH; ty < bottom; ty += base.height) {
        canvas.drawImage({ img: base, dx: x, dy: ty });
      }
    }
    if (prev?.complete) canvas.drawImage({ img: prev, dx: x, dy: top });
    if (next?.complete) canvas.drawImage({ img: next, dx: x, dy: bottom });
    if (scrollable && s.thumb?.complete && maxOffset > 0) {
      const travel = bottom - (top + arrowH) - s.thumb.height;
      canvas.drawImage({
        img: s.thumb, dx: x,
        dy: top + arrowH + Math.round(travel * (offset / maxOffset)),
      });
    }
    if (scrollable && onStep && (canvas as any).wasClicked && !this._confirm) {
      const mx = canvas.mouseX;
      const my = canvas.mouseY;
      if (mx >= x && mx <= x + 13) {
        if (my >= top && my <= top + arrowH) onStep(-1);
        else if (my >= bottom && my <= bottom + arrowH) onStep(1);
      }
    }
  },

  /**
   * GMS pagination — "1 | 2 | 3" centered under the grid. Long tabs show a
   * sliding window of ten page numbers with < > to move between windows.
   */
  drawPagination(canvas: GameCanvas) {
    const pages = Math.ceil(this.items.length / PAGE_SIZE);
    if (pages <= 1) return;
    const ctx = canvas.context;
    const y = this.oy + 507;
    const centerX = this.ox + 482;
    const page = this.scrollOffset;
    const winStart = Math.floor(page / 10) * 10;
    const winEnd = Math.min(pages, winStart + 10);

    // Build segments: [<] n | n | n [>]
    const parts: { label: string; page: number | null; bold: boolean }[] = [];
    if (winStart > 0) parts.push({ label: '<', page: winStart - 1, bold: false });
    for (let pIdx = winStart; pIdx < winEnd; pIdx++) {
      if (parts.length) parts.push({ label: '|', page: null, bold: false });
      parts.push({ label: String(pIdx + 1), page: pIdx, bold: pIdx === page });
    }
    if (winEnd < pages) parts.push({ label: '>', page: winEnd, bold: false });

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    let total = 0;
    const widths = parts.map((seg) => {
      ctx.font = (seg.bold ? 'bold ' : '') + '11px Arial';
      const w = ctx.measureText(seg.label).width + 6;
      total += w;
      return w;
    });
    let x = centerX - total / 2;
    const clicked = (canvas as any).wasClicked && !this._confirm;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      ctx.font = (seg.bold ? 'bold ' : '') + '11px Arial';
      ctx.fillStyle = seg.bold ? '#FFFFFF' : seg.page === null ? '#8FA6C8' : '#C9D9F0';
      ctx.fillText(seg.label, x + 3, y);
      if (
        seg.page !== null && clicked &&
        canvas.mouseX >= x && canvas.mouseX <= x + widths[i] &&
        canvas.mouseY >= y - 3 && canvas.mouseY <= y + 15
      ) {
        this.scrollOffset = seg.page;
      }
      x += widths[i];
    }
    ctx.restore();
  },

  drawTooltip(canvas: GameCanvas) {
    const item = this._hoverItem;
    if (!item) return;
    const name = getItemNameSync(item.itemId) || `Item #${item.itemId}`;
    const desc = (getItemDescSync(item.itemId) || '').replace(/\\n/g, ' ').replace(/#c|#/g, '');
    const duration = item.period > 0 ? `Duration: ${item.period} days` : 'Permanent';

    const ctx = canvas.context;
    ctx.save();
    ctx.font = '11px Arial';
    const lines = [name, duration];
    if (desc) {
      // naive wrap at ~34 chars, max 4 lines
      for (let i = 0; i < desc.length && lines.length < 6; i += 34) {
        lines.push(desc.substring(i, i + 34));
      }
    }
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const h = lines.length * 14 + 12;
    let tx = this._hoverX + 14;
    let ty = this._hoverY + 14;
    if (tx + w > canvas.game.width) tx = this._hoverX - w - 4;
    if (ty + h > canvas.game.height) ty = this._hoverY - h - 4;

    // Classic dark tooltip plate (matches the inventory tooltip treatment)
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#000033';
    ctx.fillRect(tx, ty, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#8888AA';
    ctx.strokeRect(tx + 0.5, ty + 0.5, w - 1, h - 1);
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? '#FFFFFF' : i === 1 ? '#FFAA00' : '#CCCCCC';
      ctx.font = i === 0 ? 'bold 11px Arial' : '11px Arial';
      ctx.fillText(line, tx + 8, ty + 6 + i * 14);
    });
    ctx.restore();
  },

  drawConfirm(canvas: GameCanvas) {
    const item = this._confirm;
    if (!item) return;
    const dw = this.noticeBg?.width ?? 266;
    const dh = this.noticeBg?.height ?? 142;
    const dx = Math.floor((Config.width - dw) / 2);
    const dy = Math.floor((Config.height - dh) / 2);

    if (this.noticeBg) {
      canvas.drawImage({ img: this.noticeBg, dx, dy });
    }
    const name = getItemNameSync(item.itemId) || `Item #${item.itemId}`;
    canvas.drawText({
      text: 'Purchase this item?', x: dx + dw / 2, y: dy + 30,
      fontSize: 12, color: '#000000', align: 'center', fontWeight: 'bold',
    });
    canvas.drawText({
      text: name, x: dx + dw / 2, y: dy + 52, fontSize: 12, color: '#0033BB', align: 'center',
    });
    canvas.drawText({
      text: `${item.price.toLocaleString()} NX` +
        (item.period > 0 ? `  ·  usable for ${item.period} days` : ''),
      x: dx + dw / 2, y: dy + 72, fontSize: 11, color: '#000000', align: 'center',
    });

    for (const btn of this.dialogButtons) {
      btn.draw(canvas, { x: 0, y: 0 } as CameraInterface, 0, 16, 0);
    }
  },
};

export default CashShopUI;
