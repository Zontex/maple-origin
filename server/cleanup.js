// Periodic cleanup — inactive players and dead connection detection

const { players, mapHosts } = require('./state');
const { broadcastToMap } = require('./network');
const { assignMapHost } = require('./hostManager');

function startCleanupTasks(wss) {
  // Host revalidation every 5s — a host whose game loop stalled
  // (backgrounded tab, crashed page) stops sending player_updates while its
  // mob broadcasts keep firing frozen positions; hand hostship to a live
  // player. assignMapHost is a no-op while the current host is healthy.
  setInterval(() => {
    const activeMaps = new Set();
    for (const player of players.values()) {
      const mapId = Number(player.mapId);
      if (Number.isFinite(mapId) && mapId > 0) activeMaps.add(mapId);
    }
    for (const mapId of activeMaps) assignMapHost(mapId);
    for (const mapId of [...mapHosts.keys()]) {
      if (!activeMaps.has(mapId)) mapHosts.delete(mapId);
    }
  }, 5000);
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
