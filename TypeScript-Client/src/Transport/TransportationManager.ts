// Client-side replacement for Cosmic's server-side transportation events.
// All schedules derive from wall-clock time (Date.now() modulo the cycle
// length), so every multiplayer client independently agrees on boarding
// windows, departures, arrivals and Balrog invasions with zero network
// coordination — and backgrounded tabs (rAF paused) catch up correctly.
//
// Dev flags (read live):
//   localStorage.boatTravelRate  — divides every duration (Cosmic travel_rate;
//                                  10 → 90s Boats cycle)
//   localStorage.boatForceBalrog — '1' forces the invasion roll

import AudioManager from '../Audio/AudioManager';
import MapStateCache from '../MapStateCache';
import {
  TRANSPORT_ROUTES, ELEVATOR, TIMED_RIDES,
  CLOCK_ROUTE_BY_MAP, SHIP_ROUTE_BY_MAP, ENEMY_SHIP_MAPS,
  TransportRouteConfig, TransportLeg, InvasionConfig,
} from './TransportRoutes';

export interface RoutePhase {
  cycleLenMs: number;
  cyclePos: number;
  cycleIndex: number;
  entryClosePos: number;
  departPos: number;
  entryOpen: boolean;
  sailing: boolean;
}

// Deterministic PRNG so all clients roll the same invasion for a given cycle
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ChangeMapFn = (mapId: number, portal?: string | number) => Promise<void> | void;

class TransportationManagerImpl {
  private changeMapFn: ChangeMapFn | null = null;
  private currentMap: any = null;
  private prev: Record<string, { index: number; pos: number }> = {};
  private prevElevator: { index: number; pos: number } | null = null;
  private lastMapId = -1;
  private mapEnteredAt = 0;
  private warping = false;
  // Balrogs this client saw die, per cycle — so cabin-hopping back onto the
  // deck doesn't resurrect kills we witnessed
  private invasionDeaths = new Set<string>();
  private balrogSeen: Record<number, boolean> = {};
  // Spawns requested but not yet resolved — while one is in flight the mob is
  // legitimately absent from the map, which must not be read as a kill
  private balrogPending: Record<number, boolean> = {};

  private devRate(): number {
    try {
      const raw = Number(localStorage.getItem('boatTravelRate') || 1);
      return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 600) : 1;
    } catch { return 1; }
  }

  private forceBalrog(): boolean {
    try { return localStorage.getItem('boatForceBalrog') === '1'; } catch { return false; }
  }

  private getRoute(key: string): TransportRouteConfig | undefined {
    return TRANSPORT_ROUTES.find((r) => r.key === key);
  }

  getPhase(route: TransportRouteConfig): RoutePhase {
    const rate = this.devRate();
    const cycleLen = route.cycleMs / rate;
    const now = Date.now();
    const cyclePos = now % cycleLen;
    const cycleIndex = Math.floor(now / cycleLen);
    const entryClosePos = route.entryCloseMs / rate;
    const departPos = route.departMs / rate;
    return {
      cycleLenMs: cycleLen, cyclePos, cycleIndex, entryClosePos, departPos,
      entryOpen: cyclePos < entryClosePos,
      sailing: cyclePos >= departPos,
    };
  }

  // Cosmic rolls once per departure in takeoff(); both boats share the result
  private invasionForCycle(invasion: InvasionConfig, cycleIndex: number) {
    const rate = this.devRate();
    const rand = mulberry32(Math.imul(cycleIndex, 2654435761) ^ 0x9e3779b9);
    const rolled = this.forceBalrog() || rand() < invasion.chance;
    const approachOffset =
      invasion.minDelayAfterDepartMs / rate + rand() * (invasion.delayRangeMs / rate);
    return { rolled, approachOffset };
  }

  haveBalrog(routeKey = 'Boats'): boolean {
    const route = this.getRoute(routeKey);
    if (!route?.invasion) return false;
    const ph = this.getPhase(route);
    const inv = this.invasionForCycle(route.invasion, ph.cycleIndex);
    return ph.sailing && inv.rolled && ph.cyclePos >= ph.departPos + inv.approachOffset;
  }

  private getElevatorPhase() {
    const rate = this.devRate();
    const period = ELEVATOR.periodMs / rate;
    const now = Date.now();
    const pos = now % period;
    const index = Math.floor(now / period);
    const upArrive = ELEVATOR.upArriveMs / rate;
    const downDepart = ELEVATOR.downDepartMs / rate;
    const downArrive = ELEVATOR.downArriveMs / rate;
    return {
      periodMs: period, pos, index,
      upArrivePos: upArrive, downDepartPos: downDepart, downArrivePos: downArrive,
      // Gate opens when its car arrives back, closes when it departs
      upGateOpen: pos >= downArrive,
      downGateOpen: pos >= upArrive && pos < downDepart,
    };
  }

  // === Script-facing API (cm/pi.getEventManager) ==========================
  // Returns null for event names this system doesn't own, so callers can
  // fall back to their generic stub (PQs, weddings, etc.).
  getEventManagerApi(name: string): any | null {
    const mgr = this;
    const route = this.getRoute(name);
    if (route) {
      return {
        getProperty(k: string) {
          const ph = mgr.getPhase(route);
          if (k === 'entry') return ph.entryOpen ? 'true' : 'false';
          if (k === 'docked') return ph.sailing ? 'false' : 'true';
          if (k === 'haveBalrog') return mgr.haveBalrog(route.key) ? 'true' : 'false';
          return null;
        },
        getIntProperty(_k: string) { return 0; },
        setProperty(_k: string, _v: any) { /* vestigial in all Cosmic transport scripts */ },
        getTransportationTime(t: number) { return (t ?? 0) / mgr.devRate(); },
        getEventInstance() { return null; },
      };
    }
    if (name === ELEVATOR.key) {
      return {
        getProperty(k: string) {
          const ph = mgr.getElevatorPhase();
          // Inverted semantics (Cosmic): "true" = car away / in motion
          if (k === 'goingUp') return ph.upGateOpen ? 'false' : 'true';
          if (k === 'goingDown') return ph.downGateOpen ? 'false' : 'true';
          return null;
        },
        getIntProperty(_k: string) { return 0; },
        setProperty(_k: string, _v: any) { /* no-op */ },
        getEventInstance() { return null; },
      };
    }
    if (TIMED_RIDES.some((r) => r.routeKey === name)) {
      return {
        startInstance(_player?: any) { return mgr.startTimedRide(name); },
        getProperty(_k: string) { return null; },
        getIntProperty(_k: string) { return 0; },
        setProperty(_k: string, _v: any) { /* no-op */ },
        getEventInstance() { return null; },
      };
    }
    return null;
  }

  private startTimedRide(routeKey: string): boolean {
    const mapId = this.currentMapId();
    const ride = TIMED_RIDES.find(
      (r) => r.routeKey === routeKey && r.fromMaps.includes(mapId)
    );
    if (!ride || !this.changeMapFn) return false;
    this.requestWarp(ride.rideMap);
    return true;
  }

  private currentMapId(): number {
    const id = Number(this.currentMap?.id);
    return Number.isFinite(id) ? id : -1;
  }

  private requestWarp(mapId: number, portal?: string | number) {
    if (!this.changeMapFn || this.warping) return;
    this.warping = true;
    console.log(`[Transport] warp → ${mapId}${portal !== undefined ? ` @${portal}` : ''}`);
    Promise.resolve(this.changeMapFn(mapId, portal))
      .catch((e) => console.error('[Transport] warp failed:', e))
      .finally(() => { this.warping = false; });
  }

  // === Visual queries ======================================================

  // ms until the next departure shown by this map's clock, or remaining ride
  // time on an instanced ride map; null = no clock here
  getClockRemainingMs(mapId: number): number | null {
    const ride = TIMED_RIDES.find((r) => r.rideMap === mapId);
    if (ride && this.lastMapId === mapId) {
      return Math.max(0, ride.durationMs / this.devRate() - (Date.now() - this.mapEnteredAt));
    }
    const key = CLOCK_ROUTE_BY_MAP[mapId];
    const route = key ? this.getRoute(key) : undefined;
    if (!route) return null;
    const ph = this.getPhase(route);
    return (ph.departPos - ph.cyclePos + ph.cycleLenMs) % ph.cycleLenMs;
  }

  getDockShipPhase(mapId: number): RoutePhase | null {
    const key = SHIP_ROUTE_BY_MAP[mapId];
    const route = key ? this.getRoute(key) : undefined;
    return route ? this.getPhase(route) : null;
  }

  isEnemyShipVisible(mapId: number): boolean {
    return ENEMY_SHIP_MAPS.has(mapId) && this.haveBalrog('Boats');
  }

  // Re-arm all crossing trackers to "now". Called on every map entry so a
  // boundary that passed while we were elsewhere (or loading) can never be
  // mistaken for one we witnessed while standing on a transport map.
  private snapshotTrackers() {
    for (const route of TRANSPORT_ROUTES) {
      const ph = this.getPhase(route);
      this.prev[route.key] = { index: ph.cycleIndex, pos: ph.cyclePos };
    }
    const eph = this.getElevatorPhase();
    this.prevElevator = { index: eph.index, pos: eph.pos };
  }

  // === Per-frame tick (called from MapState.doUpdate) ======================
  update(mapleMap: any, changeMapFn: ChangeMapFn) {
    this.changeMapFn = changeMapFn;
    this.currentMap = mapleMap;
    const mapId = Number(mapleMap?.id);
    if (!mapleMap?.doneLoading || !Number.isFinite(mapId) || this.warping) return;

    // Crossings only count while continuously standing on one map
    if (mapId !== this.lastMapId) {
      this.lastMapId = mapId;
      this.mapEnteredAt = Date.now();
      this.balrogSeen = {};
      this.snapshotTrackers();
      return;
    }

    // 1) Instanced timed rides — countdown from map entry, then exit
    const ride = TIMED_RIDES.find((r) => r.rideMap === mapId);
    if (ride) {
      if (Date.now() - this.mapEnteredAt >= ride.durationMs / this.devRate()) {
        this.requestWarp(ride.destMap, ride.destPortal);
      }
      return;
    }

    // 2) Cyclic shuttles — edge-triggered boundary warps (each client warps
    //    only itself; trackers always advance so no crossing fires twice)
    let warpTo: { map: number; portal?: string | number } | null = null;
    for (const route of TRANSPORT_ROUTES) {
      const ph = this.getPhase(route);
      const prev = this.prev[route.key];
      this.prev[route.key] = { index: ph.cycleIndex, pos: ph.cyclePos };
      if (!prev || warpTo) continue;

      const wrapped = ph.cycleIndex > prev.index;
      const crossedDepart =
        (!wrapped && prev.pos < ph.departPos && ph.cyclePos >= ph.departPos) ||
        (wrapped && ph.cyclePos >= ph.departPos);

      const waitingLeg = route.legs.find((l) => l.waitingRoomMap === mapId);
      if (waitingLeg) {
        if (wrapped) {
          // Slept through the whole voyage (backgrounded tab) — you rode it
          warpTo = { map: waitingLeg.arrivalMap, portal: waitingLeg.arrivalPortal };
        } else if (crossedDepart) {
          warpTo = { map: waitingLeg.deckMap };
        }
        continue;
      }
      const ridingLeg = route.legs.find(
        (l) => l.deckMap === mapId || l.cabinMaps.includes(mapId)
      );
      if (ridingLeg && wrapped) {
        warpTo = { map: ridingLeg.arrivalMap, portal: ridingLeg.arrivalPortal };
      }
    }

    // 3) Elevator — car departures/arrivals (trackers advance regardless)
    const eph = this.getElevatorPhase();
    const eprev = this.prevElevator;
    this.prevElevator = { index: eph.index, pos: eph.pos };
    if (eprev && !warpTo) {
      const wrappedE = eph.index > eprev.index;
      const crossed = (at: number) =>
        wrappedE ? eph.pos >= at : eprev.pos < at && eph.pos >= at;
      if (mapId === ELEVATOR.upBoardingMap && wrappedE) {
        warpTo = { map: ELEVATOR.upCarMap };
      } else if (mapId === ELEVATOR.upCarMap && crossed(eph.upArrivePos)) {
        warpTo = { map: ELEVATOR.upArrivalMap, portal: ELEVATOR.upArrivalPortal };
      } else if (mapId === ELEVATOR.downBoardingMap && crossed(eph.downDepartPos)) {
        warpTo = { map: ELEVATOR.downCarMap };
      } else if (mapId === ELEVATOR.downCarMap && crossed(eph.downArrivePos)) {
        warpTo = { map: ELEVATOR.downArrivalMap, portal: ELEVATOR.downArrivalPortal };
      }
    }

    if (warpTo) {
      this.requestWarp(warpTo.map, warpTo.portal);
      return;
    }

    // 4) Balrog invasion — level-triggered spawn + BGM while on a deck
    this.updateInvasion(mapleMap, mapId);
  }

  private updateInvasion(mapleMap: any, mapId: number) {
    const route = this.getRoute('Boats');
    const invasion = route?.invasion;
    if (!route || !invasion) return;
    const leg = route.legs.find((l) => l.deckMap === mapId);
    if (!leg?.invasionSpawn) return;

    const ph = this.getPhase(route);
    const inv = this.invasionForCycle(invasion, ph.cycleIndex);
    if (!ph.sailing || !inv.rolled) return;
    const approachPos = ph.departPos + inv.approachOffset;
    if (ph.cyclePos < approachPos) return;

    // Approach: enemy ship visible (ShipObject queries us) + invasion BGM.
    // Level-enforced so cabin exits and late deck entries re-apply it (no-op
    // when already playing); the arrival warp restores map BGM via MapleMap.load.
    AudioManager.playBackgroundMusic(invasion.bgm).catch(() => {});

    if (ph.cyclePos < approachPos + invasion.spawnAfterApproachMs / this.devRate()) return;

    // Track deaths we witnessed so re-entering the deck doesn't resurrect them.
    // "Seen" means the spawn actually landed, never that one was requested:
    // spawnMonster is async and loading Mob.wz/8150000 takes several ticks, so
    // marking it seen up front made the gap before it appeared indistinguish-
    // able from a kill. That recorded a death for a Balrog still on its way in
    // — it then showed up and fought normally while already flagged dead for
    // the cycle, and stepping into the cabin and back out lost it for good.
    for (let i = 0; i < invasion.countPerDeck; i++) {
      const oId = invasion.baseOId + i;
      if (this.balrogPending[oId]) continue; // spawn in flight, absence proves nothing
      const present = !!mapleMap.findMonsterByOId?.(oId);
      if (this.balrogSeen[oId] && !present) {
        this.invasionDeaths.add(`${ph.cycleIndex}:${oId}`);
      }
      this.balrogSeen[oId] = present;
    }

    const { x, y } = leg.invasionSpawn;
    const ground = mapleMap.getNearestFootholdPosition?.(x, y) || { x, y };
    const fhId = this.findFootholdIdAt(mapleMap, ground.x, ground.y);
    for (let i = 0; i < invasion.countPerDeck; i++) {
      const oId = invasion.baseOId + i;
      if (this.invasionDeaths.has(`${ph.cycleIndex}:${oId}`)) continue;
      if (mapleMap.findMonsterByOId?.(oId)) continue;
      if (this.balrogPending[oId]) continue;

      // Coming back to the deck mid-invasion resumes the same Balrog rather
      // than handing you a fresh one at full HP
      const remembered = MapStateCache.getMonsterState(mapId, oId);
      this.balrogPending[oId] = true;
      Promise.resolve(mapleMap.spawnMonster({
        oId,
        id: invasion.mobId,
        x: remembered?.x ?? ground.x, y: remembered?.y ?? ground.y,
        stance: '', fh: fhId,
        minX: ground.x - 400, maxX: ground.x + 400,
        mobTime: -1,
        map: mapleMap,
        alive: true,
        nextPossibleSpawn: 0,
        fadeIn: true,
      })).then(() => {
        this.balrogPending[oId] = false;
        this.balrogSeen[oId] = true;
        const mob = mapleMap.findMonsterByOId?.(oId);
        if (mob && remembered && remembered.hp > 0) mob.hp = remembered.hp;
      }).catch((e: any) => {
        this.balrogPending[oId] = false;
        console.error('[Transport] Balrog spawn failed:', e);
      });
    }
  }

  private findFootholdIdAt(mapleMap: any, x: number, y: number): number {
    let bestId = 0;
    let bestDy = Infinity;
    for (const fh of Object.values(mapleMap.footholds || {}) as any[]) {
      if (fh.x1 === fh.x2 || fh.x1 > fh.x2) continue;
      if (x < fh.x1 || x > fh.x2) continue;
      const t = (x - fh.x1) / (fh.x2 - fh.x1 || 1);
      const fhY = fh.y1 + t * (fh.y2 - fh.y1);
      const dy = Math.abs(fhY - y);
      if (dy < bestDy) { bestDy = dy; bestId = fh.id; }
    }
    return bestId;
  }
}

const TransportationManager = new TransportationManagerImpl();
export default TransportationManager;
