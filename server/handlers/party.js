// Party system — v83 semantics: max 6 members, leader-only invite/expel/
// leader-transfer, party disbands when the leader leaves. The server is the
// source of truth for membership; every mutation broadcasts a full
// party_update to all members so clients never drift.

const { players } = require('../state');
const { sendToPlayer } = require('../network');

const MAX_PARTY_SIZE = 6;

let nextPartyId = 1;
const parties = new Map(); // partyId -> { id, leaderId, members: [playerId] }

function getPartyOf(playerId) {
  const player = players.get(playerId);
  if (!player || !player.partyId) return null;
  return parties.get(player.partyId) || null;
}

function memberInfo(playerId) {
  const p = players.get(playerId);
  return {
    id: playerId,
    name: p?.info?.name || '???',
    level: p?.info?.level || 0,
    job: p?.info?.job ?? 0,
    mapId: Number(p?.mapId ?? p?.info?.mapId ?? 0),
  };
}

function partyPayload(party) {
  return {
    id: party.id,
    leaderId: party.leaderId,
    members: party.members.map(memberInfo),
  };
}

function broadcastPartyUpdate(party) {
  const payload = { type: 'party_update', party: partyPayload(party) };
  for (const pid of party.members) {
    const p = players.get(pid);
    if (p) sendToPlayer(p.ws, payload);
  }
}

function notify(playerId, text) {
  const p = players.get(playerId);
  if (p) sendToPlayer(p.ws, { type: 'party_notice', text });
}

function clearedUpdate(playerId) {
  const p = players.get(playerId);
  if (p) sendToPlayer(p.ws, { type: 'party_update', party: null });
}

function handlePartyCreate(playerId) {
  if (getPartyOf(playerId)) {
    notify(playerId, 'You are already in a party.');
    return;
  }
  const party = { id: nextPartyId++, leaderId: playerId, members: [playerId] };
  parties.set(party.id, party);
  const p = players.get(playerId);
  if (p) p.partyId = party.id;
  notify(playerId, 'You have created a new party.');
  broadcastPartyUpdate(party);
}

function handlePartyInvite(playerId, data) {
  let party = getPartyOf(playerId);
  // Inviting without a party first forms one (REQ PARTY from character info)
  if (!party) {
    handlePartyCreate(playerId);
    party = getPartyOf(playerId);
    if (!party) return;
  }
  if (party.leaderId !== playerId) {
    notify(playerId, 'Only the party leader can invite.');
    return;
  }
  if (party.members.length >= MAX_PARTY_SIZE) {
    notify(playerId, 'Your party is already full.');
    return;
  }

  // Find the target by id, falling back to name lookup
  let targetId = data?.targetId;
  if (!targetId && data?.targetName) {
    for (const [pid, p] of players.entries()) {
      if (p.info?.name?.toLowerCase() === String(data.targetName).toLowerCase()) {
        targetId = pid;
        break;
      }
    }
  }
  const target = targetId ? players.get(targetId) : null;
  if (!target || !target.info) {
    notify(playerId, 'Unable to find the character.');
    return;
  }
  if (targetId === playerId) return;
  if (target.partyId) {
    notify(playerId, `'${target.info.name}' is already in a party.`);
    return;
  }

  const inviter = players.get(playerId);
  sendToPlayer(target.ws, {
    type: 'party_invite',
    partyId: party.id,
    from: { id: playerId, name: inviter?.info?.name || '???' },
  });
  notify(playerId, `You have invited '${target.info.name}' to your party.`);
}

function handlePartyInviteResponse(playerId, data) {
  const party = parties.get(data?.partyId);
  const responder = players.get(playerId);
  if (!responder) return;

  if (!party) {
    notify(playerId, 'That party no longer exists.');
    return;
  }
  const leaderName = players.get(party.leaderId)?.info?.name || '???';

  if (!data?.accept) {
    notify(party.leaderId, `'${responder.info?.name || '???'}' has declined the party invite.`);
    return;
  }
  if (responder.partyId) {
    notify(playerId, 'You are already in a party.');
    return;
  }
  if (party.members.length >= MAX_PARTY_SIZE) {
    notify(playerId, `'${leaderName}''s party is already full.`);
    return;
  }

  party.members.push(playerId);
  responder.partyId = party.id;
  for (const pid of party.members) {
    if (pid !== playerId) notify(pid, `'${responder.info?.name || '???'}' has joined the party.`);
  }
  broadcastPartyUpdate(party);
}

function removeFromParty(party, playerId) {
  party.members = party.members.filter((id) => id !== playerId);
  const p = players.get(playerId);
  if (p) p.partyId = null;
  clearedUpdate(playerId);
}

function disbandParty(party, reason) {
  for (const pid of [...party.members]) {
    const p = players.get(pid);
    if (p) p.partyId = null;
    if (reason) notify(pid, reason);
    clearedUpdate(pid);
  }
  parties.delete(party.id);
}

function handlePartyLeave(playerId) {
  const party = getPartyOf(playerId);
  if (!party) return;
  const name = players.get(playerId)?.info?.name || '???';

  if (party.leaderId === playerId) {
    // v83: the leader leaving dissolves the party
    disbandParty(party, 'The party has been disbanded.');
    return;
  }
  removeFromParty(party, playerId);
  notify(playerId, 'You have left the party.');
  for (const pid of party.members) notify(pid, `'${name}' has left the party.`);
  broadcastPartyUpdate(party);
}

function handlePartyExpel(playerId, data) {
  const party = getPartyOf(playerId);
  if (!party || party.leaderId !== playerId) return;
  const targetId = data?.targetId;
  if (!targetId || targetId === playerId || !party.members.includes(targetId)) return;

  const name = players.get(targetId)?.info?.name || '???';
  removeFromParty(party, targetId);
  notify(targetId, 'You have been expelled from the party.');
  for (const pid of party.members) notify(pid, `'${name}' has been expelled from the party.`);
  broadcastPartyUpdate(party);
}

function handlePartyChangeLeader(playerId, data) {
  const party = getPartyOf(playerId);
  if (!party || party.leaderId !== playerId) return;
  const targetId = data?.targetId;
  if (!targetId || !party.members.includes(targetId) || targetId === playerId) return;

  party.leaderId = targetId;
  const name = players.get(targetId)?.info?.name || '???';
  for (const pid of party.members) notify(pid, `'${name}' has become the leader of the party.`);
  broadcastPartyUpdate(party);
}

// Killer's client computed the v83 exp split — deliver each member's share.
// Only members of the sender's own party can be granted.
function handlePartyExp(playerId, data) {
  const party = getPartyOf(playerId);
  if (!party || !Array.isArray(data?.grants)) return;
  for (const grant of data.grants) {
    if (grant?.id === playerId) continue;
    if (!party.members.includes(grant?.id)) continue;
    const exp = Math.floor(Number(grant?.exp));
    if (!Number.isFinite(exp) || exp <= 0 || exp > 1e7) continue;
    const p = players.get(grant.id);
    if (p) sendToPlayer(p.ws, { type: 'party_exp', exp });
  }
}

// Leader-driven team warp (PQ entry/clear/exile) — relayed to the other
// members, whose clients run the map change themselves
function handlePartyWarp(playerId, data) {
  const party = getPartyOf(playerId);
  if (!party || party.leaderId !== playerId) return;
  const mapId = Number(data?.mapId);
  if (!Number.isFinite(mapId) || mapId <= 0) return;
  for (const pid of party.members) {
    if (pid === playerId) continue;
    const p = players.get(pid);
    if (p) sendToPlayer(p.ws, { type: 'party_warp', mapId });
  }
}

// A member's level/job/map changed — refresh the roster on everyone's screen.
// Cheap enough to send on every map change and level up.
function refreshPartyOf(playerId) {
  const party = getPartyOf(playerId);
  if (party) broadcastPartyUpdate(party);
}

// Disconnect: same rules as leaving on purpose
function handlePartyDisconnect(playerId) {
  const party = getPartyOf(playerId);
  if (!party) return;
  const name = players.get(playerId)?.info?.name || '???';

  if (party.leaderId === playerId) {
    disbandParty(party, 'The party has been disbanded.');
    return;
  }
  removeFromParty(party, playerId);
  for (const pid of party.members) notify(pid, `'${name}' has left the party.`);
  broadcastPartyUpdate(party);
}

module.exports = {
  handlePartyCreate,
  handlePartyInvite,
  handlePartyInviteResponse,
  handlePartyLeave,
  handlePartyExpel,
  handlePartyChangeLeader,
  handlePartyExp,
  handlePartyWarp,
  handlePartyDisconnect,
  refreshPartyOf,
};
