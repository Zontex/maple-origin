import WZManager from '../wz-utils/WZManager';
import GUIUtil from '../GuiUtils';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import ClickManager from './ClickManager';
import { MapleStanceButton } from './MapleStanceButton';
import { ensureItemNames, getItemNameSync } from '../Quest/QuestData';
import Item from '../Inventory/Item';
import ItemConstants from '../Constants/Inventory/ItemConstants';
import { MapleInventoryType } from '../Constants/Inventory/MapleInventory';
import UIMesoDropDialog from './UIMesoDropDialog';
import UIChatLog from './UIChatLog';
import Config from '../Config';
import { drawItemHoverTooltip } from './UIItemHoverTooltip';
import StorageManager, { StorageEntry, StorageError } from '../Storage/StorageManager';

/**
 * The Storage Keeper window — `UI.wz/UIWindow.img/Trunk`.
 *
 * One 463x318 background holding two panes. Left: the trunk — the keeper
 * stands on the baked shadow, EXIT / TAKE OUT / ARRANGE ITEM stacked beside
 * them, every stored stack in one five-row list (a slot is a slot whatever
 * the tab), the trunk's mesos in the bottom box with the take-out coin
 * button. Right: the character on their shadow, STORE, the five inventory
 * tabs on the red-lined strip, four rows of the chosen tab, the character's
 * mesos with the put-in coin button. Orange `select` marks the chosen row;
 * `en` is the enabled-slot plate drawn over every slot the trunk owns.
 *
 * Measured off the backgrnd (per-row brightness scan): left rows at y=87,
 * right rows at y=127, both on a 40px pitch with 35px strips; a row is the
 * 35px icon cell at x+6 and the 162px strip at x+43 (exactly `select`),
 * scrollbar column at x+211; right pane offset 230; meso boxes x+43..194,
 * y=296..309; red tab line at y=116.
 */

const BG_W = 463;
const BG_H = 318;
const ROW_H = 40;          // row pitch — strips are 35 tall with a 5px seam
const STRIP_H = 35;
const PANEL_RIGHT_OFF = 230;
const LEFT_LIST_Y = 87;
const LEFT_ROWS = 5;
const RIGHT_LIST_Y = 127;
const RIGHT_ROWS = 4;
const ROW_X = 6;           // icon cell x+6..40
const CELL_SIZE = 35;
const ICON_CENTER_X = 23;
const ICON_BOTTOM_Y = 31;  // bottom on the cell's baked shadow
const STRIP_X = 43;        // name strip x+43..204 (= select)
const SCROLL_X = 211;
const ICON_SIZE = 32;
const TAB_STRIP_BOTTOM = 116;
const TAB_X = 9;
const TAB_GAP = 2;
const BTN_X = 155;
const EXIT_Y = 16;
const GET_Y = 36;
const SORT_Y = 56;
const PUT_Y = 16;
const COIN_X = 3;
const COIN_Y = 293;
const MESO_TEXT_X = 193;
const MESO_TEXT_Y = 297;
const SHADOW_X = 55;
const BASELINE_Y = 76;
const DOUBLE_CLICK_MS = 400;

const TAB_TYPES: MapleInventoryType[] = [
  MapleInventoryType.EQUIP, MapleInventoryType.USE, MapleInventoryType.SETUP,
  MapleInventoryType.ETC, MapleInventoryType.CASH,
];

const ERROR_TEXT: Record<StorageError, string[]> = {
  full: ['The storage is full.'],
  inventory_full: ['Please check if your inventory', 'is full or not.'],
  mesos: ["You don't have enough mesos."],
  untradeable: ['This item cannot be stored.'],
  one_of_a_kind: ['You can only have one of this item.'],
  not_found: ['The item is no longer in storage.'],
  offline: ['The storage is unavailable right now.'],
  invalid: ['The storage is unavailable right now.'],
};

interface InvRow {
  item: Item;
  tab: MapleInventoryType;
  slot: number;
  itemId: number;
  name: string;
  quantity: number;
  icon: HTMLImageElement | null;
  equipData?: any;
}

interface TrunkRow {
  entry: StorageEntry;
  itemId: number;
  name: string;
  quantity: number;
  equipData?: any;
}

const UIStorage: any = {
  isVisible: false,
  loaded: false,
  npcId: 0,

  trunkRows: [] as TrunkRow[],
  invRows: [] as InvRow[],
  tab: 0,
  trunkSel: -1,
  trunkScroll: 0,
  invSel: -1,
  invScroll: 0,
  focusPanel: 'trunk' as 'trunk' | 'inv',
  _prevUp: false,
  _prevDown: false,
  _hoverItem: null as any,
  _hoverY: 0,
  _busy: false,
  _mapId: null as any,
  _invRefreshAt: 0,
  _unsubscribe: null as null | (() => void),

  trunkNode: null as any,
  backgrndImg: null as HTMLImageElement | null,
  selectImg: null as HTMLImageElement | null,
  enImg: null as HTMLImageElement | null,
  _tabPlateOn: null as HTMLImageElement | null,
  _tabPlateOff: null as HTMLImageElement | null,
  _tabOn: [] as (HTMLImageElement | null)[],
  _tabOff: [] as (HTMLImageElement | null)[],
  _itemNoDigits: [] as HTMLImageElement[],
  _scroll: null as any,
  _iconCache: new Map<number, HTMLImageElement | null>(),

  npcSprite: null as HTMLImageElement | null,
  npcFlipped: false,
  npcOrigin: { x: 0, y: 0 },

  buttons: [] as MapleStanceButton[],
  buttonsRegistered: false,
  x: 0,
  y: 0,
  canvas: null as GameCanvas | null,

  _dialog: null as any,
  _dialogReady: null as Promise<void> | null,
  _lastClickPanel: '',
  _lastClickIdx: -1,
  _lastClickTime: 0,

  // ------------------------------------------------------------ lifecycle

  async show(npcId: number) {
    if (this.isVisible) this.hide();
    this.npcId = npcId;
    this.tab = 0;
    this.trunkSel = -1;
    this.trunkScroll = 0;
    this.invSel = -1;
    this.invScroll = 0;
    this.focusPanel = 'trunk';
    this.trunkRows = [];
    this.invRows = [];
    this.npcSprite = null;
    this._busy = false;
    const worldNpcs = (window as any).__MapleMap?.npcs || [];
    this.npcFlipped = !!worldNpcs.find((n: any) => n.id === npcId)?.flipped;
    this._mapId = (window as any).__MapleMap?.id ?? null;

    if (!this.loaded) await this.loadAssets();
    this.x = Math.floor((Config.width - BG_W) / 2);
    this.y = Math.floor((Config.height - BG_H) / 2);

    await ensureItemNames();
    void this.loadNpcSprite(npcId);

    const ok = await StorageManager.open(npcId);
    if (!ok) {
      UIChatLog.notice('The storage is unavailable right now.');
      return;
    }
    this._unsubscribe = StorageManager.onChange(() => this.refreshTrunkRows());
    this.refreshTrunkRows();
    this.refreshInvRows();
    this.isVisible = true;
    this.buttonsRegistered = false;
  },

  hide() {
    this.isVisible = false;
    this.unregisterButtons();
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
    if (this._dialog && !this._dialog.isHidden) this._dialog.hide();
    StorageManager.close();
  },

  /** ESC — a pending prompt closes first, the next press leaves. */
  escape() {
    if (this._dialog && !this._dialog.isHidden) { this._dialog.hide(); return; }
    this.hide();
  },

  async loadAssets() {
    try {
      this.trunkNode = await WZManager.get('UI.wz/UIWindow.img/Trunk');
      this.backgrndImg = this.trunkNode?.backgrnd?.nGetImage?.() || null;
      this.selectImg = this.trunkNode?.select?.nGetImage?.() || null;
      this.enImg = this.trunkNode?.en?.nGetImage?.() || null;
      this._tabOn = [];
      this._tabOff = [];
      for (let i = 0; i < 5; i++) {
        this._tabOn[i] = this.trunkNode?.Tab?.enabled?.[i]?.nGetImage?.() || null;
        this._tabOff[i] = this.trunkNode?.Tab?.disabled?.[i]?.nGetImage?.() || null;
      }
      // The Trunk ships label text only; the plates are the inventory's
      // shared set, like the shop and skill windows
      const newNode: any = await WZManager.get('UI.wz/UIWindow.img/Item/New');
      this._tabPlateOn = newNode?.nGet('Tab1')?.nGet('0')?.nGetImage?.() || null;
      this._tabPlateOff = newNode?.nGet('Tab0')?.nGet('0')?.nGetImage?.() || null;

      const basic: any = await WZManager.get('UI.wz/Basic.img');
      this._itemNoDigits = [];
      const itemNo = basic?.nGet?.('ItemNo');
      for (let i = 0; i <= 9; i++) {
        const d = itemNo?.nGet?.(`${i}`);
        if (d?.nGetImage) this._itemNoDigits[i] = d.nGetImage();
      }
      const vscr = basic?.nGet?.('VScr4');
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
      this.loaded = true;
    } catch (e) {
      console.error('Failed to load storage UI assets:', e);
    }
  },

  async loadNpcSprite(npcId: number) {
    try {
      const strId = `${npcId}`.padStart(7, '0');
      let npcFile: any = await WZManager.get(`Npc.wz/${strId}.img`);
      if (npcFile?.info?.link) {
        const linkId = npcFile.info.link.nValue;
        npcFile = await WZManager.get(`Npc.wz/${`${linkId}`.padStart(7, '0')}.img`);
      }
      const standFrame = npcFile?.stand?.[0];
      this.npcSprite = standFrame?.nGetImage?.() || null;
      this.npcOrigin = { x: standFrame?.origin?.nX ?? 0, y: standFrame?.origin?.nY ?? 0 };
    } catch { /* ignore */ }
  },

  // ------------------------------------------------------------------ data

  refreshTrunkRows() {
    this.trunkRows = StorageManager.items.map((entry: StorageEntry) => {
      this.ensureIcon(entry.itemId);
      return {
        entry,
        itemId: entry.itemId,
        name: getItemNameSync(entry.itemId) || `Item #${entry.itemId}`,
        quantity: entry.quantity,
        equipData: entry.equipData,
      } as TrunkRow;
    });
    if (this.trunkSel >= this.trunkRows.length) this.trunkSel = this.trunkRows.length - 1;
    const maxScroll = Math.max(0, Math.max(this.trunkRows.length, StorageManager.slots) - LEFT_ROWS);
    this.trunkScroll = Math.max(0, Math.min(maxScroll, this.trunkScroll));
  },

  refreshInvRows() {
    const inv = (window as any).charecter?.inventory;
    this.invRows = [];
    if (!inv) return;
    const tab = TAB_TYPES[this.tab];
    const arr: Item[] = [inv.equip, inv.use, inv.setup, inv.etc, inv.cash][this.tab] || [];
    for (let slot = 0; slot < arr.length; slot++) {
      const item = arr[slot];
      if (!item) continue;
      this.invRows.push({
        item, tab, slot,
        itemId: item.itemId,
        name: getItemNameSync(item.itemId) || `Item #${item.itemId}`,
        quantity: item.quantity,
        icon: this.iconOf(item),
        equipData: item.equipData ?? undefined,
      });
    }
    if (this.invSel >= this.invRows.length) this.invSel = this.invRows.length - 1;
    const maxScroll = Math.max(0, this.invRows.length - RIGHT_ROWS);
    this.invScroll = Math.max(0, Math.min(maxScroll, this.invScroll));
  },

  iconOf(item: any): HTMLImageElement | null {
    const node = item?.equipData?.dead
      ? (item.node?.info?.iconRawD ?? item.node?.info?.iconD)
      : (item?.node?.info?.iconRaw ?? item?.node?.info?.icon ?? item?.node?.iconRaw ?? item?.node?.icon);
    return node?.nGetImage?.() || null;
  },

  /** Storage entries have no live Item — icons come from a per-id cache. */
  ensureIcon(itemId: number) {
    if (this._iconCache.has(itemId)) return;
    this._iconCache.set(itemId, null);
    Item.fromOpts({ itemId, quantity: 1 }).then((it) => {
      this._iconCache.set(itemId, this.iconOf(it));
    }).catch(() => { /* keep the empty cell */ });
  },

  // --------------------------------------------------------------- buttons

  registerButtons() {
    this.unregisterButtons();
    if (!this.trunkNode || !this.canvas) return;
    const canvas = this.canvas;
    const add = (name: string, x: number, y: number, onClick: () => void) => {
      const node = this.trunkNode[name];
      if (!node) return;
      const btn = new MapleStanceButton(canvas, {
        x: this.x + x, y: this.y + y,
        img: node.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick,
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    };
    add('BtExit', BTN_X, EXIT_Y, () => this.hide());
    add('BtGet', BTN_X, GET_Y, () => void this.onTakeOut());
    add('BtSort', BTN_X, SORT_Y, () => void this.onArrange());
    add('BtPut', PANEL_RIGHT_OFF + BTN_X, PUT_Y, () => void this.onStore());
    add('BtOutCoin', COIN_X, COIN_Y, () => void this.onMesos(false));
    add('BtInCoin', PANEL_RIGHT_OFF + COIN_X, COIN_Y, () => void this.onMesos(true));
  },

  unregisterButtons() {
    for (const btn of this.buttons) ClickManager.removeButton(btn);
    this.buttons = [];
  },

  async getDialog() {
    if (!this._dialog) {
      this._dialog = new UIMesoDropDialog({ canvas: this.canvas });
      this._dialogReady = this._dialog.load();
    }
    if (this._dialogReady) await this._dialogReady;
    return this._dialog;
  },

  async showError(error: StorageError | undefined) {
    const dialog = await this.getDialog();
    dialog.showMessage(ERROR_TEXT[error || 'invalid']);
  },

  // --------------------------------------------------------------- actions

  async onStore() {
    if (this._busy || this.invSel < 0) return;
    const row: InvRow | undefined = this.invRows[this.invSel];
    if (!row) return;
    const stackable = row.quantity > 1 && !ItemConstants.isRechargeable(row.itemId);
    if (!stackable) {
      await this.doStore(row, row.quantity);
      return;
    }
    const dialog = await this.getDialog();
    dialog.show(row.quantity, (amount: number) => { void this.doStore(row, amount); }, 'item', row.name, 'store');
  },

  async doStore(row: InvRow, amount: number) {
    if (this._busy) return;
    this._busy = true;
    try {
      const res = await StorageManager.store(row.tab, row.slot, amount);
      if (!res.ok) await this.showError(res.error);
    } finally {
      this._busy = false;
      this.refreshInvRows();
      this.refreshTrunkRows();
    }
  },

  async onTakeOut() {
    if (this._busy || this.trunkSel < 0) return;
    const row: TrunkRow | undefined = this.trunkRows[this.trunkSel];
    if (!row) return;
    this._busy = true;
    try {
      const res = await StorageManager.takeOut(row.entry);
      if (!res.ok) await this.showError(res.error);
    } finally {
      this._busy = false;
      this.refreshInvRows();
      this.refreshTrunkRows();
    }
  },

  async onArrange() {
    if (this._busy) return;
    this._busy = true;
    try {
      const res = await StorageManager.arrange();
      if (!res.ok) await this.showError(res.error);
    } finally {
      this._busy = false;
      this.trunkSel = -1;
      this.refreshTrunkRows();
    }
  },

  /** Coin buttons — "How many mesos would you like to save / take out?" */
  async onMesos(deposit: boolean) {
    if (this._busy) return;
    const max = deposit ? StorageManager.maxDeposit() : StorageManager.maxWithdraw();
    const dialog = await this.getDialog();
    if (max <= 0) {
      dialog.showMessage(deposit ? ["You don't have enough mesos."] : ['There are no mesos in storage.']);
      return;
    }
    dialog.show(max, (amount: number) => {
      void (async () => {
        this._busy = true;
        try {
          const res = await StorageManager.moveMesos(deposit ? amount : -amount);
          if (!res.ok) await this.showError(res.error);
        } finally {
          this._busy = false;
        }
      })();
    }, 'meso', '', deposit ? 'save' : 'take out');
  },

  // ------------------------------------------------------------- rendering

  update(_msPerTick: number) {
    if (!this.isVisible) return;
    // Walking through a portal leaves the keeper behind
    const mapId = (window as any).__MapleMap?.id ?? null;
    if (mapId !== this._mapId) { this.hide(); return; }
    // Potions drunk, drops picked up — the bag changes under the window
    const now = Date.now();
    if (now - this._invRefreshAt > 500) {
      this._invRefreshAt = now;
      this.refreshInvRows();
    }
    if (this._dialog && !this._dialog.isHidden) this._dialog.update(_msPerTick);
  },

  render(canvas: GameCanvas, camera: CameraInterface) {
    if (!this.isVisible) return;
    this.canvas = canvas;
    if (!this.buttonsRegistered) {
      this.registerButtons();
      this.buttonsRegistered = true;
    }

    if (this.backgrndImg) canvas.drawImage({ img: this.backgrndImg, dx: this.x, dy: this.y });

    this.drawPortraits(canvas);
    this.drawTabs(canvas);

    this._hoverItem = null;
    this.drawTrunkPanel(canvas);
    this.drawInvPanel(canvas);
    this.drawMesos(canvas);

    for (const btn of this.buttons) btn.draw(canvas, camera, 0, 0, 0);

    drawItemHoverTooltip(canvas, this._hoverItem, this.x, BG_W, this._hoverY);

    if (this._dialog && !this._dialog.isHidden) {
      this._dialog.draw(canvas, camera, 0, 0, 0);
    }

    this.handleArrowKeys(canvas);
    if ((canvas as any).wasClicked) {
      this.handleClick((canvas as any).mouseX || 0, (canvas as any).mouseY || 0);
    }
    const scrollDir = (canvas as any).scrolledDown ? 1 : (canvas as any).scrolledUp ? -1 : 0;
    if (scrollDir !== 0) {
      const mx = (canvas as any).mouseX || 0;
      if (mx < this.x + PANEL_RIGHT_OFF) this.scrollTrunk(scrollDir);
      else this.scrollInv(scrollDir);
    }
  },

  drawPortraits(canvas: GameCanvas) {
    const baselineY = this.y + BASELINE_Y;
    if (this.npcSprite && this.npcSprite.complete && this.npcSprite.naturalWidth > 0) {
      const w = this.npcSprite.width;
      const ox = this.npcOrigin.x || Math.floor(w / 2);
      const oy = this.npcOrigin.y || this.npcSprite.height;
      const flip = !!this.npcFlipped;
      canvas.drawImage({
        img: this.npcSprite,
        dx: this.x + SHADOW_X - (flip ? w - ox : ox),
        dy: baselineY - oy,
        flipped: flip,
      });
    }
    const character = (window as any).charecter;
    if (character) {
      const standStance = character.weaponStandType === 2 ? 'stand2' : 'stand1';
      const frames = character.getDrawableFrames?.(standStance, 0, false);
      if (frames) {
        const px = this.x + PANEL_RIGHT_OFF + SHADOW_X;
        for (const frame of frames) {
          if (frame.img && frame.img.complete && frame.img.naturalWidth > 0) {
            canvas.drawImage({ img: frame.img, dx: px + (frame.x || 0), dy: baselineY + (frame.y || 0) });
          }
        }
      }
    }
  },

  // Plates hang from the red line like the shop's sell tabs; the selected
  // plate is a pixel taller, so both are bottom-aligned to the line.
  drawTabs(canvas: GameCanvas) {
    let sx = this.x + PANEL_RIGHT_OFF + TAB_X;
    for (let i = 0; i < 5; i++) {
      const active = i === this.tab;
      const plate = active ? this._tabPlateOn : this._tabPlateOff;
      const label = active ? this._tabOn[i] : this._tabOff[i];
      const plateW = plate?.width || 34;
      const plateH = plate?.height || 18;
      const plateY = this.y + TAB_STRIP_BOTTOM - plateH;
      if (plate?.complete) canvas.drawImage({ img: plate, dx: sx, dy: plateY });
      if (label?.complete && label.naturalWidth > 0) {
        canvas.drawImage({
          img: label,
          dx: sx + Math.round((plateW - label.width) / 2),
          dy: plateY + Math.round((plateH - label.height) / 2),
        });
      }
      sx += plateW + TAB_GAP;
    }
  },

  drawTrunkPanel(canvas: GameCanvas) {
    const panelX = this.x;
    const listY = this.y + LEFT_LIST_Y;
    const slots = StorageManager.slots;
    for (let r = 0; r < LEFT_ROWS; r++) {
      const i = this.trunkScroll + r;
      const rowY = listY + r * ROW_H;
      // Every slot the trunk owns wears the enabled plate; anything past the
      // capacity keeps the background's greyed row
      if (i < slots && this.enImg?.complete) {
        canvas.drawImage({ img: this.enImg, dx: panelX + ROW_X, dy: rowY });
      }
      const row: TrunkRow | undefined = this.trunkRows[i];
      if (!row) continue;
      this.drawRow(canvas, panelX, rowY, row, this._iconCache.get(row.itemId) || null, i === this.trunkSel);
    }
    const total = Math.max(this.trunkRows.length, slots);
    this.drawScrollbar(canvas, panelX, listY, LEFT_ROWS, total, this.trunkScroll);
  },

  drawInvPanel(canvas: GameCanvas) {
    const panelX = this.x + PANEL_RIGHT_OFF;
    const listY = this.y + RIGHT_LIST_Y;
    for (let r = 0; r < RIGHT_ROWS; r++) {
      const i = this.invScroll + r;
      const row: InvRow | undefined = this.invRows[i];
      if (!row) continue;
      this.drawRow(canvas, panelX, listY + r * ROW_H, row, row.icon, i === this.invSel);
    }
    this.drawScrollbar(canvas, panelX, listY, RIGHT_ROWS, this.invRows.length, this.invScroll);
  },

  drawRow(canvas: GameCanvas, panelX: number, rowY: number, row: any, icon: HTMLImageElement | null, selected: boolean) {
    const mx = (canvas as any).mouseX || 0;
    const my = (canvas as any).mouseY || 0;
    if (mx >= panelX + ROW_X && mx < panelX + SCROLL_X && my >= rowY && my < rowY + STRIP_H) {
      this._hoverItem = row;
      this._hoverY = rowY;
    }

    if (selected && this.selectImg?.complete && this.selectImg.naturalWidth > 0) {
      canvas.drawImage({ img: this.selectImg, dx: panelX + STRIP_X, dy: rowY });
    }

    if (icon && icon.complete && icon.naturalWidth > 0) {
      let iw = icon.width;
      let ih = icon.height;
      if (iw > ICON_SIZE || ih > ICON_SIZE) {
        const scale = Math.min(ICON_SIZE / iw, ICON_SIZE / ih);
        iw = Math.floor(iw * scale);
        ih = Math.floor(ih * scale);
      }
      canvas.context.drawImage(icon, panelX + ICON_CENTER_X - Math.floor(iw / 2), rowY + ICON_BOTTOM_Y - ih, iw, ih);
    }

    // Stack count — sprite digits at the cell's bottom-right, as the bag does
    if (row.quantity > 1 && Math.floor(row.itemId / 1000000) !== 1 && this._itemNoDigits.length) {
      const digitH = this._itemNoDigits[0]?.height || 11;
      const digits = `${row.quantity}`;
      let totalW = 0;
      for (const d of digits) totalW += this._itemNoDigits[parseInt(d)]?.width || 6;
      let dx = panelX + ROW_X + CELL_SIZE - totalW - 2;
      const dy = rowY + CELL_SIZE - digitH - 2;
      for (const d of digits) {
        const digitImg = this._itemNoDigits[parseInt(d)];
        if (digitImg) {
          canvas.drawImage({ img: digitImg, dx, dy });
          dx += digitImg.width;
        }
      }
    }

    canvas.drawText({
      text: this.fitText(canvas, row.name, 150),
      color: '#000000',
      x: panelX + STRIP_X + 8, y: rowY + 5, fontSize: 11,
    });
  },

  fitText(canvas: GameCanvas, text: string, maxW: number): string {
    const ctx = canvas.context;
    ctx.save();
    ctx.font = '11px Arial';
    let out = text;
    if (ctx.measureText(out).width > maxW) {
      while (out.length > 1 && ctx.measureText(out + '..').width > maxW) out = out.slice(0, -1);
      out += '..';
    }
    ctx.restore();
    return out;
  },

  drawMesos(canvas: GameCanvas) {
    canvas.drawText({
      text: StorageManager.mesos.toLocaleString(),
      color: '#000000', x: this.x + MESO_TEXT_X, y: this.y + MESO_TEXT_Y, fontSize: 11, align: 'right',
    });
    const inv = (window as any).charecter?.inventory;
    if (inv) {
      canvas.drawText({
        text: inv.mesos.toLocaleString(),
        color: '#000000', x: this.x + PANEL_RIGHT_OFF + MESO_TEXT_X, y: this.y + MESO_TEXT_Y, fontSize: 11, align: 'right',
      });
    }
  },

  drawScrollbar(canvas: GameCanvas, panelX: number, top: number, visibleRows: number, itemCount: number, scrollOffset: number) {
    const s = this._scroll;
    if (!s) return;
    const sx = panelX + SCROLL_X;
    const trackH = visibleRows * ROW_H - (ROW_H - STRIP_H);
    const arrowH = 13;
    const bottom = top + trackH - arrowH;
    const scrollable = itemCount > visibleRows;
    const prev = scrollable ? s.prev : s.prevDis;
    const next = scrollable ? s.next : s.nextDis;
    const base = scrollable ? s.base : s.baseDis;
    if (base?.complete) {
      const ctx = canvas.context;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, top + arrowH, base.width, bottom - (top + arrowH));
      ctx.clip();
      GUIUtil.tileRange(top + arrowH, bottom, base.height, (ty: number) => {
        canvas.drawImage({ img: base, dx: sx, dy: ty });
      });
      ctx.restore();
    }
    if (prev?.complete) canvas.drawImage({ img: prev, dx: sx, dy: top });
    if (next?.complete) canvas.drawImage({ img: next, dx: sx, dy: bottom });
    if (scrollable && s.thumb?.complete) {
      const travel = bottom - (top + arrowH) - s.thumb.height;
      const maxOffset = itemCount - visibleRows;
      const ty = top + arrowH + Math.round(travel * (scrollOffset / maxOffset));
      canvas.drawImage({ img: s.thumb, dx: sx, dy: ty });
    }
  },

  // ----------------------------------------------------------------- input

  scrollTrunk(dir: number) {
    const total = Math.max(this.trunkRows.length, StorageManager.slots);
    const max = Math.max(0, total - LEFT_ROWS);
    this.trunkScroll = Math.max(0, Math.min(max, this.trunkScroll + dir));
  },

  scrollInv(dir: number) {
    const max = Math.max(0, this.invRows.length - RIGHT_ROWS);
    this.invScroll = Math.max(0, Math.min(max, this.invScroll + dir));
  },

  handleArrowKeys(canvas: GameCanvas) {
    if (this._dialog && !this._dialog.isHidden) return;
    const up = canvas.isKeyDown('up');
    const down = canvas.isKeyDown('down');
    const stepUp = up && !this._prevUp;
    const stepDown = down && !this._prevDown;
    this._prevUp = up;
    this._prevDown = down;
    if (!stepUp && !stepDown) return;

    const trunk = this.focusPanel === 'trunk';
    const rows = trunk ? this.trunkRows : this.invRows;
    const visible = trunk ? LEFT_ROWS : RIGHT_ROWS;
    if (rows.length === 0) return;
    let idx = trunk ? this.trunkSel : this.invSel;
    idx = idx < 0 ? 0 : idx + (stepDown ? 1 : -1);
    idx = Math.max(0, Math.min(rows.length - 1, idx));
    let off = trunk ? this.trunkScroll : this.invScroll;
    if (idx < off) off = idx;
    else if (idx >= off + visible) off = idx - visible + 1;
    if (trunk) { this.trunkSel = idx; this.trunkScroll = off; }
    else { this.invSel = idx; this.invScroll = off; }
  },

  handleClick(mx: number, my: number) {
    if (!this.isVisible) return;
    if (this._dialog && !this._dialog.isHidden) return;

    // Inventory tabs
    {
      const plateW = this._tabPlateOn?.width || 34;
      const plateH = this._tabPlateOn?.height || 19;
      const tabTop = this.y + TAB_STRIP_BOTTOM - plateH;
      if (my >= tabTop && my < this.y + TAB_STRIP_BOTTOM) {
        const sx = this.x + PANEL_RIGHT_OFF + TAB_X;
        for (let i = 0; i < 5; i++) {
          const tx = sx + i * (plateW + TAB_GAP);
          if (mx >= tx && mx < tx + plateW) {
            if (this.tab !== i) {
              this.tab = i;
              this.invSel = -1;
              this.invScroll = 0;
              this.refreshInvRows();
            }
            return;
          }
        }
      }
    }

    const arrowH = 13;
    const panels: { key: 'trunk' | 'inv'; panelX: number; listY: number; rows: number; items: any[] }[] = [
      { key: 'trunk', panelX: this.x, listY: this.y + LEFT_LIST_Y, rows: LEFT_ROWS, items: this.trunkRows },
      { key: 'inv', panelX: this.x + PANEL_RIGHT_OFF, listY: this.y + RIGHT_LIST_Y, rows: RIGHT_ROWS, items: this.invRows },
    ];
    for (const p of panels) {
      const listH = p.rows * ROW_H - (ROW_H - STRIP_H);
      // Scrollbar arrows
      const sx = p.panelX + SCROLL_X;
      if (mx >= sx && mx < sx + 15 && my >= p.listY && my < p.listY + listH) {
        if (my < p.listY + arrowH) { p.key === 'trunk' ? this.scrollTrunk(-1) : this.scrollInv(-1); }
        else if (my >= p.listY + listH - arrowH) { p.key === 'trunk' ? this.scrollTrunk(1) : this.scrollInv(1); }
        return;
      }
      // Rows — double-click moves the stack
      if (mx >= p.panelX + ROW_X && mx < sx && my >= p.listY && my < p.listY + listH) {
        const offset = p.key === 'trunk' ? this.trunkScroll : this.invScroll;
        const idx = Math.floor((my - p.listY) / ROW_H) + offset;
        this.focusPanel = p.key;
        const inSeam = (my - p.listY) % ROW_H >= STRIP_H;
        if (inSeam || idx < 0 || idx >= p.items.length) {
          if (p.key === 'trunk') this.trunkSel = -1; else this.invSel = -1;
          return;
        }
        if (p.key === 'trunk') this.trunkSel = idx; else this.invSel = idx;
        const now = Date.now();
        if (this._lastClickPanel === p.key && this._lastClickIdx === idx && now - this._lastClickTime < DOUBLE_CLICK_MS) {
          this._lastClickIdx = -1;
          this._lastClickTime = 0;
          if (p.key === 'trunk') void this.onTakeOut(); else void this.onStore();
        } else {
          this._lastClickPanel = p.key;
          this._lastClickIdx = idx;
          this._lastClickTime = now;
        }
        return;
      }
    }
  },
};

// Dev-console access to the live instance (HMR re-imports create copies)
(window as any).__UIStorage = UIStorage;

export default UIStorage;
