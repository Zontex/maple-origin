// WebSocket connection handler — manages per-client lifecycle

const { v4: uuidv4 } = require('uuid');
const { players, mapHosts } = require('./state');
const { sendToPlayer, broadcastToMap } = require('./network');
const { handleMessage } = require('./router');
const { assignMapHost } = require('./hostManager');
const { autoSaveCharacter } = require('./handlers/auth');

function onConnection(ws) {
  ws.maxPayload = 65536;
  ws.isAlive = true;

  const playerId = uuidv4();
  console.log(`New player connected: ${playerId}`);

  players.set(playerId, {
    id: playerId,
    ws,
    info: null,
    mapId: 0,
    lastUpdate: Date.now(),
    lastBroadcast: 0,
  });

  // serverTime lets clients sync station clocks to the server's wall clock
  sendToPlayer(ws, { type: 'player_id', id: playerId, serverTime: Date.now() });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      if (typeof message === 'string' || Buffer.isBuffer(message)) {
        const messageStr = message.toString();
        if (!messageStr.trim()) return;

        const data = JSON.parse(messageStr);

        // Rate limit only player_update (high frequency)
        const now = Date.now();
        const player = players.get(playerId);
        if (data.type === 'player_update' && player && (now - (player.lastUpdateTime || 0) < 16)) {
          return;
        }
        if (data.type === 'player_update' && player) {
          player.lastUpdateTime = now;
        }

        handleMessage(playerId, data);
      }
    } catch (error) {
      console.error(`Error handling message from ${playerId}:`, error);
      sendToPlayer(ws, { type: 'error', message: 'Failed to process message' });
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for player ${playerId}:`, error);
    const player = players.get(playerId);
    if (player && player.info) {
      broadcastToMap(player.info.mapId, { type: 'player_left', id: playerId }, playerId);
    }
    players.delete(playerId);
  });

  ws.on('close', () => {
    console.log(`Player disconnected: ${playerId}`);
    const player = players.get(playerId);

    if (player) {
      autoSaveCharacter(player);
    }

    players.delete(playerId);

    if (player && player.info) {
      const playerMapId = Number(player.info.mapId);
      broadcastToMap(playerMapId, { type: 'player_left', id: playerId }, playerId);

      if (mapHosts.get(playerMapId) === playerId) {
        mapHosts.delete(playerMapId);
        assignMapHost(playerMapId);
      }
    }
  });
}

module.exports = { onConnection };
