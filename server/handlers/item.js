// Item drop/pickup — the server keeps the ledger of every networked drop and
// arbitrates pickups, so two players reaching one drop in the same instant
// cannot both keep it (pure relay let them, which was duplicable at will).
//
// v83 ownership: a drop from a mob belongs to the killer (and their party)
// for the first OWNER_LOCK_MS; after that it is free for all. Items a player
// drops from their own inventory are free at once. Drops evaporate after
// DROP_TTL_MS, as they do on the map.
//
// Ids are server-issued. The dropping client already shows the item under a
// provisional id of its own, so the ack carries both and a short-lived index
// resolves a pickup that raced the ack.

const { players, roomOf } = require('../state');
const { sendToPlayer, broadcastToRoom } = require('../network');

const OWNER_LOCK_MS = 15000;
const DROP_TTL_MS = 180000;
const PROVISIONAL_TTL_MS = 30000;
const MAX_DROPS_PER_MAP = 600;

let nextDropId = 1;
const dropsByRoom = new Map(); // room (world:channel:map) -> Map(dropId -> drop)
const provisional = new Map(); // `${playerId}:${clientDropId}` -> { dropId, at }

function roomDrops(room) {
  let m = dropsByRoom.get(room);
  if (!m) {
    m = new Map();
    dropsByRoom.set(room, m);
  }
  return m;
}

function handleItemDrop(playerId, dropData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(dropData.mapId || player.mapId);
  if (!Number.isFinite(mapId) || mapId <= 0) return;

  const room = roomOf(player, mapId);
  const drops = roomDrops(room);
  if (drops.size >= MAX_DROPS_PER_MAP) {
    // Oldest goes first, like the map's own drop cap
    const oldest = drops.keys().next().value;
    drops.delete(oldest);
    broadcastToRoom(room, { type: 'item_expire', data: { dropId: oldest, mapId } });
  }

  // The owner must be a real connected player; anything else is unowned
  const ownerId = dropData.ownerId && players.has(dropData.ownerId) ? dropData.ownerId : null;
  const partyId = ownerId ? players.get(ownerId)?.partyId ?? null : null;
  const dropId = nextDropId++;
  const clientDropId = dropData.dropId;
  const drop = {
    dropId,
    room,
    mapId,
    itemId: Number(dropData.itemId) || 0,
    amount: Number(dropData.amount) || 1,
    x: dropData.x,
    y: dropData.y,
    vx: dropData.vx || 0,
    vy: dropData.vy || 0,
    ownerId,
    partyId,
    droppedAt: Date.now(),
    dropperId: playerId,
  };
  drops.set(dropId, drop);
  if (clientDropId !== undefined) {
    provisional.set(`${playerId}:${clientDropId}`, { dropId, at: drop.droppedAt });
    sendToPlayer(player.ws, { type: 'item_drop_ack', data: { clientDropId, dropId, mapId } });
  }
  const { room: _r, ...wire } = drop;
  broadcastToRoom(room, { type: 'item_drop', data: { ...wire, playerId } }, playerId);
}

function resolveDrop(playerId, room, dropId) {
  const drops = dropsByRoom.get(room);
  if (!drops) return null;
  if (drops.has(dropId)) return drops.get(dropId);
  const prov = provisional.get(`${playerId}:${dropId}`);
  if (prov && drops.has(prov.dropId)) return drops.get(prov.dropId);
  return null;
}

function canPickUp(drop, playerId) {
  if (!drop.ownerId) return true;
  if (drop.ownerId === playerId) return true;
  if (Date.now() - drop.droppedAt >= OWNER_LOCK_MS) return true;
  const picker = players.get(playerId);
  return !!drop.partyId && picker?.partyId === drop.partyId;
}

function handleItemPickup(playerId, pickupData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(pickupData.mapId || player.mapId);
  const room = roomOf(player, mapId);
  const requested = pickupData.dropId;
  const drop = resolveDrop(playerId, room, requested);

  if (!drop) {
    // Already taken, expired, or never registered — the picker shows it
    // flying into their bag, so tell them to put it back
    sendToPlayer(player.ws, {
      type: 'item_pickup_denied',
      data: { dropId: requested, mapId, reason: 'gone' },
    });
    return;
  }
  if (!canPickUp(drop, playerId)) {
    sendToPlayer(player.ws, {
      type: 'item_pickup_denied',
      data: { dropId: requested, mapId, reason: 'owner' },
    });
    return;
  }

  dropsByRoom.get(room).delete(drop.dropId);
  broadcastToRoom(room, {
    type: 'item_pickup',
    data: { dropId: drop.dropId, mapId, playerId },
  }, playerId);
}

/** Drops currently in a player's room — a joiner is sent these so it sees what's lying around */
function dropsOnMap(player) {
  const drops = dropsByRoom.get(roomOf(player));
  if (!drops) return [];
  return [...drops.values()].map(({ room: _r, ...wire }) => wire);
}

/** Periodic: evaporate old drops (and tell the map), forget stale provisional ids */
function sweepDrops() {
  const now = Date.now();
  for (const [room, drops] of dropsByRoom) {
    for (const [dropId, drop] of drops) {
      if (now - drop.droppedAt >= DROP_TTL_MS) {
        drops.delete(dropId);
        broadcastToRoom(room, { type: 'item_expire', data: { dropId, mapId: drop.mapId } });
      }
    }
    if (drops.size === 0) dropsByRoom.delete(room);
  }
  for (const [key, prov] of provisional) {
    if (now - prov.at >= PROVISIONAL_TTL_MS) provisional.delete(key);
  }
}

module.exports = { handleItemDrop, handleItemPickup, dropsOnMap, sweepDrops, OWNER_LOCK_MS };
