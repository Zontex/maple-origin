// GM actions that need the server: "!kill <player>" (DevCommands.ts). The
// sender must be a superuser account (users.superuser, set on the player at
// login); anyone else is ignored silently. Targets are resolved by character
// name within the sender's world, like party invites.

const { registerHandler } = require('../router');
const { players } = require('../state');
const { sendToPlayer } = require('../network');

function findByName(name, worldId) {
  const want = String(name || '').toLowerCase();
  if (!want) return null;
  for (const p of players.values()) {
    if (!p.characterName || Number(p.worldId) !== Number(worldId)) continue;
    if (String(p.characterName).toLowerCase() === want) return p;
  }
  return null;
}

function handleGmKill(playerId, data) {
  const gm = players.get(playerId);
  if (!gm || !gm.superuser) return;
  const target = findByName(data && data.name, gm.worldId);
  if (!target) {
    sendToPlayer(gm.ws, { type: 'gm_result', data: { ok: false, message: `Player not found: ${data && data.name}` } });
    return;
  }
  sendToPlayer(target.ws, { type: 'gm_killed', data: { by: gm.characterName || 'GM' } });
  sendToPlayer(gm.ws, { type: 'gm_result', data: { ok: true, message: `Killed ${target.characterName}.` } });
}

registerHandler('gm_kill', handleGmKill);

module.exports = { handleGmKill };
