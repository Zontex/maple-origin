// Player-to-player trade — v83 TradingRoom semantics on the relay model.
//
// The server owns the SESSION (who is trading whom, both offers, both lock
// flags, the meso fee) but not the inventories: like drops and purchases,
// the clients apply the item movement themselves when the server declares
// the trade complete. What the server guarantees is that both sides saw the
// same final offers (an offer change after either lock is refused), that a
// player is in at most one trade, and that a trade dies the moment either
// player vanishes, changes room or cancels.
//
// Message protocol (client payloads ride under `data`; server replies are
// `{ type, data }`):
//
//   client -> server
//     trade_request  { targetId }
//         Ask to trade with a player in the same room (world+channel+map).
//     trade_response { tradeId, accept }
//         The target's answer to a pending request.
//     trade_offer    { tradeId, items: [{ itemId, qty, equipData?, tab, slot }], mesos }
//         Replace the sender's whole offer (max 9 stacks). Refused once the
//         sender has confirmed.
//     trade_confirm  { tradeId }
//         Lock the sender's offer. When both are locked the trade completes.
//     trade_cancel   { tradeId? }
//         Abort the sender's trade (pending or open).
//     trade_chat     { tradeId, text }
//         Line for the trade window's chat box.
//
//   server -> client
//     trade_request   { tradeId, from: { id, name } }          to the target
//     trade_notice    { text }                                  plain message
//     trade_open      { tradeId, partner: { id, name } }        both, on accept
//     trade_update    { tradeId, items, mesos }                 partner's offer changed
//     trade_locked    { tradeId }                               partner confirmed
//     trade_complete  { tradeId, give: { items, mesos }, receive: { items, mesos, fee } }
//         Sent to each side with its own view. `receive.mesos` is already net
//         of the v83 meso trade fee; `fee` is the amount withheld.
//     trade_cancelled { tradeId, reason }                       both sides
//     trade_chat      { tradeId, from: { id, name }, text }     both sides
//
// Nothing leaves an inventory until trade_complete, so a cancel never has
// anything to give back.

const { players, roomOf } = require('../state');
const { sendToPlayer } = require('../network');
const { registerHandler } = require('../router');

const MAX_ITEMS = 9;
const MESO_CAP = 2147483647;
const MAX_QTY = 32767;
const MAX_CHAT = 200;
const REQUEST_TTL_MS = 30000;
const SWEEP_MS = 5000;
const MAX_EQUIP_DATA_JSON = 4096;

let nextTradeId = 1;
const trades = new Map(); // tradeId -> session
const tradeOf = new Map(); // playerId -> tradeId (pending or open)

/**
 * v83 meso trade tax — the table painted on the window's lower-left panel.
 * The receiver gets the entered amount minus this.
 */
function mesoFee(meso) {
  let rate = 0;
  if (meso >= 100000000) rate = 0.06;
  else if (meso >= 25000000) rate = 0.05;
  else if (meso >= 10000000) rate = 0.04;
  else if (meso >= 5000000) rate = 0.03;
  else if (meso >= 1000000) rate = 0.018;
  else if (meso >= 100000) rate = 0.008;
  return Math.floor(meso * rate);
}

function send(playerId, type, data) {
  const p = players.get(playerId);
  if (p) sendToPlayer(p.ws, { type, data });
}

function notify(playerId, text) {
  send(playerId, 'trade_notice', { text });
}

function nameOf(playerId) {
  return players.get(playerId)?.info?.name || '???';
}

function emptyOffer() {
  return { items: [], mesos: 0, locked: false };
}

function partnerOf(session, playerId) {
  return session.a === playerId ? session.b : session.a;
}

function sessionOf(playerId) {
  const id = tradeOf.get(playerId);
  return id ? trades.get(id) || null : null;
}

function endSession(session) {
  trades.delete(session.id);
  if (tradeOf.get(session.a) === session.id) tradeOf.delete(session.a);
  if (tradeOf.get(session.b) === session.id) tradeOf.delete(session.b);
}

function cancelSession(session, reason) {
  endSession(session);
  for (const pid of [session.a, session.b]) {
    send(pid, 'trade_cancelled', { tradeId: session.id, reason });
  }
}

/** Both players still connected, registered and in the same room */
function sameRoom(aId, bId) {
  const a = players.get(aId);
  const b = players.get(bId);
  if (!a || !b || !a.info || !b.info) return false;
  return roomOf(a) === roomOf(b);
}

// ---- offer sanitising ----------------------------------------------------

function sanitizeItems(items) {
  if (!Array.isArray(items)) return null;
  if (items.length > MAX_ITEMS) return null;
  const out = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') return null;
    const itemId = Math.floor(Number(raw.itemId));
    const qty = Math.floor(Number(raw.qty));
    const tab = Math.floor(Number(raw.tab));
    const slot = Math.floor(Number(raw.slot));
    if (!Number.isFinite(itemId) || itemId <= 0) return null;
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) return null;
    if (!Number.isFinite(tab) || tab < 1 || tab > 5) return null;
    if (!Number.isFinite(slot) || slot < 0 || slot > 255) return null;
    const entry = { itemId, qty, tab, slot };
    if (raw.equipData && typeof raw.equipData === 'object') {
      let json;
      try {
        json = JSON.stringify(raw.equipData);
      } catch (e) {
        return null;
      }
      if (json.length > MAX_EQUIP_DATA_JSON) return null;
      entry.equipData = JSON.parse(json);
    }
    out.push(entry);
  }
  // One inventory slot can only be offered once
  const seen = new Set();
  for (const it of out) {
    const key = `${it.tab}:${it.slot}`;
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return out;
}

function sanitizeMesos(mesos) {
  const n = Math.floor(Number(mesos));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MESO_CAP);
}

// ---- handlers -----------------------------------------------------------

function handleTradeRequest(playerId, data) {
  const requester = players.get(playerId);
  if (!requester || !requester.info) return;
  const targetId = typeof data?.targetId === 'string' ? data.targetId : null;
  const target = targetId ? players.get(targetId) : null;
  if (!target || !target.info || targetId === playerId) {
    notify(playerId, 'Unable to find the character.');
    return;
  }
  if (!sameRoom(playerId, targetId)) {
    notify(playerId, 'Unable to find the character.');
    return;
  }
  if (sessionOf(playerId)) {
    notify(playerId, 'You are already trading with someone.');
    return;
  }
  if (sessionOf(targetId)) {
    notify(playerId, `'${nameOf(targetId)}' is already trading with someone.`);
    return;
  }

  const session = {
    id: nextTradeId++,
    a: playerId,
    b: targetId,
    state: 'pending',
    createdAt: Date.now(),
    offers: { [playerId]: emptyOffer(), [targetId]: emptyOffer() },
  };
  trades.set(session.id, session);
  tradeOf.set(playerId, session.id);
  tradeOf.set(targetId, session.id);

  send(targetId, 'trade_request', {
    tradeId: session.id,
    from: { id: playerId, name: nameOf(playerId) },
  });
  notify(playerId, `You have requested a trade with '${nameOf(targetId)}'.`);
}

function handleTradeResponse(playerId, data) {
  const session = trades.get(Number(data?.tradeId));
  if (!session || session.state !== 'pending' || session.b !== playerId) return;

  if (!data?.accept) {
    endSession(session);
    notify(session.a, `'${nameOf(playerId)}' has declined the trade.`);
    return;
  }
  if (!sameRoom(session.a, session.b)) {
    cancelSession(session, 'partner_left');
    return;
  }
  session.state = 'open';
  session.openedAt = Date.now();
  for (const pid of [session.a, session.b]) {
    const other = partnerOf(session, pid);
    send(pid, 'trade_open', {
      tradeId: session.id,
      partner: { id: other, name: nameOf(other) },
    });
  }
}

function handleTradeOffer(playerId, data) {
  const session = sessionOf(playerId);
  if (!session || session.state !== 'open' || session.id !== Number(data?.tradeId)) return;
  const offer = session.offers[playerId];
  if (offer.locked) {
    notify(playerId, 'You cannot change your offer after confirming.');
    return;
  }
  const items = sanitizeItems(data?.items);
  if (!items) {
    notify(playerId, 'Invalid trade offer.');
    return;
  }
  offer.items = items;
  offer.mesos = sanitizeMesos(data?.mesos);
  send(partnerOf(session, playerId), 'trade_update', {
    tradeId: session.id,
    items: offer.items,
    mesos: offer.mesos,
  });
}

function handleTradeConfirm(playerId, data) {
  const session = sessionOf(playerId);
  if (!session || session.state !== 'open' || session.id !== Number(data?.tradeId)) return;
  if (!sameRoom(session.a, session.b)) {
    cancelSession(session, 'partner_left');
    return;
  }
  const mine = session.offers[playerId];
  if (mine.locked) return;
  mine.locked = true;
  const partnerId = partnerOf(session, playerId);
  send(partnerId, 'trade_locked', { tradeId: session.id });

  if (!session.offers[partnerId].locked) return;

  // Both locked — settle. Each side's view: what it hands over, what it
  // gets, and the fee withheld from the mesos coming its way.
  endSession(session);
  for (const pid of [session.a, session.b]) {
    const other = partnerOf(session, pid);
    const give = session.offers[pid];
    const get = session.offers[other];
    const fee = mesoFee(get.mesos);
    send(pid, 'trade_complete', {
      tradeId: session.id,
      give: { items: give.items, mesos: give.mesos },
      receive: { items: get.items, mesos: get.mesos - fee, fee },
    });
  }
}

function handleTradeCancel(playerId, data) {
  const session = sessionOf(playerId);
  if (!session) return;
  if (data?.tradeId !== undefined && Number(data.tradeId) !== session.id) return;
  if (session.state === 'pending') {
    // Withdrawing a request, or the target dismissing it without answering
    endSession(session);
    if (playerId === session.b) {
      notify(session.a, `'${nameOf(playerId)}' has declined the trade.`);
    } else {
      send(session.b, 'trade_cancelled', { tradeId: session.id, reason: 'withdrawn' });
    }
    return;
  }
  cancelSession(session, 'cancelled');
}

function handleTradeChat(playerId, data) {
  const session = sessionOf(playerId);
  if (!session || session.state !== 'open' || session.id !== Number(data?.tradeId)) return;
  const text = String(data?.text ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, MAX_CHAT);
  if (!text) return;
  const payload = { tradeId: session.id, from: { id: playerId, name: nameOf(playerId) }, text };
  send(session.a, 'trade_chat', payload);
  send(session.b, 'trade_chat', payload);
}

/**
 * connection.js drops the player record on close without telling us, and a
 * map or channel change only shows up as a room mismatch — so every few
 * seconds every session is re-checked against the live player table. Stale
 * requests nobody answered expire here too.
 */
function sweepTrades() {
  const now = Date.now();
  for (const session of [...trades.values()]) {
    if (!sameRoom(session.a, session.b)) {
      if (session.state === 'pending') {
        endSession(session);
        send(session.a, 'trade_cancelled', { tradeId: session.id, reason: 'partner_left' });
        send(session.b, 'trade_cancelled', { tradeId: session.id, reason: 'partner_left' });
      } else {
        cancelSession(session, 'partner_left');
      }
      continue;
    }
    if (session.state === 'pending' && now - session.createdAt > REQUEST_TTL_MS) {
      endSession(session);
      notify(session.a, `'${nameOf(session.b)}' did not answer the trade request.`);
      send(session.b, 'trade_cancelled', { tradeId: session.id, reason: 'expired' });
    }
  }
}

registerHandler('trade_request', handleTradeRequest);
registerHandler('trade_response', handleTradeResponse);
registerHandler('trade_offer', handleTradeOffer);
registerHandler('trade_confirm', handleTradeConfirm);
registerHandler('trade_cancel', handleTradeCancel);
registerHandler('trade_chat', handleTradeChat);

const sweepTimer = setInterval(sweepTrades, SWEEP_MS);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

module.exports = { mesoFee, sweepTrades, trades };
