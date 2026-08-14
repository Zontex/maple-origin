// Cash Shop — world-wide sales tally behind the "Best Item" rail

const { getDb } = require('../db');
const { players } = require('../state');
const { sendToPlayer } = require('../network');

function handleCashBuyLog(playerId, data) {
  const player = players.get(playerId);
  if (!player) return;
  const itemId = Number(data?.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) return;
  try {
    getDb().prepare(`
      INSERT INTO cash_shop_sales (item_id, count) VALUES (?, 1)
      ON CONFLICT(item_id) DO UPDATE SET count = count + 1
    `).run(itemId);
  } catch (e) {
    console.error('[CashShop] failed to log sale:', e);
  }
}

function handleGetBestItems(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  let best = [];
  try {
    best = getDb().prepare(
      'SELECT item_id AS itemId, count FROM cash_shop_sales ORDER BY count DESC, item_id ASC LIMIT 5'
    ).all();
  } catch (e) {
    console.error('[CashShop] failed to read best items:', e);
  }
  sendToPlayer(player.ws, { type: 'best_items', data: { items: best } });
}

module.exports = { handleCashBuyLog, handleGetBestItems };
