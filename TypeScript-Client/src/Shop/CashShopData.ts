import WZManager from '../wz-utils/WZManager';
import { getItemNameSync } from '../Quest/QuestData';
import UIChatLog from '../UI/UIChatLog';
import {
  isPetItemId,
  EVOLUTION_ROCK_ID,
} from '../Constants/Inventory/MapleInventory';
import { dollifyPetItem } from '../Pet/PetManager';

/**
 * Cash Shop catalog — parsed once from Etc.wz/Commodity.img (8,941 entries,
 * the authentic v83 stock list) — plus the expiry helpers for Period-based
 * rental items. UI lives in UI/CashShopUI.ts.
 */

export interface CashCommodity {
  sn: number;
  itemId: number;
  count: number;
  price: number;
  period: number;   // rental length in days; 0 = permanent
  priority: number; // sort weight from the WZ (higher = more featured)
  gender: number;   // 0 male, 1 female, 2 both (informational in v1)
  onSale: boolean;
}

let commodityCache: CashCommodity[] | null = null;

export async function loadCommodities(): Promise<CashCommodity[]> {
  if (commodityCache) return commodityCache;
  const root: any = await WZManager.get('Etc.wz/Commodity.img');
  const out: CashCommodity[] = [];
  for (const node of root.nChildren) {
    const itemId = node.ItemId?.nValue;
    const price = node.Price?.nValue;
    // ~82 rows ship without a price — unpurchasable, drop them. The Limit
    // field is mojibake in the v83 dump and deliberately ignored.
    if (!itemId || !price) continue;
    // v1 exclusion: packages (91xxxxx — no names exist anywhere in String.wz)
    if (itemId >= 9000000) continue;
    out.push({
      sn: node.SN?.nValue ?? 0,
      itemId,
      count: node.Count?.nValue ?? 1,
      price,
      period: node.Period?.nValue ?? 0,
      priority: node.Priority?.nValue ?? 0,
      gender: node.Gender?.nValue ?? 2,
      onSale: (node.OnSale?.nValue ?? 0) === 1,
    });
  }
  commodityCache = out;
  return out;
}

/**
 * The nine CSTab/Tab banner positions, labels read off the baked strip art:
 * MAIN | EVENT | EQUIP | USE | SET-UP | ETC | PET | PACKAGE | WISH LIST.
 * EVENT/PET/PACKAGE/WISH LIST are empty in v1 and show PicturePlate/NoItem.
 */
export const CASH_TAB_COUNT = 9;

export function getCategoryItems(tab: number, all: CashCommodity[]): CashCommodity[] {
  const cat = (c: CashCommodity) => Math.floor(c.itemId / 1000000);
  const isPetStock = (id: number) =>
    isPetItemId(id) ||
    (id >= 1800000 && id < 1840000) ||
    (id >= 5240000 && id < 5250000) ||
    id === EVOLUTION_ROCK_ID;
  let filtered: CashCommodity[];
  switch (tab) {
    case 1: filtered = all.filter((c) => c.onSale); break;                    // MAIN (featured)
    case 3: filtered = all.filter((c) => cat(c) === 1 && !isPetStock(c.itemId)); break; // EQUIP (avatar items)
    case 4:                                                                   // USE (+ cash effects/megaphones)
      filtered = all.filter(
        (c) => cat(c) === 2 || (cat(c) === 5 && !isPetStock(c.itemId))
      );
      break;
    case 5: filtered = all.filter((c) => cat(c) === 3); break;                // SET-UP
    case 6: filtered = all.filter((c) => cat(c) === 4); break;                // ETC
    case 7: filtered = all.filter((c) => isPetStock(c.itemId)); break;        // PET — live pets, food, equips, evolution rock
    default: filtered = []; break;                                            // EVENT / PACKAGE / WISH LIST
  }
  // Priority-desc, then SN for a stable order matching the original's featuring
  const sorted = filtered.sort((a, b) => b.priority - a.priority || a.sn - b.sn);
  if (tab !== 7) return sorted;
  // PET tab only: the catalog carries ~209 SKUs over ~40 pet species —
  // dedupe by itemId, preferring OnSale rows (the live storefront pricing)
  const seen = new Map<number, CashCommodity>();
  for (const c of sorted) {
    const prev = seen.get(c.itemId);
    if (!prev || (c.onSale && !prev.onSale)) seen.set(c.itemId, c);
  }
  return [...seen.values()];
}

/**
 * v83 face-expression coupons (5160000-5160014). Owning one lets the player
 * fire the expression — by double-click or a key binding. The WZ carries no
 * itemId→expression field; the original client pairs them in code, so this
 * table pairs each coupon name with its Face.wz expression node.
 */
export const FACE_COUPON_EXPRESSIONS: Record<number, string> = {
  5160000: 'vomit',   // Queasy
  5160001: 'oops',    // Panicky
  5160002: 'cheers',  // Sweetness
  5160003: 'chu',     // Smoochies
  5160004: 'wink',    // Wink
  5160005: 'pain',    // Ouch
  5160006: 'glitter', // Sparkling Eyes
  5160007: 'blaze',   // Flaming
  5160008: 'shine',   // Ray
  5160009: 'love',    // Goo Goo
  5160010: 'hum',     // Whoa Whoa
  5160011: 'despair', // Constant Sigh
  5160012: 'hot',     // Drool
  5160013: 'dam',     // Dragon Breath
  5160014: 'bowing',  // Bleh
};

// ---------------------------------------------------------------------------
// Pets

/**
 * Fresh blob for a just-purchased pet. Pets have Commodity Period=0 — their
 * clock is the WZ info/life (days); permanent pets get no expireAt at all.
 */
export async function makeNewPetBlob(itemId: number): Promise<any> {
  let lifeDays = 90;
  let permanent = false;
  try {
    const info: any = await WZManager.get(`Item.wz/Pet/${itemId}.img/info`);
    lifeDays = info?.life?.nValue ?? 90;
    permanent = (info?.permanent?.nValue ?? 0) === 1 || lifeDays === 0;
  } catch { /* keep 90-day default */ }
  const name = getItemNameSync(itemId);
  return {
    bonus: {},
    tuc: 0,
    level: 0,
    petName: name !== 'item' ? name : `Pet ${itemId}`,
    petLevel: 1,
    closeness: 0,
    fullness: 100,
    ...(permanent ? {} : { expireAt: Date.now() + lifeDays * 86400000 }),
  };
}

// ---------------------------------------------------------------------------
// Expiry

export function computeExpireAt(periodDays: number): number | undefined {
  return periodDays > 0 ? Date.now() + periodDays * 86400000 : undefined;
}

/** "89d 23h" / "5h" / "<1h" — or "Expired" once past. */
export function formatRemaining(expireAt: number): string {
  const ms = expireAt - Date.now();
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return '<1h';
}

/**
 * Remove expired rentals: nulls expired slots across all five inventory tabs
 * (holes preserved, like removeFromInventory) and detaches expired equipped
 * gear. Runs in both restore paths BEFORE _restoreComplete flips, so the
 * follow-up save persists the removal.
 */
export async function sweepExpiredCashItems(character: any): Promise<void> {
  const now = Date.now();
  const inv = character?.inventory;
  if (!inv) return;

  const expiredNames: string[] = [];
  for (const tab of [inv.equip, inv.use, inv.setup, inv.etc, inv.cash]) {
    if (!Array.isArray(tab)) continue;
    for (let i = 0; i < tab.length; i++) {
      const item = tab[i];
      if (!item?.equipData) continue;
      // A pet's worn equips each carry their own rental clock in the blob
      if (item.equipData.petEquipExpireAt && item.equipData.petEquipExpireAt <= now) {
        expiredNames.push(getItemNameSync(item.equipData.petEquipId) || 'Pet equip');
        delete item.equipData.petEquipId;
        delete item.equipData.petEquipExpireAt;
      }
      if (item.equipData.petEquips) {
        for (const [slotKey, entry] of Object.entries<any>(item.equipData.petEquips)) {
          if (entry?.expireAt && entry.expireAt <= now) {
            expiredNames.push(getItemNameSync(entry.id) || 'Pet equip');
            delete item.equipData.petEquips[slotKey];
          }
        }
      }
      if (item.equipData.expireAt && item.equipData.expireAt <= now) {
        if (isPetItemId(item.itemId)) {
          // Pet life ran out → the pet becomes a doll. NEVER delete the
          // slot — the doll item stays, unsummonable, with iconD art
          dollifyPetItem(item);
          continue;
        }
        expiredNames.push(getItemNameSync(item.itemId) || `Item #${item.itemId}`);
        tab[i] = null;
      }
    }
  }

  let detached = false;
  for (const slotStr of Object.keys(character.equippedItemData || {})) {
    const slot = Number(slotStr);
    const data = character.equippedItemData[slot];
    if (data?.expireAt && data.expireAt <= now) {
      const itemId = character.equippedItemIds?.[slot];
      expiredNames.push(getItemNameSync(itemId) || `Item #${itemId}`);
      character.detachEquip(slot);
      detached = true;
    }
  }
  if (detached) character.recalcLocalStats?.();

  for (const name of expiredNames) {
    UIChatLog.notice(`Your ${name} has expired.`);
  }
  if (expiredNames.length) (window as any).__mySocket?.requestSave?.();
}
