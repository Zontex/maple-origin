import WZManager from '../wz-utils/WZManager';
import MapleInventory from '../Constants/Inventory/MapleInventory';

export interface ShopItem {
  itemId: number;
  price: number;
  position: number;
}

export interface ShopInfo {
  npcId: number;
  items: ShopItem[];
}

let shopDataCache: Map<number, ShopInfo> | null = null;

export async function getShopInfo(shopId: number): Promise<ShopInfo | null> {
  if (!shopDataCache) {
    try {
      const resp = await fetch('/data/shops.json');
      const data = await resp.json();
      shopDataCache = new Map();
      for (const [id, info] of Object.entries(data)) {
        shopDataCache.set(parseInt(id), info as ShopInfo);
      }
    } catch (e) {
      console.error('Failed to load shop data:', e);
      return null;
    }
  }
  return shopDataCache.get(shopId) ?? null;
}

/** Get the sell price for an item (WZ price / 3, matching original game) */
export async function getItemSellPrice(itemId: number): Promise<number> {
  const category = Math.floor(itemId / 1000000);

  // Equipment items — use a simple formula based on level
  if (category === 1) {
    return 1; // Equip sell prices need server data; return 1 meso as placeholder
  }

  try {
    const wzType = MapleInventory.getWzNameFromInventoryId(
      itemId.toString().padStart(8, '0')
    );
    if (!wzType) return 0;
    const strId = itemId.toString().padStart(8, '0');
    const prefix = strId.slice(0, 4);
    const infoNode = await WZManager.get(
      `Item.wz/${wzType}/${prefix}.img/${strId}/info`
    );
    const price = infoNode?.price?.nValue ?? 0;
    return Math.floor(Number(price) / 3);
  } catch {
    return 0;
  }
}
