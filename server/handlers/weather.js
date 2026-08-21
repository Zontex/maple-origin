// Cash Shop weather items (5120xxx — Snowy Snow, Sprinkled Flowers,
// Fireworks, ...): the user's client consumes the item and sends
//   { type: 'weather', data: { itemId, message, mapId } }
// and everyone in the room — the sender INCLUDED, so all clients start the
// same 30-second effect from the same packet — receives
//   { type: 'weather', data: { playerId, itemId, message, name, mapId } }
// The sender's name is stamped here, not trusted from the client; the
// client fills the item's String.wz msg template ("%s's snow : %s") with it.

const { players } = require('../state');
const { broadcastToMap } = require('../network');
const { registerHandler } = require('../router');

const MAX_MESSAGE = 60;

function handleWeather(playerId, data) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const itemId = Number(data && data.itemId) || 0;
  if (itemId < 5120000 || itemId >= 5130000) return;
  const message = String((data && data.message) || '').slice(0, MAX_MESSAGE);
  const mapId = Number((data && data.mapId) || player.mapId);
  if (!mapId) return;

  broadcastToMap(mapId, {
    type: 'weather',
    data: {
      playerId,
      itemId,
      message,
      mapId,
      name: player.characterName || player.info.name || 'Player',
    },
  }, null, player);
}

registerHandler('weather', handleWeather);

module.exports = { handleWeather };
