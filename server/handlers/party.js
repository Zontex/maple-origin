// Party system — v83 semantics: max 6 members, leader-only invite/expel/
// leader-transfer, party disbands when the leader leaves. The server is the
// source of truth for membership; every mutation broadcasts a full
// party_update to all members so clients never drift.
//
// Membership is keyed by CHARACTER id and persisted in SQLite (parties /
// party_members), so a party survives a server restart and a member's page
// reload. A connection id (playerId) is only ever a member's *current*
// socket: it is re-attached on `party_sync` (sent by the client once it has
// a character) or on the first party message from a re-linked character.
//
// Disconnect semantics: v83 drops you from the party the moment you log out,
// but on a browser client a reload, a flaky network or a server restart all
// look exactly like a logout to us. So a disconnect keeps the membership and
// shows the member under PARTY MEMBER OFFLINE for a grace period
// (OFFLINE_GRACE_MS); only after that is the member removed — or, if it was
// the leader, the party disbanded (v83: the leader leaving dissolves it).

const { players } = require('../state');
const { sendToPlayer } = require('../network');
const { getDb } = require('../db');

const MAX_PARTY_SIZE = 6;
const OFFLINE_GRACE_MS = 2 * 60 * 1000;
const OFFLINE_SWEEP_MS = 10 * 1000;
const PARTY_CHAT_MAX = 120;

// partyId -> { id, worldId, leaderCharId, members: Map<charId, Member> }
// Member: { charId, name, level, job, offlineSince: number | null }
const parties = new Map();
// charId -> partyId, so relinking a reconnecting character is O(1)
const charToParty = new Map();

// ---------------------------------------------------------------------------
// Persistence

function db() {
  return getDb();
}

function ensureSchema() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      leader_character_id INTEGER NOT NULL,
      world_id INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS party_members (
      party_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL UNIQUE,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (party_id, character_id),
      FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE
    );
  `);
}

function characterRow(charId) {
  try {
    return db().prepare('SELECT id, name, level, job_id FROM characters WHERE id = ?').get(charId) || null;
  } catch (e) {
    console.error('[Party] character lookup failed:', e);
    return null;
  }
}

function persistCreate(leaderCharId, worldId) {
  const r = db().prepare('INSERT INTO parties (leader_character_id, world_id) VALUES (?, ?)').run(leaderCharId, worldId);
  const id = Number(r.lastInsertRowid);
  db().prepare('INSERT OR REPLACE INTO party_members (party_id, character_id) VALUES (?, ?)').run(id, leaderCharId);
  return id;
}

function persistAddMember(partyId, charId) {
  db().prepare('INSERT OR REPLACE INTO party_members (party_id, character_id) VALUES (?, ?)').run(partyId, charId);
}

function persistRemoveMember(charId) {
  db().prepare('DELETE FROM party_members WHERE character_id = ?').run(charId);
}

function persistLeader(partyId, leaderCharId) {
  db().prepare('UPDATE parties SET leader_character_id = ? WHERE id = ?').run(leaderCharId, partyId);
}

function persistDelete(partyId) {
  db().prepare('DELETE FROM party_members WHERE party_id = ?').run(partyId);
  db().prepare('DELETE FROM parties WHERE id = ?').run(partyId);
}

/**
 * Rebuild the in-memory map from SQLite at startup. Everyone starts offline
 * with the grace clock running from now — clients reconnect within seconds
 * of a restart and re-link through party_sync.
 */
function loadFromDb() {
  ensureSchema();
  const now = Date.now();
  let rows;
  try {
    rows = db().prepare('SELECT id, leader_character_id, world_id FROM parties').all();
  } catch (e) {
    console.error('[Party] load failed:', e);
    return;
  }
  const memberStmt = db().prepare('SELECT character_id FROM party_members WHERE party_id = ?');
  for (const row of rows) {
    const party = {
      id: Number(row.id),
      worldId: Number(row.world_id) || 0,
      leaderCharId: Number(row.leader_character_id),
      members: new Map(),
    };
    for (const m of memberStmt.all(party.id)) {
      const charId = Number(m.character_id);
      const c = characterRow(charId);
      if (!c) {
        persistRemoveMember(charId);
        continue;
      }
      party.members.set(charId, {
        charId,
        name: c.name,
        level: Number(c.level) || 1,
        job: Number(c.job_id) || 0,
        offlineSince: now,
      });
    }
    if (party.members.size === 0 || !party.members.has(party.leaderCharId)) {
      persistDelete(party.id);
      continue;
    }
    parties.set(party.id, party);
    for (const charId of party.members.keys()) charToParty.set(charId, party.id);
  }
  if (parties.size) console.log(`[Party] Restored ${parties.size} part${parties.size === 1 ? 'y' : 'ies'} from the database`);
}

// ---------------------------------------------------------------------------
// Lookups

function charIdOf(player) {
  const id = Number(player?.characterId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** The live connection of a character inside a party, if any */
function onlinePlayerOf(party, charId) {
  let best = null;
  for (const p of players.values()) {
    if (charIdOf(p) !== charId || p.partyId !== party.id) continue;
    if (!best || (p.lastUpdate || 0) > (best.lastUpdate || 0)) best = p;
  }
  return best;
}

/**
 * Attach a connection to the party its character belongs to. A reconnect
 * gets a fresh playerId with partyId unset; the character id (set by
 * select_character) is what ties it back. Returns the party or null.
 */
function relink(player) {
  if (!player) return null;
  if (player.partyId && parties.has(player.partyId)) return parties.get(player.partyId);
  const charId = charIdOf(player);
  if (!charId) return null;
  const partyId = charToParty.get(charId);
  const party = partyId ? parties.get(partyId) : null;
  if (!party) {
    player.partyId = null;
    return null;
  }
  player.partyId = party.id;
  const member = party.members.get(charId);
  if (member) {
    member.offlineSince = null;
    if (player.info) {
      member.name = player.info.name || member.name;
      member.level = Number(player.info.level) || member.level;
      member.job = Number(player.info.job ?? member.job) || 0;
    }
  }
  return party;
}

function getPartyOf(playerId) {
  const player = players.get(playerId);
  if (!player) return null;
  return relink(player);
}

function memberInfo(party, member) {
  const p = onlinePlayerOf(party, member.charId);
  const online = !!p && member.offlineSince === null;
  if (p?.info) {
    member.name = p.info.name || member.name;
    member.level = Number(p.info.level) || member.level;
    member.job = Number(p.info.job ?? member.job) || 0;
  }
  return {
    id: online ? p.id : null,
    charId: member.charId,
    name: member.name || '???',
    level: member.level || 0,
    job: member.job ?? 0,
    mapId: online ? Number(p.mapId ?? p.info?.mapId ?? 0) : 0,
    channel: online ? Number(p.channel) || 0 : -1,
    online,
    hp: online ? Number(p.info?.hp) || 0 : 0,
    maxHp: online ? Number(p.info?.maxHp) || 0 : 0,
  };
}

function partyPayload(party) {
  const leader = party.members.get(party.leaderCharId);
  const leaderPlayer = leader ? onlinePlayerOf(party, leader.charId) : null;
  return {
    id: party.id,
    leaderId: leaderPlayer && leader.offlineSince === null ? leaderPlayer.id : null,
    leaderCharId: party.leaderCharId,
    members: [...party.members.values()].map((m) => memberInfo(party, m)),
  };
}

function onlineMembers(party) {
  const out = [];
  for (const m of party.members.values()) {
    if (m.offlineSince !== null) continue;
    const p = onlinePlayerOf(party, m.charId);
    if (p) out.push(p);
  }
  return out;
}

function sendToParty(party, payload, exceptPlayerId = null) {
  for (const p of onlineMembers(party)) {
    if (p.id === exceptPlayerId) continue;
    sendToPlayer(p.ws, payload);
  }
}

function broadcastPartyUpdate(party) {
  sendToParty(party, { type: 'party_update', party: partyPayload(party) });
}

function notifyParty(party, text, exceptPlayerId = null) {
  sendToParty(party, { type: 'party_notice', text }, exceptPlayerId);
}

function notify(playerId, text) {
  const p = players.get(playerId);
  if (p) sendToPlayer(p.ws, { type: 'party_notice', text });
}

function clearedUpdate(playerId) {
  const p = players.get(playerId);
  if (p) sendToPlayer(p.ws, { type: 'party_update', party: null });
}

function memberName(party, charId) {
  return party.members.get(charId)?.name || '???';
}

/** A member's charId from a client reference: `charId`, or a live `targetId` */
function resolveMemberCharId(party, data) {
  const direct = Number(data?.charId);
  if (Number.isFinite(direct) && party.members.has(direct)) return direct;
  const targetId = data?.targetId;
  if (targetId) {
    const p = players.get(targetId);
    const cid = charIdOf(p);
    if (cid && party.members.has(cid)) return cid;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mutations

function addMember(party, player) {
  const charId = charIdOf(player);
  party.members.set(charId, {
    charId,
    name: player.info?.name || characterRow(charId)?.name || '???',
    level: Number(player.info?.level) || 1,
    job: Number(player.info?.job ?? 0) || 0,
    offlineSince: null,
  });
  charToParty.set(charId, party.id);
  player.partyId = party.id;
  persistAddMember(party.id, charId);
}

function removeMember(party, charId) {
  party.members.delete(charId);
  charToParty.delete(charId);
  persistRemoveMember(charId);
  for (const p of players.values()) {
    if (charIdOf(p) === charId && p.partyId === party.id) {
      p.partyId = null;
      clearedUpdate(p.id);
    }
  }
}

function disbandParty(party, reason) {
  for (const charId of [...party.members.keys()]) {
    for (const p of players.values()) {
      if (charIdOf(p) === charId && p.partyId === party.id) {
        p.partyId = null;
        if (reason) notify(p.id, reason);
        clearedUpdate(p.id);
      }
    }
    charToParty.delete(charId);
  }
  parties.delete(party.id);
  persistDelete(party.id);
}

function handlePartyCreate(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  if (getPartyOf(playerId)) {
    notify(playerId, 'You are already in a party.');
    return;
  }
  const charId = charIdOf(player);
  if (!charId) {
    notify(playerId, 'You cannot create a party right now.');
    return;
  }
  const worldId = Number(player.worldId) || 0;
  const id = persistCreate(charId, worldId);
  const party = { id, worldId, leaderCharId: charId, members: new Map() };
  parties.set(id, party);
  addMember(party, player);
  notify(playerId, 'You have created a new party.');
  broadcastPartyUpdate(party);
}

function handlePartyInvite(playerId, data) {
  const inviter = players.get(playerId);
  if (!inviter) return;
  let party = getPartyOf(playerId);
  // Inviting without a party first forms one (REQ PARTY from character info)
  if (!party) {
    handlePartyCreate(playerId);
    party = getPartyOf(playerId);
    if (!party) return;
  }
  if (party.leaderCharId !== charIdOf(inviter)) {
    notify(playerId, 'Only the party leader can invite.');
    return;
  }
  if (party.members.size >= MAX_PARTY_SIZE) {
    notify(playerId, 'Your party is already full.');
    return;
  }

  // Find the target by id, falling back to name lookup
  const sameWorld = (p) => (Number(p?.worldId) || 0) === (Number(inviter?.worldId) || 0);
  let targetId = data?.targetId;
  if (!targetId && data?.targetName) {
    for (const [pid, p] of players.entries()) {
      if (sameWorld(p) && p.info?.name?.toLowerCase() === String(data.targetName).toLowerCase()) {
        targetId = pid;
        break;
      }
    }
  }
  const target = targetId ? players.get(targetId) : null;
  // Parties are per world: a name on another world is "not found" there
  if (!target || !target.info || !sameWorld(target)) {
    notify(playerId, 'Unable to find the character.');
    return;
  }
  if (targetId === playerId) return;
  if (relink(target)) {
    notify(playerId, `'${target.info.name}' is already in a party.`);
    return;
  }

  sendToPlayer(target.ws, {
    type: 'party_invite',
    partyId: party.id,
    from: { id: playerId, name: inviter?.info?.name || '???' },
  });
  notify(playerId, `You have invited '${target.info.name}' to your party.`);
}

function handlePartyInviteResponse(playerId, data) {
  const party = parties.get(Number(data?.partyId));
  const responder = players.get(playerId);
  if (!responder) return;

  if (!party) {
    notify(playerId, 'That party no longer exists.');
    return;
  }
  const leaderName = memberName(party, party.leaderCharId);
  const leader = onlinePlayerOf(party, party.leaderCharId);

  if (!data?.accept) {
    if (leader) notify(leader.id, `'${responder.info?.name || '???'}' has declined the party invite.`);
    return;
  }
  if (relink(responder)) {
    notify(playerId, 'You are already in a party.');
    return;
  }
  if (!charIdOf(responder)) {
    notify(playerId, 'You cannot join a party right now.');
    return;
  }
  if (party.members.size >= MAX_PARTY_SIZE) {
    notify(playerId, `'${leaderName}''s party is already full.`);
    return;
  }

  addMember(party, responder);
  notifyParty(party, `'${responder.info?.name || '???'}' has joined the party.`, playerId);
  broadcastPartyUpdate(party);
}

function handlePartyLeave(playerId) {
  const party = getPartyOf(playerId);
  if (!party) return;
  const charId = charIdOf(players.get(playerId));
  const name = memberName(party, charId);

  if (party.leaderCharId === charId) {
    // v83: the leader leaving dissolves the party
    disbandParty(party, 'The party has been disbanded.');
    return;
  }
  removeMember(party, charId);
  notify(playerId, 'You have left the party.');
  notifyParty(party, `'${name}' has left the party.`);
  broadcastPartyUpdate(party);
}

function handlePartyExpel(playerId, data) {
  const party = getPartyOf(playerId);
  if (!party || party.leaderCharId !== charIdOf(players.get(playerId))) return;
  const charId = resolveMemberCharId(party, data);
  if (!charId || charId === party.leaderCharId) return;

  const name = memberName(party, charId);
  const target = onlinePlayerOf(party, charId);
  removeMember(party, charId);
  if (target) notify(target.id, 'You have been expelled from the party.');
  notifyParty(party, `'${name}' has been expelled from the party.`);
  broadcastPartyUpdate(party);
}

function handlePartyChangeLeader(playerId, data) {
  const party = getPartyOf(playerId);
  if (!party || party.leaderCharId !== charIdOf(players.get(playerId))) return;
  const charId = resolveMemberCharId(party, data);
  if (!charId || charId === party.leaderCharId) return;
  const member = party.members.get(charId);
  // v83 only hands leadership to someone who is actually there
  if (!member || member.offlineSince !== null || !onlinePlayerOf(party, charId)) {
    notify(playerId, 'That member is not online.');
    return;
  }

  party.leaderCharId = charId;
  persistLeader(party.id, charId);
  notifyParty(party, `'${member.name}' has become the leader of the party.`);
  broadcastPartyUpdate(party);
}

// Killer's client computed the v83 exp split — deliver each member's share.
// Only online members of the sender's own party can be granted.
function handlePartyExp(playerId, data) {
  const party = getPartyOf(playerId);
  if (!party || !Array.isArray(data?.grants)) return;
  for (const grant of data.grants) {
    if (!grant?.id || grant.id === playerId) continue;
    const p = players.get(grant.id);
    if (!p || p.partyId !== party.id) continue;
    const member = party.members.get(charIdOf(p));
    if (!member || member.offlineSince !== null) continue;
    const exp = Math.floor(Number(grant?.exp));
    if (!Number.isFinite(exp) || exp <= 0 || exp > 1e7) continue;
    sendToPlayer(p.ws, { type: 'party_exp', exp });
  }
}

// Leader-driven team warp (PQ entry/clear/exile) — relayed to the other
// members, whose clients run the map change themselves
function handlePartyWarp(playerId, data) {
  const party = getPartyOf(playerId);
  if (!party || party.leaderCharId !== charIdOf(players.get(playerId))) return;
  const mapId = Number(data?.mapId);
  if (!Number.isFinite(mapId) || mapId <= 0) return;
  sendToParty(party, { type: 'party_warp', mapId }, playerId);
}

/**
 * party_chat {message} → every online member, any map, sender included (the
 * echo is what the sender's log prints, like the original server).
 */
function handlePartyChat(playerId, data) {
  const party = getPartyOf(playerId);
  const player = players.get(playerId);
  if (!party || !player?.info) return;
  const message = String(data?.message ?? '').trim().slice(0, PARTY_CHAT_MAX);
  if (!message) return;
  sendToParty(party, {
    type: 'party_chat',
    data: { id: playerId, charId: charIdOf(player), from: player.info.name || '???', message },
  });
}

/**
 * party_hp {hp, maxHp} — the client sends this throttled; player_update does
 * not carry HP, so this is the only thing that keeps the roster's gauges
 * moving. Applied to the info (so a later party_update agrees) and fanned
 * out as the smaller party_hp_update.
 */
function handlePartyHp(playerId, data) {
  const party = getPartyOf(playerId);
  const player = players.get(playerId);
  if (!party || !player?.info) return;
  const maxHp = Math.floor(Number(data?.maxHp));
  const hp = Math.floor(Number(data?.hp));
  if (!Number.isFinite(maxHp) || !Number.isFinite(hp) || maxHp <= 0 || maxHp > 1e6) return;
  player.info.hp = Math.max(0, Math.min(hp, maxHp));
  player.info.maxHp = maxHp;
  sendToParty(party, {
    type: 'party_hp_update',
    data: { id: playerId, charId: charIdOf(player), hp: player.info.hp, maxHp },
  }, playerId);
}

/**
 * party_sync — the client asks where it stands once it has a character
 * (game entry, reconnect, server restart). Before select_character there is
 * nothing to answer, so stay silent and let the client ask again.
 */
function handlePartySync(playerId) {
  const player = players.get(playerId);
  if (!player || !charIdOf(player)) return;
  const party = relink(player);
  if (!party) {
    clearedUpdate(playerId);
    return;
  }
  broadcastPartyUpdate(party);
}

// A member's level/job/map changed — refresh the roster on everyone's screen.
// Cheap enough to send on every map change and level up.
function refreshPartyOf(playerId) {
  const party = getPartyOf(playerId);
  if (party) broadcastPartyUpdate(party);
}

/**
 * Disconnect: the member goes offline but stays in the party for the grace
 * period (see the header). A stale duplicate connection closing while a
 * newer one for the same character is live must not mark it offline.
 */
function handlePartyDisconnect(playerId) {
  const player = players.get(playerId);
  const party = player?.partyId ? parties.get(player.partyId) : null;
  if (!party) return;
  const charId = charIdOf(player);
  const member = party.members.get(charId);
  if (!member) return;
  player.partyId = null;
  for (const p of players.values()) {
    if (p !== player && charIdOf(p) === charId && p.partyId === party.id) return;
  }
  member.offlineSince = Date.now();
  broadcastPartyUpdate(party);
}

function sweepOffline() {
  const now = Date.now();
  for (const party of [...parties.values()]) {
    for (const member of [...party.members.values()]) {
      if (member.offlineSince === null || now - member.offlineSince < OFFLINE_GRACE_MS) continue;
      if (member.charId === party.leaderCharId) {
        disbandParty(party, 'The party has been disbanded.');
        break;
      }
      removeMember(party, member.charId);
      notifyParty(party, `'${member.name}' has left the party.`);
      broadcastPartyUpdate(party);
    }
  }
}

// ---------------------------------------------------------------------------
// Wiring

loadFromDb();
setInterval(sweepOffline, OFFLINE_SWEEP_MS).unref();

// The router requires this module while it is still loading, so its exports
// are not available synchronously here — register the new message types on
// the next turn of the event loop, by which point router.js has finished.
setImmediate(() => {
  const { registerHandler } = require('../router');
  if (typeof registerHandler !== 'function') {
    console.error('[Party] router.registerHandler unavailable — party_chat/party_hp/party_sync not wired');
    return;
  }
  registerHandler('party_chat', (playerId, data) => handlePartyChat(playerId, data));
  registerHandler('party_hp', (playerId, data) => handlePartyHp(playerId, data));
  registerHandler('party_sync', (playerId) => handlePartySync(playerId));
});

module.exports = {
  handlePartyCreate,
  handlePartyInvite,
  handlePartyInviteResponse,
  handlePartyLeave,
  handlePartyExpel,
  handlePartyChangeLeader,
  handlePartyExp,
  handlePartyWarp,
  handlePartyChat,
  handlePartyHp,
  handlePartySync,
  handlePartyDisconnect,
  refreshPartyOf,
  OFFLINE_GRACE_MS,
  // exposed for the offline-grace test harness only
  _sweepOffline: sweepOffline,
};
