// Message router — dispatches incoming messages to the appropriate handler

const { handlePlayerInfo, handlePlayerUpdate, handlePlayerLevelUp, handlePlayerHitByMob, sendPlayerList } = require('./handlers/player');
const { handleMonsterDamage, handleMobStateBatch, handleMobDamageRequest, handleMobDeath, handleMobRespawn } = require('./handlers/mob');
const { handleItemDrop, handleItemPickup } = require('./handlers/item');
const { handleChatMessage } = require('./handlers/chat');
const { handleReactorHit, handleReactorRespawn } = require('./handlers/reactor');
const { handleRegister, handleLogin, handleGetWorlds, handleGetCharacters, handleCheckName, handleCreateCharacter, handleDeleteCharacter, handleSelectCharacter, handleSaveCharacter } = require('./handlers/auth');

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
    default:
      console.warn('Unknown message type:', data.type);
  }
}

module.exports = { handleMessage };
