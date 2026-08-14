import MapleInventory from "../Constants/Inventory/MapleInventory";
import WZFiles from "../Constants/enums/WZFiles";
import WZManager from "../wz-utils/WZManager";

// Per-instance equip data: scroll bonuses + remaining upgrade slots.
// Despite the name it is the generic per-instance bag for ANY tab — the
// whole persistence pipeline (serializeTab → equip_data column → restore)
// round-trips it, which is what lets cash-item expiry ride along.
export interface EquipData {
  bonus: Record<string, number>; // WZ inc* keys (incSTR, incPAD, ...) added by scrolls
  tuc: number;                   // remaining upgrade slots
  level: number;                 // scrolls passed
  expireAt?: number;             // Cash Shop rental expiry, epoch ms; absent = permanent.
                                 // For pets this is the LIFE clock (purchase + info/life days)
  // --- pet extension (present only on 5000xxx items) ---
  petName?: string;              // species name at purchase
  petLevel?: number;             // 1..30
  closeness?: number;            // 0..30000, ExpTable.pet thresholds
  fullness?: number;             // 0..100
  dead?: boolean;                // life expired → doll (iconD, unsummonable)
  summoned?: boolean;            // out at last save → respawn on login
  // Worn pet equips, keyed by panel slot (equip/itemPouch/mesoMagnet/
  // hpPouch/mpPouch/sweep/binocular/scales/ignore/labelRing/quoteRing).
  // Each entry keeps its own rental clock. Lives in the blob, not char slots.
  petEquips?: Record<string, { id: number; expireAt?: number }>;
  petEquipId?: number;           // legacy single-slot form — migrated into petEquips
  petEquipExpireAt?: number;     // legacy
  lifeUsedSec?: number;          // limitedLife pets only (5000054): cumulative summoned seconds
}

/**
 * WZ path for an equip item (category 1) — equips live in Character.wz,
 * organized by directory per item-id prefix, unlike all other item types.
 * Returns null for non-equips or unknown prefixes.
 */
export function getEquipWzPath(itemId: number): string | null {
  if (Math.floor(itemId / 1000000) !== 1) return null;
  const firstThreeDigits = Math.floor(itemId / 10000);
  const equipDirMap: Record<number, string> = {
    100: 'Cap', 101: 'Accessory', 102: 'Accessory', 103: 'Accessory',
    104: 'Coat', 105: 'Longcoat', 106: 'Pants', 107: 'Shoes',
    108: 'Glove', 109: 'Shield', 110: 'Cape', 111: 'Ring', 112: 'Accessory',
    113: 'Accessory', 114: 'Accessory',
    180: 'PetEquip', 181: 'PetEquip', 182: 'PetEquip', 183: 'PetEquip',
    190: 'TamingMob', 191: 'TamingMob', 193: 'TamingMob',
  };
  // Weapons: 130-170
  let dir = equipDirMap[firstThreeDigits];
  if (!dir && firstThreeDigits >= 130 && firstThreeDigits <= 170) {
    dir = 'Weapon';
  }
  return dir ? `Character.wz/${dir}/0${itemId}.img` : null;
}

interface ItemOpts {
  itemId: number;
  quantity: number;
  equipData?: EquipData;
}

class Item {
  opts: ItemOpts;
  itemId: number;
  // name: string;
  // description: string;
  // price: number;
  quantity: number;
  node: any;
  equipData: EquipData | null = null;

  static async fromOpts(opts: ItemOpts) {
    const object = new Item(opts);
    await object.load();
    return object;
  }
  constructor(opts: ItemOpts) {
    this.opts = opts;
    this.itemId = opts.itemId;
    // this.name = name;
    // this.description = description;
    // this.price = price;
    this.quantity = opts.quantity || 1;
    this.node = null;
  }

  /**
   * WZ info/cash flag. Cash-flagged equips live in the CASH inventory tab
   * and wear as costume covers (slot base+100), never as stat gear.
   */
  isCashItem(): boolean {
    return (this.node?.info?.cash?.nValue ?? 0) === 1;
  }

  /** Max stack size from WZ slotMax (equips 1; stackables default 100) */
  getSlotMax(): number {
    const category = Math.floor(this.itemId / 1000000);
    if (category === 1) return 1;
    // Pets never stack — each carries its own name/closeness blob, and their
    // WZ info has no slotMax so the 100 default would merge two same-species
    // pets into one slot
    if (MapleInventory.isPetItemId(this.itemId)) return 1;
    const slotMax = this.node?.info?.slotMax?.nValue;
    return slotMax && slotMax > 0 ? slotMax : 100;
  }

  async load() {
    if (this.itemId === 0) {
      const mesoAmount = this.quantity;
      const itemId = MapleInventory.getMesosItemId(mesoAmount);
      let strId = `${itemId}`.padStart(8, "0");
      const idFirst4digits = strId.slice(0, 4);
      let itemFile = await WZManager.get(
        `${WZFiles.Item}/${MapleInventory.WzInventoryType.Special}/${idFirst4digits}.img/${itemId}`
      );
      this.node = itemFile;
    } else {
      const category = Math.floor(this.itemId / 1000000);

      // Equipment items (category 1) live in Character.wz, not Item.wz
      if (category === 1) {
        const path = getEquipWzPath(this.itemId);
        if (path) {
          try {
            this.node = await WZManager.get(path);
          } catch (e) {
            console.warn(`Failed to load equip item ${this.itemId} from ${path}`);
          }
        }
        // Equip instance data: restore saved bonuses/tuc or init from WZ
        this.equipData = this.opts.equipData ?? {
          bonus: {},
          tuc: this.node?.info?.tuc?.nValue ?? 0,
          level: 0,
        };
        return;
      }

      // Non-equips carry the per-instance bag too (cash expiry) — without
      // this the expireAt saved on a cash-tab item vanished on every restore
      this.equipData = this.opts.equipData ?? null;

      const wzInventoryType = MapleInventory.getWzNameFromInventoryId(
        this.itemId.toString().padStart(8, "0")
      );
      try {
        if (wzInventoryType === MapleInventory.WzInventoryType.Pet) {
          this.node = await WZManager.get(
            `${WZFiles.Item}/${wzInventoryType}/${this.itemId}.img`
          );
        } else if (wzInventoryType) {
          let strId = `${this.itemId}`.padStart(8, "0");
          const idFirst4digits = strId.slice(0, 4);
          let itemFile = await WZManager.get(
            `${WZFiles.Item}/${wzInventoryType}/${idFirst4digits}.img/${strId}`
          );
          this.node = itemFile;
        }
      } catch (e) {
        // A missing WZ file (e.g. a stray cash id) must not reject fromOpts —
        // the item still exists, it just has no sprite data
        console.warn(`Failed to load item ${this.itemId} (${wzInventoryType})`);
      }
    }
  }
}

export default Item;
