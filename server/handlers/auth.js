// Auth & character management handlers

const { players } = require('../state');
const { sendToPlayer } = require('../network');
const User = require('../models/User');
const Character = require('../models/Character');
const { WORLDS } = require('../worlds');

function handleRegister(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  sendToPlayer(player.ws, { type: 'register_result', success: false, error: 'Registration is currently disabled' });
}

function handleLogin(playerId, data) {
  const player = players.get(playerId);
  if (!player) return;
  const result = User.login(data.username, data.password);
  sendToPlayer(player.ws, { type: 'login_result', ...result });
  if (result.success) {
    player.userId = result.userId;
    player.username = result.username;
    console.log(`[Auth] User logged in: ${result.username} (${playerId.slice(0, 6)})`);
  }
}

function handleGetWorlds(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  sendToPlayer(player.ws, { type: 'world_list', worlds: WORLDS });
}

function handleGetCharacters(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.userId) return;
  const characters = Character.getByUserAndWorld(player.userId, data.worldId);
  sendToPlayer(player.ws, { type: 'character_list', worldId: data.worldId, characters });
}

function handleCheckName(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.userId) return;
  const result = Character.isNameTaken(data.worldId, data.name);
  sendToPlayer(player.ws, { type: 'check_name_result', ...result });
}

function handleCreateCharacter(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.userId) return;
  const result = Character.create(player.userId, {
    worldId: data.worldId,
    name: data.name,
    hair: data.hair,
    face: data.face,
    skin: data.skin,
    gender: data.gender,
    equips: data.equips,
    jobId: data.jobId,
  });
  sendToPlayer(player.ws, { type: 'create_character_result', ...result });
  if (result.success) {
    console.log(`[Char] Created: ${data.name} (job ${data.jobId ?? 0}) in world ${data.worldId}`);
    const characters = Character.getByUserAndWorld(player.userId, data.worldId);
    sendToPlayer(player.ws, { type: 'character_list', worldId: data.worldId, characters });
  }
}

function handleDeleteCharacter(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.userId) return;
  const result = Character.delete(player.userId, data.characterId);
  sendToPlayer(player.ws, { type: 'delete_character_result', ...result });
  if (result.success) {
    console.log(`[Char] Deleted character ${data.characterId}`);
  }
}

function handleSelectCharacter(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.userId) return;
  const charData = Character.getFullCharacter(data.characterId, player.userId);
  if (!charData) {
    sendToPlayer(player.ws, { type: 'select_character_result', success: false, error: 'Character not found' });
    return;
  }
  player.characterId = charData.id;
  player.characterName = charData.name;
  sendToPlayer(player.ws, { type: 'select_character_result', success: true, character: charData });
  console.log(`[Char] Selected: ${charData.name} (lv${charData.level} ${charData.stats.jobId})`);
}

function handleSaveCharacter(playerId, data) {
  const player = players.get(playerId);
  if (!player) return;
  // NEVER drop a save silently. A connection without characterId is a
  // client that reconnected without resuming its session (or a server that
  // restarted underneath it) — discarding its saves without a word cost a
  // player hours of progress. Tell it so it can re-authenticate and retry.
  if (!player.characterId) {
    console.warn(`[Save] save_character from unauthenticated connection ${playerId} — rejecting`);
    sendToPlayer(player.ws, { type: 'save_character_result', success: false, error: 'not_authenticated' });
    return;
  }
  // Never persist a bogus map id — drop map/pos so the DB row keeps the last
  // real location instead of teleporting the character to the start map
  if (!validMapId(data.mapId)) {
    console.warn(`[Save] save_character without valid mapId (${data.mapId}) for ${player.characterName || player.characterId} — keeping stored map`);
    delete data.mapId;
    delete data.posX;
    delete data.posY;
  }
  // Store full save data so disconnect handler has it
  player.lastSaveData = data;
  const result = Character.saveCharacter(player.characterId, data);
  sendToPlayer(player.ws, { type: 'save_character_result', ...result });
}

// A usable in-game map id, or null. NaN/0/undefined (login screen, map still
// loading) must NEVER be persisted — Number(NaN || fallback) short-circuits
// through falsy NaN, which is how characters got teleported to map 10000.
function validMapId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function autoSaveCharacter(player) {
  if (!player.characterId) return;

  // Prefer the last full save from the client (has equipped/inventory/quests)
  // Fall back to player.info (position updates only) if no full save received yet
  if (player.lastSaveData) {
    // Update position from latest player.info — only with a valid map id;
    // otherwise keep whatever the last full save recorded
    const infoMapId = validMapId(player.info?.mapId);
    if (infoMapId) {
      player.lastSaveData.mapId = infoMapId;
      player.lastSaveData.posX = Math.round(player.info.x || player.lastSaveData.posX || 0);
      player.lastSaveData.posY = Math.round(player.info.y || player.lastSaveData.posY || 0);
    } else if (!validMapId(player.lastSaveData.mapId)) {
      // Neither source has a real map — leave the DB value untouched
      delete player.lastSaveData.mapId;
      delete player.lastSaveData.posX;
      delete player.lastSaveData.posY;
    }
    const result = Character.saveCharacter(player.characterId, player.lastSaveData);
    if (result.success) {
      console.log(`[Save] Auto-saved ${player.characterName || player.characterId} (full data)`);
    }
    return;
  }

  // Fallback: save from player.info only. info comes from player_info/
  // player_update render-sync messages — its equipped list can be empty
  // (sent before the client finished attaching gear) and lacks scroll
  // equipData, so item data must NEVER be persisted from here: a crash
  // before the first full save would wipe the character's equipped rows
  if (!player.info) return;
  const info = player.info;
  const saveData = {
    level: info.level,
    exp: info.exp,
    str: info.str, dex: info.dex, int: info.int, luk: info.luk, ap: info.ap,
    hp: info.hp, maxHp: info.maxHp, mp: info.mp, maxMp: info.maxMp,
    jobId: info.job ?? info.jobId,
    mesos: info.mesos,
    fame: info.fame,
  };
  // Map/position only when the client reported a real in-game map — a save
  // without them keeps the character where the DB last placed them
  const mapId = validMapId(info.mapId) || validMapId(player.mapId);
  if (mapId) {
    saveData.mapId = mapId;
    saveData.posX = Math.round(info.x || 0);
    saveData.posY = Math.round(info.y || 0);
  } else {
    console.warn(`[Save] No valid mapId for ${player.characterName || player.characterId} — keeping stored map`);
  }
  const result = Character.saveCharacter(player.characterId, saveData);
  if (result.success) {
    console.log(`[Save] Auto-saved ${player.characterName || player.characterId} (fallback)`);
  }
}

module.exports = {
  handleRegister,
  handleLogin,
  handleGetWorlds,
  handleGetCharacters,
  handleCheckName,
  handleCreateCharacter,
  handleDeleteCharacter,
  handleSelectCharacter,
  handleSaveCharacter,
  autoSaveCharacter,
};
