// Shared server state — single source of truth for all modules

const players = new Map();
const monsters = new Map();
const mapHosts = new Map(); // mapId -> playerId

module.exports = { players, monsters, mapHosts };
