// Network utilities — sending messages to players and maps

const WebSocket = require('ws');
const { players } = require('./state');

function sendToPlayer(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending message to player:', error);
    }
  }
}

function broadcastToMap(mapId, message, excludePlayerId = null) {
  const numericMapId = Number(mapId);
  const json = JSON.stringify(message);

  for (const [id, player] of players.entries()) {
    if (id === excludePlayerId) continue;

    let playerMapId = player.mapId;
    if (player.info && player.info.mapId) {
      playerMapId = player.info.mapId;
    }

    if (Number(playerMapId) === numericMapId && player.ws.readyState === WebSocket.OPEN) {
      try {
        player.ws.send(json);
      } catch (error) {
        console.error(`Error broadcasting to player ${id}:`, error);
      }
    }
  }
}

module.exports = { sendToPlayer, broadcastToMap };
