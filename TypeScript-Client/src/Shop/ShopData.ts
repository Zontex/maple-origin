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
  const direct = shopDataCache.get(shopId);
  if (direct) return direct;
  // Some shops have shopId != npcId (e.g. 57 → NPC 2002001); NPC clicks look up by npcId
  for (const info of shopDataCache.values()) {
    if (info.npcId === shopId) return info;
  }
  return null;
}

/** Get the sell price for an item (WZ price, matching original game) */
export async function getItemSellPrice(itemId: number): Promise<number> {
  const category = Math.floor(itemId / 1000000);
  const strId = itemId.toString().padStart(8, '0');
  const prefix = strId.slice(0, 4);

  try {
    if (category === 1) {
      // Equipment items — price is in Character.wz/{Dir}/0{itemId}.img/info/price
      const firstThreeDigits = Math.floor(itemId / 10000);
      const equipDirMap: Record<number, string> = {
        100: 'Cap', 101: 'Accessory', 102: 'Accessory', 103: 'Accessory',
        104: 'Coat', 105: 'Longcoat', 106: 'Pants', 107: 'Shoes',
        108: 'Glove', 109: 'Shield', 110: 'Cape', 111: 'Ring',
        112: 'Accessory', 113: 'Accessory', 114: 'Accessory',
      };
      // Weapons: 130-170
      for (let w = 130; w <= 170; w++) equipDirMap[w] = 'Weapon';
      const dir = equipDirMap[firstThreeDigits];
      if (dir) {
        const infoNode = await WZManager.get(`Character.wz/${dir}/0${itemId}.img/info`);
        const price = infoNode?.price?.nValue ?? 0;
        // Cosmic sells at the full WZ price (no /3 heuristic)
        return Math.max(1, Math.floor(Number(price)));
      }
      return 1;
    }

    // Consumable/Etc/Setup/Cash items — price in Item.wz
    const wzType = MapleInventory.getWzNameFromInventoryId(strId);
    if (!wzType) return 0;
    const infoNode = await WZManager.get(
      `Item.wz/${wzType}/${prefix}.img/${strId}/info`
    );
    const price = infoNode?.price?.nValue ?? 0;
    return Math.max(1, Math.floor(Number(price)));
  } catch {
    return 1;
  }
}

/** Per-unit price for rechargeables (stars/bullets) from WZ info/unitPrice */
export async function getItemUnitPrice(itemId: number): Promise<number> {
  try {
    const strId = itemId.toString().padStart(8, '0');
    const prefix = strId.slice(0, 4);
    const wzType = MapleInventory.getWzNameFromInventoryId(strId);
    if (!wzType) return 0;
    const infoNode: any = await WZManager.get(`Item.wz/${wzType}/${prefix}.img/${strId}/info`);
    return Number(infoNode?.unitPrice?.nValue ?? 0);
  } catch {
    return 0;
  }
}

/** Max stack size from WZ info/slotMax */
export async function getItemSlotMax(itemId: number): Promise<number> {
  try {
    const strId = itemId.toString().padStart(8, '0');
    const prefix = strId.slice(0, 4);
    const wzType = MapleInventory.getWzNameFromInventoryId(strId);
    if (!wzType) return 100;
    const infoNode: any = await WZManager.get(`Item.wz/${wzType}/${prefix}.img/${strId}/info`);
    const slotMax = Number(infoNode?.slotMax?.nValue ?? 0);
    return slotMax > 0 ? slotMax : 100;
  } catch {
    return 100;
  }
}
