// Player summons (Silver Hawk, Puppet, Octopus, Beholder, ...) — a pure
// relay. The owner's client runs the summon's AI and deals its damage through
// the ordinary mob damage path; everyone else on the map only needs the
// spawn / move / attack / remove stream to draw it. Messages are stamped
// with the sender's id and scoped to the sender's room (world + channel +
// map), excluding the sender.
//
// Nothing is stored: an owner re-sends summon_spawn every few seconds while
// a summon lives, so a late joiner picks it up without a roster.

const { registerHandler } = require('../router');
const { players } = require('../state');
const { broadcastToMap } = require('../network');

const MAX_SUMMON_MSG_BYTES = 512;

function relay(type) {
  return (playerId, data) => {
    const player = players.get(playerId);
    if (!player || !player.info) return;
    if (!data || typeof data !== 'object') return;
    const skillId = Number(data.skillId);
    if (!Number.isFinite(skillId) || skillId <= 0) return;
    // Cheap guard against a client stuffing arbitrary payloads through the relay
    if (JSON.stringify(data).length > MAX_SUMMON_MSG_BYTES) return;
    const mapId = Number(player.info.mapId || player.mapId);
    if (!Number.isFinite(mapId) || mapId <= 0) return;
    broadcastToMap(mapId, { type, data: { ...data, skillId, ownerId: playerId } }, playerId, player);
  };
}

const handleSummonSpawn = relay('summon_spawn');
const handleSummonMove = relay('summon_move');
const handleSummonAttack = relay('summon_attack');
const handleSummonRemove = relay('summon_remove');

registerHandler('summon_spawn', handleSummonSpawn);
registerHandler('summon_move', handleSummonMove);
registerHandler('summon_attack', handleSummonAttack);
registerHandler('summon_remove', handleSummonRemove);

module.exports = { handleSummonSpawn, handleSummonMove, handleSummonAttack, handleSummonRemove };
