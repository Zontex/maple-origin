/**
 * Storage Keeper — client mirror of the server's per-account, per-world
 * storage (server/handlers/storage.js) and the rules of moving things in and
 * out of it.
 *
 * The server owns what is in the trunk; this side owns the character's bag
 * and mesos, as everywhere else. A move is therefore two halves: the bag
 * side is applied optimistically with the fee, the trunk side is requested,
 * and a refusal puts the bag back. After each accepted move the character is
 * saved at once (not on the 2s debounce) so the two ledgers never drift
 * further apart than one round trip.
 *
 * Fees come from the keeper's own WZ record: `Npc.wz/<id>/info/trunkPut`
 * (deposit, default 100) and `info/trunkGet` (withdrawal, default 0).
 */

import WZManager from '../wz-utils/WZManager';
import Item from '../Inventory/Item';
import MapleInventory, { MapleInventoryType } from '../Constants/Inventory/MapleInventory';
import ItemConstants from '../Constants/Inventory/ItemConstants';
import { getItemFlags } from '../Inventory/ItemRestrictions';
import PetManager from '../Pet/PetManager';

export interface StorageEntry {
  /** Server row id — the handle for take-out. */
  id: number;
  itemId: number;
  quantity: number;
  equipData?: any;
}

export type StorageError =
  | 'full'            // the trunk has no free slot
  | 'inventory_full'  // no room in the bag for what comes out
  | 'mesos'           // cannot pay the fee / amount out of bounds
  | 'untradeable'     // tradeBlock / quest items never enter the trunk
  | 'one_of_a_kind'   // already holding one
  | 'not_found'       // the stack is gone (another character took it)
  | 'offline'
  | 'invalid';

export interface StorageResult {
  ok: boolean;
  error?: StorageError;
}

const DEFAULT_PUT_FEE = 100;
const DEFAULT_GET_FEE = 0;
const MESO_CAP = 2147483647;
const REQUEST_TIMEOUT_MS = 8000;

const TAB_ARRAYS: Record<number, (inv: any) => any[]> = {
  [MapleInventoryType.EQUIP]: (inv) => inv.equip,
  [MapleInventoryType.USE]: (inv) => inv.use,
  [MapleInventoryType.SETUP]: (inv) => inv.setup,
  [MapleInventoryType.ETC]: (inv) => inv.etc,
  [MapleInventoryType.CASH]: (inv) => inv.cash,
};

class StorageManagerClass {
  npcId = 0;
  slots = 4;
  mesos = 0;
  items: StorageEntry[] = [];
  putFee = DEFAULT_PUT_FEE;
  getFee = DEFAULT_GET_FEE;
  /** True between a successful open() and close(). */
  isOpen = false;

  private installed = false;
  private nextReqId = 1;
  private pending = new Map<number, { resolve: (msg: any) => void; timer: number }>();
  private openWaiter: ((msg: any) => void) | null = null;
  private listeners = new Set<() => void>();
  private feeCache = new Map<number, { put: number; get: number }>();

  // ---------------------------------------------------------------- wiring

  private get socket(): any {
    return (window as any).__mySocket;
  }

  private get character(): any {
    return (window as any).charecter;
  }

  /** Hook the socket messages; idempotent. */
  install() {
    const sock = this.socket;
    if (this.installed || !sock?.on) return;
    this.installed = true;
    sock.on('storage_data', (msg: any) => {
      const d = msg?.data || {};
      this.applySnapshot(d);
      if (this.openWaiter) {
        const w = this.openWaiter;
        this.openWaiter = null;
        w(d);
      }
    });
    sock.on('storage_result', (msg: any) => {
      const d = msg?.data || {};
      const p = this.pending.get(d.reqId);
      if (!p) return;
      this.pending.delete(d.reqId);
      clearTimeout(p.timer);
      p.resolve(d);
    });
  }

  /** Subscribe to state changes (the window redraws from the live fields). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private applySnapshot(d: any) {
    if (typeof d.slots === 'number') this.slots = d.slots;
    if (typeof d.mesos === 'number') this.mesos = d.mesos;
    if (Array.isArray(d.items)) {
      this.items = d.items.map((it: any) => ({
        id: it.id, itemId: it.itemId, quantity: it.quantity ?? 1, equipData: it.equipData ?? undefined,
      }));
    }
    this.emit();
  }

  private request(type: string, data: any): Promise<any> {
    const sock = this.socket;
    if (!sock?.isConnected) return Promise.resolve({ ok: false, error: 'offline' });
    const reqId = this.nextReqId++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(reqId);
        resolve({ ok: false, error: 'offline' });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, timer });
      sock.sendMessage({ type, data: { reqId, ...data } });
    });
  }

  /** Persist the bag side right away — the trunk side is already on disk. */
  private flushSave() {
    const sock = this.socket;
    if (sock?.saveCharacterToServer) sock.saveCharacterToServer();
    else sock?.requestSave?.();
  }

  // ------------------------------------------------------------------ fees

  async loadFees(npcId: number): Promise<{ put: number; get: number }> {
    const cached = this.feeCache.get(npcId);
    if (cached) return cached;
    let put = DEFAULT_PUT_FEE;
    let get = DEFAULT_GET_FEE;
    try {
      const node: any = await WZManager.get(`Npc.wz/${`${npcId}`.padStart(7, '0')}.img`);
      const info = node?.info;
      const p = Number(info?.trunkPut?.nValue);
      const g = Number(info?.trunkGet?.nValue);
      if (Number.isFinite(p) && p >= 0) put = p;
      if (Number.isFinite(g) && g >= 0) get = g;
    } catch { /* keep defaults */ }
    const fees = { put, get };
    this.feeCache.set(npcId, fees);
    return fees;
  }

  // ------------------------------------------------------------- open/close

  /** Ask the server for the trunk; resolves false when it never answers. */
  async open(npcId: number): Promise<boolean> {
    this.install();
    const sock = this.socket;
    if (!sock?.isConnected) return false;
    this.npcId = npcId;
    const fees = await this.loadFees(npcId);
    this.putFee = fees.put;
    this.getFee = fees.get;
    const answered = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        if (this.openWaiter) { this.openWaiter = null; resolve(false); }
      }, REQUEST_TIMEOUT_MS);
      this.openWaiter = () => { clearTimeout(timer); resolve(true); };
      sock.sendMessage({ type: 'storage_open', data: { npcId } });
    });
    this.isOpen = answered;
    return answered;
  }

  close() {
    this.isOpen = false;
    this.npcId = 0;
  }

  // ----------------------------------------------------------------- store

  /**
   * Deposit `quantity` of the stack sitting at (tab, slot). Rechargeables go
   * in whole, like v83. The fee is charged up front and refunded on refusal.
   */
  async store(tab: MapleInventoryType, slot: number, quantity: number): Promise<StorageResult> {
    const character = this.character;
    const inv = character?.inventory;
    const arr = inv && TAB_ARRAYS[tab]?.(inv);
    const item: Item | undefined = arr?.[slot];
    if (!item) return { ok: false, error: 'invalid' };

    if (this.items.length >= this.slots) return { ok: false, error: 'full' };

    const flags = await getItemFlags(item.itemId);
    if (flags.tradeBlock || flags.quest) return { ok: false, error: 'untradeable' };

    if (inv.mesos < this.putFee) return { ok: false, error: 'mesos' };

    // The stack may have changed while the dialog was up
    if (arr[slot] !== item) return { ok: false, error: 'invalid' };
    let qty = ItemConstants.isRechargeable(item.itemId) ? item.quantity : Math.floor(quantity);
    if (!(qty >= 1)) return { ok: false, error: 'invalid' };
    qty = Math.min(qty, item.quantity);

    // A summoned pet goes home before it is boxed up
    const pet = PetManager.pets.find((p: any) => p.itemRef === item);
    if (pet) PetManager.despawn(pet, 'user');

    const payload = {
      itemId: item.itemId,
      quantity: qty,
      equipData: item.equipData ?? undefined,
    };

    // Bag side first (optimistic), trunk side second
    const whole = qty >= item.quantity;
    if (whole) inv.removeAt(tab, slot);
    else { item.quantity -= qty; this.socket?.requestSave?.(); }
    inv.gainMesos(-this.putFee);

    const res = await this.request('storage_store', { item: payload, tab, slot, fee: this.putFee });
    if (!res?.ok) {
      // Put it back exactly where it was
      if (whole) {
        if (!arr[slot]) arr[slot] = item;
        else await inv.addToInventory(item.itemId, qty, item.equipData ?? undefined);
      } else {
        item.quantity += qty;
      }
      inv.gainMesos(this.putFee);
      this.emit();
      return { ok: false, error: (res?.error as StorageError) || 'invalid' };
    }

    this.applySnapshot(res);
    this.flushSave();
    return { ok: true };
  }

  // --------------------------------------------------------------- take out

  /** Withdraw one stored stack into the bag. */
  async takeOut(entry: StorageEntry): Promise<StorageResult> {
    const character = this.character;
    const inv = character?.inventory;
    if (!inv) return { ok: false, error: 'invalid' };
    if (!this.items.includes(entry)) return { ok: false, error: 'not_found' };

    const flags = await getItemFlags(entry.itemId);
    if (flags.only && this.holds(entry.itemId)) return { ok: false, error: 'one_of_a_kind' };

    if (inv.mesos < this.getFee) return { ok: false, error: 'mesos' };
    if (!inv.canHold(entry.itemId, entry.quantity)) return { ok: false, error: 'inventory_full' };

    const tab = this.destinationTab(entry);
    inv.gainMesos(-this.getFee);
    const res = await this.request('storage_takeout', { id: entry.id, tab, fee: this.getFee });
    if (!res?.ok) {
      inv.gainMesos(this.getFee);
      // The server's view is the truth — if the stack is gone, drop it here too
      if (res?.error === 'not_found') this.items = this.items.filter((it) => it !== entry);
      this.emit();
      return { ok: false, error: (res?.error as StorageError) || 'invalid' };
    }

    const got = res.item || entry;
    const added = await inv.addToInventory(got.itemId, got.quantity, got.equipData ?? undefined);
    if (added === false) {
      // Room vanished between the check and the add: the stack is already
      // out of the trunk, so keep it from being lost by storing it again
      console.warn('[Storage] inventory filled during take-out; returning the stack to storage');
      await this.request('storage_store', { item: got, tab, slot: -1, fee: 0 });
      inv.gainMesos(this.getFee);
    }
    this.applySnapshot(res);
    this.flushSave();
    return added === false ? { ok: false, error: 'inventory_full' } : { ok: true };
  }

  // ------------------------------------------------------------------ mesos

  /** Positive = put mesos into the trunk, negative = take them out. */
  async moveMesos(amount: number): Promise<StorageResult> {
    const inv = this.character?.inventory;
    if (!inv) return { ok: false, error: 'invalid' };
    amount = Math.trunc(amount);
    if (!amount) return { ok: false, error: 'invalid' };
    if (amount > 0) {
      if (inv.mesos < amount) return { ok: false, error: 'mesos' };
      if (this.mesos + amount > MESO_CAP) return { ok: false, error: 'mesos' };
    } else {
      if (this.mesos < -amount) return { ok: false, error: 'mesos' };
      if (inv.mesos - amount > MESO_CAP) return { ok: false, error: 'mesos' };
    }

    inv.gainMesos(-amount);
    const res = await this.request('storage_meso', { amount });
    if (!res?.ok) {
      inv.gainMesos(amount);
      if (typeof res?.mesos === 'number') { this.mesos = res.mesos; this.emit(); }
      return { ok: false, error: (res?.error as StorageError) || 'invalid' };
    }
    this.mesos = res.mesos;
    this.emit();
    this.flushSave();
    return { ok: true };
  }

  /** Most mesos the character could deposit right now. */
  maxDeposit(): number {
    const inv = this.character?.inventory;
    return Math.max(0, Math.min(inv?.mesos ?? 0, MESO_CAP - this.mesos));
  }

  /** Most mesos the character could withdraw right now. */
  maxWithdraw(): number {
    const inv = this.character?.inventory;
    return Math.max(0, Math.min(this.mesos, MESO_CAP - (inv?.mesos ?? 0)));
  }

  // ---------------------------------------------------------------- arrange

  async arrange(): Promise<StorageResult> {
    const res = await this.request('storage_arrange', {});
    if (!res?.ok) return { ok: false, error: (res?.error as StorageError) || 'invalid' };
    this.applySnapshot(res);
    return { ok: true };
  }

  // ---------------------------------------------------------------- helpers

  private holds(itemId: number): boolean {
    const character = this.character;
    const inv = character?.inventory;
    if (!inv) return false;
    for (const arr of [inv.equip, inv.use, inv.setup, inv.etc, inv.cash]) {
      if (arr?.some((it: any) => it?.itemId === itemId)) return true;
    }
    const worn = character.equippedItemIds || {};
    return Object.values(worn).some((id) => id === itemId);
  }

  /** The tab addToInventory will use — cash-flagged equips go to CASH. */
  private destinationTab(entry: StorageEntry): MapleInventoryType {
    const base = MapleInventory.getInventoryTypeFromItemId(entry.itemId);
    if (base === MapleInventoryType.EQUIP) {
      const worn = this.character?.inventory?.cash?.find?.((it: any) => it?.itemId === entry.itemId);
      if (worn) return MapleInventoryType.CASH;
    }
    return base;
  }
}

const StorageManager = new StorageManagerClass();
(window as any).__StorageManager = StorageManager;
export default StorageManager;
