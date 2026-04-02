// Item drop/pickup message handlers

const { players } = require('../state');
const { broadcastToMap } = require('../network');

function handleItemDrop(playerId, dropData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(dropData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'item_drop', data: { ...dropData, playerId } }, playerId);
}

function handleItemPickup(playerId, pickupData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(pickupData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'item_pickup', data: { ...pickupData, playerId } }, playerId);
}

module.exports = { handleItemDrop, handleItemPickup };
