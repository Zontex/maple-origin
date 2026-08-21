// Fame (popularity) — the v83 raise/drop flow from another player's
// Character Info window. Rules follow the v83 GiveFameHandler: giver must be
// level 15+, cannot fame themselves, one fame action per 24 hours, the same
// target at most once per 30 days, and the target has to be in the room
// (same world, channel and map — v83 required the same map).
//
// The DB (characters.fame) is bumped here and the target client is told the
// new value (fame_changed) so its own next save — which still carries fame
// client-side — writes the same number back instead of the stale one.

const { registerHandler } = require('../router');
const { players, roomOf } = require('../state');
const { getDb } = require('../db');
const { sendToPlayer } = require('../network');

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;
const MIN_LEVEL = 15;

// v83 GiveFameResponse reasons, as the client shows them
const FAME_ERROR = {
  NOT_FOUND: 'not_found',   // target offline / not in the room
  LEVEL: 'level',           // giver under Lv. 15
  TODAY: 'today',           // already famed someone in the last 24h
  MONTH: 'month',           // already famed this target in the last 30 days
  SELF: 'self',             // tried to fame yourself
  ERROR: 'error',           // unexpected
};

getDb().exec(`
  CREATE TABLE IF NOT EXISTS fame_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    given_at INTEGER NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_fame_log_giver ON fame_log(character_id, given_at);
`);

function fail(player, reason) {
  sendToPlayer(player.ws, { type: 'fame_result', data: { ok: false, error: reason } });
}

/** Current fame of an online player, straight from the DB row */
function readFame(characterId) {
  const row = getDb().prepare('SELECT fame FROM characters WHERE id = ?').get(characterId);
  return row ? Number(row.fame) || 0 : 0;
}

/**
 * fame_give { targetId, mode } — mode 1 raises, 0 drops. Replies fame_result
 * to the giver; on success the target also gets fame_changed.
 */
function handleFameGive(playerId, data) {
  const giver = players.get(playerId);
  if (!giver || !giver.characterId) return;

  const target = players.get(String(data?.targetId ?? ''));
  const mode = Number(data?.mode) === 1 ? 1 : 0;

  if (!target || !target.characterId || !target.info || roomOf(target) !== roomOf(giver)) {
    return fail(giver, FAME_ERROR.NOT_FOUND);
  }
  if (target.characterId === giver.characterId) {
    return fail(giver, FAME_ERROR.SELF);
  }

  const db = getDb();
  const giverRow = db.prepare('SELECT level FROM characters WHERE id = ?').get(giver.characterId);
  const giverLevel = Math.max(Number(giverRow?.level) || 0, Number(giver.info?.level) || 0);
  if (giverLevel < MIN_LEVEL) {
    return fail(giver, FAME_ERROR.LEVEL);
  }

  const now = Date.now();
  const last = db.prepare(
    'SELECT given_at FROM fame_log WHERE character_id = ? ORDER BY given_at DESC LIMIT 1'
  ).get(giver.characterId);
  if (last && now - Number(last.given_at) < DAY_MS) {
    return fail(giver, FAME_ERROR.TODAY);
  }
  const sameTarget = db.prepare(
    'SELECT 1 FROM fame_log WHERE character_id = ? AND target_id = ? AND given_at > ? LIMIT 1'
  ).get(giver.characterId, target.characterId, now - MONTH_MS);
  if (sameTarget) {
    return fail(giver, FAME_ERROR.MONTH);
  }

  const delta = mode === 1 ? 1 : -1;
  let fame;
  try {
    db.transaction(() => {
      db.prepare('UPDATE characters SET fame = fame + ? WHERE id = ?').run(delta, target.characterId);
      db.prepare('INSERT INTO fame_log (character_id, target_id, given_at) VALUES (?, ?, ?)')
        .run(giver.characterId, target.characterId, now);
      fame = readFame(target.characterId);
    })();
  } catch (e) {
    console.error('[Fame] failed to apply fame:', e);
    return fail(giver, FAME_ERROR.ERROR);
  }

  // Keep the in-memory roster right for later info windows and the
  // disconnect-fallback save (which writes info.fame)
  target.info.fame = fame;

  const giverName = giver.info?.name || giver.characterName || '';
  const targetName = target.info?.name || target.characterName || '';
  console.log(`[Fame] ${giverName} ${mode === 1 ? 'raised' : 'dropped'} ${targetName}'s fame -> ${fame}`);

  sendToPlayer(giver.ws, {
    type: 'fame_result',
    data: { ok: true, targetId: target.id, targetName, mode, fame },
  });
  sendToPlayer(target.ws, {
    type: 'fame_changed',
    data: { fromId: giver.id, fromName: giverName, mode, fame },
  });
}

/**
 * fame_query { targetId } — the Character Info window asks for another
 * player's current fame when it opens; player_info never carried it.
 */
function handleFameQuery(playerId, data) {
  const asker = players.get(playerId);
  if (!asker) return;
  const target = players.get(String(data?.targetId ?? ''));
  if (!target || !target.characterId) return;
  const fame = readFame(target.characterId);
  if (target.info) target.info.fame = fame;
  sendToPlayer(asker.ws, { type: 'fame_info', data: { targetId: target.id, fame } });
}

registerHandler('fame_give', handleFameGive);
registerHandler('fame_query', handleFameQuery);

module.exports = { handleFameGive, handleFameQuery, FAME_ERROR };
