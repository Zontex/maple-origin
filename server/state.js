// Shared server state — single source of truth for all modules

const players = new Map();
// room key -> playerId. A "room" is one map on one channel of one world —
// the unit every broadcast, host election and drop ledger is scoped to.
// The eight advertised worlds used to share one physical world and channel
// select was cosmetic; now a Scania/ch1 Henesys and a Bera/ch1 Henesys are
// different places.
const mapHosts = new Map();

function roomKey(worldId, channel, mapId) {
  return `${Number(worldId) || 0}:${Number(channel) || 0}:${Number(mapId)}`;
}

function roomOf(player, mapId = player?.mapId) {
  return roomKey(player?.worldId, player?.channel, mapId);
}

function sameScope(a, b) {
  return (Number(a?.worldId) || 0) === (Number(b?.worldId) || 0) &&
    (Number(a?.channel) || 0) === (Number(b?.channel) || 0);
}

module.exports = { players, mapHosts, roomKey, roomOf, sameScope };
