import MapleInventory from "../Constants/Inventory/MapleInventory";
import WZFiles from "../Constants/enums/WZFiles";
import WZManager from "../wz-utils/WZManager";

// Per-instance equip data: scroll bonuses + remaining upgrade slots
export interface EquipData {
  bonus: Record<string, number>; // WZ inc* keys (incSTR, incPAD, ...) added by scrolls
  tuc: number;                   // remaining upgrade slots
  level: number;                 // scrolls passed
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

  /** Max stack size from WZ slotMax (equips 1; stackables default 100) */
  getSlotMax(): number {
    const category = Math.floor(this.itemId / 1000000);
    if (category === 1) return 1;
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
        const firstThreeDigits = Math.floor(this.itemId / 10000);
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
        if (dir) {
          try {
            this.node = await WZManager.get(`Character.wz/${dir}/0${this.itemId}.img`);
          } catch (e) {
            console.warn(`Failed to load equip item ${this.itemId} from Character.wz/${dir}`);
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

      const wzInventoryType = MapleInventory.getWzNameFromInventoryId(
        this.itemId.toString().padStart(8, "0")
      );
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
    }
  }
}

export default Item;
