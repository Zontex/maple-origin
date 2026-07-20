import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import ClickManager from './ClickManager';
import { MapleStanceButton } from './MapleStanceButton';
import { getShopInfo, getItemSellPrice, getItemUnitPrice, getItemSlotMax, ShopItem } from '../Shop/ShopData';
import { ensureItemNames, getItemNameSync } from '../Quest/QuestData';
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

// Layout — the 463x339 background has two panels side by side
const BG_W = 463;
const BG_H = 339;
const ROW_H = 41;
const VISIBLE_ROWS = 5;
const ICON_OFFSET_X = 10;  // icon centered in the icon square
const TEXT_OFFSET_X = 48;  // text starts after icon square
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
  sellScrollOffset: 0,

  // WZ assets
  shopNode: null as any,
  backgrndImg: null as HTMLImageElement | null,
  selectImg: null as HTMLImageElement | null,
  mesoImg: null as HTMLImageElement | null,

  // NPC sprite
  npcSprite: null as HTMLImageElement | null,

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
      this.loaded = true;
    } catch (e) {
      console.error('Failed to load shop UI assets:', e);
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
      this.npcSprite = npcFile?.stand?.[0]?.nGetImage?.() || null;
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

    // BUY ITEM button — left header area
    if (this.shopNode.BtBuy) {
      const btn = new MapleStanceButton(canvas, {
        x: this.x + 120, y: this.y + 52,
        img: this.shopNode.BtBuy.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this.onBuy(),
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }

    // SELL ITEM button — right header area
    if (this.shopNode.BtSell) {
      const btn = new MapleStanceButton(canvas, {
        x: this.x + 352, y: this.y + 52,
        img: this.shopNode.BtSell.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this.onSell(),
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }

    // EXIT / LEAVE STORE button — left header area, above BUY ITEM
    if (this.shopNode.BtExit) {
      const btn = new MapleStanceButton(canvas, {
        x: this.x + 120, y: this.y + 30,
        img: this.shopNode.BtExit.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this.hide(),
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
    }, 'item', item.name);
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
      }, 'item', item.name);
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
    // Red line=y116, vert divider=x230, row1=y127, rowH=40, icon box=x6..x40
    const npcX = this.x + 50;
    const npcY = this.y + 8;
    const playerX = this.x + 280;
    const playerY = this.y + 8;
    const mesoX = this.x + 350;
    const mesoY = this.y + 70;
    const leftListX = this.x + 4;
    const leftListY = this.y + 125;
    const rightListX = this.x + 234;
    const rightListY = this.y + 125;

    // NPC sprite (top-left area)
    if (this.npcSprite && this.npcSprite.complete && this.npcSprite.naturalWidth > 0) {
      canvas.drawImage({ img: this.npcSprite, dx: npcX - this.npcSprite.width / 2, dy: npcY });
    }

    // Player character sprite (top-right area)
    const character = (window as any).charecter;
    if (character) {
      const frames = character.getDrawableFrames?.('stand1', 0, false);
      if (frames) {
        for (const frame of frames) {
          if (frame.img && frame.img.complete && frame.img.naturalWidth > 0) {
            canvas.drawImage({
              img: frame.img,
              dx: playerX + (frame.x || 0),
              dy: playerY + 65 + (frame.y || 0),
            });
          }
        }
      }
    }

    // Meso balance
    if (character?.inventory && this.mesoImg && this.mesoImg.complete) {
      canvas.drawImage({ img: this.mesoImg, dx: mesoX, dy: mesoY });
      canvas.drawText({
        text: character.inventory.mesos.toLocaleString(),
        color: '#000000', x: mesoX + 16, y: mesoY - 2, fontSize: 11,
      });
    }

    // Left panel — shop items (buy)
    this.drawItemPanel(canvas, this.shopItems, this.buySelectedIndex,
      this.buyScrollOffset, leftListX, leftListY, true);

    // Right panel — player items (sell)
    this.drawItemPanel(canvas, this.playerItems, this.sellSelectedIndex,
      this.sellScrollOffset, rightListX, rightListY, false);

    // Buttons
    for (const btn of this.buttons) {
      btn.draw(canvas, camera, 0, 0, 0);
    }

    // Buy/sell quantity dialog on top
    if (this._quantityDialog && !this._quantityDialog.isHidden) {
      this._quantityDialog.draw(canvas, camera, 0, 0, 0);
    }

    // Click handling
    if ((canvas as any).clicked) {
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

  drawItemPanel(canvas: GameCanvas, items: any[], selectedIdx: number,
    scrollOffset: number, panelX: number, panelY: number, showBuyPrice: boolean) {
    const end = Math.min(scrollOffset + VISIBLE_ROWS, items.length);

    for (let i = scrollOffset; i < end; i++) {
      const item = items[i];
      const rowY = panelY + (i - scrollOffset) * ROW_H;

      // Selection highlight
      if (i === selectedIdx && this.selectImg && this.selectImg.complete && this.selectImg.naturalWidth > 0) {
        canvas.drawImage({ img: this.selectImg, dx: panelX + 2, dy: rowY });
      }

      // Item icon (fit within the icon square)
      if (item.icon && item.icon.complete && item.icon.naturalWidth > 0) {
        const iw = item.icon.width;
        const ih = item.icon.height;
        // Scale down if icon is larger than slot
        if (iw > ICON_SIZE || ih > ICON_SIZE) {
          const scale = Math.min(ICON_SIZE / iw, ICON_SIZE / ih);
          const dw = Math.floor(iw * scale);
          const dh = Math.floor(ih * scale);
          const ix = panelX + ICON_OFFSET_X + Math.floor((ICON_SIZE - dw) / 2);
          const iy = rowY + Math.floor((ROW_H - dh) / 2);
          canvas.context.drawImage(item.icon, ix, iy, dw, dh);
        } else {
          const ix = panelX + ICON_OFFSET_X + Math.floor((ICON_SIZE - iw) / 2);
          const iy = rowY + Math.floor((ROW_H - ih) / 2);
          canvas.drawImage({ img: item.icon, dx: ix, dy: iy });
        }
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
        x: panelX + TEXT_OFFSET_X, y: rowY + 8, fontSize: 11,
      });

      // Price
      const price = showBuyPrice ? item.price : item.sellPrice;
      if (this.mesoImg && this.mesoImg.complete && this.mesoImg.naturalWidth > 0) {
        canvas.drawImage({ img: this.mesoImg, dx: panelX + TEXT_OFFSET_X, dy: rowY + 24 });
      }
      canvas.drawText({
        text: `${price.toLocaleString()}meso`,
        color: '#000000',
        x: panelX + TEXT_OFFSET_X + 16, y: rowY + 23, fontSize: 10,
      });
    }
  },

  handleClick(mx: number, my: number) {
    if (!this.isVisible) return;

    const leftListX = this.x + 4;
    const leftListY = this.y + 125;
    const rightListX = this.x + 234;
    const rightListY = this.y + 125;
    const listH = VISIBLE_ROWS * ROW_H;

    // Left panel (buy) item click
    if (mx >= leftListX && mx < leftListX + 220 && my >= leftListY && my < leftListY + listH) {
      const rowIdx = Math.floor((my - leftListY) / ROW_H) + this.buyScrollOffset;
      if (rowIdx >= 0 && rowIdx < this.shopItems.length) {
        this.buySelectedIndex = rowIdx;
      }
      return;
    }

    // Right panel (sell) item click — double-click a rechargeable to refill it
    if (mx >= rightListX && mx < rightListX + 220 && my >= rightListY && my < rightListY + listH) {
      const rowIdx = Math.floor((my - rightListY) / ROW_H) + this.sellScrollOffset;
      if (rowIdx >= 0 && rowIdx < this.playerItems.length) {
        const now = Date.now();
        if (
          rowIdx === this._lastSellClickIdx &&
          now - this._lastSellClickTime < 400 &&
          ItemConstants.isRechargeable(this.playerItems[rowIdx].itemId)
        ) {
          this.rechargeItem(this.playerItems[rowIdx]);
          this._lastSellClickIdx = -1;
          this._lastSellClickTime = 0;
        } else {
          this._lastSellClickIdx = rowIdx;
          this._lastSellClickTime = now;
        }
        this.sellSelectedIndex = rowIdx;
      }
      return;
    }
  },

  _lastSellClickIdx: -1,
  _lastSellClickTime: 0,
};

export default ShopUI;
