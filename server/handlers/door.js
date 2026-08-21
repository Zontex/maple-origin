// Mystic Door (skill 2311002) — the server keeps the active doors because a
// door lives in TWO rooms at once: the field map it was cast on and that
// map's return town, where the matching door stands at one of the town's
// `tp` portals. Every door_open/door_close goes to both rooms (same world
// and channel as the caster), and a client that enters either map later
// asks with door_sync and gets the doors that touch that map.
//
// Nothing here reads WZ data. The client that casts sends how many `tp`
// slots the town has; this module only hands out the lowest slot not taken
// by another door in that town, so two parties' doors never share a spot.

const { registerHandler } = require('../router');
const { players, sameScope } = require('../state');
const { broadcastToMap, sendToPlayer } = require('../network');

// v83 level 20 lasts 70s; nothing legitimate asks for more than a few minutes
const MAX_DURATION_MS = 10 * 60 * 1000;
const MIN_DURATION_MS = 1000;
const SWEEP_INTERVAL_MS = 2000;

// doorId -> door
const doors = new Map();
let nextDoorSeq = 1;

function scopeOf(player) {
  return { worldId: Number(player.worldId) || 0, channel: Number(player.channel) || 0 };
}

function currentMapOf(player) {
  return Number(player.info?.mapId ?? player.mapId);
}

function publicDoor(door) {
  return {
    doorId: door.doorId,
    ownerId: door.ownerId,
    ownerName: door.ownerName,
    partyId: door.partyId,
    mapId: door.mapId,
    x: door.x,
    y: door.y,
    townMapId: door.townMapId,
    townSlot: door.townSlot,
    expiresAt: door.expiresAt,
    durationMs: door.durationMs,
  };
}

/** Send to everyone on the field map and everyone in the town, in the door's world/channel */
function broadcastDoor(door, message) {
  broadcastToMap(door.mapId, message, null, door.scope);
  if (Number(door.townMapId) !== Number(door.mapId)) {
    broadcastToMap(door.townMapId, message, null, door.scope);
  }
}

function closeDoor(door, reason) {
  if (!doors.delete(door.doorId)) return;
  broadcastDoor(door, { type: 'door_close', data: { doorId: door.doorId, reason } });
}

/** Lowest `tp` index in this town (same world/channel) not used by another active door */
function pickTownSlot(townMapId, scope, slotCount, excludeDoorId) {
  const taken = new Set();
  for (const d of doors.values()) {
    if (d.doorId === excludeDoorId) continue;
    if (Number(d.townMapId) !== Number(townMapId) || !sameScope(d.scope, scope)) continue;
    taken.add(d.townSlot);
  }
  const count = Math.max(1, Math.min(64, Math.floor(Number(slotCount)) || 1));
  for (let i = 0; i < count; i++) {
    if (!taken.has(i)) return i;
  }
  // Every slot busy — double up on the first rather than refuse the cast
  return 0;
}

/**
 * door_open { mapId, x, y, townMapId, townPortalCount, partyId, durationMs }
 * Replaces the caster's previous door (Cosmic: one door per character).
 */
function handleDoorOpen(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.info) return;

  const mapId = Number(data?.mapId);
  const x = Number(data?.x);
  const y = Number(data?.y);
  const townMapId = Number(data?.townMapId);
  if (![mapId, x, y, townMapId].every(Number.isFinite)) return;
  // The door stands where the caster is; a client claiming another map is ignored
  if (mapId !== currentMapOf(player)) return;

  const durationMs = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Number(data?.durationMs) || 30000));
  const scope = scopeOf(player);
  // Trust the server's own party record when it has one; otherwise the
  // client's, which it gets from the same party_update stream
  const partyId = player.partyId != null
    ? Number(player.partyId) || null
    : (data?.partyId == null ? null : Number(data.partyId) || null);

  for (const d of [...doors.values()]) {
    if (d.ownerId === playerId) closeDoor(d, 'recast');
  }

  const doorId = `${playerId}:${nextDoorSeq++}`;
  const door = {
    doorId,
    ownerId: playerId,
    ownerName: player.info.name || player.characterName || '',
    partyId,
    mapId,
    x: Math.round(x),
    y: Math.round(y),
    townMapId,
    townSlot: pickTownSlot(townMapId, scope, data?.townPortalCount, doorId),
    expiresAt: Date.now() + durationMs,
    durationMs,
    scope,
  };
  doors.set(doorId, door);
  console.log(`[Door] ${door.ownerName} opened a door on ${mapId} (${door.x},${door.y}) -> town ${townMapId} slot ${door.townSlot}, ${durationMs / 1000}s`);
  broadcastDoor(door, { type: 'door_open', data: publicDoor(door) });
}

/** door_close { doorId } — only the owner may close their door early */
function handleDoorClose(playerId, data) {
  const door = doors.get(String(data?.doorId ?? ''));
  if (!door || door.ownerId !== playerId) return;
  closeDoor(door, 'closed');
}

/** door_sync { mapId } — the doors that stand on this map (field side or town side) */
function handleDoorSync(playerId, data) {
  const player = players.get(playerId);
  if (!player) return;
  const mapId = Number(data?.mapId);
  if (!Number.isFinite(mapId)) return;
  const scope = scopeOf(player);
  const list = [];
  for (const d of doors.values()) {
    if (!sameScope(d.scope, scope)) continue;
    if (Number(d.mapId) === mapId || Number(d.townMapId) === mapId) list.push(publicDoor(d));
  }
  sendToPlayer(player.ws, { type: 'door_list', data: { mapId, doors: list } });
}

/** Expiry, and doors whose owner has left the server (Cosmic drops them on logout) */
function sweep() {
  const now = Date.now();
  for (const d of [...doors.values()]) {
    if (now >= d.expiresAt) closeDoor(d, 'expired');
    else if (!players.has(d.ownerId)) closeDoor(d, 'owner_left');
  }
}

const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

registerHandler('door_open', handleDoorOpen);
registerHandler('door_close', handleDoorClose);
registerHandler('door_sync', handleDoorSync);

module.exports = { handleDoorOpen, handleDoorClose, handleDoorSync, _doors: doors, _sweep: sweep };
