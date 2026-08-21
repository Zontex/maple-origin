// Mob skills — relay of a mob's skill cast from the room's mob host to
// everyone else in the room (same world, channel and map), exactly like
// mob_state_batch. Only the host runs mob AI, so only the host may announce
// a cast; the record it sends already contains every rolled outcome (prop,
// targets, summons), and each client applies it to itself.
//
// Nothing is stored: a late joiner sees the mob's stance via the state
// batch and simply misses the one-shot art, as with mob_death.

const { registerHandler } = require('../router');
const { players, mapHosts, roomOf } = require('../state');
const { broadcastToMap } = require('../network');

function handleMobSkill(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.info || !data) return;
  const mapId = Number(data.mapId || player.mapId);
  if (!Number.isFinite(mapId)) return;
  if (mapHosts.get(roomOf(player, mapId)) !== playerId) return;
  const oId = Number(data.oId);
  const skillId = Number(data.skillId);
  if (!Number.isFinite(oId) || !Number.isFinite(skillId)) return;
  broadcastToMap(mapId, { type: 'mob_skill', data: { ...data, mapId } }, playerId);
}

registerHandler('mob_skill', handleMobSkill);

module.exports = { handleMobSkill };
