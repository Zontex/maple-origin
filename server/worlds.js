// v83 Pre-Big Bang world list
const WORLDS = [
  { id: 0, name: 'Scania' },
  { id: 1, name: 'Bera' },
  { id: 2, name: 'Broa' },
  { id: 3, name: 'Windia' },
  { id: 4, name: 'Khaini' },
  { id: 5, name: 'Bellocan' },
  { id: 6, name: 'Mardia' },
  { id: 7, name: 'Kradia' },
];

function getWorldName(worldId) {
  const world = WORLDS.find(w => w.id === worldId);
  return world ? world.name : null;
}

module.exports = { WORLDS, getWorldName };
