// Chat message handler

const { players } = require('../state');
const { broadcastToMap, broadcastToWorld } = require('../network');

function handleChatMessage(playerId, chatData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;

  broadcastToMap(chatData.mapId, {
    type: 'chat_message',
    message: { playerId, message: chatData.message, mapId: chatData.mapId }
  }, null, player);
}

// Cash Shop megaphones — world-wide, INCLUDING the sender (the original
// shows your own shout back to you, which doubles as delivery feedback).
// The look payload lets clients on other maps compose the avatar banner.
function handleMegaphone(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const message = String(data?.message ?? '').slice(0, 120);
  if (!message.trim()) return;

  broadcastToWorld(player.worldId, {
    type: 'megaphone',
    data: {
      playerId,
      itemId: Number(data.itemId) || 0,
      message,
      name: player.characterName || player.info.name || 'Player',
      look: data.look || null,
    },
  });
  console.log(`[Megaphone] ${player.characterName || playerId}: ${message}`);
}

module.exports = { handleChatMessage, handleMegaphone };
