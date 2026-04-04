// Periodic cleanup — inactive players and dead connection detection

const { players } = require('./state');
const { broadcastToMap } = require('./network');

function startCleanupTasks(wss) {
  // Remove inactive players every 30s
  setInterval(() => {
    const now = Date.now();
    const inactiveTimeout = 600000; // 10 minutes

    for (const [id, player] of players.entries()) {
      if (now - player.lastUpdate > inactiveTimeout) {
        console.log(`Removing inactive player: ${id}`);
        if (player.info) {
          broadcastToMap(player.mapId, { type: 'player_left', id });
        }
        if (player.ws.readyState === 1) { // WebSocket.OPEN
          player.ws.close(4000, 'idle_timeout');
        }
        players.delete(id);
      }
    }
  }, 30000);

  // Ping/pong heartbeat every 30s
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (error) {
        console.error('Error sending ping:', error);
        ws.terminate();
      }
    });
  }, 30000);
}

module.exports = { startCleanupTasks };
