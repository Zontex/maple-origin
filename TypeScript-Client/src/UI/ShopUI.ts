import WZManager from '../wz-utils/WZManager';
import GUIUtil from '../GuiUtils';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import ClickManager from './ClickManager';
import { MapleStanceButton } from './MapleStanceButton';
import { getShopInfo, getItemSellPrice, getItemUnitPrice, getItemSlotMax, ShopItem } from '../Shop/ShopData';
import { ensureItemNames, getItemNameSync, getItemDescSync } from '../Quest/QuestData';
import UIEquipTooltip from './UIEquipTooltip';
import Item from '../Inventory/Item';
import ItemConstants from '../Constants/Inventory/ItemConstants';
import UIMesoDropDialog from './UIMesoDropDialog';
import Config from '../Config';

interface LoadedShopItem {
  itemId: number;
  name: string;
  price: number;
  icon: HTMLImageElement | null;
}

interface LoadedPlayerItem {
  itemId: number;
  name: string;
  quantity: number;
  sellPrice: number;
  icon: HTMLImageElement | null;
}

// Layout — the 463x339 background has two panels side by side.
// Measured from the WZ backgrnd: rows start y=126 with a 40px stride; each
// row has an icon square at x+10..40 (item shadow baked at its bottom), the
// content strip at x+44..206 (exactly the 162px select highlight), and a
// scrollbar column at x+213. Right panel is the same layout offset +228.
const BG_W = 463;
const BG_H = 339;
const ROW_H = 40;
const LIST_Y = 126;
const VISIBLE_ROWS = 5;
const PANEL_RIGHT_OFF = 228; // right panel x offset from window origin
const ICON_CENTER_X = 25;   // icon square center within a panel
const ICON_BOTTOM_Y = 30;   // icon bottom sits on the baked shadow
const STRIP_X = 44;         // content strip left edge within a panel
const SCROLL_X = 213;       // scrollbar column within a panel
const ICON_SIZE = 32;       // cap icon to 32x32

const ShopUI: any = {
  isVisible: false,
  loaded: false,
  shopId: 0,

  // Data
  shopItems: [] as LoadedShopItem[],
  playerItems: [] as LoadedPlayerItem[],

  // Selection / scroll (separate for each panel)
  buySelectedIndex: -1,
  buyScrollOffset: 0,
  sellSelectedIndex: -1,
  // Which list the arrow keys drive. Set by whichever panel was last
  // clicked so up/down follow the player's attention, as in GMS.
  focusPanel: 'buy' as 'buy' | 'sell',
  _prevUp: false,
  _prevDown: false,
  // Item under the cursor this frame, resolved during the panel draw so
  // the tooltip can be painted after everything else
  _hoverItem: null as any,
  _hoverX: 0,
  _hoverY: 0,
  sellScrollOffset: 0,

  // WZ assets
  shopNode: null as any,
  backgrndImg: null as HTMLImageElement | null,
  selectImg: null as HTMLImageElement | null,
  mesoImg: null as HTMLImageElement | null,

  // NPC sprite
  npcSprite: null as HTMLImageElement | null,
  // Mirrors the world NPC's flip so the portrait faces the same way as the
  // person you clicked (life/f varies per placement)
  npcFlipped: false,
  npcOrigin: { x: 0, y: 0 },

  // Buttons
  buttons: [] as MapleStanceButton[],
  buttonsRegistered: false,

  // Position
  x: 0,
  y: 0,
  canvas: null as GameCanvas | null,

  async show(shopId: number) {
    if (this.isVisible) this.hide();

    this.shopId = shopId;
    this.buySelectedIndex = -1;
    this.buyScrollOffset = 0;
    this.sellSelectedIndex = -1;
    this.sellScrollOffset = 0;
    this.shopItems = [];
    this.playerItems = [];
    this.npcSprite = null;
    // Reached through the window global rather than an import — ShopUI is
    // pulled in by MapState, and importing MapleMap here closes a cycle
    const worldNpcs = (window as any).__MapleMap?.npcs || [];
    this.npcFlipped = !!worldNpcs.find((n: any) => n.id === shopId)?.flipped;

    if (!this.loaded) {
      await this.loadAssets();
    }

    // Center on screen
    this.x = Math.floor((Config.width - BG_W) / 2);
    this.y = Math.floor((Config.height - BG_H) / 2);

    // Load shop data
    await ensureItemNames();
    const shopInfo = await getShopInfo(shopId);
    if (!shopInfo) {
      console.warn(`Shop ${shopId} not found`);
      return;
    }

    // Load NPC sprite
    this.loadNpcSprite(shopInfo.npcId);

    // Load shop items with icons
    this.shopItems = await this.loadShopItems(shopInfo.items);

    // Load player inventory for sell panel
    await this.populateSellItems();

    this.isVisible = true;
    this.buttonsRegistered = false;
  },

  hide() {
    this.isVisible = false;
    this.unregisterButtons();
  },

  async loadAssets() {
    try {
      this.shopNode = await WZManager.get('UI.wz/UIWindow.img/Shop');
      this.backgrndImg = this.shopNode?.backgrnd?.nGetImage?.() || null;
      this.selectImg = this.shopNode?.select?.nGetImage?.() || null;
      this.mesoImg = this.shopNode?.meso?.nGetImage?.() || null;

      // Scrollbar pieces (Basic.img/VScr4) for the per-panel list scrollbars
      const basic: any = await WZManager.get('UI.wz/Basic.img');
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
      console.error('Failed to load shop UI assets:', e);
    }
  },

  _scroll: null as any,

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
      // Origin marks the feet anchor so the NPC can stand on the shadow
      this.npcOrigin = {
        x: standFrame?.origin?.nX ?? 0,
        y: standFrame?.origin?.nY ?? 0,
      };
    } catch { /* ignore */ }
  },

  async loadShopItems(items: ShopItem[]): Promise<LoadedShopItem[]> {
    const loaded: LoadedShopItem[] = [];
    for (const item of items) {
      const name = getItemNameSync(item.itemId) || `Item #${item.itemId}`;
      let icon: HTMLImageElement | null = null;
      try {
        const itemObj = await Item.fromOpts({ itemId: item.itemId, quantity: 1 });
        if (itemObj.node) {
          const iconNode = itemObj.node.info?.iconRaw || itemObj.node.info?.icon;
          if (iconNode?.nGetImage) icon = iconNode.nGetImage();
        }
      } catch { /* icon load failure is ok */ }
      loaded.push({ itemId: item.itemId, name, price: item.price, icon });
    }
    return loaded;
  },

  async populateSellItems() {
    const character = (window as any).charecter;
    if (!character?.inventory) return;

    this.playerItems = [];
    const tabs = [
      character.inventory.equip,
      character.inventory.use,
      character.inventory.setup,
      character.inventory.etc,
    ];

    for (const tab of tabs) {
      for (const item of tab) {
        if (!item) continue;
        const name = getItemNameSync(item.itemId) || `Item #${item.itemId}`;
        let icon: HTMLImageElement | null = null;
        if (item.node) {
          const iconNode = item.node.info?.iconRaw || item.node.info?.icon;
          if (iconNode?.nGetImage) icon = iconNode.nGetImage();
        }
        const sellPrice = await getItemSellPrice(item.itemId);
        this.playerItems.push({
          itemId: item.itemId, name, quantity: item.quantity, sellPrice, icon,
        });
      }
    }
  },

  registerButtons() {
    this.unregisterButtons();
    if (!this.shopNode || !this.canvas) return;
    const canvas = this.canvas;

    // Buttons are 80x18. Left header button area spans x+105..x+225.
    // EXIT / LEAVE STORE button — left header, top
    if (this.shopNode.BtExit) {
      const btn = new MapleStanceButton(canvas, {
        x: this.x + 125, y: this.y + 26,
        img: this.shopNode.BtExit.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this.hide(),
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }

    // BUY ITEM button — left header, below EXIT
    if (this.shopNode.BtBuy) {
      const btn = new MapleStanceButton(canvas, {
        x: this.x + 125, y: this.y + 50,
        img: this.shopNode.BtBuy.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this.onBuy(),
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }

    // SELL ITEM button — right header, above the meso box (box is y+64..y+82)
    if (this.shopNode.BtSell) {
      const btn = new MapleStanceButton(canvas, {
        x: this.x + 367, y: this.y + 30,
        img: this.shopNode.BtSell.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this.onSell(),
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }
  },

  unregisterButtons() {
    for (const btn of this.buttons) {
      ClickManager.removeButton(btn);
    }
    this.buttons = [];
  },

  async onBuy() {
    if (this.buySelectedIndex < 0) return;
    const item = this.shopItems[this.buySelectedIndex];
    if (!item) return;

    const character = (window as any).charecter;
    if (!character?.inventory) return;

    if (character.inventory.mesos < item.price) {
      console.log('Not enough mesos');
      return;
    }

    // Rechargeables (stars/bullets): the listed price buys a full stack
    if (ItemConstants.isRechargeable(item.itemId)) {
      const slotMax = await getItemSlotMax(item.itemId);
      character.inventory.gainMesos(-item.price);
      await character.inventory.addToInventory(item.itemId, slotMax);
      this.populateSellItems();
      return;
    }

    // Equips buy one at a time; stackables get a quantity dialog
    const isEquip = Math.floor(item.itemId / 1000000) === 1;
    const slotMax = isEquip ? 1 : await getItemSlotMax(item.itemId);
    const maxAffordable = Math.floor(character.inventory.mesos / item.price);
    const maxQty = Math.min(slotMax, maxAffordable);

    if (isEquip || maxQty <= 1) {
      character.inventory.gainMesos(-item.price);
      await character.inventory.addToInventory(item.itemId, 1);
      this.populateSellItems();
      return;
    }

    const buyDialog = await this.getQuantityDialog();
    buyDialog.show(maxQty, async (amount: number) => {
      if (amount <= 0) return;
      const cost = item.price * amount;
      if (character.inventory.mesos < cost) return;
      character.inventory.gainMesos(-cost);
      const ok = await character.inventory.addToInventory(item.itemId, amount);
      if (ok === false) character.inventory.gainMesos(cost); // refund on full inventory
      this.populateSellItems();
    }, 'item', item.name, 'buy');
  },

  async onSell() {
    if (this.sellSelectedIndex < 0) return;
    const item = this.playerItems[this.sellSelectedIndex];
    if (!item) return;

    const character = (window as any).charecter;
    if (!character?.inventory) return;

    // Rechargeables always sell the whole stack: price + ceil(qty * unitPrice)
    if (ItemConstants.isRechargeable(item.itemId)) {
      const unitPrice = await getItemUnitPrice(item.itemId);
      const total = item.sellPrice + Math.ceil(item.quantity * unitPrice);
      character.inventory.gainMesos(total);
      character.inventory.removeFromInventory(item.itemId, item.quantity);
      this.afterSell();
      return;
    }

    if (item.quantity > 1) {
      const sellDialog = await this.getQuantityDialog();
      sellDialog.show(item.quantity, (amount: number) => {
        if (amount <= 0) return;
        character.inventory.gainMesos(item.sellPrice * amount);
        character.inventory.removeFromInventory(item.itemId, amount);
        this.afterSell();
      }, 'item', item.name, 'sell');
      return;
    }

    character.inventory.gainMesos(item.sellPrice);
    character.inventory.removeFromInventory(item.itemId, 1);
    this.afterSell();
  },

  afterSell() {
    this.populateSellItems();
    if (this.sellSelectedIndex >= this.playerItems.length) {
      this.sellSelectedIndex = this.playerItems.length - 1;
    }
  },

  // Recharge stars/bullets to slotMax for ceil(unitPrice * missing)
  async rechargeItem(item: any) {
    const character = (window as any).charecter;
    if (!character?.inventory) return;
    const slotMax = await getItemSlotMax(item.itemId);
    const missing = slotMax - item.quantity;
    if (missing <= 0) return;
    const unitPrice = await getItemUnitPrice(item.itemId);
    const cost = Math.ceil(unitPrice * missing);
    if (character.inventory.mesos < cost) {
      console.log('Not enough mesos to recharge');
      return;
    }
    character.inventory.gainMesos(-cost);
    // Fill the existing stack directly (bypasses slotMax split logic)
    const tabs = [character.inventory.use];
    for (const tab of tabs) {
      for (const it of tab) {
        if (it?.itemId === item.itemId) {
          it.quantity = slotMax;
          this.populateSellItems();
          return;
        }
      }
    }
  },

  _quantityDialog: null as any,
  _quantityDialogReady: null as Promise<void> | null,
  async getQuantityDialog() {
    if (!this._quantityDialog) {
      this._quantityDialog = new UIMesoDropDialog({ canvas: this.canvas });
      this._quantityDialogReady = this._quantityDialog.load();
    }
    // WZ assets must be loaded before show() builds its buttons
    if (this._quantityDialogReady) await this._quantityDialogReady;
    return this._quantityDialog;
  },

  update(_msPerTick: number) {},

  render(canvas: GameCanvas, camera: CameraInterface) {
    if (!this.isVisible) return;
    this.canvas = canvas;

    if (!this.buttonsRegistered) {
      this.registerButtons();
      this.buttonsRegistered = true;
    }

    // Background
    if (this.backgrndImg) {
      canvas.drawImage({ img: this.backgrndImg, dx: this.x, dy: this.y });
    }

    // Positions from WZ bg pixel analysis (463x339)
    // Shadow ellipses (sprite feet anchors): left center (57,73), right center (290,73)
    const npcX = this.x + 57;
    const playerX = this.x + 290;
    const baselineY = this.y + 76;

    // NPC sprite — feet on the left shadow, anchored by its WZ origin
    if (this.npcSprite && this.npcSprite.complete && this.npcSprite.naturalWidth > 0) {
      const w = this.npcSprite.width;
      const ox = this.npcOrigin.x || Math.floor(w / 2);
      const oy = this.npcOrigin.y || this.npcSprite.height;
      // Mirror exactly as the NPC is mirrored out in the world, so the
      // portrait matches the person you just clicked. Native facing varies
      // per NPC (Pan is authored facing left, Natasha facing right), so a
      // blanket flip either way is wrong — the map's own flip is the answer.
      const flip = !!this.npcFlipped;
      canvas.drawImage({
        img: this.npcSprite,
        dx: npcX - (flip ? w - ox : ox),
        dy: baselineY - oy,
        flipped: flip,
      });
    }

    // Player character sprite — feet on the right shadow (frame offsets are
    // relative to the character's ground position)
    const character = (window as any).charecter;
    if (character) {
      const frames = character.getDrawableFrames?.('stand1', 0, false);
      if (frames) {
        for (const frame of frames) {
          if (frame.img && frame.img.complete && frame.img.naturalWidth > 0) {
            canvas.drawImage({
              img: frame.img,
              dx: playerX + (frame.x || 0),
              dy: baselineY + (frame.y || 0),
            });
          }
        }
      }
    }

    // Meso balance — the coin is baked into the bg's white box (x336..456,
    // y60..80); draw only the amount, right-aligned inside the box
    if (character?.inventory) {
      canvas.drawText({
        text: character.inventory.mesos.toLocaleString(),
        color: '#000000', x: this.x + 452, y: this.y + 66, fontSize: 11,
        align: 'right',
      });
    }

    // Left panel — shop items (buy)
    this._hoverItem = null;
    this.drawItemPanel(canvas, this.shopItems, this.buySelectedIndex,
      this.buyScrollOffset, this.x, true);

    // Right panel — player items (sell)
    this.drawItemPanel(canvas, this.playerItems, this.sellSelectedIndex,
      this.sellScrollOffset, this.x + PANEL_RIGHT_OFF, false);

    // Buttons
    for (const btn of this.buttons) {
      btn.draw(canvas, camera, 0, 0, 0);
    }

    // Item tooltip — above the buttons, below the quantity dialog, so a
    // pending buy/sell prompt is never obscured by a hover
    this.drawHoverTooltip(canvas);

    // Buy/sell quantity dialog on top
    if (this._quantityDialog && !this._quantityDialog.isHidden) {
      this._quantityDialog.draw(canvas, camera, 0, 0, 0);
    }

    this.handleArrowKeys(canvas);

    // Click handling — wasClicked is a one-shot flag, so holding the button
    // down doesn't refire and break double-click detection
    if ((canvas as any).wasClicked) {
      this.handleClick((canvas as any).mouseX || 0, (canvas as any).mouseY || 0);
    }

    // Scroll — determine which panel mouse is over
    const scrollDir = (canvas as any).scrolledDown ? 1 : (canvas as any).scrolledUp ? -1 : 0;
    if (scrollDir !== 0) {
      const mx = (canvas as any).mouseX || 0;
      const midX = this.x + 232;
      if (mx < midX) {
        // Left panel scroll
        const max = Math.max(0, this.shopItems.length - VISIBLE_ROWS);
        this.buyScrollOffset = Math.max(0, Math.min(max, this.buyScrollOffset + scrollDir));
      } else {
        // Right panel scroll
        const max = Math.max(0, this.playerItems.length - VISIBLE_ROWS);
        this.sellScrollOffset = Math.max(0, Math.min(max, this.sellScrollOffset + scrollDir));
      }
    }
  },

  /**
   * Tooltip for the row under the cursor — the same information the inventory
   * shows, since a shop is where you most need it. Equips reuse UIEquipTooltip
   * (REQ stats, job bar, the lot); everything else gets name + description
   * from String.wz, with `#c..#` rendered orange as elsewhere.
   */
  drawHoverTooltip(canvas: GameCanvas) {
    const item = this._hoverItem;
    if (!item) return;
    const itemId = item.itemId ?? item.id;
    if (!itemId) return;

    // Anchor beside the shop window, never over it. Anchoring to the hovered
    // row put the panel straight on top of the list, hiding the very items
    // being browsed. Prefer the right of the window, fall back to its left
    // when there is no room there.
    const NOMINAL_W = 260;
    let ax = this.x + BG_W + 6;
    if (ax + NOMINAL_W > canvas.game.width) ax = Math.max(2, this.x - NOMINAL_W - 6);
    const ay = Math.max(2, this._hoverY - 20);

    if (Math.floor(itemId / 1000000) === 1) {
      if (UIEquipTooltip.draw(canvas, itemId, item.equipData, ax, ay)) return;
    }

    const name = getItemNameSync(itemId) || item.name || '';
    const desc = (getItemDescSync(itemId) || '').replace(/\\n/g, '\n');
    if (!name && !desc) return;

    const ctx = canvas.context;
    const W = 210, PAD = 8, LINE = 13;
    ctx.save();
    ctx.font = '11px Arial';

    const lines: { text: string; color: string }[] = [];
    lines.push({ text: name, color: '#ffcc00' });
    for (const para of desc.split('\n')) {
      // #c..# is the orange highlight; other codes are chrome and get dropped
      const cleaned = para.replace(/#c(.*?)#/g, '$1').replace(/#[a-z]/g, '');
      let line = '';
      for (const word of cleaned.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > W - PAD * 2 && line) {
          lines.push({ text: line, color: '#ffffff' });
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push({ text: line, color: '#ffffff' });
    }

    const H = PAD * 2 + lines.length * LINE;
    let tx = ax;
    let ty = ay;
    if (tx + W > canvas.game.width) tx = canvas.game.width - W - 2;
    if (ty + H > canvas.game.height) ty = canvas.game.height - H - 2;
    if (ty < 0) ty = 0;

    ctx.fillStyle = 'rgba(68, 74, 125, 0.9)';
    ctx.fillRect(tx, ty, W, H);
    ctx.strokeStyle = 'rgba(150, 158, 200, 0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx + 0.5, ty + 0.5, W - 1, H - 1);

    ctx.textAlign = 'left';
    let y = ty + PAD + 10;
    for (const l of lines) {
      ctx.fillStyle = l.color;
      ctx.font = l.color === '#ffcc00' ? 'bold 11px Arial' : '11px Arial';
      ctx.fillText(l.text, tx + PAD, y);
      y += LINE;
    }
    ctx.restore();
  },

  /**
   * Up/down move the selection in whichever panel was last clicked, scrolling
   * the list to keep it in view. Edge-triggered so a held key steps once per
   * press; the player cannot walk while a shop is open, so the arrows are free.
   */
  handleArrowKeys(canvas: GameCanvas) {
    if (!this.isVisible) return;
    if (this._quantityDialog && !this._quantityDialog.isHidden) return;

    const up = canvas.isKeyDown('up');
    const down = canvas.isKeyDown('down');
    const stepUp = up && !this._prevUp;
    const stepDown = down && !this._prevDown;
    this._prevUp = up;
    this._prevDown = down;
    if (!stepUp && !stepDown) return;

    const buy = this.focusPanel === 'buy';
    const items = buy ? this.shopItems : this.playerItems;
    if (items.length === 0) return;

    let idx = buy ? this.buySelectedIndex : this.sellSelectedIndex;
    idx = idx < 0 ? 0 : idx + (stepDown ? 1 : -1);
    idx = Math.max(0, Math.min(items.length - 1, idx));

    let off = buy ? this.buyScrollOffset : this.sellScrollOffset;
    if (idx < off) off = idx;
    else if (idx >= off + VISIBLE_ROWS) off = idx - VISIBLE_ROWS + 1;
    off = Math.max(0, Math.min(Math.max(0, items.length - VISIBLE_ROWS), off));

    if (buy) { this.buySelectedIndex = idx; this.buyScrollOffset = off; }
    else { this.sellSelectedIndex = idx; this.sellScrollOffset = off; }
  },

  drawItemPanel(canvas: GameCanvas, items: any[], selectedIdx: number,
    scrollOffset: number, panelX: number, showBuyPrice: boolean) {
    const listY = this.y + LIST_Y;
    const end = Math.min(scrollOffset + VISIBLE_ROWS, items.length);

    for (let i = scrollOffset; i < end; i++) {
      const item = items[i];
      const rowY = listY + (i - scrollOffset) * ROW_H;

      // Record what the cursor is over. Resolved here rather than in a
      // separate hit-test so it can never drift from where rows are drawn.
      const mx = (canvas as any).mouseX || 0;
      const my = (canvas as any).mouseY || 0;
      // The whole row is hoverable, not just the text strip — the icon column
      // sits left of STRIP_X and reads as part of the same entry.
      if (mx >= panelX && mx < panelX + SCROLL_X &&
          my >= rowY && my < rowY + ROW_H) {
        this._hoverItem = item;
        this._hoverX = panelX;
        this._hoverY = rowY;
      }

      // Selection highlight — covers the content strip exactly (162x35)
      if (i === selectedIdx && this.selectImg && this.selectImg.complete && this.selectImg.naturalWidth > 0) {
        canvas.drawImage({ img: this.selectImg, dx: panelX + STRIP_X, dy: rowY + 2 });
      }

      // Item icon — centered in the icon square, bottom resting on the
      // baked-in item shadow (like GMS)
      if (item.icon && item.icon.complete && item.icon.naturalWidth > 0) {
        let iw = item.icon.width;
        let ih = item.icon.height;
        if (iw > ICON_SIZE || ih > ICON_SIZE) {
          const scale = Math.min(ICON_SIZE / iw, ICON_SIZE / ih);
          iw = Math.floor(iw * scale);
          ih = Math.floor(ih * scale);
        }
        const ix = panelX + ICON_CENTER_X - Math.floor(iw / 2);
        const iy = rowY + ICON_BOTTOM_Y - ih;
        canvas.context.drawImage(item.icon, ix, iy, iw, ih);
      }

      // Item name
      let displayName = item.name;
      if (!showBuyPrice && item.quantity > 1) {
        displayName = `${item.name} (x${item.quantity})`;
      }
      if (displayName.length > 18) displayName = displayName.substring(0, 16) + '..';
      canvas.drawText({
        text: displayName,
        color: '#000000',
        x: panelX + STRIP_X + 8, y: rowY + 6, fontSize: 11,
      });

      // Price
      const price = showBuyPrice ? item.price : item.sellPrice;
      if (this.mesoImg && this.mesoImg.complete && this.mesoImg.naturalWidth > 0) {
        canvas.drawImage({ img: this.mesoImg, dx: panelX + STRIP_X + 8, dy: rowY + 23 });
      }
      canvas.drawText({
        text: `${price.toLocaleString()}meso`,
        color: '#000000',
        x: panelX + STRIP_X + 24, y: rowY + 23, fontSize: 10,
      });
    }

    this.drawScrollbar(canvas, panelX, items.length, scrollOffset);
  },

  // Per-panel scrollbar from Basic.img/VScr4 in the bg's scrollbar column
  drawScrollbar(canvas: GameCanvas, panelX: number, itemCount: number, scrollOffset: number) {
    const s = this._scroll;
    if (!s) return;
    const sx = panelX + SCROLL_X;
    const top = this.y + LIST_Y;
    const trackH = VISIBLE_ROWS * ROW_H;
    const arrowH = 13;
    const bottom = top + trackH - arrowH;
    const scrollable = itemCount > VISIBLE_ROWS;

    const prev = scrollable ? s.prev : s.prevDis;
    const next = scrollable ? s.next : s.nextDis;
    const base = scrollable ? s.base : s.baseDis;

    // Track fill between the arrows
    if (base?.complete) {
      const ctx = canvas.context;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, top + arrowH, base.width, bottom - (top + arrowH));
      ctx.clip();
      GUIUtil.tileRange(top + arrowH, bottom, base.height, (ty) => {
        canvas.drawImage({ img: base, dx: sx, dy: ty });
      });
      ctx.restore();
    }
    if (prev?.complete) canvas.drawImage({ img: prev, dx: sx, dy: top });
    if (next?.complete) canvas.drawImage({ img: next, dx: sx, dy: bottom });

    // Thumb at the proportional position
    if (scrollable && s.thumb?.complete) {
      const travel = bottom - (top + arrowH) - s.thumb.height;
      const maxOffset = itemCount - VISIBLE_ROWS;
      const ty = top + arrowH + Math.round(travel * (scrollOffset / maxOffset));
      canvas.drawImage({ img: s.thumb, dx: sx, dy: ty });
    }
  },

  handleClick(mx: number, my: number) {
    if (!this.isVisible) return;

    const listY = this.y + LIST_Y;
    const listH = VISIBLE_ROWS * ROW_H;
    const arrowH = 13;

    // Scrollbar arrows (both panels)
    for (const [panelX, isBuy] of [[this.x, true], [this.x + PANEL_RIGHT_OFF, false]] as [number, boolean][]) {
      const sx = panelX + SCROLL_X;
      if (mx >= sx && mx < sx + 15) {
        const items = isBuy ? this.shopItems : this.playerItems;
        const max = Math.max(0, items.length - VISIBLE_ROWS);
        if (my >= listY && my < listY + arrowH) {
          if (isBuy) this.buyScrollOffset = Math.max(0, this.buyScrollOffset - 1);
          else this.sellScrollOffset = Math.max(0, this.sellScrollOffset - 1);
          return;
        }
        if (my >= listY + listH - arrowH && my < listY + listH) {
          if (isBuy) this.buyScrollOffset = Math.min(max, this.buyScrollOffset + 1);
          else this.sellScrollOffset = Math.min(max, this.sellScrollOffset + 1);
          return;
        }
      }
    }

    // Left panel (buy) item click — double-click buys
    const leftX = this.x + 4;
    if (mx >= leftX && mx < this.x + SCROLL_X && my >= listY && my < listY + listH) {
      const rowIdx = Math.floor((my - listY) / ROW_H) + this.buyScrollOffset;
      if (rowIdx >= 0 && rowIdx < this.shopItems.length) {
        const now = Date.now();
        this.focusPanel = 'buy';
        this.buySelectedIndex = rowIdx;
        if (rowIdx === this._lastBuyClickIdx && now - this._lastBuyClickTime < 400) {
          this._lastBuyClickIdx = -1;
          this._lastBuyClickTime = 0;
          this.onBuy();
        } else {
          this._lastBuyClickIdx = rowIdx;
          this._lastBuyClickTime = now;
        }
      }
      return;
    }

    // Right panel (sell) item click — double-click sells (rechargeables refill instead)
    const rightX = this.x + PANEL_RIGHT_OFF + 4;
    if (mx >= rightX && mx < this.x + PANEL_RIGHT_OFF + SCROLL_X && my >= listY && my < listY + listH) {
      const rowIdx = Math.floor((my - listY) / ROW_H) + this.sellScrollOffset;
      if (rowIdx >= 0 && rowIdx < this.playerItems.length) {
        const now = Date.now();
        this.focusPanel = 'sell';
        this.sellSelectedIndex = rowIdx;
        if (rowIdx === this._lastSellClickIdx && now - this._lastSellClickTime < 400) {
          this._lastSellClickIdx = -1;
          this._lastSellClickTime = 0;
          if (ItemConstants.isRechargeable(this.playerItems[rowIdx].itemId)) {
            this.rechargeItem(this.playerItems[rowIdx]);
          } else {
            this.onSell();
          }
        } else {
          this._lastSellClickIdx = rowIdx;
          this._lastSellClickTime = now;
        }
      }
      return;
    }
  },

  _lastBuyClickIdx: -1,
  _lastBuyClickTime: 0,
  _lastSellClickIdx: -1,
  _lastSellClickTime: 0,
};

// Dev-console access to the live instance (HMR re-imports create copies)
(window as any).__ShopUI = ShopUI;

export default ShopUI;
