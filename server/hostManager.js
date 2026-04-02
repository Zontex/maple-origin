// Mob host assignment — one player per map runs mob AI

const WebSocket = require('ws');
const { players, mapHosts } = require('./state');
const { sendToPlayer } = require('./network');

function assignMapHost(mapId, newJoinerId) {
  mapId = Number(mapId);

  // Check if current host is still valid
  const currentHost = mapHosts.get(mapId);
  if (currentHost) {
    const hostPlayer = players.get(currentHost);
    if (hostPlayer && hostPlayer.ws.readyState === WebSocket.OPEN && Number(hostPlayer.mapId) === mapId) {
      // Host is valid — tell new joiner they're NOT the host
      if (newJoinerId && newJoinerId !== currentHost) {
        const joiner = players.get(newJoinerId);
        if (joiner) {
          sendToPlayer(joiner.ws, { type: 'mob_host_assign', isHost: false });
        }
      }
      return;
    }
  }

  // Find a new host — first player on this map
  let newHost = null;
  for (const [id, player] of players.entries()) {
    if (Number(player.mapId) === mapId && player.ws.readyState === WebSocket.OPEN && player.info) {
      newHost = id;
      break;
    }
  }

  if (newHost) {
    mapHosts.set(mapId, newHost);
    const hostPlayer = players.get(newHost);
    if (hostPlayer) {
      sendToPlayer(hostPlayer.ws, { type: 'mob_host_assign', isHost: true });
    }
    // Tell all other players on this map they are NOT the host
    for (const [id, player] of players.entries()) {
      if (id !== newHost && Number(player.mapId) === mapId && player.ws.readyState === WebSocket.OPEN) {
        sendToPlayer(player.ws, { type: 'mob_host_assign', isHost: false });
      }
    }
    console.log(`Map ${mapId}: assigned mob host to ${newHost}`);
  } else {
    mapHosts.delete(mapId);
  }
}

module.exports = { assignMapHost };
