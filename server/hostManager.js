// Mob host assignment — one player per room (world/channel/map) runs mob AI

const WebSocket = require('ws');
const { players, mapHosts, roomOf } = require('./state');
const { sendToPlayer } = require('./network');
const { flushPendingDamage } = require('./handlers/mob');

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

// Clients that cannot run mob AI (the native client in M1) register with
// noHost: true in their player_info and are never elected
function canHost(player) {
  return !!player?.info && !player.info.noHost;
}

/**
 * (Re)elect the mob host of a room. `room` is a state.roomKey string;
 * `newJoinerId` is a player who just arrived and must be told its role
 * even when nothing changes.
 */
function assignMapHost(room, newJoinerId) {
  const inRoom = (p) => roomOf(p) === room;
  const liveCandidateExists = [...players.values()].some(
    (p) => inRoom(p) && canHost(p) && isLive(p)
  );

  // Check if current host is still valid
  const currentHost = mapHosts.get(room);
  if (currentHost) {
    const hostPlayer = players.get(currentHost);
    const hostValid =
      hostPlayer &&
      hostPlayer.ws.readyState === WebSocket.OPEN &&
      inRoom(hostPlayer) &&
      canHost(hostPlayer) &&
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
    if (inRoom(player) && player.ws.readyState === WebSocket.OPEN && canHost(player)) {
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
    mapHosts.set(room, newHost);
    const hostPlayer = players.get(newHost);
    if (hostPlayer) {
      sendToPlayer(hostPlayer.ws, { type: 'mob_host_assign', isHost: true });
    }
    // Tell all other players in this room they are NOT the host
    for (const [id, player] of players.entries()) {
      if (id !== newHost && inRoom(player) && player.ws.readyState === WebSocket.OPEN) {
        sendToPlayer(player.ws, { type: 'mob_host_assign', isHost: false });
      }
    }
    // Hits that landed during the host gap go to the new host now
    flushPendingDamage(room, newHost);
    const age = Date.now() - (players.get(newHost)?.lastUpdate || 0);
    console.log(
      `Room ${room}: assigned mob host to ${newHost} ` +
        `(was ${currentHost || 'none'}, heartbeat ${age}ms ago, live=${isLive(players.get(newHost))})`
    );
  } else {
    if (currentHost) console.log(`Room ${room}: no eligible mob host, clearing ${currentHost}`);
    mapHosts.delete(room);
  }
}

module.exports = { assignMapHost };
