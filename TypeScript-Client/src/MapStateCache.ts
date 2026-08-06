// Remembers what happened on a map so re-entering it does not rewind it.
//
// `MapleMap.load()` rebuilds every map from WZ data, which is correct for the
// static geometry and wrong for everything living on it: walking through a
// door and back restored every mob to full HP at its spawn point and stood
// every smashed reactor back up. That is not just a fidelity gap, it is an
// exploit — the box in the Ellinia boat cabin carries `reactorTime = 3600`,
// so a one-hour respawn became an instant one by stepping out and back in.
//
// The original client never has this problem because the map lives on the
// channel server and the client only ever visits it. We have no such server,
// so the client keeps the snapshot itself: what was dead, what was hurt, and
// when each is due back.
//
// Scope is deliberately narrow. Only state a player can *change* is kept —
// HP, position, death and the respawn deadline. Aggro, animation frames and
// pathing are AI scratch that should reset on re-entry, and do.

interface ReactorSnapshot {
  oId: number;
  destroyed: boolean;
  // Absolute wall-clock deadline, not a remaining duration: the map is not
  // ticking while you are away, so a duration would silently pause the timer
  // and a long detour would still come back to a full hour left.
  respawnAt: number;
}

interface MonsterSnapshot {
  oId: number;
  alive: boolean;
  hp: number;
  x: number;
  y: number;
  nextPossibleSpawn: number;
}

interface MapSnapshot {
  savedAt: number;
  // Which *instance* of the map this describes, for maps the original client
  // instances rather than keeps (see setInstanceTokenProvider). null for
  // ordinary maps, which have exactly one instance and always match.
  token: string | null;
  reactors: ReactorSnapshot[];
  monsters: MonsterSnapshot[];
}

// Bounded so a long session does not accumulate a snapshot per map forever.
// 32 covers any realistic run of maps between returns; the oldest is dropped
// first, and dropping one is harmless — that map simply loads fresh from WZ.
const MAX_MAPS = 32;

// Nothing in v83 respawns on a timer longer than an hour (`reactorTime` tops
// out there), so a snapshot older than that has no remaining deadline left to
// enforce and is only holding memory.
const MAX_AGE_MS = 60 * 60 * 1000;

class MapStateCache {
  // Insertion-ordered: Map preserves it, so the first key is the oldest.
  private snapshots = new Map<number, MapSnapshot>();

  // Some maps are instanced in the original client — the boat deck and cabin
  // are rebuilt for every sailing and torn down on docking, so nothing you did
  // aboard one voyage is there on the next. Modelling that as an opaque token
  // keeps this module from knowing anything about transport: it only asks
  // "same instance?" and drops the snapshot when the answer changes.
  // Registered from outside to avoid an import cycle — TransportationManager
  // reads this cache to restore the Balrog.
  private instanceToken: ((mapId: number) => string | null) | null = null;
  setInstanceTokenProvider(fn: (mapId: number) => string | null) {
    this.instanceToken = fn;
  }
  private tokenFor(mapId: number): string | null {
    try {
      return this.instanceToken?.(mapId) ?? null;
    } catch {
      return null;
    }
  }

  // Snapshot the map being left. Called before load() clears its collections.
  capture(map: any) {
    const mapId = Number(map?.id);
    if (!Number.isFinite(mapId) || !map.doneLoading) return;

    const reactors: ReactorSnapshot[] = (map.reactors || []).map((r: any) => ({
      oId: r.oId,
      destroyed: !!r.destroyed,
      // A reactor knocked down this visit has no deadline yet — the update
      // loop only schedules one for the mob host. Derive it here so a client
      // that was never host still remembers when the box is due back.
      respawnAt:
        r.destroyed && r.reactorTime > 0
          ? (r.respawnAt || Date.now() + r.reactorTime * 1000)
          : 0,
    }));

    // Living mobs come from the map; dead ones are already filtered out of
    // `monsters`, so their state has to come from the spawn defs, which are
    // the only record that survives a kill.
    const byOId = new Map<number, any>();
    for (const m of map.monsters || []) byOId.set(m.oId, m);

    const monsters: MonsterSnapshot[] = (map.getMonsterSpawnDefs?.() || []).map(
      (def: any) => {
        const live = byOId.get(def.oId);
        return {
          oId: def.oId,
          alive: !!def.alive && !!live && !live.destroyed,
          hp: live?.hp ?? 0,
          x: live?.pos?.x ?? def.x,
          y: live?.pos?.y ?? def.y,
          nextPossibleSpawn: def.nextPossibleSpawn || 0,
        };
      }
    );

    // Mobs with no WZ spawn def — the Balrog invasion is placed by the
    // transport system, not by the map's `life` node, so it is absent from
    // the defs and would otherwise be forgotten the moment you stepped inside
    const defOIds = new Set(monsters.map((m) => m.oId));
    for (const m of map.monsters || []) {
      if (defOIds.has(m.oId) || m.destroyed) continue;
      monsters.push({
        oId: m.oId,
        alive: true,
        hp: m.hp,
        x: m.pos?.x ?? 0,
        y: m.pos?.y ?? 0,
        nextPossibleSpawn: 0,
      });
    }

    this.snapshots.delete(mapId); // re-insert so it counts as most recent
    this.snapshots.set(mapId, {
      savedAt: Date.now(),
      token: this.tokenFor(mapId),
      reactors,
      monsters,
    });

    while (this.snapshots.size > MAX_MAPS) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest === undefined) break;
      this.snapshots.delete(oldest);
    }
  }

  private get(mapId: number): MapSnapshot | null {
    const snap = this.snapshots.get(mapId);
    if (!snap) return null;
    if (Date.now() - snap.savedAt > MAX_AGE_MS) {
      this.snapshots.delete(mapId);
      return null;
    }
    // A different sailing is a different map as far as the original client is
    // concerned — nothing carries over
    if (snap.token !== this.tokenFor(mapId)) {
      this.snapshots.delete(mapId);
      return null;
    }
    return snap;
  }

  // What a mob spawn def should look like on re-entry, or null for "no memory
  // of this one — spawn it normally". Consulted before the mob is created, so
  // a mob that is still dead is never spawned and then removed.
  getMonsterState(mapId: number, oId: number): MonsterSnapshot | null {
    const snap = this.get(mapId);
    if (!snap) return null;
    const m = snap.monsters.find((s) => s.oId === oId);
    if (!m) return null;
    // Its respawn came due while we were away — let it spawn fresh.
    if (!m.alive && m.nextPossibleSpawn <= Date.now()) return null;
    return m;
  }

  getReactorState(mapId: number, oId: number): ReactorSnapshot | null {
    const snap = this.get(mapId);
    if (!snap) return null;
    const r = snap.reactors.find((s) => s.oId === oId);
    if (!r || !r.destroyed) return null;
    if (r.respawnAt && r.respawnAt <= Date.now()) return null; // due back
    return r;
  }

  // Dropped on logout/character change so a new session starts clean.
  clear() {
    this.snapshots.clear();
  }

  // A single map's memory dropped — a fresh PQ instance must not inherit
  // smashed reactors or dead mobs from a previous run.
  forget(mapId: number) {
    this.snapshots.delete(mapId);
  }
}

export default new MapStateCache();
