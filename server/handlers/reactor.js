// Reactor message handlers

const { players } = require('../state');
const { broadcastToMap } = require('../network');

function handleReactorHit(playerId, hitData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(hitData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'reactor_hit', data: hitData }, playerId);
}

function handleReactorRespawn(playerId, respawnData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(respawnData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'reactor_respawn', data: respawnData }, playerId);
}

module.exports = { handleReactorHit, handleReactorRespawn };
