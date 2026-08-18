import MapleInventory, {
  MapleInventoryType,
} from "../Constants/Inventory/MapleInventory";
import Item from "./Item";
import { isMonsterCardId } from "../MonsterBook/MonsterBookData";

// cant be more than 96 cause of the UI
const maxInventorySize = 96;

class Inventory {
  equip: Item[];
  use: Item[];
  etc: Item[];
  setup: Item[];
  cash: Item[];

  // Accessor rather than a raw field so EVERY meso mutation — pickups,
  // purchases, sales, script rewards, drops — schedules a save without
  // each call site having to remember to
  private _mesos: number = 0;
  get mesos(): number {
    return this._mesos;
  }
  set mesos(v: number) {
    if (v === this._mesos) return;
    this._mesos = v;
    (window as any).__mySocket?.requestSave?.();
  }

  // NX (Cash Shop currency) — same save-on-mutation contract as mesos
  private _nx: number = 0;
  get nx(): number {
    return this._nx;
  }
  set nx(v: number) {
    if (v === this._nx) return;
    this._nx = v;
    (window as any).__mySocket?.requestSave?.();
  }

  constructor(opts: any) {
    this.equip = opts.equip || [];
    this.use = opts.use || [];
    this.etc = opts.etc || [];
    this.setup = opts.setup || [];
    this.cash = opts.cash || [];
    this.mesos = opts.mesos || 0;
    this.nx = opts.nx || 0;
  }

  /**
   * Merge same-item partial stacks left-to-right, repairing inventories
   * fragmented by the old first-stack-only fill in addToInventory. Runs on
   * restore. Slots emptied by merging are nulled in place so the remaining
   * items keep their positions. Equips and pets never merge (slotMax 1),
   * and anything carrying an equipData blob (rentals, pet state) is
   * skipped outright so distinct blobs can't collapse into one stack.
   */
  compactStacks() {
    for (const tab of [this.use, this.setup, this.etc, this.cash]) {
      for (let i = 0; i < tab.length; i++) {
        const target: any = tab[i];
        if (!target || target.equipData) continue;
        const slotMax = target.getSlotMax?.() ?? 100;
        if (slotMax <= 1) continue;
        for (let j = i + 1; j < tab.length && target.quantity < slotMax; j++) {
          const src: any = tab[j];
          if (!src || src.itemId !== target.itemId || src.equipData) continue;
          const put = Math.min(slotMax - target.quantity, src.quantity);
          target.quantity += put;
          src.quantity -= put;
          if (src.quantity <= 0) (tab as any)[j] = null;
        }
      }
    }
  }

  /** Clamped meso mutation — v83 caps at int32 max, never below 0 */
  gainMesos(amount: number) {
    const MESO_CAP = 2147483647;
    this.mesos = Math.max(0, Math.min(MESO_CAP, this.mesos + amount));
  }

  /** Clamped NX mutation — never below 0, capped like mesos */
  gainNX(amount: number) {
    const NX_CAP = 2147483647;
    this.nx = Math.max(0, Math.min(NX_CAP, this.nx + amount));
  }

  async addToInventory(itemId: number | string, quantity: number, equipData?: any) {
    itemId = typeof itemId === 'string' ? parseInt(itemId, 10) : itemId;
    console.log("Adding to inventory", itemId, quantity);
    // Item gained — persist soon (mesos route through their own setter)
    (window as any).__mySocket?.requestSave?.();
    if (MapleInventory.isMeso(itemId.toString())) {
      this.gainMesos(quantity);
    } else if (isMonsterCardId(itemId) && (window as any).charecter?.monsterBook) {
      // Monster cards never occupy an inventory slot in v83 — their WZ spec
      // carries `consumeOnPickup`, so the card is spent registering itself in
      // the Monster Book. Gating it here rather than only at pickup covers
      // every other way an item is granted (quest and NPC script rewards),
      // so a card can't reach a tab by a route nobody thought of.
      const book = (window as any).charecter.monsterBook;
      for (let i = 0; i < Math.max(1, quantity); i++) book.addCard(itemId);
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

      // Fill existing stacks up to slotMax, then open new stacks in free
      // slots. Every matching stack gets topped up — checking only the first
      // one meant that once it was full, each pickup opened another 1-qty
      // slot forever instead of filling the partial overflow stacks.
      // (Equips and pets have slotMax 1, so they never merge here.)
      let remaining = quantity;
      for (const existing of chosenType) {
        if (remaining <= 0) break;
        if (!existing || existing.itemId !== itemId) continue;
        const slotMax = existing.getSlotMax?.() ?? 100;
        const room = slotMax - existing.quantity;
        if (room > 0) {
          const put = Math.min(room, remaining);
          existing.quantity += put;
          remaining -= put;
        }
      }

      while (remaining > 0) {
        // equipData only applies to the first created item — equips never
        // stack, so there is exactly one for a picked-up piece of gear
        const newItem = await Item.fromOpts({ itemId, quantity: 1, equipData });
        equipData = undefined;
        // Cash-flagged equips (WZ info/cash) are costume covers and live in
        // the CASH tab, like v83 — regular gear drops keep going to Equip
        if (
          mapleInventoryType === MapleInventoryType.EQUIP &&
          newItem.isCashItem?.()
        ) {
          chosenType = this.cash;
        }
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

  /**
   * Null one exact slot in a tab. Pet operations must use this instead of
   * removeFromInventory — matching by itemId could hit the wrong same-species
   * pet and destroy its closeness/name blob.
   */
  removeAt(tab: MapleInventoryType, slot: number): boolean {
    const tabMap: Partial<Record<MapleInventoryType, Item[]>> = {
      [MapleInventoryType.EQUIP]: this.equip,
      [MapleInventoryType.USE]: this.use,
      [MapleInventoryType.SETUP]: this.setup,
      [MapleInventoryType.ETC]: this.etc,
      [MapleInventoryType.CASH]: this.cash,
    };
    const items = tabMap[tab];
    if (!items || !items[slot]) return false;
    items[slot] = null as any;
    (window as any).__mySocket?.requestSave?.();
    return true;
  }

  removeFromInventory(itemId: number, quantity: number = 1): boolean {
    // Item consumed/dropped/sold — persist soon
    (window as any).__mySocket?.requestSave?.();
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
