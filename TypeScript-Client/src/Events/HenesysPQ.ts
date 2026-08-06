import WZManager from '../wz-utils/WZManager';
import config from '../Config';
import PLAY_AUDIO from '../Audio/PlayAudio';
import GameCanvas from '../GameCanvas';
import PartyManager from '../Party/PartyManager';

/**
 * Client-side port of Cosmic's HenesysPQ event (scripts/event/HenesysPQ.js) —
 * "Moon Bunny's Rice Cake" / Primrose Hill, v83.
 *
 * Flow (authentic):
 *  - Tory (1012112) at Henesys Park starts the instance → warp to 910010000,
 *    10-minute timer.
 *  - Break the primrose leaves (nut reactors 9102002-9102007, already driven
 *    by the normal reactor system) for colored primrose seeds.
 *  - Drop the matching seed on each of the 6 platform moonflowers
 *    (9108000-9108005, WZ type-100 item events) — each bloom fills the moon
 *    (reactor 9101000) one state.
 *  - At 6 blooms the moon is full: the map's monsters appear and the Moon
 *    Bunny (9300061, friendly) spawns at (-183,-433), pounding out one rice
 *    cake (4001101) every 6s (WZ dropItemPeriod). Nearby monsters hurt it;
 *    if it dies the party is exiled to 910010300.
 *  - Hand Growlie (1012114) 10 rice cakes → stage clear (+1600 exp), map
 *    sweep, warp to 910010100. Tory there pays the event reward (4001158);
 *    Tommy offers the Pig Town bonus round (910010200, 5 min) → 910010400.
 *
 * The original Cosmic NPC scripts (1012112/1012113/1012114) run unmodified —
 * NpcScriptEngine routes their em/eim calls here. No party system exists in
 * this client yet, so a solo player counts as an eligible party of one.
 */

const RECRUIT_MAP = 100000200;
const ENTRY_MAP = 910010000;
const CLEAR_MAP = 910010100;
const BONUS_MAP = 910010200;
const EXIT_MAP = 910010300;
const BONUS_EXIT_MAP = 910010400;
const MIN_MAP = 910010000;
const MAX_MAP = 910010400;

const EVENT_TIME_MS = 10 * 60 * 1000;
const MIN_LEVEL = 10;
const MAX_LEVEL = 255;

const MOON_BUNNY_ID = 9300061;
const BUNNY_OID = 990061; // outside the map's spawn-index oId range
const BUNNY_SPAWN = { x: -183, y: -433 }; // Cosmic spawnMonsterOnGroundBelow
const RICE_CAKE = 4001101;
// Cosmic: dropPeriod = WZ dropItemPeriod (6) * 10000ms, and the Moon Bunny is
// special-cased to a third of that — one rice cake every 20 seconds
const CAKE_PERIOD_MS = 20000;
const MOB_BITE_PERIOD_MS = 3000;
const MOB_BITE_RANGE_X = 100;
const MOB_BITE_RANGE_Y = 80;

const FULLMOON_REACTOR = 9101000;
const REWARD_ITEM = 4001158; // Feather of Goddess
const STAGE_CLEAR_EXP = 1600;
const EXCLUSIVE_ITEMS = [4001095, 4001096, 4001097, 4001098, 4001099, 4001100, 4001101];

// Mirrors Cosmic setEventRequirements() — shown by Tory via em.getProperty("party")
const REQUIREMENTS_TEXT =
  '\r\n    Number of players: 3 ~ 6' +
  '\r\n    Level range: 10 ~ 255' +
  '\r\n    Time limit: 10 minutes';

interface EffectFrame {
  img: HTMLImageElement;
  ox: number;
  oy: number;
  delay: number;
}

class HenesysPQEvent {
  /** NPCs whose scripts belong to this event (party stub scope) */
  readonly NPC_IDS = [1012112, 1012113, 1012114];

  active = false;
  private cleared = false;
  private rewarded = false;
  private props: Record<string, string> = {};
  private timerEndsAt = 0;
  private stage = 0; // moonflowers bloomed (0-6)
  private bunnyCake = 0;
  private bunnyDamaged = 0;
  private bunny: any = null;
  private bunnyFailAt = 0;
  private cakeNextAt = 0;
  private mobBiteNextAt = 0;
  private retargetNextAt = 0;
  /** Blooms relayed to a party member riding the leader's instance */
  private passengerStage = 0;

  // Registered by MapState so warps avoid an import cycle
  changeMapFn: ((mapId: number, portal?: number | string) => void) | null = null;

  // ---- on-screen extras ------------------------------------------------
  private banner: string | null = null;
  private bannerT = 0;
  private clockDigits: Record<string, HTMLImageElement> | null = null;
  private clearEffect: { frames: EffectFrame[]; idx: number; t: number } | null = null;

  private get character(): any {
    return (window as any).charecter;
  }
  private get map(): any {
    return this.character?.map;
  }
  private currentMapId(): number {
    return Number(this.map?.mapId ?? 0);
  }

  private warp(mapId: number): void {
    if (this.changeMapFn) this.changeMapFn(mapId);
    else console.error('[HenesysPQ] no changeMapFn registered');
  }

  /** Event warps move the whole team — party members follow the leader */
  private warpTeam(mapId: number): void {
    this.warp(mapId);
    PartyManager.warpTeam(mapId); // no-op unless we lead a party
  }

  private notice(text: string): void {
    import('../UI/UIChatLog')
      .then(({ default: UIChatLog }) => UIChatLog.notice(text))
      .catch(() => {});
  }

  // =====================================================================
  // Script API — em (Tory's cm.getEventManager("HenesysPQ"))
  // =====================================================================
  getManagerApi(): any {
    const self = this;
    return {
      getProperty(key: string) {
        if (key === 'party') return REQUIREMENTS_TEXT;
        return self.props[key] ?? null;
      },
      setProperty(key: string, value: any) { self.props[key] = String(value); },
      getIntProperty(key: string) { return parseInt(self.props[key] ?? '0') || 0; },
      // Eligibility mirrors Cosmic getEligibleParty: members on the recruit
      // map within the level range, and the leader among them. A solo player
      // still counts as a party of one so the PQ stays playable alone.
      getEligibleParty(_party: any) {
        const level = self.character?.stats?.level ?? 1;
        const selfOk = level >= MIN_LEVEL && level <= MAX_LEVEL &&
          self.currentMapId() === RECRUIT_MAP;
        if (!PartyManager.isInParty()) {
          return { size: () => (selfOk ? 1 : 0) };
        }
        if (!PartyManager.isLeader() || !selfOk) return { size: () => 0 };
        const eligible = 1 + PartyManager.getOtherMembersOnMap(RECRUIT_MAP)
          .filter((m) => m.level >= MIN_LEVEL && m.level <= MAX_LEVEL).length;
        return { size: () => eligible };
      },
      startInstance(_party?: any, _map?: any, _n?: number) {
        if (self.active) return false; // lobby already taken
        self.begin();
        return true;
      },
      getEventInstance() {
        return self.isRegistered() ? self.getInstanceApi() : null;
      },
    };
  }

  // =====================================================================
  // Script API — eim (cm.getEventInstance())
  // =====================================================================
  getInstanceApi(): any {
    const self = this;
    return {
      getProperty(key: string) { return self.props[key] ?? null; },
      setProperty(key: string, value: any) { self.props[key] = String(value); },
      getIntProperty(key: string) { return parseInt(self.props[key] ?? '0') || 0; },
      setIntProperty(key: string, value: number) { self.props[key] = String(value); },
      isEventCleared() { return self.cleared; },
      setEventCleared() { self.cleared = true; },
      startEventTimer(ms: number) { self.timerEndsAt = Date.now() + ms; },
      stopEventTimer() { self.timerEndsAt = 0; },
      warpEventTeam(a: number, b?: number) { self.warpTeam(b ?? a); },
      giveEventReward(_player?: any) { return self.giveReward(); },
      giveEventPlayersStageReward(_stage: number) {
        self.character?.addExp?.(STAGE_CLEAR_EXP, true);
        // Same-map party members earn the stage reward too
        const grants = PartyManager.getOtherMembersOnMap(self.currentMapId())
          .map((m) => ({ id: m.id, exp: STAGE_CLEAR_EXP }));
        if (grants.length > 0) {
          (window as any).__mySocket?.sendMessage?.({ type: 'party_exp', data: { grants } });
        }
      },
      showClearEffect(_b?: boolean) { self.showClearEffect(); },
      clearPQ() {
        self.timerEndsAt = 0;
        self.cleared = true;
        self.warpTeam(CLEAR_MAP);
      },
      getMapInstance(mapId: number) {
        return {
          getId() { return mapId; },
          killAllMonstersNotFriendly() { self.killAllMonstersNotFriendly(); },
        };
      },
      unregisterPlayer(_p?: any) { /* solo — handled by onMapChanged */ },
      dispose() { self.endInstance(); },
    };
  }

  isRegistered(): boolean {
    const mapId = this.currentMapId();
    if (mapId < MIN_MAP || mapId > MAX_MAP) return false;
    return this.active || this.isPassengerFor(mapId);
  }

  /** Only the client running the instance is the event leader */
  isEventLeader(): boolean {
    return this.active && this.isRegistered();
  }

  /**
   * A party member riding the leader's instance: their own client has no
   * running instance, but they're on an event map with their party. The
   * instance state (timer, stage records) lives on the leader's client;
   * passengers get the moon/bloom state relayed and a minimal eim for the
   * reward NPCs.
   */
  private isPassengerFor(mapId: number): boolean {
    return !this.active && PartyManager.isInParty() &&
      Number(mapId) >= MIN_MAP && Number(mapId) <= MAX_MAP;
  }

  /** Bloom relayed from the planting player (via the reactor-hit channel) */
  onRemoteMoonflowerBloom(reactor: any): void {
    const map = this.map;
    if (!map || this.currentMapId() !== ENTRY_MAP) return;
    const ev = reactor.getItemEvent?.();
    reactor.forceAdvance?.(ev?.nextState ?? 1);
    this.passengerStage = Math.min(6, this.passengerStage + 1);
    const moon = map.reactors?.find(
      (r: any) => r.id === FULLMOON_REACTOR && !r.destroyed
    );
    moon?.forceAdvance?.(this.passengerStage);
    if (this.passengerStage >= 6) void this.passengerMoonFull(map);
  }

  /** Moon full on a passenger client: wake the hill and raise the bunny */
  private async passengerMoonFull(map: any): Promise<void> {
    if (this.bunny) return;
    this.notice('Protect the Moon Bunny!!!');
    this.showBanner(
      "Protect the Moon Bunny that's pounding the mill, and gather up 10 Moon Bunny's Rice Cakes!"
    );
    map.releaseSuppressedMobs?.();
    const ground = map.getFootholdBelow?.(BUNNY_SPAWN.x, BUNNY_SPAWN.y - 20);
    const gx = ground?.x ?? BUNNY_SPAWN.x;
    const gy = ground?.y ?? BUNNY_SPAWN.y;
    await map.spawnMonster?.({
      oId: BUNNY_OID,
      id: MOON_BUNNY_ID,
      x: gx,
      y: gy,
      stance: '',
      fh: ground?.fh?.id,
      minX: gx - 20,
      maxX: gx + 20,
      mobTime: -1,
      map,
      alive: true,
      nextPossibleSpawn: 0,
      fadeIn: true,
    });
    this.bunny = map.findMonsterByOId?.(BUNNY_OID) ?? null;
  }

  // =====================================================================
  // Lifecycle
  // =====================================================================
  private begin(): void {
    this.active = true;
    this.cleared = false;
    this.rewarded = false;
    this.props = {};
    this.stage = 0;
    this.bunnyCake = 0;
    this.bunnyDamaged = 0;
    this.bunny = null;
    this.bunnyFailAt = 0;
    this.cakeNextAt = 0;
    this.mobBiteNextAt = 0;
    this.banner = null;
    this.clearEffect = null;
    this.timerEndsAt = Date.now() + EVENT_TIME_MS;

    // A fresh instance: forget any remembered reactor/mob state on the PQ maps
    import('../MapStateCache')
      .then(({ default: MapStateCache }) => {
        MapStateCache.forget?.(ENTRY_MAP);
        MapStateCache.forget?.(BONUS_MAP);
      })
      .catch(() => {});

    this.warpTeam(ENTRY_MAP);
  }

  /** Mob spawns on the main map stay hidden until the moon is full */
  shouldSuppressMobs(mapId: number): boolean {
    if (Number(mapId) !== ENTRY_MAP) return false;
    if (this.active) return this.stage < 6;
    // Passengers key off the relayed bloom count so both clients agree
    return this.isPassengerFor(mapId) && this.passengerStage < 6;
  }

  onMapChanged(mapId: number): void {
    const id = Number(mapId);
    if (!this.active) {
      if (id >= MIN_MAP && id <= MAX_MAP && id !== EXIT_MAP) {
        // Party members ride the leader's instance as passengers; a fresh
        // entry map starts their relayed bloom count over
        if (this.isPassengerFor(id)) {
          if (id === ENTRY_MAP) {
            this.passengerStage = 0;
            this.rewarded = false;
            this.bunny = null;
          }
          return;
        }
        // Instance maps without a running instance (and no party) eject to
        // the exit map — a reload mid-PQ loses the instance; Tommy at the
        // exit warps home
        setTimeout(() => {
          if (!this.active && this.currentMapId() === id && !this.isPassengerFor(id)) {
            this.warp(EXIT_MAP);
          }
        }, 300);
      } else {
        // Seeds and rice cakes can't exist outside the event: sweep strays
        // that survived a lost instance (reload mid-PQ, saved-then-relogged)
        this.removeExclusiveItems();
        this.passengerStage = 0;
        this.bunny = null;
      }
      return;
    }
    // Leaving the event's map range (or reaching the exit map) unregisters
    // the player — solo team means the instance dies with them (Cosmic
    // changedMap/isEventTeamLackingNow)
    if (id < MIN_MAP || id > MAX_MAP || id === EXIT_MAP) {
      this.endInstance();
    }
  }

  private endInstance(): void {
    if (!this.active) return;
    this.active = false;
    this.timerEndsAt = 0;
    this.bunny = null;
    this.banner = null;
    this.removeExclusiveItems();
  }

  /** Seeds and rice cakes never leave Primrose Hill (Cosmic setEventExclusives) */
  private removeExclusiveItems(): void {
    const qm = this.character?.questManager;
    if (!qm) return;
    for (const itemId of EXCLUSIVE_ITEMS) {
      const count = qm.getItemCount?.(itemId) ?? 0;
      if (count > 0) qm.removeItems?.(itemId, count);
    }
  }

  private giveReward(): boolean {
    if (this.rewarded) return true;
    const inv = this.character?.inventory;
    if (inv?.canHold && !inv.canHold(REWARD_ITEM, 1)) return false;
    inv?.addToInventory?.(REWARD_ITEM, 1);
    import('../UI/UIChatLog')
      .then(({ default: UIChatLog }) => UIChatLog.logItemChange(REWARD_ITEM, 1))
      .catch(() => {});
    this.rewarded = true;
    return true;
  }

  private killAllMonstersNotFriendly(): void {
    const map = this.map;
    if (!map?.monsters) return;
    for (const mob of map.monsters) {
      if (mob.isFriendly || mob.dying || mob.destroyed) continue;
      mob._noDrops = true;
      mob.hp = 0;
      mob.die(null);
    }
    // The event is over — stop the respawn tick from refilling the hill
    const defs = map.getMonsterSpawnDefs?.() ?? [];
    for (const def of defs) def.nextPossibleSpawn = Number.POSITIVE_INFINITY;
  }

  // =====================================================================
  // Per-frame drive (called from MapState update/render)
  // =====================================================================
  update(msPerTick: number): void {
    if (this.banner !== null) {
      this.bannerT += msPerTick;
      if (this.bannerT >= 7000) this.banner = null;
    }
    if (this.clearEffect) {
      const eff = this.clearEffect;
      eff.t += msPerTick;
      const delay = eff.frames[eff.idx]?.delay ?? 120;
      if (eff.t >= delay) {
        eff.t -= delay;
        eff.idx++;
        if (eff.idx >= eff.frames.length) this.clearEffect = null;
      }
    }

    const now = Date.now();
    const map = this.map;
    const mapId = this.currentMapId();

    if (!this.active) {
      // Passenger hosting the map runs the mobs — including their assault
      // on the bunny (the leader's client owns cakes, timer and fail)
      if (
        this.isPassengerFor(mapId) && mapId === ENTRY_MAP &&
        map?.doneLoading && this.bunny
      ) {
        this.updateBunnyCombat(map, now);
      }
      return;
    }

    // Timer expiry — Cosmic scheduledTimeout: a cleared stage 1 sends the
    // team from the bonus round to its exit; otherwise the run is over
    if (this.timerEndsAt && now >= this.timerEndsAt) {
      this.timerEndsAt = 0;
      if (this.props['1stageclear']) {
        this.warpTeam(BONUS_EXIT_MAP);
      } else {
        this.warpTeam(EXIT_MAP);
      }
      return;
    }

    if (mapId === ENTRY_MAP && map?.doneLoading) {
      if (this.stage < 6) this.checkMoonflowers(map);
      this.updateBunny(map, now);
    }
  }

  /** A matching primrose seed dropped inside a moonflower's box makes it bloom */
  private checkMoonflowers(map: any): void {
    if (!map.reactors || !map.itemDrops) return;
    for (const reactor of map.reactors) {
      if (reactor.destroyed) continue;
      const ev = reactor.getItemEvent?.();
      if (!ev) continue;
      for (const drop of map.itemDrops) {
        if (drop.destroyed || drop.id !== ev.itemId) continue;
        if (drop.pos?.vy !== 0) continue; // still airborne
        const dx = drop.pos.x - reactor.x;
        const dy = drop.pos.y - reactor.y;
        if (dx < ev.lt.x || dx > ev.rb.x || dy < ev.lt.y || dy > ev.rb.y) continue;

        // Consume the seed and bloom; the bloom rides the reactor-hit relay
        // so party members' clients advance their flower and moon too
        drop.destroyed = true;
        try {
          const netId = (drop as any)._netDropId;
          if (netId) (window as any).__mySocket?.sendItemPickup?.(netId);
          (window as any).__mySocket?.sendReactorHit?.(reactor.oId);
        } catch {}
        reactor.forceAdvance(ev.nextState);

        this.stage++;
        const moon = map.reactors.find(
          (r: any) => r.id === FULLMOON_REACTOR && !r.destroyed
        );
        moon?.forceAdvance?.(this.stage);

        if (this.stage >= 6) void this.moonFull(map);
        break;
      }
    }
  }

  private async moonFull(map: any): Promise<void> {
    // Cosmic reactor 9108xxx act(): "Protect the Moon Bunny!!!" + spawn
    this.notice('Protect the Moon Bunny!!!');
    this.showBanner(
      "Protect the Moon Bunny that's pounding the mill, and gather up 10 Moon Bunny's Rice Cakes!"
    );
    try {
      const alert: any = await WZManager.get('Sound.wz/Game.img/QuestAlert');
      if (alert?.nGetAudio) PLAY_AUDIO(alert.nGetAudio());
    } catch {}

    // The hill wakes up: monsters appear and keep respawning
    map.releaseSuppressedMobs?.();

    const ground = map.getFootholdBelow?.(BUNNY_SPAWN.x, BUNNY_SPAWN.y - 20);
    const gx = ground?.x ?? BUNNY_SPAWN.x;
    const gy = ground?.y ?? BUNNY_SPAWN.y;
    await map.spawnMonster?.({
      oId: BUNNY_OID,
      id: MOON_BUNNY_ID,
      x: gx,
      y: gy,
      stance: '',
      fh: ground?.fh?.id,
      minX: gx - 20,
      maxX: gx + 20,
      mobTime: -1,
      map,
      alive: true,
      nextPossibleSpawn: 0,
      fadeIn: true,
    });
    this.bunny = map.findMonsterByOId?.(BUNNY_OID) ?? null;
    const now = Date.now();
    this.cakeNextAt = now + CAKE_PERIOD_MS;
    this.mobBiteNextAt = now + MOB_BITE_PERIOD_MS;
  }

  private updateBunny(map: any, now: number): void {
    const bunny = this.bunny;
    if (!bunny) return;

    // Failure: the bunny died — 5s later the team is exiled (Cosmic
    // friendlyKilled → schedule bunnyDefeated 5s)
    if ((bunny.dying || bunny.destroyed) && !this.bunnyFailAt) {
      this.bunnyFailAt = now + 5000;
      return;
    }
    if (this.bunnyFailAt) {
      if (now >= this.bunnyFailAt) {
        this.bunnyFailAt = 0;
        this.notice(
          'Due to your failure to protect the Moon Bunny, you have been transported to the Exile Map.'
        );
        this.warpTeam(EXIT_MAP);
      }
      return;
    }

    // Rice cake production — one every CAKE_PERIOD_MS while it lives
    if (now >= this.cakeNextAt) {
      this.cakeNextAt = now + CAKE_PERIOD_MS;
      void this.dropRiceCake(map, bunny);
    }

    this.updateBunnyCombat(map, now);
  }

  /**
   * Mob-vs-bunny combat, run by whichever party member hosts the map's mobs
   * (mob AI only runs on the host client).
   */
  private updateBunnyCombat(map: any, now: number): void {
    const bunny = this.bunny;
    if (!bunny || bunny.dying || bunny.destroyed) return;
    if (!((window as any).__mySocket?.isMobHost ?? true)) return;

    // The hill's monsters exist to hurt the bunny: any mob not currently
    // aggro'd onto a player converges on it (mob AI treats a friendly-mob
    // target as always-valid, and flyers may leave their altitude band)
    if (now >= this.retargetNextAt) {
      this.retargetNextAt = now + 1000;
      for (const mob of map.monsters ?? []) {
        if (mob.isFriendly || mob.dying || mob.destroyed || mob.isRemote) continue;
        if (!mob.aggroTarget) mob.aggroTarget = bunny;
      }
    }

    // Monsters close to the bunny gnaw on it. In the original client this is
    // mob-attacks-mob combat (the MobDamageMob packet); damage follows the
    // v83 physical formula from that handler:
    //   max = (atkPAD * (1.15 + 0.025*atkLevel) - 0.75*defPDD)
    //         * (log|defPDD - atkPAD| / log 17)
    if (now >= this.mobBiteNextAt) {
      this.mobBiteNextAt = now + MOB_BITE_PERIOD_MS;
      for (const mob of map.monsters ?? []) {
        if (mob.isFriendly || mob.dying || mob.destroyed) continue;
        if (
          Math.abs(mob.pos.x - bunny.pos.x) <= MOB_BITE_RANGE_X &&
          Math.abs(mob.pos.y - bunny.pos.y) <= MOB_BITE_RANGE_Y
        ) {
          const atk = mob.mobFile?.info?.PADamage?.nValue ?? 0;
          if (atk <= 0) continue;
          const level = mob.mobFile?.info?.level?.nValue ?? 1;
          const def = bunny.mobFile?.info?.PDDamage?.nValue ?? 0;
          const maxDmg = Math.max(
            1,
            Math.floor(
              (atk * (1.15 + 0.025 * level) - 0.75 * def) *
                (Math.log(Math.abs(def - atk) || 2) / Math.log(17))
            )
          );
          const dmg = 1 + Math.floor(Math.random() * maxDmg);
          bunny.hit(dmg, mob.pos.x < bunny.pos.x ? 1 : -1, null);
        }
      }
    }
  }

  private async dropRiceCake(map: any, bunny: any): Promise<void> {
    try {
      const { default: DropItemSprite } = await import('../DropItem/DropItemSprite');
      const jitter = Math.floor(Math.random() * 60) - 30;
      const drop = await DropItemSprite.fromOpts({
        id: RICE_CAKE,
        monster: { pos: { x: bunny.pos.x + jitter, y: bunny.pos.y, vx: 0, vy: 0 } },
        amount: 1,
      });
      if (drop && !(drop as any).destroyed) {
        const dropId = Date.now() + Math.floor(Math.random() * 10000);
        (drop as any)._netDropId = dropId;
        map.addItemDrop(drop);
        try {
          (window as any).__mySocket?.sendItemDrop?.(
            RICE_CAKE, 1, bunny.pos.x + jitter, bunny.pos.y, 0, 0, dropId
          );
        } catch {}
      }
      this.bunnyCake++;
      this.notice(`The Moon Bunny made rice cake number ${this.bunnyCake}.`);
    } catch (e) {
      console.warn('[HenesysPQ] rice cake drop failed:', e);
    }
  }

  /** Player whacked the bunny — Cosmic friendlyDamaged */
  onFriendlyHitByPlayer(mob: any): void {
    if (!this.active || mob?.id !== MOON_BUNNY_ID) return;
    this.bunnyDamaged++;
    if (this.bunnyDamaged > 5) {
      this.bunnyDamaged = 0;
      this.notice(
        'The Moon Bunny is feeling sick. Please protect it so it can make delicious rice cakes.'
      );
    }
  }

  // =====================================================================
  // Rendering — event timer clock + map-effect banner + PQ clear effect
  // =====================================================================
  private showBanner(text: string): void {
    this.banner = text;
    this.bannerT = 0;
  }

  private async showClearEffect(): Promise<void> {
    try {
      const node: any = await WZManager.get('Map.wz/Effect.img/quest/party/clear');
      const frames: EffectFrame[] = [];
      for (let i = 0; i < 30; i++) {
        const f = node?.[String(i)];
        if (!f?.nGetImage) break;
        frames.push({
          img: f.nGetImage(),
          ox: f.origin?.nX ?? 0,
          oy: f.origin?.nY ?? 0,
          delay: f.delay?.nValue || 120,
        });
      }
      if (frames.length > 0) this.clearEffect = { frames, idx: 0, t: 0 };
    } catch {}
    try {
      const snd: any = await WZManager.get('Sound.wz/Game.img/QuestClear');
      if (snd?.nGetAudio) PLAY_AUDIO(snd.nGetAudio());
    } catch {}
  }

  private async loadClockDigits(): Promise<void> {
    if (this.clockDigits) return;
    const digits: Record<string, HTMLImageElement> = {};
    const node: any = await WZManager.get('Map.wz/Obj/etc.img');
    const font = node?.clock?.fontTime;
    if (!font) return;
    for (const key of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'comma']) {
      const canvas = font[key];
      if (canvas?.nGetImage) digits[key] = canvas.nGetImage();
    }
    this.clockDigits = digits;
  }

  render(canvas: GameCanvas): void {
    // PQ clear effect — screen-centered
    if (this.clearEffect) {
      const f = this.clearEffect.frames[this.clearEffect.idx];
      if (f?.img?.width) {
        canvas.drawImage({
          img: f.img,
          dx: Math.floor(config.width / 2 - f.ox),
          dy: Math.floor(config.height / 3 - f.oy),
        });
      }
    }

    if (!this.active) return;

    // Map-effect banner
    if (this.banner !== null) {
      canvas.drawText({
        text: this.banner,
        x: Math.floor(config.width / 2),
        y: 96,
        color: '#FFFF00',
        align: 'center',
        fontWeight: 'bold',
      });
    }

    // Countdown clock (red LCD digits from Map.wz/Obj/etc.img/clock/fontTime)
    if (this.timerEndsAt && this.isRegistered()) {
      if (!this.clockDigits) {
        void this.loadClockDigits().catch(() => {});
        return;
      }
      const remaining = Math.max(0, this.timerEndsAt - Date.now());
      const totalSec = Math.ceil(remaining / 1000);
      const mm = Math.floor(totalSec / 60);
      const ss = totalSec % 60;
      const glyphs = `${mm}:${String(ss).padStart(2, '0')}`.split('');

      let totalW = 0;
      for (const g of glyphs) {
        const img = this.clockDigits[g === ':' ? 'comma' : g];
        totalW += img?.width || 26;
      }
      let x = Math.floor(config.width / 2 - totalW / 2);
      const y = 28;
      for (const g of glyphs) {
        const img = this.clockDigits[g === ':' ? 'comma' : g];
        if (img?.width) {
          canvas.drawImage({ img, dx: x, dy: y });
          x += img.width;
        } else {
          x += 26;
        }
      }
    }
  }
}

const HenesysPQ = new HenesysPQEvent();
export default HenesysPQ;
