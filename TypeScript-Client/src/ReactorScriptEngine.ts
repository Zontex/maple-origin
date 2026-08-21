import { cachedFetch } from './AssetDownloader';
import { createScriptJavaShim, makeSafeScriptApi } from './NpcScriptEngine';
import { QuestState } from './Quest/QuestData';
import DropItemSprite from './DropItem/DropItemSprite';
import REACTOR_DROPS, { ReactorDropEntry } from './Constants/ReactorDropData';
import AudioManager from './Audio/AudioManager';

/**
 * Reactor ACT scripts — `public/scripts/reactor/<reactorId>.js`, the v83
 * server's per-reactor scripts (292 files, from Cosmic), run client-side
 * the way NpcScriptEngine and PortalScriptEngine run theirs.
 *
 * A script exposes `act()` (reactor reached its final state) and sometimes
 * `touch()`/`untouch()` (player walked into it — not implemented, the
 * client has no reactor touch detection). `act()` talks to an `rm` object
 * (Cosmic's ReactorActionManager); the methods below are the ones the 292
 * scripts actually call, unknown ones degrade through the same chainable
 * no-op proxy the NPC engine uses.
 *
 * What the scripts do, by frequency: `rm.dropItems(...)` (133 scripts —
 * nearly every box, crate and rock), `rm.getEventInstance()` (162, the PQ
 * stage reactors), `rm.spawnMonster` (69), map/player messages, a few
 * warps, `rm.spawnNpc`, `rm.changeMusic`.
 *
 * Drops: `rm.dropItems()` draws from the same per-reactor table
 * (Constants/ReactorDropData, Cosmic's reactordrops) the static fallback
 * used before, with Cosmic's layout — items spread 25px apart, 200ms between
 * each — and the optional meso roll. A reactor with no script at all falls
 * back to `rm.dropItems()` semantics (Reactor.dropItems), so every reactor
 * that dropped before still drops.
 */

// Positive cache of script text, and a negative cache of 404s so a box with
// no script is fetched exactly once per session rather than once per break
const scriptCache: Map<number, string | null> = new Map();

let scriptSpawnCounter = 0;

export async function loadReactorScript(reactorId: number): Promise<string | null> {
  if (scriptCache.has(reactorId)) return scriptCache.get(reactorId)!;
  let text: string | null = null;
  try {
    const resp = await cachedFetch(`/scripts/reactor/${reactorId}.js`);
    if (resp.ok) {
      const body = await resp.text();
      // Vite's dev server answers unknown paths with index.html (200); a real
      // script is JS with an act/touch function in it
      if (/function\s+(act|touch|untouch)\s*\(/.test(body)) text = body;
    }
  } catch {
    text = null;
  }
  scriptCache.set(reactorId, text);
  return text;
}

export async function hasReactorScript(reactorId: number): Promise<boolean> {
  return (await loadReactorScript(reactorId)) !== null;
}

export interface ReactorDropOptions {
  posX?: number;
  posY?: number;
  meso?: boolean;
  mesoChance?: number;
  minMeso?: number;
  maxMeso?: number;
  minItems?: number;
}

function showMessage(text: string, notice: boolean = false) {
  if (!text) return;
  console.log(`[ReactorScript] ${text}`);
  import('./UI/UIChatLog')
    .then(({ default: UIChatLog }) => (notice ? UIChatLog.notice(text) : UIChatLog.system(text)))
    .catch(() => {});
}

/**
 * Roll and spawn a reactor's drops — Cosmic's ReactorActionManager.dropItems
 * with `delayed=true`, which is how every reactor drops there ("all reactors
 * actually drop items sequentially").
 *
 *  - each table entry drops with probability 1/chance
 *  - `meso` adds a meso pile with probability 1/mesoChance, amount uniform
 *    in [minMeso, maxMeso); `minItems` pads the list with more meso piles
 *  - quest-gated entries (questId > 0) need the quest active and the player
 *    still short of the required count
 *  - the pile is centred on the reactor: first drop at x - 12*n, then +25
 *    each, 200ms apart
 *
 * Only the breaking player rolls; drops are broadcast so everyone sees the
 * same ones (quest drops stay local, as before).
 */
export async function spawnReactorDrops(reactor: any, map: any, opts: ReactorDropOptions = {}): Promise<void> {
  if (!map) return;
  const table: ReactorDropEntry[] = REACTOR_DROPS.get(reactor.id) || [];
  const questManager = (window as any).charecter?.questManager;

  const meso = !!opts.meso;
  const mesoChance = Math.max(1, Number(opts.mesoChance) || 1);
  const minMeso = Math.max(0, Number(opts.minMeso) || 0);
  const maxMeso = Math.max(minMeso, Number(opts.maxMeso) || 0);
  const minItems = Math.max(0, Number(opts.minItems) || 0);

  type Rolled = { itemId: number; questId: number };
  const rolled: Rolled[] = [];
  if (meso && Math.random() < 1 / mesoChance) rolled.push({ itemId: 0, questId: -1 });

  let QuestData: any = null;
  for (const drop of table) {
    if (drop.questId > 0) {
      if (!questManager?.activeQuests?.has(drop.questId)) continue;
      const currentCount = questManager.getItemCount(drop.itemId);
      if (!QuestData) QuestData = (await import('./Quest/QuestData')).default;
      const reqs = QuestData.requirements.get(drop.questId);
      if (reqs?.complete?.items) {
        const needed = reqs.complete.items.find((i: any) => i.id === drop.itemId);
        if (needed && currentCount >= needed.count) continue;
      }
    }
    // Quest items listed at chance=1 are toned down to ~30% (kept from the
    // pre-script drop code; Cosmic gives them every time)
    const effectiveChance = drop.questId > 0 && drop.chance <= 1 ? 3 : drop.chance;
    if (Math.random() >= 1 / effectiveChance) continue;
    rolled.push({ itemId: drop.itemId, questId: drop.questId });
  }
  while (rolled.length < minItems) rolled.push({ itemId: 0, questId: -1 });
  if (rolled.length === 0) return;

  const baseX = opts.posX ?? reactor.x;
  const baseY = opts.posY ?? reactor.y;
  // Loot flies out of the reactor itself to its spread slot (v83 arc)
  const originX = baseX;
  let dropX = baseX - 12 * rolled.length;
  let delay = 0;
  const socket = (window as any).__mySocket;

  for (const d of rolled) {
    const x = dropX;
    const amount = d.itemId === 0 ? Math.floor(Math.random() * Math.max(1, maxMeso - minMeso)) + minMeso : 1;
    const spawnOne = async () => {
      if (d.itemId === 0 && amount <= 0) return;
      try {
        const dropItem = await DropItemSprite.fromOpts({
          id: d.itemId,
          monster: { pos: { x: originX, y: baseY, vx: 0, vy: 0, destX: x } },
          amount,
        });
        if (dropItem && !dropItem.destroyed) {
          const dropId = Date.now() + Math.floor(Math.random() * 10000);
          (dropItem as any)._netDropId = dropId;
          map.addItemDrop(dropItem);
          if (d.questId <= 0 && socket) {
            socket.sendItemDrop(d.itemId, amount, x, baseY, 0, 0, dropId, socket.playerId);
          }
        }
      } catch (e) {
        console.warn(`[Reactor] Failed to create drop ${d.itemId}:`, e);
      }
    };
    if (delay === 0) await spawnOne();
    else setTimeout(() => { void spawnOne(); }, delay);
    dropX += 25;
    delay += 200;
  }
}

/** Cosmic's overloads: (), (meso, mesoChance, min, max[, minItems]), (posX, posY, meso, mesoChance, min, max, minItems) */
function parseDropArgs(args: any[]): ReactorDropOptions {
  if (args.length >= 7) {
    const [posX, posY, meso, mesoChance, minMeso, maxMeso, minItems] = args;
    return { posX, posY, meso, mesoChance, minMeso, maxMeso, minItems };
  }
  if (args.length >= 4) {
    const [meso, mesoChance, minMeso, maxMeso, minItems] = args;
    return { meso, mesoChance, minMeso, maxMeso, minItems: minItems ?? 0 };
  }
  return {};
}

export default class ReactorScriptEngine {
  /**
   * Run the reactor's `act()` if it has a script. Resolves true when a
   * script ran (even if it chose to do nothing), false when there is none
   * and the caller should fall back to the static drop table.
   */
  static async runAct(reactor: any, map: any, character: any): Promise<boolean> {
    const code = await loadReactorScript(reactor.id);
    if (!code) return false;
    if (!/function\s+act\s*\(/.test(code)) {
      // touch-only script (Pianus' 2408002/3 etc.): nothing to do on break
      return true;
    }

    // Loaded here rather than at module level: MapleMap -> Reactor -> this
    // engine -> HenesysPQ would otherwise close a static import cycle
    let hpq: any = null;
    try { hpq = (await import('./Events/HenesysPQ')).default; } catch {}
    const rm = ReactorScriptEngine.createRM(reactor, map, character, hpq);
    try {
      const shim = createScriptJavaShim();
      const fn = new Function('rm', 'Java', 'java', 'Packages', `
        ${code}
        if (typeof act === 'function') return act();
      `);
      await fn(rm, shim.Java, shim.java, shim.Packages);
    } catch (e) {
      console.error(`[ReactorScript] Error in ${reactor.id}.js act():`, e);
    }
    return true;
  }

  private static createRM(reactor: any, map: any, character: any, hpq: any): any {
    const questManager = character?.questManager;
    const mapId = () => Number(map?.id ?? character?.map?.id ?? 0);

    // Reactor position with Cosmic's 10px lift (ReactorActionManager.getPosition)
    const getPosition = () => ({ x: reactor.x, y: reactor.y - 10, getX: () => reactor.x, getY: () => reactor.y - 10 });

    const spawnMonsterAt = async (id: number, x: number, y: number, extra: Record<string, any> = {}) => {
      if (!map?.spawnMonster) return;
      const ground = map.getFootholdBelow?.(x, y) || map.getNearestFootholdPosition?.(x, y);
      const gy = ground?.y ?? y;
      const fh = ground?.fh;
      const def = {
        oId: 100000 + scriptSpawnCounter++,
        id: Number(id),
        x,
        y: gy,
        fh: fh?.id,
        minX: fh ? fh.x1 : x - 100,
        maxX: fh ? fh.x2 : x + 100,
        stance: '',
        map,
        alive: true,
        nextPossibleSpawn: 0,
        fadeIn: true,
        ...extra,
      };
      try {
        await map.spawnMonster(def);
      } catch (e) {
        console.warn(`[ReactorScript] spawnMonster(${id}) failed:`, e);
      }
    };

    const spawnNpcAt = async (npcId: number, x: number, y: number) => {
      if (!map?.spawnNPC) return;
      const ground = map.getFootholdBelow?.(x, y) || map.getNearestFootholdPosition?.(x, y);
      try {
        await map.spawnNPC({
          id: Number(npcId),
          x,
          cy: ground?.y ?? y,
          fh: ground?.fh?.id,
          rx0: x - 50,
          rx1: x + 50,
          f: 0,
          oId: 100000 + scriptSpawnCounter++,
        });
      } catch (e) {
        console.warn(`[ReactorScript] spawnNpc(${npcId}) failed:`, e);
      }
    };

    const warpTo = (targetMapId: number, portal?: string | number) => {
      void (async () => {
        try {
          const { fadeToBlack } = await import('./MapState');
          fadeToBlack();
          const mapState = (window as any).MapStateInstance;
          await mapState?.changeMap?.(Number(targetMapId), typeof portal === 'string' || typeof portal === 'number' ? portal : undefined);
        } catch (e) {
          console.error(`[ReactorScript] warp(${targetMapId}) failed:`, e);
        }
      })();
    };

    // The only event instance that exists so far is Henesys PQ's
    const eventInstance = () => (hpq?.isRegistered?.() ? hpq.getInstanceApi() : null);

    const reactorApi = (r: any) => makeSafeScriptApi({
      getId() { return r.id; },
      getObjectId() { return r.oId; },
      getState() { return r.getState?.() ?? 0; },
      getName() { return r.name || ''; },
      getPosition() { return { x: r.x, y: r.y, getX: () => r.x, getY: () => r.y }; },
      isAlive() { return !r.destroyed; },
      getMap() { return mapApi; },
      forceHitReactor(state: number) { r.forceAdvance?.(Number(state)); },
      hitReactor() { r.forceAdvance?.((r.getState?.() ?? 0) + 1); },
      setState(state: number) { r.forceAdvance?.(Number(state)); },
      resetReactorActions() { /* no script timers to clear */ },
      delayedHitReactor(_c: any, delayMs: number) {
        setTimeout(() => r.forceAdvance?.((r.getState?.() ?? 0) + 1), Number(delayMs) || 0);
      },
    }, 'ReactorScript reactor');

    const mapApi: any = makeSafeScriptApi({
      getId() { return mapId(); },
      getSummonState() { return true; },
      allowSummonState(_b: boolean) { /* no-op */ },
      getReactorByName(name: string) {
        const r = (map?.reactors || []).find((x: any) => x.name === name && !x.destroyed);
        return r ? reactorApi(r) : null;
      },
      getReactorById(id: number) {
        const r = (map?.reactors || []).find((x: any) => x.id === Number(id) && !x.destroyed);
        return r ? reactorApi(r) : null;
      },
      getReactorByOid(oId: number) {
        const r = (map?.reactors || []).find((x: any) => x.oId === Number(oId));
        return r ? reactorApi(r) : null;
      },
      getReactors() { return (map?.reactors || []).map(reactorApi); },
      spawnMonsterOnGroundBelow(mobOrId: any, x: number, y: number) {
        const id = typeof mobOrId === 'object' ? (mobOrId?.getId?.() ?? mobOrId?.id) : mobOrId;
        void spawnMonsterAt(Number(id), Number(x), Number(y));
      },
      spawnMonsterOnGroundBelowById(id: number, x: number, y: number) { void spawnMonsterAt(Number(id), Number(x), Number(y)); },
      broadcastMessage(_packet: any) { /* packets are not a thing here */ },
      dropMessage(_type: number, text: string) { showMessage(text); },
      countMonsters() { return (map?.monsters || []).filter((m: any) => !m.dying && !m.dead).length; },
      countMonster(id: number) { return (map?.monsters || []).filter((m: any) => m.id === Number(id) && !m.dying && !m.dead).length; },
      getMonsterById(id: number) { return (map?.monsters || []).find((m: any) => m.id === Number(id) && !m.dying) || null; },
      getAllMonsters() { return (map?.monsters || []).slice(); },
      killAllMonsters() {
        for (const m of map?.monsters || []) {
          if (typeof m.die === 'function') m.die();
          else if (typeof m.kill === 'function') m.kill();
        }
      },
      killMonster(id: number) {
        for (const m of map?.monsters || []) {
          if (m.id !== Number(id)) continue;
          if (typeof m.die === 'function') m.die();
          else if (typeof m.kill === 'function') m.kill();
        }
      },
      getCharacters() { return [playerApi]; },
      getPlayerCount() { return 1 + ((map?.characters?.length ?? 1) - 1); },
      getPortal(_name: string) { return null; },
      getReturnMapId() { return Number(map?.wzNode?.info?.returnMap?.nValue ?? mapId()); },
      getForcedReturnId() { return Number(map?.wzNode?.info?.forcedReturn?.nValue ?? 999999999); },
      resetReactors() { for (const r of map?.reactors || []) r.reset?.(); },
      instanceMapFirstSpawn() { /* no-op */ },
      makeDisappearItemFromMap() { /* no-op */ },
      toggleDrops() { /* no-op */ },
      changeEnvironment(_name: string, _mode: number) { /* no-op */ },
    }, 'ReactorScript map');

    const playerApi: any = makeSafeScriptApi({
      getId() { return character?.id ?? 0; },
      getName() { return character?.name || 'Player'; },
      getLevel() { return character?.stats?.level ?? 1; },
      getGender() { return character?.gender || 0; },
      getHp() { return character?.hp ?? 50; },
      getMp() { return character?.mp ?? 5; },
      getMaxHp() { return character?.maxHp ?? 50; },
      getMaxMp() { return character?.maxMp ?? 5; },
      getJob() {
        const jobId = character?.stats?.jobId ?? 0;
        return { getId: () => jobId, id: jobId };
      },
      getJobId() { return character?.stats?.jobId ?? 0; },
      getMapId() { return mapId(); },
      getMap() { return mapApi; },
      getPosition() { return { x: character?.pos?.x ?? 0, y: character?.pos?.y ?? 0, getX: () => character?.pos?.x ?? 0, getY: () => character?.pos?.y ?? 0 }; },
      getEventInstance() { return eventInstance(); },
      getParty() { return null; },
      getGuild() { return null; },
      getGuildId() { return 0; },
      isGM() { return false; },
      gainExp(amount: number) { character?.addExp?.(Number(amount) || 0, true); },
      gainMeso(amount: number) { if (character?.inventory) character.inventory.mesos = Math.max(0, (character.inventory.mesos || 0) + (Number(amount) || 0)); },
      message(text: string) { showMessage(text); },
      dropMessage(_type: number, text: string) { showMessage(text); },
      yellowMessage(text: string) { showMessage(text, true); },
      changeMap(id: number, portal?: any) { warpTo(Number(id), portal); },
      getQuestStatus(questId: number) { return questManager?.getQuestState?.(questId) ?? 0; },
      haveItem(itemId: number, count?: number) { return (questManager?.getItemCount(itemId) ?? 0) >= (count ?? 1); },
      getItemQuantity(itemId: number) { return questManager?.getItemCount(itemId) ?? 0; },
    }, 'ReactorScript player');

    const rm: any = {
      getPlayer() { return playerApi; },
      getChar() { return playerApi; },
      getClient() {
        return makeSafeScriptApi({ getPlayer: () => playerApi, getChannel: () => 1, getWorld: () => 0 }, 'ReactorScript client');
      },
      getMap() { return mapApi; },
      getMapId() { return mapId(); },
      getReactor() { return reactorApi(reactor); },
      getPosition,
      getEventInstance() { return eventInstance(); },
      getEventManager(_name: string) { return null; },
      getGuild() { return null; },
      getParty() { return null; },

      // Drops
      dropItems(...args: any[]) { void spawnReactorDrops(reactor, map, parseDropArgs(args)); },
      sprayItems(...args: any[]) { void spawnReactorDrops(reactor, map, parseDropArgs(args)); },

      // Spawns. Cosmic overloads: (id), (id, qty), (id, qty, x, y),
      // (id, qty, Point). A handful of scripts call (id, x, y) — not a real
      // overload, but what they meant.
      spawnMonster(id: number, a?: any, b?: any, c?: any) {
        const pos = getPosition();
        let qty = 1;
        let x = pos.x;
        let y = pos.y;
        if (a !== undefined && b === undefined) {
          qty = Number(a) || 1;
        } else if (a !== undefined && typeof b === 'object' && b) {
          qty = Number(a) || 1;
          x = Number(b.getX?.() ?? b.x);
          y = Number(b.getY?.() ?? b.y);
        } else if (a !== undefined && b !== undefined && c === undefined) {
          x = Number(a);
          y = Number(b);
        } else if (c !== undefined) {
          qty = Number(a) || 1;
          x = Number(b);
          y = Number(c);
        }
        for (let i = 0; i < qty; i++) void spawnMonsterAt(Number(id), x, y);
      },
      spawnFakeMonster(id: number) {
        // Untargetable stand-in (Zakum's body while its arms live)
        const pos = getPosition();
        void spawnMonsterAt(Number(id), pos.x, pos.y, { fake: true });
      },
      summonBossDelayed(mobId: number, delayMs: number, x: number, y: number, bgm?: string, message?: string) {
        setTimeout(() => {
          void spawnMonsterAt(Number(mobId), Number(x), Number(y));
          if (bgm) void AudioManager.playBackgroundMusic(String(bgm));
          if (message) showMessage(String(message));
        }, Number(delayMs) || 0);
      },
      spawnNpc(npcId: number, pos?: any) {
        const p = pos && typeof pos === 'object' ? { x: Number(pos.getX?.() ?? pos.x), y: Number(pos.getY?.() ?? pos.y) } : getPosition();
        void spawnNpcAt(Number(npcId), p.x, p.y);
      },
      destroyNpc(npcId: number) {
        if (!map?.npcs) return;
        map.npcs = map.npcs.filter((n: any) => n.id !== Number(npcId));
      },
      killMonster(id: number, _withDrops?: boolean) { mapApi.killMonster(id); },
      dispelAllMonsters(_num: number, _team: number) { /* Monster Carnival only */ },
      weakenAreaBoss(_mobId: number, message?: string) {
        // Cosmic halves an area boss's HP for the Taiwan/Ariant reactors; we
        // have no script-reachable mob HP API, so the announcement alone
        if (message) showMessage(String(message));
      },
      createMapMonitor(_mapId: number, _portal: string) { /* no instance monitors */ },
      isAllReactorState(_id: number, _state: number) { return false; },

      // The reactor itself
      hitReactor() { reactor.forceAdvance?.((reactor.getState?.() ?? 0) + 1); },

      // Warps
      warp(targetMapId: number, portal?: any) { warpTo(Number(targetMapId), portal); },
      warpMap(targetMapId: number, portal?: any) { warpTo(Number(targetMapId), portal); },

      // Messages. Type 6 is the light-blue "notice" line in the original;
      // everything else reads as a system line.
      mapMessage(type: number, text: string) { showMessage(String(text), Number(type) === 6); },
      playerMessage(type: number, text: string) { showMessage(String(text), Number(type) === 6); },
      message(text: string) { showMessage(String(text)); },

      changeMusic(path: string) { void AudioManager.playBackgroundMusic(String(path)); },

      // Quests and items
      isQuestStarted(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      isQuestActive(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      isQuestCompleted(questId: number) { return questManager?.getQuestState(questId) === QuestState.COMPLETED; },
      startQuest(questId: number) { questManager?.forceStartQuest(questId); },
      completeQuest(questId: number) { questManager?.forceCompleteQuest(questId); },
      setQuestProgress(questId: number, progress: string | number, _n?: any) {
        questManager?.setQuestProgress?.(questId, String(progress));
      },
      getQuestProgress(questId: number) { return questManager?.getQuestProgress?.(questId) ?? ''; },
      haveItem(itemId: number, count?: number) { return (questManager?.getItemCount(itemId) ?? 0) >= (count ?? 1); },
      gainItem(itemId: number, count?: number) {
        const qty = count ?? 1;
        if (qty > 0) character?.inventory?.addToInventory(itemId, qty);
        else if (qty < 0) questManager?.removeItems(itemId, -qty);
      },
      giveCharacterExp(amount: number, _player?: any) { character?.addExp?.(Number(amount) || 0, true); },
      gainExp(amount: number) { character?.addExp?.(Number(amount) || 0, true); },
      canHold(_itemId: number) { return true; },
    };

    return makeSafeScriptApi(rm, 'ReactorScript rm');
  }
}
