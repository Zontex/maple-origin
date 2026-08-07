// Mob-related message handlers

const WebSocket = require('ws');
const { players, monsters, mapHosts } = require('../state');
const { sendToPlayer, broadcastToMap } = require('../network');

function handleMonsterDamage(playerId, damageData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;

  let monster = monsters.get(damageData.targetId);
  if (!monster) {
    monster = {
      id: damageData.targetId,
      hp: 100,
      maxHp: 100,
      mapId: damageData.mapId,
      lastUpdate: Date.now()
    };
    monsters.set(damageData.targetId, monster);
  }

  monster.hp -= damageData.damage;
  if (monster.hp < 0) monster.hp = 0;

  broadcastToMap(damageData.mapId, { type: 'monster_damage', damage: damageData }, playerId);
  broadcastToMap(damageData.mapId, { type: 'monster_update', monster });

  if (monster.hp <= 0) {
    setTimeout(() => monsters.delete(damageData.targetId), 5000);
  }
}

function handleMobStateBatch(playerId, batchData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(batchData.mapId || player.mapId);
  if (mapHosts.get(mapId) !== playerId) return;
  broadcastToMap(mapId, { type: 'mob_state_batch', data: batchData }, playerId);
}

function handleMobDamageRequest(playerId, reqData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(reqData.mapId || player.mapId);
  const hostId = mapHosts.get(mapId);
  if (!hostId || hostId === playerId) return;
  const hostPlayer = players.get(hostId);
  if (hostPlayer && hostPlayer.ws.readyState === WebSocket.OPEN) {
    sendToPlayer(hostPlayer.ws, { type: 'mob_damage_request', data: { ...reqData, sourcePlayerId: playerId } });
  }
}

function handleMobDeath(playerId, deathData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(deathData.mapId || player.mapId);
  if (mapHosts.get(mapId) !== playerId) return;
  broadcastToMap(mapId, { type: 'mob_death', data: deathData }, playerId);
}

function handleMobRespawn(playerId, respawnData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(respawnData.mapId || player.mapId);
  if (mapHosts.get(mapId) !== playerId) return;
  broadcastToMap(mapId, { type: 'mob_respawn', data: respawnData }, playerId);
}

module.exports = {
  handleMonsterDamage,
  handleMobStateBatch,
  handleMobDamageRequest,
  handleMobDeath,
  handleMobRespawn,
};
