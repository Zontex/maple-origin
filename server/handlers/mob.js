// Mob-related message handlers

const WebSocket = require('ws');
const { players, mapHosts, roomOf } = require('../state');
const { sendToPlayer, broadcastToMap } = require('../network');

// Damage requests that arrive while a map has no host (the host just left
// or stalled and a replacement is still being elected) used to be dropped
// on the floor — the hit landed on the attacker's screen and nowhere else.
// They are parked here and replayed to whoever becomes host next.
const PENDING_TTL_MS = 5000;
const PENDING_MAX = 200;
const pendingDamage = new Map(); // room -> [{ data, at }]

function handleMobStateBatch(playerId, batchData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(batchData.mapId || player.mapId);
  if (mapHosts.get(roomOf(player, mapId)) !== playerId) return;
  broadcastToMap(mapId, { type: 'mob_state_batch', data: batchData }, playerId);
}

function handleMobDamageRequest(playerId, reqData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(reqData.mapId || player.mapId);
  const room = roomOf(player, mapId);
  const hostId = mapHosts.get(room);
  if (hostId === playerId) return;
  const hostPlayer = hostId ? players.get(hostId) : null;
  const payload = { ...reqData, sourcePlayerId: playerId };
  if (hostPlayer && hostPlayer.ws.readyState === WebSocket.OPEN) {
    sendToPlayer(hostPlayer.ws, { type: 'mob_damage_request', data: payload });
    return;
  }
  let queue = pendingDamage.get(room);
  if (!queue) {
    queue = [];
    pendingDamage.set(room, queue);
  }
  if (queue.length >= PENDING_MAX) queue.shift();
  queue.push({ data: payload, at: Date.now() });
}

/** Called by hostManager the moment a room gets a (new) host */
function flushPendingDamage(room, hostId) {
  const queue = pendingDamage.get(room);
  if (!queue || queue.length === 0) return;
  pendingDamage.delete(room);
  const host = players.get(hostId);
  if (!host || host.ws.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  let replayed = 0;
  for (const entry of queue) {
    if (now - entry.at > PENDING_TTL_MS) continue;
    sendToPlayer(host.ws, { type: 'mob_damage_request', data: entry.data });
    replayed++;
  }
  if (replayed) console.log(`Room ${room}: replayed ${replayed} buffered damage request(s) to new host ${hostId}`);
}

function handleMobDeath(playerId, deathData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(deathData.mapId || player.mapId);
  if (mapHosts.get(roomOf(player, mapId)) !== playerId) return;
  broadcastToMap(mapId, { type: 'mob_death', data: deathData }, playerId);
}

function handleMobRespawn(playerId, respawnData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(respawnData.mapId || player.mapId);
  if (mapHosts.get(roomOf(player, mapId)) !== playerId) return;
  broadcastToMap(mapId, { type: 'mob_respawn', data: respawnData }, playerId);
}

module.exports = {
  handleMobStateBatch,
  handleMobDamageRequest,
  flushPendingDamage,
  handleMobDeath,
  handleMobRespawn,
};
