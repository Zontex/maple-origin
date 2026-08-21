// Guild system — v83 semantics (Cosmic's rules): a guild is per world, costs
// 1,500,000 mesos to found, starts at capacity 10 and grows by 5 per purchase
// up to 100, has five ranks with editable titles (Master / Jr. Master /
// Member x3), a notice, and an emblem made of GuildMark.img parts. The server
// is the source of truth for membership and persists everything in SQLite so
// a character's guild survives restarts; every mutation answers with a full
// `guild_update` to all ONLINE members so clients never drift.
//
// Players are per-connection (uuid), guild membership is per CHARACTER — so
// everything here is keyed by characterId and the player record is only a
// delivery address. Online status is discovered by a 2s poll over `players`
// (this module does not own connection/player handlers): each tick diffs the
// set of online members per guild and broadcasts an update on change, which
// is also what delivers a member's roster when they log in (the client sends
// `guild_sync` on entering the game for an immediate answer).
//
// Mesos are client-authoritative in this project (like the Cash Shop's NX),
// so purchases are acknowledged with `guild_result {op, ok, cost}` and the
// client deducts on success — the same pattern as every other meso sink.

const { registerHandler } = require('../router');
const { players } = require('../state');
const { sendToPlayer, broadcastToMap } = require('../network');
const { getDb } = require('../db');

const CREATE_COST = 1500000;
const EMBLEM_COST = 5000000;
const BASE_CAPACITY = 10;
const MAX_CAPACITY = 100;
const DEFAULT_RANKS = ['Master', 'Jr. Master', 'Member', 'Member', 'Member'];
const MAX_NOTICE = 100;
const MAX_TITLE = 12;
const ONLINE_POLL_MS = 2000;

// ---- schema ---------------------------------------------------------------

const db = getDb();
db.exec(`
  CREATE TABLE IF NOT EXISTS guilds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL COLLATE NOCASE,
    leader_id INTEGER NOT NULL,
    notice TEXT DEFAULT '',
    rank1 TEXT DEFAULT 'Master',
    rank2 TEXT DEFAULT 'Jr. Master',
    rank3 TEXT DEFAULT 'Member',
    rank4 TEXT DEFAULT 'Member',
    rank5 TEXT DEFAULT 'Member',
    logo_bg INTEGER DEFAULT 0,
    logo_bg_color INTEGER DEFAULT 0,
    logo INTEGER DEFAULT 0,
    logo_color INTEGER DEFAULT 0,
    capacity INTEGER DEFAULT ${BASE_CAPACITY},
    gp INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(world_id, name)
  );
  CREATE TABLE IF NOT EXISTS guild_members (
    guild_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    rank INTEGER NOT NULL DEFAULT 5,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (character_id),
    FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members(guild_id);
`);

const stmts = {
  guildById: db.prepare('SELECT * FROM guilds WHERE id = ?'),
  guildByName: db.prepare('SELECT id FROM guilds WHERE world_id = ? AND name = ? COLLATE NOCASE'),
  membership: db.prepare('SELECT guild_id, rank FROM guild_members WHERE character_id = ?'),
  members: db.prepare(`
    SELECT gm.character_id, gm.rank, c.name, c.level, c.job_id
    FROM guild_members gm JOIN characters c ON c.id = gm.character_id
    WHERE gm.guild_id = ? ORDER BY gm.rank ASC, c.name COLLATE NOCASE ASC`),
  memberCount: db.prepare('SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?'),
  insertGuild: db.prepare(`
    INSERT INTO guilds (world_id, name, leader_id, rank1, rank2, rank3, rank4, rank5, capacity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  insertMember: db.prepare('INSERT INTO guild_members (guild_id, character_id, rank) VALUES (?, ?, ?)'),
  deleteMember: db.prepare('DELETE FROM guild_members WHERE character_id = ?'),
  deleteMembers: db.prepare('DELETE FROM guild_members WHERE guild_id = ?'),
  deleteGuild: db.prepare('DELETE FROM guilds WHERE id = ?'),
  setRank: db.prepare('UPDATE guild_members SET rank = ? WHERE character_id = ? AND guild_id = ?'),
  setLeader: db.prepare('UPDATE guilds SET leader_id = ? WHERE id = ?'),
  setNotice: db.prepare('UPDATE guilds SET notice = ? WHERE id = ?'),
  setTitles: db.prepare('UPDATE guilds SET rank1 = ?, rank2 = ?, rank3 = ?, rank4 = ?, rank5 = ? WHERE id = ?'),
  setCapacity: db.prepare('UPDATE guilds SET capacity = ? WHERE id = ?'),
  setEmblem: db.prepare('UPDATE guilds SET logo_bg = ?, logo_bg_color = ?, logo = ?, logo_color = ? WHERE id = ?'),
  characterWorld: db.prepare('SELECT world_id, name FROM characters WHERE id = ?'),
};

// ---- lookups --------------------------------------------------------------

function playerByCharacterId(characterId) {
  for (const p of players.values()) {
    if (p.characterId === characterId && p.info) return p;
  }
  return null;
}

function membershipOf(characterId) {
  if (!characterId) return null;
  return stmts.membership.get(characterId) || null;
}

function guildOf(characterId) {
  const m = membershipOf(characterId);
  return m ? stmts.guildById.get(m.guild_id) || null : null;
}

/** Cosmic's expansion price for a guild currently holding `size` members */
function getIncreaseGuildCost(size) {
  const cost = 500000 + Math.max(0, Math.floor((size - 15) / 5)) * 1000000;
  if (size > 30) return Math.min(5000000, Math.max(cost, 5000000));
  return cost;
}

function isGuildNameAcceptable(name) {
  return typeof name === 'string' && name.length >= 3 && name.length <= 12 && /^[A-Za-z0-9]+$/.test(name);
}

function emblemOf(row) {
  return {
    bg: row.logo_bg | 0,
    bgColor: row.logo_bg_color | 0,
    mark: row.logo | 0,
    markColor: row.logo_color | 0,
  };
}

function memberPayload(m) {
  const p = playerByCharacterId(m.character_id);
  return {
    characterId: m.character_id,
    playerId: p ? p.id : null,
    name: m.name,
    level: p ? (p.info.level || m.level || 1) : (m.level || 1),
    job: p ? (p.info.job ?? m.job_id ?? 0) : (m.job_id ?? 0),
    rank: m.rank,
    online: !!p,
    mapId: p ? Number(p.mapId || p.info.mapId || 0) : 0,
    channel: p ? (Number(p.channel) || 0) : 0,
  };
}

function guildPayload(row) {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    leaderId: row.leader_id,
    notice: row.notice || '',
    ranks: [row.rank1, row.rank2, row.rank3, row.rank4, row.rank5],
    emblem: emblemOf(row),
    capacity: row.capacity,
    gp: row.gp | 0,
    members: stmts.members.all(row.id).map(memberPayload),
  };
}

// ---- delivery -------------------------------------------------------------

function notify(player, text) {
  if (player) sendToPlayer(player.ws, { type: 'guild_notice', data: { text } });
}

function result(player, op, ok, extra = {}) {
  if (player) sendToPlayer(player.ws, { type: 'guild_result', data: { op, ok, ...extra } });
}

function sendGuildUpdate(player, row) {
  if (!player) return;
  sendToPlayer(player.ws, {
    type: 'guild_update',
    data: { guild: row ? guildPayload(row) : null, myCharacterId: player.characterId || 0 },
  });
}

/**
 * Full roster to every online member. `looksChanged` (membership or emblem
 * moved) also refreshes each member's name-tag look and tells their rooms;
 * rank/notice/title/capacity changes leave the tags alone.
 */
function broadcastGuild(guildId, looksChanged = false) {
  const row = stmts.guildById.get(guildId);
  if (!row) return;
  const payload = guildPayload(row);
  for (const m of payload.members) {
    if (!m.playerId) continue;
    const p = players.get(m.playerId);
    if (!p) continue;
    sendToPlayer(p.ws, { type: 'guild_update', data: { guild: payload, myCharacterId: p.characterId || 0 } });
    if (looksChanged) {
      applyLook(p, row);
      announceLook(p);
    }
  }
  onlineSnapshot.set(guildId, snapshotKey(payload));
}

function notifyGuild(guildId, text, exceptCharacterId = null) {
  for (const m of stmts.members.all(guildId)) {
    if (m.character_id === exceptCharacterId) continue;
    notify(playerByCharacterId(m.character_id), text);
  }
}

// Name-tag look: mirrored onto player.info so player_joined / player_list
// carry it for free, and pushed to the room as `guild_looks` for clients
// that already have the character on screen
function lookOf(row) {
  return row ? { guildName: row.name, guildMark: emblemOf(row) } : null;
}

function applyLook(player, row) {
  if (!player || !player.info) return;
  const look = lookOf(row);
  player.info.guildName = look ? look.guildName : undefined;
  player.info.guildMark = look ? look.guildMark : undefined;
}

function announceLook(player) {
  if (!player || !player.info) return;
  const mapId = Number(player.mapId || player.info.mapId || 0);
  if (!mapId) return;
  const look = player.info.guildName
    ? { guildName: player.info.guildName, guildMark: player.info.guildMark }
    : null;
  broadcastToMap(mapId, { type: 'guild_looks', data: { looks: { [player.id]: look } } }, player.id, player);
}

// ---- handlers -------------------------------------------------------------

function requireCharacter(playerId) {
  const p = players.get(playerId);
  if (!p || !p.characterId) return null;
  return p;
}

registerHandler('guild_sync', (playerId) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  applyLook(p, row);
  sendGuildUpdate(p, row);
  announceLook(p);
});

registerHandler('guild_create', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const name = String(data?.name ?? '').trim();
  if (membershipOf(p.characterId)) {
    result(p, 'create', false, { error: 'You may not create a new Guild while you are in one.' });
    return;
  }
  if (!isGuildNameAcceptable(name)) {
    result(p, 'create', false, { error: 'The Guild name you have chosen is not accepted.' });
    return;
  }
  const worldId = Number(p.worldId) || 0;
  if (stmts.guildByName.get(worldId, name)) {
    result(p, 'create', false, { error: 'The name is already in use. Please try other ones.' });
    return;
  }
  const tx = db.transaction(() => {
    const info = stmts.insertGuild.run(worldId, name, p.characterId, ...DEFAULT_RANKS, BASE_CAPACITY);
    stmts.insertMember.run(info.lastInsertRowid, p.characterId, 1);
    return Number(info.lastInsertRowid);
  });
  const guildId = tx();
  console.log(`[Guild] ${p.characterName || p.characterId} founded '${name}' (#${guildId}) on world ${worldId}`);
  result(p, 'create', true, { cost: CREATE_COST, guildId });
  notify(p, 'You have successfully created a Guild.');
  broadcastGuild(guildId, true);
});

registerHandler('guild_disband', (playerId) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  if (!row || row.leader_id !== p.characterId) {
    result(p, 'disband', false, { error: 'You can only disband a Guild if you are the leader of that Guild.' });
    return;
  }
  const members = stmts.members.all(row.id);
  db.transaction(() => {
    stmts.deleteMembers.run(row.id);
    stmts.deleteGuild.run(row.id);
  })();
  onlineSnapshot.delete(row.id);
  console.log(`[Guild] '${row.name}' (#${row.id}) disbanded by ${p.characterName || p.characterId}`);
  for (const m of members) {
    const mp = playerByCharacterId(m.character_id);
    if (!mp) continue;
    notify(mp, 'The Guild has been disbanded.');
    applyLook(mp, null);
    sendGuildUpdate(mp, null);
    announceLook(mp);
  }
  result(p, 'disband', true);
});

registerHandler('guild_expand', (playerId) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  if (!row || row.leader_id !== p.characterId) {
    result(p, 'expand', false, { error: "You can only increase your Guild's capacity if you are the leader." });
    return;
  }
  if (row.capacity >= MAX_CAPACITY) {
    result(p, 'expand', false, { error: 'Your Guild has already reached the maximum capacity.' });
    return;
  }
  const cost = getIncreaseGuildCost(row.capacity);
  const capacity = Math.min(MAX_CAPACITY, row.capacity + 5);
  stmts.setCapacity.run(capacity, row.id);
  result(p, 'expand', true, { cost, capacity });
  notifyGuild(row.id, `The Guild's capacity has been increased to ${capacity}.`);
  broadcastGuild(row.id);
});

registerHandler('guild_emblem', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  if (!row || row.leader_id !== p.characterId) {
    result(p, 'emblem', false, { error: 'You must be the Guild Leader to change the Emblem.' });
    return;
  }
  const bg = Number(data?.bg) | 0;
  const bgColor = Number(data?.bgColor) | 0;
  const mark = Number(data?.mark) | 0;
  const markColor = Number(data?.markColor) | 0;
  // GuildMark.img: backgrounds 1000..1030, marks 2000..9026, colours 1..16
  const validBg = bg === 0 || (bg >= 1000 && bg <= 1999 && bgColor >= 1 && bgColor <= 16);
  const validMark = mark === 0 || (mark >= 2000 && mark <= 9999 && markColor >= 1 && markColor <= 16);
  if (!validBg || !validMark) {
    result(p, 'emblem', false, { error: 'That emblem is not valid.' });
    return;
  }
  stmts.setEmblem.run(bg, bg ? bgColor : 0, mark, mark ? markColor : 0, row.id);
  result(p, 'emblem', true, { cost: EMBLEM_COST });
  notifyGuild(row.id, 'The Guild Emblem has been changed.');
  broadcastGuild(row.id, true);
});

registerHandler('guild_invite', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  const me = membershipOf(p.characterId);
  if (!row || !me || me.rank > 2) {
    notify(p, 'You are not allowed to invite members.');
    return;
  }
  const count = stmts.memberCount.get(row.id).n;
  if (count >= row.capacity) {
    notify(p, 'Your Guild is already full.');
    return;
  }
  const targetName = String(data?.targetName ?? '').trim().toLowerCase();
  let target = null;
  if (data?.targetId && players.has(data.targetId)) {
    target = players.get(data.targetId);
  } else if (targetName) {
    for (const cand of players.values()) {
      if (cand.info?.name?.toLowerCase() === targetName) { target = cand; break; }
    }
  }
  if (!target || !target.info || !target.characterId || (Number(target.worldId) || 0) !== (Number(p.worldId) || 0)) {
    notify(p, `'${data?.targetName || '???'}' is not online or not in this world.`);
    return;
  }
  if (target.id === p.id) return;
  if (membershipOf(target.characterId)) {
    notify(p, `'${target.info.name}' is already in a Guild.`);
    return;
  }
  sendToPlayer(target.ws, {
    type: 'guild_invite',
    data: { guildId: row.id, guildName: row.name, fromName: p.info?.name || p.characterName || '???' },
  });
  notify(p, `You have invited '${target.info.name}' to your Guild.`);
});

registerHandler('guild_invite_response', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = stmts.guildById.get(Number(data?.guildId));
  if (!row) {
    notify(p, 'That Guild no longer exists.');
    return;
  }
  const inviter = data?.fromName
    ? [...players.values()].find((c) => c.info?.name === data.fromName && membershipOf(c.characterId)?.guild_id === row.id)
    : null;
  if (!data?.accept) {
    notify(inviter, `'${p.info?.name || '???'}' has declined the Guild invitation.`);
    return;
  }
  if (membershipOf(p.characterId)) {
    notify(p, 'You are already in a Guild.');
    return;
  }
  if (stmts.memberCount.get(row.id).n >= row.capacity) {
    notify(p, `'${row.name}' is already full.`);
    return;
  }
  stmts.insertMember.run(row.id, p.characterId, 5);
  const name = p.info?.name || p.characterName || '???';
  console.log(`[Guild] ${name} joined '${row.name}' (#${row.id})`);
  notifyGuild(row.id, `${name} has joined the guild.`, p.characterId);
  broadcastGuild(row.id, true);
});

function removeMember(row, characterId, reason, isExpel) {
  stmts.deleteMember.run(characterId);
  const mp = playerByCharacterId(characterId);
  if (mp) {
    notify(mp, reason);
    applyLook(mp, null);
    sendGuildUpdate(mp, null);
    announceLook(mp);
  }
  const name = mp?.info?.name || stmts.characterWorld.get(characterId)?.name || '???';
  notifyGuild(row.id, isExpel ? `${name} has been expelled from the guild.` : `${name} has left the guild.`);
  broadcastGuild(row.id);
}

registerHandler('guild_leave', (playerId) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  if (!row) return;
  if (row.leader_id === p.characterId) {
    notify(p, 'The Guild Master cannot leave the Guild. Disband it through Heracle instead.');
    return;
  }
  removeMember(row, p.characterId, 'You have left the Guild.', false);
});

registerHandler('guild_expel', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  const me = membershipOf(p.characterId);
  const targetId = Number(data?.characterId);
  if (!row || !me || me.rank > 2 || !targetId || targetId === p.characterId) return;
  const target = membershipOf(targetId);
  if (!target || target.guild_id !== row.id || target.rank <= me.rank) return;
  removeMember(row, targetId, 'You have been expelled from the Guild.', true);
});

registerHandler('guild_rank', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  const me = membershipOf(p.characterId);
  const targetId = Number(data?.characterId);
  const rank = Number(data?.rank);
  if (!row || !me || me.rank > 2 || !targetId || targetId === p.characterId) return;
  // Master can hand out Jr. Master (2); a Jr. Master only moves ranks below
  // their own. Rank 1 is only ever transferred through guild_change_leader.
  if (!Number.isInteger(rank) || rank < 2 || rank > 5 || rank <= me.rank) return;
  const target = membershipOf(targetId);
  if (!target || target.guild_id !== row.id || target.rank <= me.rank) return;
  stmts.setRank.run(rank, targetId, row.id);
  const name = stmts.characterWorld.get(targetId)?.name || '???';
  const title = [row.rank1, row.rank2, row.rank3, row.rank4, row.rank5][rank - 1];
  notifyGuild(row.id, `${name} is now a ${title} of the guild.`);
  broadcastGuild(row.id);
});

registerHandler('guild_change_leader', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  const targetId = Number(data?.characterId);
  if (!row || row.leader_id !== p.characterId || !targetId || targetId === p.characterId) return;
  const target = membershipOf(targetId);
  if (!target || target.guild_id !== row.id) return;
  db.transaction(() => {
    stmts.setRank.run(2, p.characterId, row.id);
    stmts.setRank.run(1, targetId, row.id);
    stmts.setLeader.run(targetId, row.id);
  })();
  const name = stmts.characterWorld.get(targetId)?.name || '???';
  notifyGuild(row.id, `${name} has become the new Guild Master.`);
  broadcastGuild(row.id);
});

registerHandler('guild_notice', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  const me = membershipOf(p.characterId);
  if (!row || !me || me.rank > 2) return;
  const notice = String(data?.notice ?? '').replace(/[\r\n]+/g, ' ').slice(0, MAX_NOTICE);
  stmts.setNotice.run(notice, row.id);
  broadcastGuild(row.id);
});

registerHandler('guild_titles', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  if (!row || row.leader_id !== p.characterId) return;
  const titles = Array.isArray(data?.titles) ? data.titles : [];
  const clean = DEFAULT_RANKS.map((def, i) => {
    const t = String(titles[i] ?? '').trim().slice(0, MAX_TITLE);
    return t || def;
  });
  stmts.setTitles.run(...clean, row.id);
  notifyGuild(row.id, 'The Guild rank titles have been changed.');
  broadcastGuild(row.id);
});

registerHandler('guild_chat', (playerId, data) => {
  const p = requireCharacter(playerId);
  if (!p) return;
  const row = guildOf(p.characterId);
  if (!row) {
    notify(p, 'You are not in a Guild.');
    return;
  }
  const message = String(data?.message ?? '').slice(0, 120);
  if (!message.trim()) return;
  const payload = { type: 'guild_chat', data: { name: p.info?.name || p.characterName || '???', message } };
  for (const m of stmts.members.all(row.id)) {
    const mp = playerByCharacterId(m.character_id);
    if (mp) sendToPlayer(mp.ws, payload);
  }
});

// A client that has characters on screen it knows no guild look for asks
// about them in a batch; null means "no guild", so it can stop asking.
registerHandler('guild_look_request', (playerId, data) => {
  const p = players.get(playerId);
  if (!p) return;
  const ids = Array.isArray(data?.ids) ? data.ids.slice(0, 64) : [];
  const looks = {};
  for (const id of ids) {
    const other = players.get(id);
    if (!other) continue;
    const row = other.characterId ? guildOf(other.characterId) : null;
    applyLook(other, row);
    looks[id] = lookOf(row);
  }
  sendToPlayer(p.ws, { type: 'guild_looks', data: { looks } });
});

// ---- online-status poll -----------------------------------------------------

// guildId -> key of the last roster broadcast (online flags + level/job/map
// per member). Rosters go out only when that key changes, so idle guilds
// cost nothing beyond the scan.
const onlineSnapshot = new Map();

function snapshotKey(payload) {
  return payload.members
    .map((m) => `${m.characterId}:${m.online ? 1 : 0}:${m.level}:${m.job}:${m.mapId}:${m.channel}`)
    .join('|');
}

function pollOnline() {
  const seen = new Set();
  for (const p of players.values()) {
    if (!p.characterId || !p.info) continue;
    const m = membershipOf(p.characterId);
    if (!m) {
      if (p.info.guildName) { applyLook(p, null); announceLook(p); }
      continue;
    }
    if (!p.info.guildName) {
      // First sighting of this member since they logged in — stamp the look
      // so player_joined carries it, and tell the room they're standing in
      applyLook(p, stmts.guildById.get(m.guild_id));
      announceLook(p);
    }
    seen.add(m.guild_id);
  }
  for (const guildId of seen) {
    const row = stmts.guildById.get(guildId);
    if (!row) continue;
    const payload = guildPayload(row);
    const key = snapshotKey(payload);
    if (onlineSnapshot.get(guildId) === key) continue;
    onlineSnapshot.set(guildId, key);
    for (const mem of payload.members) {
      if (!mem.playerId) continue;
      const mp = players.get(mem.playerId);
      if (mp) sendToPlayer(mp.ws, { type: 'guild_update', data: { guild: payload, myCharacterId: mp.characterId || 0 } });
    }
  }
  // Guilds that went fully offline: forget the snapshot so the next login
  // gets a fresh roster even if nothing else changed
  for (const guildId of [...onlineSnapshot.keys()]) {
    if (!seen.has(guildId)) onlineSnapshot.delete(guildId);
  }
}

const pollTimer = setInterval(() => {
  try { pollOnline(); } catch (e) { console.error('[Guild] online poll failed:', e); }
}, ONLINE_POLL_MS);
if (pollTimer.unref) pollTimer.unref();

module.exports = { getIncreaseGuildCost, guildOf, CREATE_COST, EMBLEM_COST };
