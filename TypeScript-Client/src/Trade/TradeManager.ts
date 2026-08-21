/**
 * Client trade state — the local mirror of one server trade session
 * (server/handlers/trade.js owns the session; this side owns the inventory).
 *
 * v83 rules as they survive the relay model: one trade at a time, same map,
 * nothing leaves either inventory until the server says `trade_complete`,
 * an offer is frozen the moment its owner presses TRADE, and the mesos that
 * arrive are already net of the trade tax painted on the window.
 *
 * Items are referenced by (tab, slot) rather than by id so that exactly the
 * offered instance — with its scroll bonuses / pet blob — is the one that
 * moves. removeAt() for whole slots, a quantity decrement for part of a
 * stack; never removeFromInventory(itemId), which could hit a sibling stack.
 */

import { MapleInventoryType } from '../Constants/Inventory/MapleInventory';
import { getItemFlags } from '../Inventory/ItemRestrictions';
import UIChatLog from '../UI/UIChatLog';

export interface TradeItem {
  itemId: number;
  qty: number;
  equipData?: any;
  tab: number;  // MapleInventoryType of the source slot (own items only)
  slot: number; // index in that tab (own items only)
}

export interface TradeChatLine {
  from: string; // character name, or '' for a system line
  text: string;
}

export interface TradeSession {
  id: number;
  partnerId: string;
  partnerName: string;
  mapId: number;
  myItems: TradeItem[];
  myMesos: number;
  myLocked: boolean;
  partnerItems: TradeItem[];
  partnerMesos: number;
  partnerLocked: boolean;
  chat: TradeChatLine[];
}

export interface PendingTradeRequest {
  tradeId: number;
  fromId: string;
  fromName: string;
}

export const TRADE_MAX_ITEMS = 9;
const MESO_CAP = 2147483647;
const CHAT_KEEP = 200;

/** v83 meso trade tax (same table the server applies) */
export function tradeMesoFee(meso: number): number {
  let rate = 0;
  if (meso >= 100000000) rate = 0.06;
  else if (meso >= 25000000) rate = 0.05;
  else if (meso >= 10000000) rate = 0.04;
  else if (meso >= 5000000) rate = 0.03;
  else if (meso >= 1000000) rate = 0.018;
  else if (meso >= 100000) rate = 0.008;
  return Math.floor(meso * rate);
}

function tabArray(inventory: any, tab: number): any[] | null {
  switch (tab) {
    case MapleInventoryType.EQUIP: return inventory?.equip ?? null;
    case MapleInventoryType.USE: return inventory?.use ?? null;
    case MapleInventoryType.SETUP: return inventory?.setup ?? null;
    case MapleInventoryType.ETC: return inventory?.etc ?? null;
    case MapleInventoryType.CASH: return inventory?.cash ?? null;
    default: return null;
  }
}

class TradeManagerClass {
  session: TradeSession | null = null;
  pendingRequest: PendingTradeRequest | null = null;
  /** Set while our own request is out and unanswered */
  outgoingRequest = false;

  /**
   * Facts the window knows and this module must not import (CashShopUI and
   * MapleMap sit on the far side of the UI import graph): whether the Cash
   * Shop overlay is up, and which map we are on.
   */
  env: { cashShopOpen: () => boolean; mapId: () => number } | null = null;

  /** UI hooks — the window subscribes to these */
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onChanged: (() => void) | null = null;
  onRequest: (() => void) | null = null;

  private hooked = false;

  private get socket(): any {
    return (window as any).__mySocket;
  }
  private get character(): any {
    return (window as any).charecter;
  }
  myId(): string {
    return this.socket?.playerId ?? '';
  }
  myName(): string {
    return String(this.character?.name ?? '');
  }

  isTrading(): boolean {
    return !!this.session;
  }

  // ---- socket wiring ---------------------------------------------------
  /** Idempotent — `on` replaces the handler for a type */
  hookSocket() {
    const sock = this.socket;
    if (!sock?.on) return;
    this.hooked = true;
    sock.on('trade_request', (msg: any) => this.handleRequest(msg?.data ?? {}));
    sock.on('trade_notice', (msg: any) => this.handleNotice(msg?.data ?? {}));
    sock.on('trade_open', (msg: any) => this.handleOpen(msg?.data ?? {}));
    sock.on('trade_update', (msg: any) => this.handleUpdate(msg?.data ?? {}));
    sock.on('trade_locked', (msg: any) => this.handleLocked(msg?.data ?? {}));
    sock.on('trade_complete', (msg: any) => this.handleComplete(msg?.data ?? {}));
    sock.on('trade_cancelled', (msg: any) => this.handleCancelled(msg?.data ?? {}));
    sock.on('trade_chat', (msg: any) => this.handleChat(msg?.data ?? {}));
  }

  private send(type: string, data: any) {
    if (!this.hooked) this.hookSocket();
    this.socket?.sendMessage?.({ type, data });
  }

  // ---- guards ----------------------------------------------------------
  /** Why the local player cannot start or accept a trade right now, or null */
  blockedReason(): string | null {
    const ch = this.character;
    if (!ch) return 'Unable to trade right now.';
    if (ch.isDead) return 'You cannot trade while dead.';
    if (this.env?.cashShopOpen?.()) return 'You cannot trade inside the Cash Shop.';
    if (this.session) return 'You are already trading with someone.';
    return null;
  }

  // ---- actions ---------------------------------------------------------
  request(targetId: string) {
    const why = this.blockedReason();
    if (why) {
      UIChatLog.system(why);
      return;
    }
    if (!targetId || targetId === this.myId()) return;
    this.outgoingRequest = true;
    this.send('trade_request', { targetId });
  }

  respond(accept: boolean) {
    const req = this.pendingRequest;
    this.pendingRequest = null;
    if (!req) return;
    if (accept) {
      const why = this.blockedReason();
      if (why) {
        UIChatLog.system(why);
        accept = false;
      }
    }
    this.send('trade_response', { tradeId: req.tradeId, accept });
    this.onChanged?.();
  }

  /** Quantity of one inventory slot already sitting in our offer */
  offeredFromSlot(tab: number, slot: number): number {
    if (!this.session) return 0;
    return this.session.myItems
      .filter((it) => it.tab === tab && it.slot === slot)
      .reduce((n, it) => n + it.qty, 0);
  }

  /**
   * Put `qty` of the item in (tab, slot) on the table. Returns a message for
   * the player when it cannot be done, null on success.
   */
  async offerItem(tab: number, slot: number, qty: number): Promise<string | null> {
    const s = this.session;
    if (!s) return null;
    if (s.myLocked) return 'You cannot change your offer after confirming.';
    const arr = tabArray(this.character?.inventory, tab);
    const item = arr?.[slot];
    if (!item) return 'That item is no longer in your inventory.';
    const already = this.offeredFromSlot(tab, slot);
    if (already > 0 && (item.getSlotMax?.() ?? 100) <= 1) {
      return 'That item is already in the trade window.';
    }
    qty = Math.max(1, Math.floor(qty));
    if (already + qty > item.quantity) {
      return already > 0
        ? `You only have ${item.quantity - already} more of those.`
        : `You only have ${item.quantity} of those.`;
    }
    const topUp = s.myItems.some((it) => it.tab === tab && it.slot === slot);
    if (!topUp && s.myItems.length >= TRADE_MAX_ITEMS) return 'The trade window is full.';

    const flags = await getItemFlags(item.itemId).catch(() => null);
    if (flags?.tradeBlock || flags?.quest) return 'This item cannot be traded.';
    // The await above yields — re-check that the world did not move on
    if (this.session !== s || s.myLocked) return null;

    const entry: TradeItem = { itemId: item.itemId, qty, tab, slot };
    if (item.equipData) {
      try {
        entry.equipData = JSON.parse(JSON.stringify(item.equipData));
      } catch {
        entry.equipData = undefined;
      }
    }
    // Topping up an already-offered stack extends that entry instead of
    // spending a second cell on the same slot
    const existing = s.myItems.find((it) => it.tab === tab && it.slot === slot);
    if (existing) existing.qty += qty;
    else s.myItems.push(entry);
    this.pushOffer();
    this.onChanged?.();
    return null;
  }

  setMesos(amount: number): string | null {
    const s = this.session;
    if (!s) return null;
    if (s.myLocked) return 'You cannot change your offer after confirming.';
    const have = Number(this.character?.inventory?.mesos ?? 0);
    amount = Math.max(0, Math.min(MESO_CAP, Math.floor(amount) || 0));
    if (amount > have) return "You don't have enough mesos.";
    s.myMesos = amount;
    this.pushOffer();
    this.onChanged?.();
    return null;
  }

  private pushOffer() {
    const s = this.session;
    if (!s) return;
    this.send('trade_offer', {
      tradeId: s.id,
      items: s.myItems.map((it) => ({
        itemId: it.itemId,
        qty: it.qty,
        tab: it.tab,
        slot: it.slot,
        equipData: it.equipData,
      })),
      mesos: s.myMesos,
    });
  }

  /**
   * Whether everything we offered is still in the inventory. Checked before
   * confirming and again when the server settles — the relay cannot see our
   * bags, so we must refuse to complete a trade we can no longer honour.
   */
  offerStillValid(): boolean {
    const s = this.session;
    if (!s) return false;
    const inv = this.character?.inventory;
    if (!inv) return false;
    if (s.myMesos > Number(inv.mesos ?? 0)) return false;
    const perSlot = new Map<string, number>();
    for (const it of s.myItems) {
      const key = `${it.tab}:${it.slot}`;
      perSlot.set(key, (perSlot.get(key) ?? 0) + it.qty);
    }
    for (const it of s.myItems) {
      const item = tabArray(inv, it.tab)?.[it.slot];
      if (!item || item.itemId !== it.itemId) return false;
      if ((perSlot.get(`${it.tab}:${it.slot}`) ?? 0) > item.quantity) return false;
    }
    return true;
  }

  confirm() {
    const s = this.session;
    if (!s || s.myLocked) return;
    if (!this.offerStillValid()) {
      UIChatLog.system('The trade was cancelled: an offered item is no longer available.');
      this.cancel();
      return;
    }
    s.myLocked = true;
    this.send('trade_confirm', { tradeId: s.id });
    this.onChanged?.();
  }

  cancel() {
    const s = this.session;
    if (s) {
      this.send('trade_cancel', { tradeId: s.id });
      this.closeSession('The trade was cancelled.');
      return;
    }
    if (this.outgoingRequest) {
      this.outgoingRequest = false;
      this.send('trade_cancel', {});
    }
  }

  chat(text: string) {
    const s = this.session;
    const line = text.replace(/[\r\n\t]/g, ' ').trim();
    if (!s || !line) return;
    this.send('trade_chat', { tradeId: s.id, text: line.slice(0, 200) });
  }

  // ---- incoming ----------------------------------------------------------
  private handleRequest(d: any) {
    const tradeId = Number(d.tradeId);
    const fromName = String(d.from?.name ?? '???');
    const fromId = String(d.from?.id ?? '');
    if (!Number.isFinite(tradeId)) return;
    // Cannot take it right now: answer no, so the requester is not left
    // staring at "You have requested a trade" until the request expires
    if (this.blockedReason()) {
      this.send('trade_response', { tradeId, accept: false });
      return;
    }
    this.pendingRequest = { tradeId, fromId, fromName };
    this.onRequest?.();
    this.onChanged?.();
  }

  private handleNotice(d: any) {
    const text = String(d.text ?? '');
    if (!text) return;
    // Anything that answers our outstanding request ends it
    if (/declined|did not answer|Unable to find|already trading/.test(text)) {
      this.outgoingRequest = false;
    }
    UIChatLog.system(text);
  }

  private handleOpen(d: any) {
    this.outgoingRequest = false;
    this.pendingRequest = null;
    const mapId = Number(this.env?.mapId?.() ?? 0);
    this.session = {
      id: Number(d.tradeId),
      partnerId: String(d.partner?.id ?? ''),
      partnerName: String(d.partner?.name ?? '???'),
      mapId,
      myItems: [],
      myMesos: 0,
      myLocked: false,
      partnerItems: [],
      partnerMesos: 0,
      partnerLocked: false,
      chat: [],
    };
    this.onOpen?.();
    this.onChanged?.();
  }

  private handleUpdate(d: any) {
    const s = this.session;
    if (!s || Number(d.tradeId) !== s.id) return;
    const items = Array.isArray(d.items) ? d.items : [];
    s.partnerItems = items.slice(0, TRADE_MAX_ITEMS).map((it: any) => ({
      itemId: Number(it.itemId) || 0,
      qty: Math.max(1, Number(it.qty) || 1),
      equipData: it.equipData,
      tab: Number(it.tab) || 0,
      slot: Number(it.slot) || 0,
    }));
    s.partnerMesos = Math.max(0, Number(d.mesos) || 0);
    this.onChanged?.();
  }

  private handleLocked(d: any) {
    const s = this.session;
    if (!s || Number(d.tradeId) !== s.id) return;
    s.partnerLocked = true;
    this.addSystemLine(`'${s.partnerName}' has confirmed the trade.`);
    this.onChanged?.();
  }

  private handleCancelled(d: any) {
    const tradeId = Number(d.tradeId);
    if (this.pendingRequest && this.pendingRequest.tradeId === tradeId) {
      this.pendingRequest = null;
      this.onChanged?.();
      return;
    }
    if (this.outgoingRequest && !this.session) {
      this.outgoingRequest = false;
      UIChatLog.system('The trade request was cancelled.');
      return;
    }
    const s = this.session;
    if (!s || tradeId !== s.id) return;
    const reason = String(d.reason ?? '');
    this.closeSession(
      reason === 'partner_left'
        ? `'${s.partnerName}' has left; the trade was cancelled.`
        : 'The trade was cancelled.',
    );
  }

  private handleChat(d: any) {
    const s = this.session;
    if (!s || Number(d.tradeId) !== s.id) return;
    const from = String(d.from?.name ?? '');
    const text = String(d.text ?? '');
    if (!text) return;
    s.chat.push({ from, text });
    if (s.chat.length > CHAT_KEEP) s.chat.splice(0, s.chat.length - CHAT_KEEP);
    this.onChanged?.();
  }

  addSystemLine(text: string) {
    const s = this.session;
    if (!s) return;
    s.chat.push({ from: '', text });
    if (s.chat.length > CHAT_KEEP) s.chat.splice(0, s.chat.length - CHAT_KEEP);
  }

  /**
   * Settlement. The server only sends this once both sides locked, and our
   * side was validated at confirm time; it is re-validated here because the
   * inventory may have changed in between (a pet ate a potion, a buff
   * expired and dropped an item...). If it no longer holds, we still apply
   * what we can — the partner's client has already given its side away, so
   * refusing now would strand their items.
   */
  private async handleComplete(d: any) {
    const s = this.session;
    if (!s || Number(d.tradeId) !== s.id) return;
    this.session = null;
    const inv = this.character?.inventory;
    if (!inv) return;

    const give = d.give ?? {};
    const receive = d.receive ?? {};

    // Give: whole slots are nulled, partial stacks decremented
    const giveItems: TradeItem[] = Array.isArray(give.items) ? give.items : [];
    for (const it of giveItems) {
      const arr = tabArray(inv, Number(it.tab));
      const item = arr?.[Number(it.slot)];
      if (!item || item.itemId !== Number(it.itemId)) {
        console.warn('[Trade] offered item missing at settlement', it);
        continue;
      }
      const qty = Math.max(1, Number(it.qty) || 1);
      if (qty >= item.quantity) {
        inv.removeAt(Number(it.tab), Number(it.slot));
      } else {
        item.quantity -= qty;
      }
    }
    const giveMesos = Math.max(0, Number(give.mesos) || 0);
    if (giveMesos > 0) inv.gainMesos(-giveMesos);

    // Receive
    const recvItems: TradeItem[] = Array.isArray(receive.items) ? receive.items : [];
    for (const it of recvItems) {
      const itemId = Number(it.itemId);
      const qty = Math.max(1, Number(it.qty) || 1);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;
      try {
        await inv.addToInventory(itemId, qty, it.equipData ?? undefined);
      } catch (e) {
        console.error('[Trade] failed to add received item', itemId, e);
      }
    }
    const recvMesos = Math.max(0, Number(receive.mesos) || 0);
    if (recvMesos > 0) inv.gainMesos(recvMesos);

    this.socket?.requestSave?.();
    UIChatLog.system('Trade completed successfully.');
    const fee = Number(receive.fee) || 0;
    if (fee > 0) {
      UIChatLog.system(`${fee.toLocaleString()} mesos were deducted as the trade fee.`);
    }
    this.onClose?.();
    this.onChanged?.();
  }

  private closeSession(notice: string) {
    this.session = null;
    UIChatLog.system(notice);
    this.onClose?.();
    this.onChanged?.();
  }
}

const TradeManager = new TradeManagerClass();
export default TradeManager;
