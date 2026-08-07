// Message router — dispatches incoming messages to the appropriate handler

const { handlePlayerInfo, handlePlayerUpdate, handlePlayerLevelUp, handlePlayerHitByMob, sendPlayerList } = require('./handlers/player');
const { handleMonsterDamage, handleMobStateBatch, handleMobDamageRequest, handleMobDeath, handleMobRespawn } = require('./handlers/mob');
const { handleItemDrop, handleItemPickup } = require('./handlers/item');
const { handleChatMessage } = require('./handlers/chat');
const { handleReactorHit, handleReactorRespawn } = require('./handlers/reactor');
const { handleRegister, handleLogin, handleGetWorlds, handleGetCharacters, handleCheckName, handleCreateCharacter, handleDeleteCharacter, handleSelectCharacter, handleSaveCharacter } = require('./handlers/auth');
const { players } = require('./state');
const { sendToPlayer } = require('./network');
const { assignMapHost } = require('./hostManager');
const { handlePartyCreate, handlePartyInvite, handlePartyInviteResponse, handlePartyLeave, handlePartyExpel, handlePartyChangeLeader, handlePartyExp, handlePartyWarp } = require('./handlers/party');

/**
 * A client that believes it is not the mob host but is receiving no mob
 * state asks us to re-state the authoritative answer. Cheap, and the only
 * way out of a desync that previously needed a page reload.
 */
function handleHostCheck(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  // A host-check from an unregistered client means it lost (or never
  // completed) registration — dropping the request silently left it asking
  // every 5s forever while its mobs stayed frozen. Tell it to re-register;
  // handlePlayerInfo will assign the host from there.
  if (!player.info) {
    sendToPlayer(player.ws, { type: 'reregister' });
    return;
  }
  assignMapHost(player.mapId, playerId);
}

/**
 * Frame-driven liveness ping, sent once a second from the client's render
 * loop. This is the signal isLive() and the inactivity sweep should use:
 * player_update only fires when the player moves, so standing still was
 * indistinguishable from a dead tab.
 */
function handleHeartbeat(playerId) {
  const player = players.get(playerId);
  if (player) player.lastUpdate = Date.now();
}

function handleMessage(playerId, data) {
  switch (data.type) {
    case 'player_info':
      handlePlayerInfo(playerId, data.data);
      break;
    case 'player_update':
      handlePlayerUpdate(playerId, data.data);
      break;
    case 'monster_damage':
      handleMonsterDamage(playerId, data.data);
      break;
    case 'chat_message':
      handleChatMessage(playerId, data.data);
      break;
    case 'item_drop':
      handleItemDrop(playerId, data.data);
      break;
    case 'item_pickup':
      handleItemPickup(playerId, data.data);
      break;
    case 'mob_state_batch':
      handleMobStateBatch(playerId, data.data);
      break;
    case 'mob_damage_request':
      handleMobDamageRequest(playerId, data.data);
      break;
    case 'mob_death':
      handleMobDeath(playerId, data.data);
      break;
    case 'mob_respawn':
      handleMobRespawn(playerId, data.data);
      break;
    case 'request_host_check':
      handleHostCheck(playerId);
      break;
    case 'heartbeat':
      handleHeartbeat(playerId);
      break;
    case 'player_hit_by_mob':
      handlePlayerHitByMob(playerId, data.data);
      break;
    case 'reactor_hit':
      handleReactorHit(playerId, data.data);
      break;
    case 'reactor_respawn':
      handleReactorRespawn(playerId, data.data);
      break;
    case 'player_level_up':
      handlePlayerLevelUp(playerId, data.data);
      break;
    case 'client_log': {
      const short = playerId.slice(0, 6);
      console.log(`\x1b[36m[CLIENT ${short}]\x1b[0m ${data.data}`);
      break;
    }
    case 'get_player_list':
      sendPlayerList(playerId);
      break;
    case 'register':
      handleRegister(playerId, data.data);
      break;
    case 'login':
      handleLogin(playerId, data.data);
      break;
    case 'get_worlds':
      handleGetWorlds(playerId);
      break;
    case 'get_characters':
      handleGetCharacters(playerId, data.data);
      break;
    case 'check_name':
      handleCheckName(playerId, data.data);
      break;
    case 'create_character':
      handleCreateCharacter(playerId, data.data);
      break;
    case 'delete_character':
      handleDeleteCharacter(playerId, data.data);
      break;
    case 'select_character':
      handleSelectCharacter(playerId, data.data);
      break;
    case 'save_character':
      handleSaveCharacter(playerId, data.data);
      break;
    case 'party_create':
      handlePartyCreate(playerId);
      break;
    case 'party_invite':
      handlePartyInvite(playerId, data.data);
      break;
    case 'party_invite_response':
      handlePartyInviteResponse(playerId, data.data);
      break;
    case 'party_leave':
      handlePartyLeave(playerId);
      break;
    case 'party_expel':
      handlePartyExpel(playerId, data.data);
      break;
    case 'party_change_leader':
      handlePartyChangeLeader(playerId, data.data);
      break;
    case 'party_exp':
      handlePartyExp(playerId, data.data);
      break;
    case 'party_warp':
      handlePartyWarp(playerId, data.data);
      break;
    default:
      console.warn('Unknown message type:', data.type);
  }
}

module.exports = { handleMessage };
