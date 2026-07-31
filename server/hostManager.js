// Mob host assignment — one player per map runs mob AI

const WebSocket = require('ws');
const { players, mapHosts } = require('./state');
const { sendToPlayer } = require('./network');

// A host whose game loop has stalled (backgrounded tab, crashed page) keeps
// its socket open and its setInterval mob broadcasts running, but stops
// sending player_updates — those only fire when the rAF-driven game state
// changes. Such a host broadcasts frozen mobs forever, so treat it as
// invalid whenever a live replacement exists on the map.
const HOST_STALE_MS = 10000;

function isLive(player) {
  return (
    !!player &&
    player.ws.readyState === WebSocket.OPEN &&
    Date.now() - (player.lastUpdate || 0) < HOST_STALE_MS
  );
}

function assignMapHost(mapId, newJoinerId) {
  mapId = Number(mapId);

  const liveCandidateExists = [...players.values()].some(
    (p) => Number(p.mapId) === mapId && p.info && isLive(p)
  );

  // Check if current host is still valid
  const currentHost = mapHosts.get(mapId);
  if (currentHost) {
    const hostPlayer = players.get(currentHost);
    const hostValid =
      hostPlayer &&
      hostPlayer.ws.readyState === WebSocket.OPEN &&
      Number(hostPlayer.mapId) === mapId &&
      // A stale host keeps hostship only while no live player can take over
      (isLive(hostPlayer) || !liveCandidateExists);
    if (hostValid) {
      // Answer the joiner unconditionally, including when the joiner IS the
      // current host. Skipping that case assumed the client already knew,
      // but a client that missed or dropped its assignment then never heard
      // again — mobs frozen and unattackable until a full page reload.
      if (newJoinerId) {
        const joiner = players.get(newJoinerId);
        if (joiner) {
          sendToPlayer(joiner.ws, {
            type: 'mob_host_assign',
            isHost: newJoinerId === currentHost,
          });
        }
      }
      return;
    }
  }

  // Find a new host — prefer players with a live game loop
  let newHost = null;
  for (const [id, player] of players.entries()) {
    if (Number(player.mapId) === mapId && player.ws.readyState === WebSocket.OPEN && player.info) {
      if (isLive(player)) {
        newHost = id;
        break;
      }
      if (!newHost) newHost = id;
    }
  }

  if (newHost) {
    // Re-send even when the winner is unchanged: reaching here means the
    // previous assignment was found invalid, so the client's view of it
    // cannot be trusted either.
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
