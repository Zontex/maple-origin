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

  /** Clamped meso mutation — v83 caps at int32 max, never below 0 */
  gainMesos(amount: number) {
    const MESO_CAP = 2147483647;
    this.mesos = Math.max(0, Math.min(MESO_CAP, this.mesos + amount));
  }

  async addToInventory(itemId: number | string, quantity: number) {
    itemId = typeof itemId === 'string' ? parseInt(itemId, 10) : itemId;
    console.log("Adding to inventory", itemId, quantity);
    if (MapleInventory.isMeso(itemId.toString())) {
      this.gainMesos(quantity);
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

      // Fill existing stacks up to slotMax, then open new stacks in free slots
      let remaining = quantity;
      const existing = chosenType.find((item) => item?.itemId === itemId);
      if (existing) {
        const slotMax = existing.getSlotMax?.() ?? 100;
        const room = slotMax - existing.quantity;
        if (room > 0) {
          const put = Math.min(room, remaining);
          existing.quantity += put;
          remaining -= put;
        }
      }

      while (remaining > 0) {
        const newItem = await Item.fromOpts({ itemId, quantity: 1 });
        const slotMax = newItem.getSlotMax?.() ?? 100;
        newItem.quantity = Math.min(slotMax, remaining);
        remaining -= newItem.quantity;

        // Fill the first empty slot so slot positions stay stable
        let freeSlot = chosenType.findIndex((item) => !item);
        if (freeSlot === -1) freeSlot = chosenType.length;
        if (freeSlot >= maxInventorySize) {
          console.warn("Inventory tab full, cannot add item", itemId);
          return false;
        }
        chosenType[freeSlot] = newItem;
      }
    }
    return true;
  }

  /** Whether count of an item can be added without overflowing the tab */
  canHold(itemId: number, count: number = 1): boolean {
    const mapleInventoryType = MapleInventory.getInventoryTypeFromItemId(itemId);
    const tab: (Item | null)[] =
      mapleInventoryType === MapleInventoryType.EQUIP ? this.equip
      : mapleInventoryType === MapleInventoryType.USE ? this.use
      : mapleInventoryType === MapleInventoryType.SETUP ? this.setup
      : mapleInventoryType === MapleInventoryType.ETC ? this.etc
      : this.cash;
    let room = 0;
    let usedSlots = 0;
    for (const item of tab) {
      if (!item) continue;
      usedSlots++;
      if (item.itemId === itemId) {
        room += Math.max(0, (item.getSlotMax?.() ?? 100) - item.quantity);
      }
    }
    const freeSlots = Math.max(0, maxInventorySize - Math.max(usedSlots, tab.filter(Boolean).length));
    const isEquip = Math.floor(itemId / 1000000) === 1;
    room += freeSlots * (isEquip ? 1 : 100);
    return room >= count;
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
