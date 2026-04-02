// Chat message handler

const { players } = require('../state');
const { broadcastToMap } = require('../network');

function handleChatMessage(playerId, chatData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;

  broadcastToMap(chatData.mapId, {
    type: 'chat_message',
    message: { playerId, message: chatData.message, mapId: chatData.mapId }
  });
}

module.exports = { handleChatMessage };
