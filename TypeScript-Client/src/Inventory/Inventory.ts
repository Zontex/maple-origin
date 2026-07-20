import MapleInventory, {
  MapleInventoryType,
} from "../Constants/Inventory/MapleInventory";
import Item from "./Item";

// cant be more than 96 cause of the UI
const maxInventorySize = 96;

class Inventory {
  equip: Item[];
  use: Item[];
  etc: Item[];
  setup: Item[];
  cash: Item[];
  mesos: number;

  constructor(opts: any) {
    this.equip = opts.equip || [];
    this.use = opts.use || [];
    this.etc = opts.etc || [];
    this.setup = opts.setup || [];
    this.cash = opts.cash || [];
    this.mesos = opts.mesos || 0;
  }

  async addToInventory(itemId: number | string, quantity: number) {
    itemId = typeof itemId === 'string' ? parseInt(itemId, 10) : itemId;
    console.log("Adding to inventory", itemId, quantity);
    if (MapleInventory.isMeso(itemId.toString())) {
      this.mesos += quantity;
    } else {
      const mapleInventoryType =
        MapleInventory.getInventoryTypeFromItemId(itemId);
      let chosenType = this.cash;
      switch (mapleInventoryType) {
        case MapleInventoryType.EQUIP:
          chosenType = this.equip;
          break;
        case MapleInventoryType.USE:
          chosenType = this.use;
          break;
        case MapleInventoryType.SETUP:
          chosenType = this.setup;
          break;
        case MapleInventoryType.ETC:
          chosenType = this.etc;
          break;
        case MapleInventoryType.CASH:
          chosenType = this.cash;
          break;
        default:
          break;
      }

      const itemIndex = chosenType.findIndex((item) => item?.itemId === itemId);
      if (itemIndex === -1) {
        const newItem = await Item.fromOpts({
          itemId,
          quantity,
        });
        // Fill the first empty slot so slot positions stay stable
        let freeSlot = chosenType.findIndex((item) => !item);
        if (freeSlot === -1) freeSlot = chosenType.length;
        if (freeSlot >= maxInventorySize) {
          console.warn("Inventory tab full, cannot add item", itemId);
          return;
        }
        chosenType[freeSlot] = newItem;
      } else {
        chosenType[itemIndex].quantity += quantity;
      }
    }
    console.log(this);
  }

  removeFromInventory(itemId: number, quantity: number = 1): boolean {
    const tabs = [this.equip, this.use, this.setup, this.etc, this.cash];
    for (const tab of tabs) {
      for (let i = 0; i < tab.length; i++) {
        if (tab[i]?.itemId === itemId) {
          if (tab[i].quantity <= quantity) {
            // Null the slot (not splice) so later items keep their positions
            tab[i] = null as any;
          } else {
            tab[i].quantity -= quantity;
          }
          return true;
        }
      }
    }
    return false;
  }
}

export default Inventory;
