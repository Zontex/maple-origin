// Player-related message handlers

const { players, roomOf, roomKey } = require('../state');
const { sendToPlayer, broadcastToMap } = require('../network');
const { assignMapHost } = require('../hostManager');
const { refreshPartyOf } = require('./party');
const { dropsOnMap } = require('./item');
const { WORLDS } = require('../worlds');

// Buffs a player reports (player_buff) are kept on its info so a late joiner
// sees them; expired entries are dropped whenever the list is touched
function liveBuffs(info) {
  const now = Date.now();
  return (info?.buffs || []).filter((b) => Number(b.expiresAt) > now);
}

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

  player.info = { ...playerInfo, id: playerId, buffs: liveBuffs(playerInfo) };
  player.mapId = playerInfo.mapId;

  broadcastToMap(player.mapId, {
    type: 'player_joined',
    player: player.info
  }, playerId);

  sendPlayerList(playerId);
  assignMapHost(roomOf(player), playerId);
}

/**
 * A buff went up or came down on the player. Relayed to the room (remote
 * characters play the cast art and keep the active set — party buffs ride
 * on this) and remembered on the info for joiners.
 */
function handlePlayerBuff(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const skillId = Number(data?.skillId);
  if (!Number.isFinite(skillId)) return;
  const on = !!data?.on;
  const level = Math.max(1, Math.min(Math.floor(Number(data?.level)) || 1, 30));
  const durationMs = Math.max(0, Math.min(Number(data?.durationMs) || 0, 3 * 60 * 60 * 1000));
  const buffs = liveBuffs(player.info).filter((b) => b.skillId !== skillId);
  if (on) buffs.push({ skillId, expiresAt: Date.now() + durationMs });
  player.info.buffs = buffs;
  broadcastToMap(player.mapId, {
    type: 'player_buff',
    data: { playerId, skillId, on, durationMs, level },
  }, playerId);
}

/**
 * Channel change (the in-game channel window). Same shape as a map change:
 * leave the old room, join the new one, re-elect both hosts.
 */
function handleChangeChannel(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const world = WORLDS.find((w) => Number(w.id) === (Number(player.worldId) || 0));
  const channelCount = Number(world?.channelCount) || 20;
  const channel = Math.floor(Number(data?.channel));
  if (!Number.isFinite(channel) || channel < 0 || channel >= channelCount) {
    sendToPlayer(player.ws, { type: 'channel_changed', success: false, channel: player.channel });
    return;
  }
  if (channel === (Number(player.channel) || 0)) {
    sendToPlayer(player.ws, { type: 'channel_changed', success: true, channel });
    return;
  }
  const mapId = Number(player.mapId);
  const oldRoom = roomOf(player);
  broadcastToMap(mapId, { type: 'player_left', id: playerId }, playerId);
  player.channel = channel;
  const newRoom = roomOf(player);
  console.log(`Player ${playerId} changed channel: ${oldRoom} -> ${newRoom}`);
  sendToPlayer(player.ws, { type: 'channel_changed', success: true, channel });
  broadcastToMap(mapId, { type: 'player_joined', player: player.info }, playerId);
  sendPlayerList(playerId);
  assignMapHost(oldRoom);
  assignMapHost(newRoom, playerId);
  refreshPartyOf(playerId);
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
  // Face emote is transient — present while held, absent otherwise
  updatedInfo.emote = updateData.emote;
  // Summoned-pet roster (persists in info so late joiners see the pets);
  // petAction is a one-shot like emote — present for one broadcast only
  if (updateData.pets !== undefined) updatedInfo.pets = updateData.pets;
  updatedInfo.petAction = updateData.petAction;
  // Monster Book summary (level / cover card / card counts) — persists in info
  // so a late joiner's character-info window sees it too
  if (updateData.monsterBook !== undefined) updatedInfo.monsterBook = updateData.monsterBook;

  const currentMapId = Number(player.mapId);
  const newMapId = updateData.mapId;

  if (currentMapId !== newMapId) {
    console.log(`Player ${playerId} changed maps: ${currentMapId} -> ${newMapId}`);

    broadcastToMap(currentMapId, { type: 'player_left', id: playerId }, playerId);

    player.mapId = newMapId;
    updatedInfo.mapId = newMapId;

    broadcastToMap(newMapId, { type: 'player_joined', player: updatedInfo }, playerId);
    sendPlayerList(playerId);

    assignMapHost(roomKey(player.worldId, player.channel, currentMapId));
    assignMapHost(roomOf(player), playerId);

    // Party rosters show each member's map — keep them fresh
    refreshPartyOf(playerId);
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
  if (Number.isFinite(Number(levelData.level))) {
    player.info.level = Number(levelData.level);
  }
  broadcastToMap(mapId, { type: 'player_level_up', data: { ...levelData, playerId } }, playerId);
  refreshPartyOf(playerId);
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

  // What is lying on the floor of the room being entered — sent alongside
  // the player list, which goes out on every join and map change
  const floor = dropsOnMap(player);
  if (floor.length) sendToPlayer(player.ws, { type: 'item_drops_on_map', data: { mapId: Number(player.mapId), drops: floor } });

  const room = roomOf(player);
  const playerList = [];

  for (const [, p] of players.entries()) {
    if (p.info && roomOf(p) === room) {
      playerList.push({ ...p.info, buffs: liveBuffs(p.info) });
    }
  }

  sendToPlayer(player.ws, { type: 'player_list', players: playerList });
}

module.exports = {
  handlePlayerInfo,
  handlePlayerUpdate,
  handlePlayerLevelUp,
  handlePlayerHitByMob,
  handlePlayerBuff,
  handleChangeChannel,
  sendPlayerList,
};
