import WZManager from '../wz-utils/WZManager';

// Equip icons live in Character.wz/<dir>/<8-digit>.img/info/icon; everything
// else in Item.wz/<category>/<first4>.img/<8-digit>/info/icon (pets excepted —
// see Item.load). Mirrors UIQuestDialog's loader so both show the same art.
const EQUIP_DIRS: Record<number, string> = {
  100: 'Cap', 101: 'Accessory', 102: 'Accessory', 103: 'Accessory',
  104: 'Coat', 105: 'Longcoat', 106: 'Pants', 107: 'Shoes',
  108: 'Glove', 109: 'Shield', 110: 'Cape', 111: 'Ring',
  112: 'Ring', 113: 'Accessory', 114: 'Accessory',
  130: 'Weapon', 131: 'Weapon', 132: 'Weapon', 133: 'Weapon',
  137: 'Weapon', 138: 'Weapon', 139: 'Weapon', 140: 'Weapon',
  141: 'Weapon', 142: 'Weapon', 143: 'Weapon', 144: 'Weapon',
  145: 'Weapon', 146: 'Weapon', 147: 'Weapon', 148: 'Weapon',
  149: 'Weapon', 170: 'Weapon',
  190: 'TamingMob', 191: 'TamingMob', 192: 'TamingMob', 193: 'TamingMob',
};

const cache = new Map<number, HTMLImageElement | null>();

/** The item's `info/icon` image, cached; null when the WZ has none. */
export async function loadItemIcon(itemId: number): Promise<HTMLImageElement | null> {
  if (cache.has(itemId)) return cache.get(itemId) || null;
  try {
    const padded = `${itemId}`.padStart(8, '0');
    const category = Math.floor(itemId / 1000000);
    let node: any = null;
    if (category === 1) {
      const dir = EQUIP_DIRS[Math.floor(itemId / 10000)] || 'Accessory';
      node = await WZManager.get(`Character.wz/${dir}/${padded}.img/info/icon`);
    } else {
      const prefix = padded.substring(0, 4);
      const categoryDir = category === 2 ? 'Consume' : category === 3 ? 'Install' : category === 4 ? 'Etc' : 'Cash';
      node = await WZManager.get(`Item.wz/${categoryDir}/${prefix}.img/${padded}/info/icon`);
    }
    const img = node?.nGetImage?.() || null;
    cache.set(itemId, img);
    return img;
  } catch {
    cache.set(itemId, null);
    return null;
  }
}

/** Synchronous read of an icon that loadItemIcon already fetched (or null). */
export function getItemIconSync(itemId: number): HTMLImageElement | null {
  return cache.get(itemId) || null;
}
