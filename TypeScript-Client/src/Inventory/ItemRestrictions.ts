import WZManager from "../wz-utils/WZManager";
import MapleInventory from "../Constants/Inventory/MapleInventory";

/**
 * What an item's WZ `info` node says you may do with it.
 *
 * v83 marks this per item rather than by category, and it is common: across a
 * sample of ~2,600 Etc/Install/Consume items, 546 carry `tradeBlock` and 906
 * carry `quest`. So this has to be a general rule read from the data — the
 * Relaxer chair (03010000, tradeBlock=1 notSale=1) is just the one that got
 * noticed.
 */
export interface ItemFlags {
  /** Cannot be traded, and by extension cannot be dropped. */
  tradeBlock: boolean;
  /** Quest item. */
  quest: boolean;
  /** One-of-a-kind. */
  only: boolean;
  /** Shops will not buy it. */
  notSale: boolean;
}

const NONE: ItemFlags = { tradeBlock: false, quest: false, only: false, notSale: false };
const cache = new Map<number, ItemFlags>();

/** Character.wz subdirectory for an equip id, mirroring ShopData's map. */
function equipDir(itemId: number): string | null {
  const p = Math.floor(itemId / 10000);
  const map: Record<number, string> = {
    100: "Cap", 101: "Accessory", 102: "Accessory", 103: "Accessory",
    104: "Coat", 105: "Longcoat", 106: "Pants", 107: "Shoes",
    108: "Glove", 109: "Shield", 110: "Cape", 111: "Ring",
    112: "Accessory", 113: "Accessory", 114: "Accessory",
    190: "TamingMob", 191: "TamingMob", 193: "TamingMob",
  };
  if (p >= 130 && p <= 170) return "Weapon";
  return map[p] ?? null;
}

async function readInfo(itemId: number): Promise<any | null> {
  const category = Math.floor(itemId / 1000000);
  const strId = itemId.toString().padStart(8, "0");
  if (category === 1) {
    const dir = equipDir(itemId);
    if (!dir) return null;
    return await WZManager.get(`Character.wz/${dir}/0${itemId}.img/info`);
  }
  const wzType = MapleInventory.getWzNameFromInventoryId(strId);
  if (!wzType) return null;
  const prefix = strId.slice(0, 4);
  return await WZManager.get(`Item.wz/${wzType}/${prefix}.img/${strId}/info`);
}

/**
 * Cached flags for draw paths that cannot await: returns what is known now
 * (NONE until the first lookup lands) and kicks the lookup off if needed.
 */
export function getItemFlagsSync(itemId: number): ItemFlags {
  const hit = cache.get(itemId);
  if (hit) return hit;
  void getItemFlags(itemId);
  return NONE;
}

/** Read (and cache) an item's restriction flags. Unknown items are unrestricted. */
export async function getItemFlags(itemId: number): Promise<ItemFlags> {
  const hit = cache.get(itemId);
  if (hit) return hit;
  let flags: ItemFlags = { ...NONE };
  try {
    const info: any = await readInfo(itemId);
    if (info) {
      const on = (k: string) => Number(info?.[k]?.nValue ?? 0) === 1;
      flags = {
        tradeBlock: on("tradeBlock"),
        quest: on("quest"),
        only: on("only"),
        notSale: on("notSale"),
      };
    }
  } catch {
    // Missing WZ data must not make an ordinary item undroppable.
  }
  cache.set(itemId, flags);
  return flags;
}

/**
 * Whether the item may be thrown on the ground.
 *
 * Untradeable and quest items may not — that is what the orange
 * "Cannot be traded" line in their own tooltip is telling the player, and
 * until now nothing enforced it.
 */
export async function canDropItem(itemId: number): Promise<boolean> {
  const f = await getItemFlags(itemId);
  return !f.quest;
}

/**
 * v83: an untradeable item (tradeBlock) CAN be dropped, but the client first
 * warns that it will be gone, and the drop vanishes instead of landing on
 * the floor (the emulator's "disappearing item drop"). Quest items never get
 * that far — canDropItem refuses them outright.
 */
export async function dropVanishes(itemId: number): Promise<boolean> {
  const f = await getItemFlags(itemId);
  return f.tradeBlock && !f.quest;
}

export const UNTRADEABLE_DROP_WARNING =
  'This item cannot be traded. If you drop it, it will disappear. Are you sure you want to drop it?';
