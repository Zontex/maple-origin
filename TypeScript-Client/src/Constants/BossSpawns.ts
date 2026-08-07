/**
 * Area bosses that GMS spawned from the server rather than from map data.
 *
 * v83's Map.wz has no `life` entry for Mano, Stumpy, Faust or Blue Mushmom
 * anywhere — Mushmom (map 100000005, mobTime 1800) is the only boss the map
 * data places itself. Their spawn points lived in the server, so a client
 * reading only `life` can never make them appear no matter how long you wait.
 * This table stands in for that server-side list until the Cosmic port owns it.
 *
 * Entries are shaped like a WZ life node (`cy` is the foothold Y the mob stands
 * on, `rx0`/`rx1` its patrol bounds) so MapleMap.loadMonsters can append them to
 * the same spawn-def list the map's own mobs go through — including the shared
 * respawn tick, the remembered-state cache and multiplayer oId agreement.
 */
export interface BossSpawn {
  /** Mob id, e.g. 2220000 = Mano */
  id: number;
  x: number;
  /** Foothold Y — the ground the mob spawns on, not the authored sprite Y */
  cy: number;
  fh: number;
  rx0: number;
  rx1: number;
  /** Seconds from death to next spawn */
  mobTime: number;
}

/**
 * A spawn point this long-cycled is a boss on its own clock, not a face in the
 * map's population. MapleMap's respawn tick refills a map to ~75% of its spawn
 * points, so a boss left to compete for those slots would sit dead behind a
 * queue of snails; at or above this mobTime, a spawn respawns strictly on its
 * own deadline. It also covers the long-timer bosses the WZ does place, like
 * Mushmom at 1800.
 */
export const BOSS_MOBTIME_S = 300;

export const BOSS_SPAWNS: Record<number, BossSpawn[]> = {
  // Mano — Victoria Road: Thicket Around the Beach III. Placed on the ground
  // platform the map's own snails walk (the foothold and patrol range of its
  // third life entry), which is where he turns up in GMS.
  104000400: [
    { id: 2220000, x: 355, cy: 455, fh: 72, rx0: -469, rx1: 1099, mobTime: 1200 },
  ],
};

export function getBossSpawns(mapId: number): BossSpawn[] {
  return BOSS_SPAWNS[mapId] ?? [];
}
