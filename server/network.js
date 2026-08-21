// Network utilities — sending messages to players, rooms, worlds

const WebSocket = require('ws');
const { players, roomOf, sameScope } = require('./state');

function sendToPlayer(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending message to player:', error);
    }
  }
}

function sendRaw(id, player, json) {
  if (player.ws.readyState !== WebSocket.OPEN) return;
  try {
    player.ws.send(json);
  } catch (error) {
    console.error(`Error broadcasting to player ${id}:`, error);
  }
}

/**
 * Everyone on `mapId` in the same world and channel as `scope` (a player
 * record or {worldId, channel}). Without an explicit scope the excluded
 * player's own is used — callers that broadcast after deleting the player
 * record must pass the scope themselves.
 */
function broadcastToMap(mapId, message, excludePlayerId = null, scope = null) {
  const numericMapId = Number(mapId);
  const json = JSON.stringify(message);
  const sc = scope || (excludePlayerId ? players.get(excludePlayerId) : null);

  for (const [id, player] of players.entries()) {
    if (id === excludePlayerId) continue;
    if (sc && !sameScope(sc, player)) continue;

    let playerMapId = player.mapId;
    if (player.info && player.info.mapId) {
      playerMapId = player.info.mapId;
    }
    if (Number(playerMapId) === numericMapId) sendRaw(id, player, json);
  }
}

/** Everyone in a room (see state.roomOf) */
function broadcastToRoom(room, message, excludePlayerId = null) {
  const json = JSON.stringify(message);
  for (const [id, player] of players.entries()) {
    if (id === excludePlayerId) continue;
    if (roomOf(player) === room) sendRaw(id, player, json);
  }
}

/** Everyone in a world, all channels and maps — megaphones, world notices */
function broadcastToWorld(worldId, message, excludePlayerId = null) {
  const json = JSON.stringify(message);
  const w = Number(worldId) || 0;
  for (const [id, player] of players.entries()) {
    if (id === excludePlayerId) continue;
    if ((Number(player.worldId) || 0) !== w) continue;
    sendRaw(id, player, json);
  }
}

/** Every connected client regardless of world — server-wide announcements only */
function broadcastToAll(message, excludePlayerId = null) {
  const json = JSON.stringify(message);
  for (const [id, player] of players.entries()) {
    if (id === excludePlayerId) continue;
    sendRaw(id, player, json);
  }
}

module.exports = { sendToPlayer, broadcastToMap, broadcastToRoom, broadcastToWorld, broadcastToAll };
