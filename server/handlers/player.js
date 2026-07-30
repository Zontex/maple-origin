// Player-related message handlers

const { players } = require('../state');
const { sendToPlayer, broadcastToMap } = require('../network');
const { assignMapHost } = require('../hostManager');

function handlePlayerInfo(playerId, playerInfo) {
  const player = players.get(playerId);
  if (!player) return;

  playerInfo.mapId = Number(playerInfo.mapId);
  // A client mid-load can report NaN — keep the last known map instead of
  // poisoning player.info/player.mapId (this fed disconnect saves map 10000)
  if (!Number.isFinite(playerInfo.mapId) || playerInfo.mapId <= 0) {
    const lastKnown = Number(player.mapId);
    console.warn(`[Player] player_info with invalid mapId from ${playerId} — keeping ${player.mapId}`);
    if (!Number.isFinite(lastKnown) || lastKnown <= 0) {
      // No usable map at all — register the info so player_update isn't
      // ignored, but defer join broadcast/host assignment until the client
      // reports a real map (its update loop re-registers)
      player.info = { ...playerInfo, mapId: undefined, id: playerId };
      return;
    }
    playerInfo.mapId = lastKnown;
  }

  player.info = { ...playerInfo, id: playerId };
  player.mapId = playerInfo.mapId;

  broadcastToMap(player.mapId, {
    type: 'player_joined',
    player: player.info
  }, playerId);

  sendPlayerList(playerId);
  assignMapHost(player.mapId, playerId);
}

function handlePlayerUpdate(playerId, updateData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;

  if (updateData.mapId !== undefined) {
    updateData.mapId = Number(updateData.mapId);
  }
  // NaN/0 map ids (client mid-load) must not replace the tracked map
  if (!Number.isFinite(updateData.mapId) || updateData.mapId <= 0) {
    updateData.mapId = Number(player.mapId || player.info.mapId);
  }

  const updatedInfo = { ...player.info };

  if (updateData.x !== undefined) updatedInfo.x = updateData.x;
  if (updateData.y !== undefined) updatedInfo.y = updateData.y;
  if (updateData.stance) updatedInfo.stance = updateData.stance;
  if (updateData.frame !== undefined) updatedInfo.frame = updateData.frame;
  if (updateData.flipped !== undefined) updatedInfo.flipped = updateData.flipped;
  if (updateData.attacking !== undefined) updatedInfo.attacking = updateData.attacking;

  const currentMapId = Number(player.mapId);
  const newMapId = updateData.mapId;

  if (currentMapId !== newMapId) {
    console.log(`Player ${playerId} changed maps: ${currentMapId} -> ${newMapId}`);

    broadcastToMap(currentMapId, { type: 'player_left', id: playerId }, playerId);

    player.mapId = newMapId;
    updatedInfo.mapId = newMapId;

    broadcastToMap(newMapId, { type: 'player_joined', player: updatedInfo }, playerId);
    sendPlayerList(playerId);

    assignMapHost(currentMapId);
    assignMapHost(newMapId, playerId);
  } else {
    const now = Date.now();
    const timeSinceLastBroadcast = now - (player.lastBroadcast || 0);
    if (timeSinceLastBroadcast >= 33) {
      broadcastToMap(player.mapId, { type: 'player_update', player: updatedInfo }, playerId);
      player.lastBroadcast = now;
    }
  }

  player.info = updatedInfo;
  player.lastUpdate = Date.now();
}

function handlePlayerLevelUp(playerId, levelData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(levelData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'player_level_up', data: { ...levelData, playerId } }, playerId);
}

function handlePlayerHitByMob(playerId, hitData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(hitData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'player_hit_by_mob', data: { ...hitData, playerId } }, playerId);
}

function sendPlayerList(playerId) {
  const player = players.get(playerId);
  if (!player || !player.ws) return;

  const playerMapId = Number(player.mapId);
  const playerList = [];

  for (const [, p] of players.entries()) {
    if (p.info && Number(p.mapId) === playerMapId) {
      playerList.push(p.info);
    }
  }

  sendToPlayer(player.ws, { type: 'player_list', players: playerList });
}

module.exports = {
  handlePlayerInfo,
  handlePlayerUpdate,
  handlePlayerLevelUp,
  handlePlayerHitByMob,
  sendPlayerList,
};
