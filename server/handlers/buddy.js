// Buddy list + whispers — v83 semantics, keyed by CHARACTER id (players are
// per-connection and come and go; characters persist).
//
// Rows: buddies(character_id = the list's owner, buddy_id = who is on it).
//   pending=0  a real entry on the owner's list
//   pending=1  an INCOMING request: buddy_id asked to add the owner and the
//              owner has not answered yet. It is delivered as buddy_request
//              on buddy_sync (every map load) so offline targets see it at
//              their next login without this module owning the auth path.
//
// Flow (matches the v83 server): A adds B -> (A,B,0) lands on A's list at
// once, shown offline until B accepts; (B,A,1) is B's request. Accept turns
// it into (B,A,0); decline deletes it and A keeps B as an offline entry.
// Delete only removes your own row (plus a still-pending request you sent);
// the other side keeps you, but presence is mutual-only, so they now see
// you offline.
//
// Presence: this module owns neither player.js nor connection.js, so it
// polls `players` every 2s, diffs {map, channel, level, job} per character,
// and pushes a fresh buddy_list to every online owner of a changed buddy.
//
// Whispers (/w, /find) ride the same module: both are per world, any
// channel, any map.

const { players } = require('../state');
const { sendToPlayer } = require('../network');
const { getDb } = require('../db');
const { registerHandler } = require('../router');

const BUDDY_CAPACITY = 20;
const DEFAULT_GROUP = 'Default Group';
const PRESENCE_POLL_MS = 2000;
const WHISPER_MAX_LEN = 120;

const db = getDb();
db.exec(`
  CREATE TABLE IF NOT EXISTS buddies (
    character_id INTEGER NOT NULL,
    buddy_id INTEGER NOT NULL,
    group_name TEXT NOT NULL DEFAULT '${DEFAULT_GROUP}',
    pending INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (character_id, buddy_id),
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY (buddy_id) REFERENCES characters(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_buddies_buddy ON buddies(buddy_id);
`);

const stmt = {
  list: db.prepare(`
    SELECT b.buddy_id AS id, b.group_name AS groupName, b.pending,
           c.name, c.level, c.job_id AS job
    FROM buddies b JOIN characters c ON c.id = b.buddy_id
    WHERE b.character_id = ?
    ORDER BY c.name COLLATE NOCASE`),
  get: db.prepare('SELECT pending FROM buddies WHERE character_id = ? AND buddy_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM buddies WHERE character_id = ?'),
  put: db.prepare('INSERT OR REPLACE INTO buddies (character_id, buddy_id, group_name, pending) VALUES (?, ?, ?, ?)'),
  del: db.prepare('DELETE FROM buddies WHERE character_id = ? AND buddy_id = ?'),
  // Everyone who has this character as a real (non-pending) buddy
  owners: db.prepare('SELECT character_id AS id FROM buddies WHERE buddy_id = ? AND pending = 0'),
  charByName: db.prepare('SELECT id, name, level, job_id AS job, world_id AS worldId FROM characters WHERE world_id = ? AND name = ?'),
  charById: db.prepare('SELECT id, name, level, job_id AS job, world_id AS worldId FROM characters WHERE id = ?'),
};

// ---- lookups ---------------------------------------------------------------

/** The player record behind a message, only once it is in-game as a character. */
function selfOf(playerId) {
  const p = players.get(playerId);
  return p && p.characterId ? p : null;
}

function nameOf(p) {
  return p?.characterName || p?.info?.name || '???';
}

function worldOf(p) {
  return Number(p?.worldId) || 0;
}

/** Live (registered, in a map) connection for a character id, if any. */
function onlineByCharId(characterId) {
  let best = null;
  for (const p of players.values()) {
    if (p.characterId !== characterId || !p.info) continue;
    if (!best || (p.lastUpdate || 0) > (best.lastUpdate || 0)) best = p;
  }
  return best;
}

function onlineByName(worldId, name) {
  const wanted = String(name || '').toLowerCase();
  if (!wanted) return null;
  let best = null;
  for (const p of players.values()) {
    if (!p.info || !p.characterId || worldOf(p) !== worldId) continue;
    if (nameOf(p).toLowerCase() !== wanted) continue;
    if (!best || (p.lastUpdate || 0) > (best.lastUpdate || 0)) best = p;
  }
  return best;
}

function notice(p, text) {
  if (p) sendToPlayer(p.ws, { type: 'buddy_notice', data: { text } });
}

// ---- list building ----------------------------------------------------------

function buildList(characterId) {
  const rows = stmt.list.all(characterId);
  const buddies = [];
  for (const row of rows) {
    if (row.pending) continue; // incoming requests are not buddies yet
    const live = onlineByCharId(row.id);
    // Presence is mutual-only: you only see someone online if they have you
    // as a real buddy too (a declined or deleted side shows offline)
    const theirs = stmt.get.get(row.id, characterId);
    const mutual = !!theirs && theirs.pending === 0;
    const online = !!live && mutual;
    buddies.push({
      characterId: row.id,
      name: row.name,
      level: online ? Number(live.info.level) || row.level : row.level,
      job: online ? Number(live.info.job ?? row.job) : row.job,
      online,
      mapId: online ? Number(live.mapId ?? live.info.mapId ?? 0) : 0,
      channel: online ? Number(live.channel) || 0 : -1,
      group: row.groupName || DEFAULT_GROUP,
    });
  }
  return { capacity: BUDDY_CAPACITY, buddies };
}

function pushList(characterId) {
  const p = onlineByCharId(characterId);
  if (!p) return;
  sendToPlayer(p.ws, { type: 'buddy_list', data: buildList(characterId) });
}

function pushPending(characterId) {
  const p = onlineByCharId(characterId);
  if (!p) return;
  for (const row of stmt.list.all(characterId)) {
    if (!row.pending) continue;
    sendToPlayer(p.ws, {
      type: 'buddy_request',
      data: { characterId: row.id, name: row.name, level: row.level, job: row.job },
    });
  }
}

// ---- handlers ---------------------------------------------------------------

function handleSync(playerId) {
  const me = selfOf(playerId);
  if (!me) return;
  sendToPlayer(me.ws, { type: 'buddy_list', data: buildList(me.characterId) });
  pushPending(me.characterId);
}

function handleAdd(playerId, data) {
  const me = selfOf(playerId);
  if (!me) return;
  const name = String(data?.name ?? '').trim();
  if (!name) return;

  const target = stmt.charByName.get(worldOf(me), name);
  if (!target) {
    notice(me, 'A character with that name does not exist.');
    return;
  }
  if (target.id === me.characterId) {
    notice(me, 'You cannot add yourself to your buddy list.');
    return;
  }
  const existing = stmt.get.get(me.characterId, target.id);
  if (existing && existing.pending === 0) {
    notice(me, `'${target.name}' is already on your buddy list.`);
    return;
  }
  if (existing && existing.pending === 1) {
    // They asked first — adding them back is an acceptance
    handleAccept(playerId, { characterId: target.id });
    return;
  }
  if (stmt.count.get(me.characterId).n >= BUDDY_CAPACITY) {
    notice(me, 'Your buddy list is full.');
    return;
  }
  const theirs = stmt.get.get(target.id, me.characterId);
  if (!theirs && stmt.count.get(target.id).n >= BUDDY_CAPACITY) {
    notice(me, `'${target.name}''s buddy list is full.`);
    return;
  }

  stmt.put.run(me.characterId, target.id, DEFAULT_GROUP, 0);
  if (!theirs) {
    stmt.put.run(target.id, me.characterId, DEFAULT_GROUP, 1);
    const live = onlineByCharId(target.id);
    if (live) {
      sendToPlayer(live.ws, {
        type: 'buddy_request',
        data: {
          characterId: me.characterId,
          name: nameOf(me),
          level: Number(me.info?.level) || 0,
          job: Number(me.info?.job) || 0,
        },
      });
    }
    notice(me, `You have sent a buddy request to '${target.name}'.`);
  } else if (theirs.pending === 0) {
    // They already had us (we deleted them earlier) — mutual again
    pushList(target.id);
  }
  pushList(me.characterId);
}

function handleAccept(playerId, data) {
  const me = selfOf(playerId);
  if (!me) return;
  const otherId = Number(data?.characterId);
  const row = stmt.get.get(me.characterId, otherId);
  if (!row || row.pending !== 1) return;
  // Pending rows already count toward capacity, so accepting never overflows
  stmt.put.run(me.characterId, otherId, DEFAULT_GROUP, 0);
  pushList(me.characterId);
  pushList(otherId);
  const other = onlineByCharId(otherId);
  if (other) notice(other, `'${nameOf(me)}' has accepted your buddy request.`);
}

function handleDecline(playerId, data) {
  const me = selfOf(playerId);
  if (!me) return;
  const otherId = Number(data?.characterId);
  const row = stmt.get.get(me.characterId, otherId);
  if (!row || row.pending !== 1) return;
  stmt.del.run(me.characterId, otherId);
  // The requester keeps us as an offline entry — v83 never tells them
}

function handleDelete(playerId, data) {
  const me = selfOf(playerId);
  if (!me) return;
  const otherId = Number(data?.characterId);
  if (!stmt.get.get(me.characterId, otherId)) return;
  stmt.del.run(me.characterId, otherId);
  // A request we sent that they never answered goes with it
  const theirs = stmt.get.get(otherId, me.characterId);
  if (theirs && theirs.pending === 1) stmt.del.run(otherId, me.characterId);
  pushList(me.characterId);
  if (theirs && theirs.pending === 0) pushList(otherId); // they now see us offline
}

function handleFind(playerId, data) {
  const me = selfOf(playerId);
  if (!me) return;
  const name = String(data?.name ?? '').trim();
  if (!name) return;
  const live = onlineByName(worldOf(me), name);
  sendToPlayer(me.ws, {
    type: 'buddy_find_result',
    data: live
      ? { name: nameOf(live), online: true, mapId: Number(live.mapId ?? live.info.mapId ?? 0), channel: Number(live.channel) || 0 }
      : { name, online: false },
  });
}

function handleWhisper(playerId, data) {
  const me = selfOf(playerId);
  if (!me) return;
  const to = String(data?.to ?? '').trim();
  const message = String(data?.message ?? '').trim().slice(0, WHISPER_MAX_LEN);
  if (!to || !message) return;
  const live = onlineByName(worldOf(me), to);
  if (!live) {
    sendToPlayer(me.ws, { type: 'whisper_fail', data: { to } });
    return;
  }
  sendToPlayer(live.ws, { type: 'whisper', data: { from: nameOf(me), message } });
  sendToPlayer(me.ws, { type: 'whisper_sent', data: { to: nameOf(live), message } });
}

registerHandler('buddy_sync', handleSync);
registerHandler('buddy_add', handleAdd);
registerHandler('buddy_accept', handleAccept);
registerHandler('buddy_decline', handleDecline);
registerHandler('buddy_delete', handleDelete);
registerHandler('buddy_find', handleFind);
registerHandler('whisper', handleWhisper);

// ---- presence poll ----------------------------------------------------------

let lastPresence = new Map(); // characterId -> "map|channel|level|job"

function presenceTick() {
  const now = new Map();
  for (const p of players.values()) {
    if (!p.characterId || !p.info) continue;
    now.set(p.characterId, `${p.mapId}|${p.channel}|${p.info.level}|${p.info.job}`);
  }
  const changed = new Set();
  for (const [cid, key] of now) if (lastPresence.get(cid) !== key) changed.add(cid);
  for (const cid of lastPresence.keys()) if (!now.has(cid)) changed.add(cid);
  lastPresence = now;
  if (changed.size === 0) return;

  const owners = new Set();
  for (const cid of changed) {
    for (const row of stmt.owners.all(cid)) owners.add(row.id);
  }
  for (const owner of owners) {
    if (now.has(owner)) pushList(owner);
  }
}

const presenceTimer = setInterval(() => {
  try {
    presenceTick();
  } catch (e) {
    console.error('[Buddy] presence poll failed:', e);
  }
}, PRESENCE_POLL_MS);
if (presenceTimer.unref) presenceTimer.unref();

module.exports = { BUDDY_CAPACITY, buildList };
