/**
 * Storage Keeper (v83 "Trunk") — the account-wide, per-world item bank.
 *
 * One storage per (user, world): 4 slots by default, 48 at most, every
 * stored stack occupying one slot, plus a meso balance. The server is the
 * ledger: capacity and meso bounds are enforced here and every reply carries
 * a fresh snapshot so two characters of one account working the same storage
 * at once can't disagree about what is in it.
 *
 * Fees (Npc.wz info/trunkPut, default 100; info/trunkGet, default 0) are
 * mesos, which are client-authoritative like every other meso sink, so the
 * client charges itself and only reports the fee so the disconnect-save
 * mirror below stays honest.
 *
 * The inventory side of a move is the client's (its next save carries it),
 * but a tab closed between the ack and that save would let the server's
 * disconnect save restore the old bag — an item stored moments earlier would
 * exist twice. So every accepted move is also applied to
 * `player.lastSaveData`, the payload the disconnect path saves.
 *
 * Messages (client → server → same client):
 *   storage_open     {npcId}                         → storage_data {npcId, slots, mesos, items}
 *   storage_store    {reqId, item, tab, slot, fee}   → storage_result {reqId, op:'store', ok, ...snapshot}
 *   storage_takeout  {reqId, id, tab, fee}           → storage_result {reqId, op:'takeout', ok, item, ...snapshot}
 *   storage_meso     {reqId, amount}                 → storage_result {reqId, op:'meso', ok, mesos}
 *   storage_arrange  {reqId}                         → storage_result {reqId, op:'arrange', ok, ...snapshot}
 * Errors: {ok:false, error:'full'|'not_found'|'meso'|'invalid'}.
 */

const { registerHandler } = require('../router');
const { players } = require('../state');
const { getDb } = require('../db');
const { sendToPlayer } = require('../network');

const DEFAULT_SLOTS = 4;
const MAX_SLOTS = 48;
const MESO_CAP = 2147483647;
const MAX_EQUIP_DATA_JSON = 4096;
const TAB_NAMES = { 1: 'equip', 2: 'use', 3: 'setup', 4: 'etc', 5: 'cash' };

getDb().exec(`
  CREATE TABLE IF NOT EXISTS storages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    world_id INTEGER NOT NULL,
    slots INTEGER NOT NULL DEFAULT ${DEFAULT_SLOTS},
    mesos INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, world_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS storage_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storage_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    equip_data TEXT,
    FOREIGN KEY (storage_id) REFERENCES storages(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_storage_items_storage ON storage_items(storage_id, position);
`);

function send(playerId, type, data) {
  const p = players.get(playerId);
  if (p) sendToPlayer(p.ws, { type, data });
}

/** The player's storage row for their current world, created on first use. */
function storageOf(player) {
  const db = getDb();
  const userId = player.userId;
  const worldId = Number(player.worldId) || 0;
  let row = db.prepare('SELECT id, slots, mesos FROM storages WHERE user_id = ? AND world_id = ?').get(userId, worldId);
  if (!row) {
    db.prepare('INSERT INTO storages (user_id, world_id, slots, mesos) VALUES (?, ?, ?, 0)')
      .run(userId, worldId, DEFAULT_SLOTS);
    row = db.prepare('SELECT id, slots, mesos FROM storages WHERE user_id = ? AND world_id = ?').get(userId, worldId);
  }
  return row;
}

function rowToItem(row) {
  let equipData;
  if (row.equip_data) {
    try { equipData = JSON.parse(row.equip_data); } catch (e) { equipData = undefined; }
  }
  return { id: row.id, itemId: row.item_id, quantity: row.quantity, equipData };
}

function snapshot(storageId) {
  const db = getDb();
  const st = db.prepare('SELECT slots, mesos FROM storages WHERE id = ?').get(storageId);
  const rows = db.prepare('SELECT id, item_id, quantity, equip_data FROM storage_items WHERE storage_id = ? ORDER BY position, id').all(storageId);
  return { slots: st ? st.slots : DEFAULT_SLOTS, mesos: st ? st.mesos : 0, items: rows.map(rowToItem) };
}

/** Validate an incoming item the same way trade.js does — shape only. */
function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const itemId = Number(raw.itemId);
  const quantity = Number(raw.quantity);
  if (!Number.isInteger(itemId) || itemId < 1000000 || itemId > 5999999) return null;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 32767) return null;
  let equipData = null;
  if (raw.equipData && typeof raw.equipData === 'object') {
    try {
      const json = JSON.stringify(raw.equipData);
      if (json.length > MAX_EQUIP_DATA_JSON) return null;
      equipData = json;
    } catch (e) { return null; }
  }
  return { itemId, quantity, equipData };
}

function tabNameFor(tab, itemId) {
  return TAB_NAMES[Number(tab)] || TAB_NAMES[Math.floor(itemId / 1000000)] || null;
}

// --- disconnect-save mirror ------------------------------------------------

function mirrorMesos(player, delta) {
  const d = player.lastSaveData;
  if (!d || typeof d.mesos !== 'number') return;
  d.mesos = Math.max(0, Math.min(MESO_CAP, d.mesos + delta));
}

function mirrorRemove(player, tabName, slot, quantity) {
  const inv = player.lastSaveData && player.lastSaveData.inventory;
  const arr = inv && tabName && inv[tabName];
  if (!Array.isArray(arr)) return;
  const cur = arr[slot];
  if (!cur) return;
  if ((cur.quantity || 1) <= quantity) arr[slot] = null;
  else cur.quantity -= quantity;
}

function mirrorAdd(player, tabName, item) {
  const inv = player.lastSaveData && player.lastSaveData.inventory;
  const arr = inv && tabName && inv[tabName];
  if (!Array.isArray(arr)) return;
  let slot = arr.findIndex((it) => !it);
  if (slot < 0) slot = arr.length;
  arr[slot] = { itemId: item.itemId, quantity: item.quantity, equipData: item.equipData };
}

// --- handlers ---------------------------------------------------------------

function requireCharacter(playerId) {
  const player = players.get(playerId);
  if (!player || !player.characterId || !player.userId) return null;
  return player;
}

function handleOpen(playerId, data) {
  const player = requireCharacter(playerId);
  if (!player) return;
  const st = storageOf(player);
  send(playerId, 'storage_data', { npcId: Number(data && data.npcId) || 0, ...snapshot(st.id) });
}

function handleStore(playerId, data) {
  const player = requireCharacter(playerId);
  if (!player) return;
  const reqId = data && data.reqId;
  const item = sanitizeItem(data && data.item);
  if (!item) { send(playerId, 'storage_result', { reqId, op: 'store', ok: false, error: 'invalid' }); return; }

  const db = getDb();
  const st = storageOf(player);
  let ok = false;
  let error = null;
  db.transaction(() => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM storage_items WHERE storage_id = ?').get(st.id);
    if (n >= st.slots) { error = 'full'; return; }
    const { p } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM storage_items WHERE storage_id = ?').get(st.id);
    db.prepare('INSERT INTO storage_items (storage_id, position, item_id, quantity, equip_data) VALUES (?, ?, ?, ?, ?)')
      .run(st.id, p, item.itemId, item.quantity, item.equipData);
    ok = true;
  })();

  if (!ok) { send(playerId, 'storage_result', { reqId, op: 'store', ok: false, error }); return; }

  mirrorRemove(player, tabNameFor(data.tab, item.itemId), Number(data.slot), item.quantity);
  mirrorMesos(player, -(Math.max(0, Number(data.fee)) || 0));
  send(playerId, 'storage_result', { reqId, op: 'store', ok: true, ...snapshot(st.id) });
}

function handleTakeOut(playerId, data) {
  const player = requireCharacter(playerId);
  if (!player) return;
  const reqId = data && data.reqId;
  const id = Number(data && data.id);
  if (!Number.isInteger(id)) { send(playerId, 'storage_result', { reqId, op: 'takeout', ok: false, error: 'invalid' }); return; }

  const db = getDb();
  const st = storageOf(player);
  let item = null;
  db.transaction(() => {
    const row = db.prepare('SELECT id, item_id, quantity, equip_data FROM storage_items WHERE id = ? AND storage_id = ?').get(id, st.id);
    if (!row) return;
    db.prepare('DELETE FROM storage_items WHERE id = ?').run(id);
    item = rowToItem(row);
  })();

  if (!item) { send(playerId, 'storage_result', { reqId, op: 'takeout', ok: false, error: 'not_found' }); return; }

  mirrorAdd(player, tabNameFor(data.tab, item.itemId), item);
  mirrorMesos(player, -(Math.max(0, Number(data.fee)) || 0));
  send(playerId, 'storage_result', { reqId, op: 'takeout', ok: true, item, ...snapshot(st.id) });
}

/** amount > 0 deposits into storage, amount < 0 withdraws to the character. */
function handleMeso(playerId, data) {
  const player = requireCharacter(playerId);
  if (!player) return;
  const reqId = data && data.reqId;
  const amount = Number(data && data.amount);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MESO_CAP) {
    send(playerId, 'storage_result', { reqId, op: 'meso', ok: false, error: 'invalid' });
    return;
  }

  const db = getDb();
  const st = storageOf(player);
  let mesos = st.mesos;
  let ok = false;
  db.transaction(() => {
    const cur = db.prepare('SELECT mesos FROM storages WHERE id = ?').get(st.id).mesos;
    const next = cur + amount;
    if (next < 0 || next > MESO_CAP) return;
    db.prepare('UPDATE storages SET mesos = ? WHERE id = ?').run(next, st.id);
    mesos = next;
    ok = true;
  })();

  if (!ok) { send(playerId, 'storage_result', { reqId, op: 'meso', ok: false, error: 'meso', mesos }); return; }
  mirrorMesos(player, -amount);
  send(playerId, 'storage_result', { reqId, op: 'meso', ok: true, mesos });
}

/** ARRANGE ITEM — group by inventory tab, then by item id, keeping stack order. */
function handleArrange(playerId, data) {
  const player = requireCharacter(playerId);
  if (!player) return;
  const reqId = data && data.reqId;
  const db = getDb();
  const st = storageOf(player);
  db.transaction(() => {
    const rows = db.prepare('SELECT id, item_id FROM storage_items WHERE storage_id = ? ORDER BY position, id').all(st.id);
    rows.sort((a, b) => (Math.floor(a.item_id / 1000000) - Math.floor(b.item_id / 1000000)) || (a.item_id - b.item_id) || (a.id - b.id));
    const upd = db.prepare('UPDATE storage_items SET position = ? WHERE id = ?');
    rows.forEach((r, i) => upd.run(i, r.id));
  })();
  send(playerId, 'storage_result', { reqId, op: 'arrange', ok: true, ...snapshot(st.id) });
}

/** +4 slots up to 48 — the Cash Shop hook (no v83 SKU exists yet; unused by the client). */
function expandStorage(player, by = 4) {
  const db = getDb();
  const st = storageOf(player);
  const next = Math.min(MAX_SLOTS, st.slots + by);
  db.prepare('UPDATE storages SET slots = ? WHERE id = ?').run(next, st.id);
  return next;
}

registerHandler('storage_open', handleOpen);
registerHandler('storage_store', handleStore);
registerHandler('storage_takeout', handleTakeOut);
registerHandler('storage_meso', handleMeso);
registerHandler('storage_arrange', handleArrange);

module.exports = { storageOf, snapshot, expandStorage, DEFAULT_SLOTS, MAX_SLOTS };
