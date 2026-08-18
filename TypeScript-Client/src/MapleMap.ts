import WZManager from "./wz-utils/WZManager";

import Background, { getBackgroundScale } from "./Background";
import config from "./Config";
import { getBossSpawns, BOSS_MOBTIME_S } from "./Constants/BossSpawns";
import Foothold from "./FootHold";
import Portal from "./Portal";
import Tile from "./Tile";
import Obj from "./Obj";
import NPC from "./NPC";
import Monster from "./Monster";

import AudioManager from "./Audio/AudioManager";
import Camera, { CameraInterface } from "./Camera"; // debugging
import Timer from "./Timer";
import type MapleCharacter from "./MapleCharacter";
import DropItemSprite from "./DropItem/DropItemSprite";
import GameCanvas from "./GameCanvas";
import UINpcTalk from './UI/UINpcTalk';
import UIQuestDialog from './UI/UIQuestDialog';
import QuestScriptEngine from './Quest/QuestScriptEngine';
import NpcScriptEngine, { stripScriptCodes } from './NpcScriptEngine';
import QuestData from './Quest/QuestData';
import Reactor from './Reactor';
import MapStateCache from './MapStateCache';
import UIMiniMap from './UI/UIMiniMap';
import UIShipClock from './UI/UIShipClock';
import ShipObject from './Transport/ShipObject';
import { _setMapleMap } from './Physics';
import { drawSkillHits, clearSkillHits } from './Effects/SkillHitEffect';
import HenesysPQ from './Events/HenesysPQ';
import PetManager from './Pet/PetManager';

export interface MapleMap {
  id: number | string;
  wzNode: any;
  isTown: boolean;
  isSwimMap: boolean;
  footholds: any;
  // Pre-flattened footholds. Physics scans every foothold per entity per
  // substep; Object.values() there allocated a fresh array each time.
  // Safe to cache: footholds is only ever assigned inside load().
  footholdList: any[];
  boundaries: any;
  backgrounds: any;
  tiles: any;
  objects: any;
  characters: any;
  portals: any;
  names: any;
  npcs: any;
  npcDialog: UINpcTalk;
  questDialog: UIQuestDialog;
  scriptEngine: QuestScriptEngine;
  npcScriptEngine: NpcScriptEngine;
  mapId: number;
  monsters: any;
  mobProjectiles: any[];
  reactors: Reactor[];
  itemDrops: any;
  // Static per-layer buckets (tiles/objects never change layer after load)
  _tilesByLayer?: any[][];
  _objectsByLayer?: any[][];
  PlayerCharacter: any;
  shipObject: any;
  doneLoading: boolean;
  changeMap: any;
  load: (id: number | string) => Promise<void>;
  addItemDrop: (itemDrop: any) => void;
  loadFootholds: (wzNode: any) => any;
  getLocationAboveFoothold: (footholdId: any) => any;
  getHorizontalFootHolds: () => any;
  getLocationAboveRandomFoothold: () => any;
  getCenterFootholdLocation: () => any;
  getNearestFootholdPosition: (x: number, y: number) => { x: number; y: number } | null;
  getFootholdBelow: (x: number, y: number) => { x: number; y: number; fh?: any } | null;
  isPositionValid: (x: number, y: number) => boolean;
  loadBoundaries: (wzNode: any, footholds: any) => any;
  getNearbyTownMapId: () => any;
  loadBackgrounds: (wzNode: any) => Promise<any>;
  loadPortals: (wzNode: any) => Promise<any>;
  loadNames: (id: number) => Promise<any>;
  loadTiles: (wzNode: any) => Promise<any>;
  loadObjects: (wzNode: any) => Promise<any>;
  loadNPCs: (wzNode: any, mapId: number | string) => Promise<any>;
  loadMonsters: (wzNode: any) => Promise<any>;
  loadReactors: (wzNode: any) => Promise<void>;
  spawnMonster: (opts: any) => Promise<void>;
  spawnNPC: (opts: any) => Promise<void>;
  setMobHostMode: (isHost: boolean) => void;
  findMonsterByOId: (oId: number) => Monster | undefined;
  getMonsterSpawnDefs: () => any[];
  releaseSuppressedMobs: () => void;
  update: (msPerTick: number) => void;
  render: (
    canvas: any,
    camera: any,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) => void;
  // New: click handling for NPCs.
  handleClick: (
    event: MouseEvent,
    canvasElement: HTMLElement,
    camera: CameraInterface
  ) => void;
  tryNpcScript: (npc: any) => Promise<void>;
  runQuestScript: (npc: any, questId: number, phase: 'start' | 'end') => Promise<void>;
  showDefaultNpcTalk: (npc: any) => Promise<void>;
}

const MapleMap = {} as MapleMap;
_setMapleMap(MapleMap);
const minLoadTimeInSeconds = 1;

MapleMap.load = async function (id: number | string) {
  // Remember what we did to the map we are leaving before any of it is torn
  // down, so coming back does not rewind it (dead mobs, smashed reactors).
  // Must run while `this.id` is still the OLD map — hence before the
  // assignment immediately below.
  MapStateCache.capture(this);

  // Adopt the new id here rather than after the loaders run: loadMonsters and
  // loadReactors ask the cache what they remember about `this.id`, and with
  // the assignment further down they were asking about the map we just left
  this.id = id;

  // Clear respawn timers from previous map
  this.clearRespawnTimers?.();

  const startTime = new Date().getTime();
  this.doneLoading = false;

  // Reset every per-frame collection BEFORE the first await — if load throws
  // midway, update()/render() must still see a consistent (empty) map rather
  // than crash-looping on undefined arrays every frame
  this.npcs = [];
  this.monsters = [];
  clearSkillHits();
  this.mobProjectiles = [];
  this.reactors = [];
  this.characters = [];
  this.backgrounds = [];
  this.tiles = [];
  this.objects = [];
  this.portals = [];
  this.itemDrops = [];
  this._tilesByLayer = Array.from({ length: 8 }, () => []);
  this._objectsByLayer = Array.from({ length: 8 }, () => []);
  this.footholds = this.footholds || {};
  this.footholdList = this.footholdList || [];
  this.boundaries = this.boundaries || { left: 0, right: 0, top: 0, bottom: 0 };

  // Free map-specific assets (Mob.wz, Map.wz, Npc.wz) from previous map
  WZManager.unloadTransient();

  let filename = "UI.wz/MapLogin.img";
  if (id !== "MapLogin") {
    const prefix = Math.floor((id as number) / 100000000);
    const strId = `${id}`.padStart(9, "0");
    filename = `Map.wz/Map/Map${prefix}/${strId}.img`;
  }
  // A map id can be valid-shaped but simply not exist (a corrupted save, a
  // script warping to a bogus id) — the fetch then rejects (or yields a node
  // with no info), and loading it used to strand the player in a black void
  // with a floating character. Fall back to Henesys instead.
  try {
    this.wzNode = await WZManager.get(filename);
  } catch (e) {
    this.wzNode = null;
  }
  if (!this.wzNode || !this.wzNode.info) {
    if (id === "MapLogin" || Number(id) === 100000000) {
      throw new Error(`Essential map ${id} missing from WZ data`);
    }
    console.error(`[MapleMap] Map ${id} does not exist — falling back to Henesys`);
    return this.load(100000000);
  }

  // Link maps carry ONLY an info node — footholds, portals, tiles and life
  // all live in the donor map named by info/link (Training Center rooms 1-4
  // link room 0; ~2,200 duplicate hunting grounds and PQ rooms work this
  // way). Without following the link the map loads as an empty void with no
  // exit. Same donor pattern mobs and reactors use; the map keeps its own id.
  const mapLink = this.wzNode.info.nGet?.("link")?.nValue;
  if (mapLink && Number(mapLink) !== Number(id)) {
    const linkStr = `${mapLink}`.padStart(9, "0");
    const linkPrefix = Math.floor(Number(mapLink) / 100000000);
    try {
      const donor: any = await WZManager.get(`Map.wz/Map/Map${linkPrefix}/${linkStr}.img`);
      if (donor?.info) {
        this.wzNode = donor;
      } else {
        console.error(`[MapleMap] Map ${id} links to missing donor ${mapLink}`);
      }
    } catch (e) {
      console.error(`[MapleMap] Failed to follow map link ${id} -> ${mapLink}:`, e);
    }
  }
  this.isTown = !!this.wzNode.info.town.nValue;
  // Swim maps (info/swim=1) switch airborne physics to water physics
  this.isSwimMap = !!this.wzNode.info.nGet("swim").nGet("nValue", 0);
  console.log(`is town: ${this.isTown}, swim: ${this.isSwimMap}`);
  console.log("Map WZ Node:", this.wzNode);

  if (!this.PlayerCharacter) {
    this.PlayerCharacter = null;
  }

  // Phase 1: Footholds + boundaries (sync, needed by NPCs/monsters)
  this.footholds = this.loadFootholds(this.wzNode.foothold);
  this.footholdList = Object.values(this.footholds);
  this.boundaries = this.loadBoundaries(this.wzNode, this.footholds);
  Camera.setBoundaries(this.boundaries);
  Camera.lookAt(this.boundaries.left, this.boundaries.top);

  // Phase 2: All independent asset loads in parallel
  const [backgrounds, tiles, objects, portals, names] = await Promise.all([
    this.loadBackgrounds(this.wzNode.back),
    this.loadTiles(this.wzNode),
    this.loadObjects(this.wzNode),
    this.loadPortals(this.wzNode.portal),
    this.loadNames(id as number),
  ]);
  this.backgrounds = backgrounds;
  this.tiles = tiles;
  this.objects = objects;
  this.portals = portals;
  this.names = names;

  // Tighten the camera's floor to the map's actually-drawn extent. The
  // synthesized boundary pads the lowest foothold by +110, but Henesys's
  // deepest tile row is a 22px edge piece — the camera could sink 88px past
  // the art into the void, a strip of bare sky-blue under the dirt (barely
  // hidden at 800x600, a full band at taller resolutions). Only ever
  // tightens, never widens, and only when tiles actually define the floor.
  if (this.tiles.length > 0) {
    let drawnBottom = -Infinity;
    for (const t of this.tiles) {
      const b = t.y - t.originY + (t.height || 0);
      if (b > drawnBottom) drawnBottom = b;
    }
    if (Number.isFinite(drawnBottom) && drawnBottom < this.boundaries.bottom) {
      // Never rise above the lowest foothold — mid-air maps (towers,
      // Ludibrium) draw tiles high while play continues below on objects
      const floor = Math.max(drawnBottom, (this.footholdList as any[]).reduce(
        (m: number, fh: any) => Math.max(m, fh.y1, fh.y2), -Infinity) + 20);
      if (floor < this.boundaries.bottom) {
        this.boundaries.bottom = floor;
        Camera.setBoundaries(this.boundaries);
      }
    }
  }

  // Bucket static geometry by layer once — render() walks layers every frame
  // and filtering the full arrays 8x per frame is wasted work
  this._tilesByLayer = Array.from({ length: 8 }, () => []);
  this._objectsByLayer = Array.from({ length: 8 }, () => []);
  for (const tile of this.tiles) {
    if (tile.layer >= 0 && tile.layer <= 7) this._tilesByLayer[tile.layer].push(tile);
  }
  for (const obj of this.objects) {
    if (obj.layer >= 0 && obj.layer <= 7) this._objectsByLayer[obj.layer].push(obj);
  }

  // Transport visuals: docked/enemy vessel (shipObj node) + departure clock
  this.shipObject = await ShipObject.fromMapNode(this.wzNode, id as number);
  UIShipClock.setFromMap(this.wzNode, id as number);

  // Phase 3: NPCs, monsters, reactors in parallel (all depend on footholds, not each other)
  await Promise.all([
    // id is passed in rather than read from this.id — that is not assigned
    // until further down, so at this point it still holds the previous map.
    this.loadNPCs(this.wzNode.life, id),
    this.loadMonsters(this.wzNode.life),
    this.loadReactors(this.wzNode.reactor),
  ]);

  // BGM can start without blocking — fire and forget
  AudioManager.playBackgroundMusic(this.wzNode.info.bgm.nValue);

  Timer.doReset();

  // Dialog/engine init in parallel (independent)
  const [npcDialog, questDialog] = await Promise.all([
    UINpcTalk.fromOpts({ isHidden: true, x: 300, y: 200 }),
    UIQuestDialog.fromOpts(),
  ]);
  this.npcDialog = npcDialog;
  this.questDialog = questDialog;
  this.scriptEngine = new QuestScriptEngine();
  this.npcScriptEngine = new NpcScriptEngine();
  this.mapId = id as number;

  const endTime = new Date().getTime();
  console.log(`MapleMap.load ${id} took ${endTime - startTime}ms`);

  // Mark done AFTER dialogs are ready — click handlers depend on them
  this.doneLoading = true;

  // Apply a mob-host assignment that arrived while the map was loading
  if ((this as any)._pendingHostMode !== undefined) {
    const pending = (this as any)._pendingHostMode;
    delete (this as any)._pendingHostMode;
    this.setMobHostMode(pending);
  }

  // Update minimap for the new map
  UIMiniMap.loadMapData();

  // Party quest lifecycle — leaving the event's map range ends the instance
  HenesysPQ.onMapChanged(Number(id));
};

MapleMap.addItemDrop = function (itemDrop) {
  this.itemDrops.push(itemDrop);
};

MapleMap.loadFootholds = function (wzNode) {
  const footholds: any = {};

  wzNode.nChildren.forEach((layer: any) => {
    layer.nChildren.forEach((group: any) => {
      group.nChildren.forEach((fhNode: any) => {
        const fh = Foothold.fromWzNode(fhNode);
        footholds[fh.id] = fh;
      });
    });
  });

  Object.values(footholds).forEach((fh: any) => {
    fh.prev = footholds[fh.prev];
    fh.next = footholds[fh.next];
  });

  return footholds;
};

MapleMap.getLocationAboveFoothold = function (footholdId: any) {
  const foothold = this.footholds[footholdId];
  if (!foothold) return null;

  const x = (foothold.x1 + foothold.x2) / 2;
  const y = foothold.y1;

  return { x, y };
};

MapleMap.getHorizontalFootHolds = function () {
  const horizontalFootholds: any[] = [];
  Object.values(this.footholds).forEach((fh: any) => {
    if (fh.y1 === fh.y2) {
      horizontalFootholds.push(fh);
    }
  });
  return horizontalFootholds;
};

MapleMap.getLocationAboveRandomFoothold = function () {
  const horizontalFootholds = this.getHorizontalFootHolds();
  const fh =
    horizontalFootholds[Math.floor(Math.random() * horizontalFootholds.length)];
  if (!fh) {
    return this.getCenterFootholdLocation();
  }

  return this.getLocationAboveFoothold(fh.id);
};

MapleMap.getCenterFootholdLocation = function () {
  const centerX = Math.floor((this.boundaries.left + this.boundaries.right) / 2);
  const horizontalFhs: any[] = Object.values(this.footholds).filter(
    (fh: any) => fh.x1 <= centerX && fh.x2 >= centerX
  );

  if (horizontalFhs.length > 0) {
    // Pick the foothold closest to center that the player can stand on
    const fh = horizontalFhs[0];
    const t = (centerX - fh.x1) / (fh.x2 - fh.x1 || 1);
    const y = fh.y1 + t * (fh.y2 - fh.y1);
    return { x: centerX, y };
  }

  // Fallback: find longest horizontal foothold (likely a main platform)
  const allFhs: any[] = Object.values(this.footholds);
  let bestFh: any = null;
  let bestLen = 0;
  for (const fh of allFhs) {
    const len = Math.abs(fh.x2 - fh.x1);
    if (len > bestLen) {
      bestLen = len;
      bestFh = fh;
    }
  }

  if (bestFh) {
    const x = (bestFh.x1 + bestFh.x2) / 2;
    const t = (x - bestFh.x1) / (bestFh.x2 - bestFh.x1 || 1);
    const y = bestFh.y1 + t * (bestFh.y2 - bestFh.y1);
    return { x, y };
  }

  return { x: centerX, y: (this.boundaries.top + this.boundaries.bottom) / 2 };
};

// Find the nearest valid position on a foothold to the given point
MapleMap.getNearestFootholdPosition = function (x: number, y: number) {
  const allFhs: any[] = Object.values(this.footholds || {});
  if (allFhs.length === 0) return null;

  let bestX = 0, bestY = 0;
  let bestDist = Infinity;

  for (const fh of allFhs) {
    // Skip walls and ceilings
    if (fh.x1 === fh.x2 || fh.x1 > fh.x2) continue;

    // Clamp x to the foothold's horizontal range
    const clampedX = Math.max(fh.x1, Math.min(fh.x2, x));
    // Interpolate y on the foothold at that x
    const t = (fh.x2 - fh.x1) === 0 ? 0 : (clampedX - fh.x1) / (fh.x2 - fh.x1);
    const fhY = fh.y1 + t * (fh.y2 - fh.y1);

    const dx = clampedX - x;
    const dy = fhY - y;
    const dist = dx * dx + dy * dy;

    if (dist < bestDist) {
      bestDist = dist;
      bestX = clampedX;
      bestY = fhY;
    }
  }

  return bestDist < Infinity ? { x: bestX, y: bestY } : null;
};

// The ground directly under a point: the highest foothold that spans x at or
// below y (a little slack above catches a point resting a pixel under its own
// platform). Unlike getNearestFootholdPosition this never picks a platform off
// to the side or overhead — it answers "where would something dropped here land".
MapleMap.getFootholdBelow = function (x: number, y: number) {
  const SLACK_ABOVE = 20;
  let best: any = null;
  let bestY = Infinity;
  for (const fh of Object.values(this.footholds || {}) as any[]) {
    if (fh.x1 >= fh.x2) continue; // walls and ceilings
    if (x < fh.x1 || x > fh.x2) continue;
    const t = (x - fh.x1) / (fh.x2 - fh.x1);
    const fhY = fh.y1 + t * (fh.y2 - fh.y1);
    if (fhY >= y - SLACK_ABOVE && fhY < bestY) {
      bestY = fhY;
      best = fh;
    }
  }
  return best ? { x, y: bestY, fh: best } : null;
};

// Check if a position is within the map boundaries (with margin)
MapleMap.isPositionValid = function (x: number, y: number) {
  if (!this.boundaries) return true;
  const margin = 200; // extra tolerance beyond boundaries
  return (
    x >= this.boundaries.left - margin &&
    x <= this.boundaries.right + margin &&
    y >= this.boundaries.top - margin &&
    y <= this.boundaries.bottom + margin
  );
};

MapleMap.loadBackgrounds = async function (wzNode) {
  const backgrounds = [];

  for (const backNode of wzNode.nChildren) {
    if (!backNode.bS.nValue) {
      continue;
    }
    const bg = await Background.fromWzNode(backNode);
    backgrounds.push(bg);
  }

  backgrounds.sort((a, b) => a.z - b.z);

  return backgrounds;
};

MapleMap.loadPortals = async function (wzNode) {
  const portals = [];

  for (const portalNode of wzNode.nChildren) {
    const portal = await Portal.fromWzNode(portalNode);
    portals.push(portal);
  }

  return portals;
};

MapleMap.loadNames = async function (id: number) {
  const strMap: any = await WZManager.get("String.wz/Map.img");

  const firstDigit = Math.floor(id / 100000000);
  const firstTwoDigits = Math.floor(id / 10000000);
  const firstThreeDigits = Math.floor(id / 1000000);

  let area = "maple";
  if (firstTwoDigits === 54) {
    area = "singapore";
  } else if (firstDigit === 9) {
    area = "etc";
  } else if (firstDigit === 8) {
    area = "jp";
  } else if (firstThreeDigits === 682) {
    area = "HalloweenGL";
  } else if (firstTwoDigits === 60 || firstTwoDigits === 61) {
    area = "MasteriaGL";
  } else if (firstTwoDigits === 67 || firstTwoDigits === 68) {
    area = "weddingGL";
  } else if (firstDigit === 2) {
    area = "ossyria";
  } else if (firstDigit === 1) {
    area = "victoria";
  }

  const nameNode: any = strMap.nGet(area).nGet(id);
  const streetName = nameNode.nGet("streetName").nGet("nValue", "");
  const mapName = nameNode.nGet("mapName").nGet("nValue", "");

  return {
    streetName,
    mapName,
  };
};

MapleMap.loadTiles = async function (wzNode) {
  const tiles = [];
  for (let layer = 0; layer <= 7; layer += 1) {
    for (const tileNode of wzNode[layer].tile.nChildren) {
      const tile = await Tile.fromWzNode(tileNode);
      tile.layer = layer;
      tiles.push(tile);
    }
  }

  tiles.sort((a, b) => a.z - b.z);

  return tiles;
};

MapleMap.loadObjects = async function (wzNode) {
  const objects = [];

  for (let layer = 0; layer <= 7; layer += 1) {
    for (const objNode of wzNode[layer].obj.nChildren) {
      const obj = await Obj.fromWzNode(objNode);
      obj.layer = layer;
      objects.push(obj);
    }
  }

  objects.sort((a, b) => (a.z === b.z ? a.zid - b.zid : a.z - b.z));

  return objects;
};

let footholds: any = [];
async function initializeMonster(opts: any) {
  const mob = await Monster.fromOpts(opts);
  const whichFoothold = footholds[mob.fh];
  if (whichFoothold) {
    mob.layer = whichFoothold.layer;
    if (mob.moveType === "fly") {
      // Flying mobs hover at their spawn cy — no foothold attach
      mob.pos.fh = null;
    } else {
      // Place mob on its foothold so it doesn't fall from the air
      mob.pos.fh = whichFoothold;
      mob.pos.vy = 0;
    }
  }
  return mob;
}

MapleMap.spawnMonster = async function (opts: any = {}) {
  const mob = await initializeMonster(opts);
  // Set remote mode based on current host status
  const isMobHost = (window as any).__mySocket?.isMobHost ?? true;
  if (!isMobHost) {
    mob.isRemote = true;
    mob._targetX = mob.pos.x;
    mob._targetY = mob.pos.y;
  }
  // GMS fade-in effect for respawning mobs (effect -2)
  if (opts.fadeIn) {
    mob._spawnAlpha = 0;
    mob._spawning = true;
  }
  this.monsters.push(mob);
};

// HPQ moon-full: wake every parked spawn def at once (fade-in like respawns)
MapleMap.releaseSuppressedMobs = function () {
  for (const def of monsterSpawnDefs) {
    if (def.alive || def.nextPossibleSpawn !== Number.POSITIVE_INFINITY) continue;
    def.alive = true;
    def.nextPossibleSpawn = 0;
    void this.spawnMonster({ ...def, fadeIn: true });
  }
};

MapleMap.setMobHostMode = function (isHost: boolean) {
  // Host assignment can arrive while the map is still loading — remember it
  // and apply when the monsters exist (late-spawned mobs also read
  // __mySocket.isMobHost at spawn time)
  if (!Array.isArray(this.monsters)) {
    (this as any)._pendingHostMode = isHost;
    return;
  }
  for (const mob of this.monsters) {
    mob.isRemote = !isHost;
    if (mob.isRemote) {
      mob._targetX = mob.pos.x;
      mob._targetY = mob.pos.y;
    }
  }
};

MapleMap.findMonsterByOId = function (oId: number): Monster | undefined {
  return this.monsters.find((m: Monster) => m.oId === oId);
};

MapleMap.getMonsterSpawnDefs = function () {
  return monsterSpawnDefs;
};

// Store original spawn definitions for respawning.
// Cosmic-style respawn: a 10s tick refills the map up to a player-scaled
// capacity, instead of one flat timer per killed mob.
let monsterSpawnDefs: any[] = [];
const RESPAWN_TICK_MS = 10000;
const MOB_INTERVAL_MS = 5000; // earliest respawn for mobTime=0 defs
let respawnAccumulator = 0;

MapleMap.clearRespawnTimers = function () {
  monsterSpawnDefs = [];
  respawnAccumulator = 0;
  reactorSpawnDefs = [];
};

let currentMonsters: Monster[] = [];
MapleMap.loadMonsters = async function (wzNode) {
  footholds = this.footholds;
  monsterSpawnDefs = [];

  const rawSpawns: any[] = wzNode.nChildren
    .filter((n: any) => n.type.nValue === "m")
    .map((mobNode: any) => ({
      id: mobNode.id.nValue,
      x: mobNode.x.nValue,
      // Use cy (foothold Y) so the mob spawns on ground, not mid-air
      y: mobNode.cy?.nValue ?? mobNode.y.nValue,
      fh: mobNode.fh.nValue,
      minX: mobNode.rx0.nValue,
      maxX: mobNode.rx1.nValue,
      // Respawn time in seconds (-1 = no respawn, 0 = default)
      mobTime: mobNode.mobTime?.nValue ?? mobNode.nGet('mobTime').nGet('nValue', 0),
    }));

  // Area bosses GMS spawned server-side have no life node to read. Appending
  // them after the map's own spawns keeps oIds identical on every client, which
  // is what mob-state sync and respawn broadcasts key off.
  for (const boss of getBossSpawns(Number(this.id))) {
    rawSpawns.push({
      id: boss.id,
      x: boss.x,
      y: boss.cy,
      fh: boss.fh,
      minX: boss.rx0,
      maxX: boss.rx1,
      mobTime: boss.mobTime,
    });
  }

  let spawnIndex = 0;
  for (const raw of rawSpawns) {
    const spawnDef = {
      oId: spawnIndex++,
      ...raw,
      stance: "",
      map: this,
      alive: true,
      nextPossibleSpawn: 0,
    };
    monsterSpawnDefs.push(spawnDef);

    // HPQ: the hill's monsters stay hidden until the moon is full — defs are
    // parked with an infinite respawn deadline and released all at once by
    // releaseSuppressedMobs() when the Moon Bunny appears
    if (HenesysPQ.shouldSuppressMobs(Number(this.id))) {
      spawnDef.alive = false;
      spawnDef.nextPossibleSpawn = Number.POSITIVE_INFINITY;
      continue;
    }

    // Re-entering a map we have been on: a mob still inside its respawn
    // window stays down, and a survivor comes back hurt and where we left it
    // rather than healed at its spawn point.
    // Solo-play continuity ONLY: under multiplayer the current host's roster
    // is the truth, and resuming from stale local memory is exactly what
    // spawned frozen mid-air "ghost" mobs for non-host players. When we are
    // not (yet) the host, mobs spawn fresh and the host's batches take over.
    const sock: any = (window as any).__mySocket;
    const useRemembered = !sock?.isConnected || !!sock?.isMobHost;
    const remembered = useRemembered
      ? MapStateCache.getMonsterState(Number(this.id), spawnDef.oId)
      : null;
    if (remembered && !remembered.alive) {
      spawnDef.alive = false;
      spawnDef.nextPossibleSpawn = remembered.nextPossibleSpawn;
      continue;
    }
    if (remembered) {
      spawnDef.x = remembered.x;
      spawnDef.y = remembered.y;
    }
    await this.spawnMonster(spawnDef);
    if (remembered && remembered.hp > 0) {
      const mob = this.findMonsterByOId(spawnDef.oId);
      if (mob) mob.hp = remembered.hp;
    }
  }
  currentMonsters = this.monsters;
};

// --- Reactor loading ---
let reactorSpawnDefs: any[] = [];

MapleMap.loadReactors = async function (wzNode) {
  reactorSpawnDefs = [];
  if (!wzNode?.nChildren) return;

  for (const rNode of wzNode.nChildren) {
    const id = parseInt(rNode.nGet?.('id')?.nValue || '0');
    if (!id) continue;
    const x = rNode.nGet?.('x')?.nValue || 0;
    const y = rNode.nGet?.('y')?.nValue || 0;
    const reactorTime = rNode.nGet?.('reactorTime')?.nValue || 0;
    const f = rNode.nGet?.('f')?.nValue || 0;

    const spawnDef = { id, x, y, reactorTime, f, map: this, oId: reactorSpawnDefs.length };
    reactorSpawnDefs.push(spawnDef);

    try {
      const reactor = await Reactor.fromOpts(spawnDef);
      // Render within the ground foothold's layer, like mobs do. Reactor
      // layer defaulted to 0, so Amherst's quest boxes — which stand among
      // layer-1 bushes — were painted a whole layer earlier and hidden
      // behind the scenery. Within the right layer, drawLayer already puts
      // reactors after objects, which is what puts the box in front.
      let bestLayer: number | null = null;
      let bestDist = Infinity;
      for (const fh of this.footholdList) {
        const lo = Math.min(fh.x1, fh.x2);
        const hi = Math.max(fh.x1, fh.x2);
        if (x < lo || x > hi) continue;
        const t = (x - fh.x1) / (fh.x2 - fh.x1 || 1);
        const fy = fh.y1 + t * (fh.y2 - fh.y1);
        const d = Math.abs(fy - y);
        if (d < bestDist) {
          bestDist = d;
          bestLayer = fh.layer;
        }
      }
      if (bestLayer !== null) reactor.layer = bestLayer;

      // A reactor we smashed stays smashed until its own timer is up. Without
      // this, the boat cabin's box (reactorTime 3600) could be farmed as fast
      // as you could walk out the door and back in
      const remembered = MapStateCache.getReactorState(Number(this.id), reactor.oId);
      if (remembered) reactor.restoreDestroyed(remembered.respawnAt);

      this.reactors.push(reactor);
    } catch (e) {
      console.warn(`[MapleMap] Failed to load reactor ${id}:`, e);
    }
  }

  console.log(`[MapleMap] Loaded ${this.reactors.length} reactors`);
};

// --- Modified NPC spawning to include position and dialogue support ---
MapleMap.spawnNPC = async function (opts = {}) {
  // Add a reference to the map in the NPC options
  opts.map = this;
  
  const npc = await NPC.fromOpts(opts);
  // Position already set in NPC.load() method now
  
  const whichFoothold = this.footholds[npc.fh];
  if (whichFoothold) {
    npc.layer = whichFoothold.layer;
  }
  console.log(
    `Spawned NPC ${opts.id} at (${npc.pos.x}, ${npc.pos.y})`
  );
  
  this.npcs.push(npc);
};

MapleMap.changeMap = async function (newMapId: number) {
  console.log(`Changing map to ${newMapId}`);
  
  // Optionally, clear current map state
  this.npcs = [];
  this.monsters = [];
  this.mobProjectiles = [];
  this.reactors = [];
  this.characters = [];
  this.itemDrops = [];
  
  // (Optionally stop background music, reset timers, etc.)
  // For example:
  // AudioManager.stopBackgroundMusic();

  // Load the new map data
  await this.load(newMapId);
  
  // Update camera boundaries based on the new map's boundaries
  Camera.setBoundaries(this.boundaries);
  
  // Optionally, reposition the camera or update any UI elements as needed
  console.log(`Map changed to ${newMapId}`);
};

/** Map id -> extra NPCs, loaded once from /data/custom-npcs.json. */
let customNpcCache: Record<string, any[]> | null = null;
async function getCustomNpcs(mapId: string | number): Promise<any[]> {
  if (!customNpcCache) {
    try {
      const { cachedFetch } = await import('./AssetDownloader');
      const resp = await cachedFetch("/data/custom-npcs.json");
      const data = await resp.json();
      customNpcCache = {};
      for (const [id, list] of Object.entries(data)) {
        if (Array.isArray(list)) customNpcCache[id] = list;
      }
    } catch (e) {
      console.warn("[MapleMap] no custom NPC data:", e);
      customNpcCache = {};
    }
  }
  return customNpcCache[String(mapId)] || [];
}

MapleMap.loadNPCs = async function (wzNode, mapId) {
  for (const npcNode of wzNode.nChildren.filter(
    (n: any) => n.type.nValue === "n"
  )) {
    await this.spawnNPC({
      oId: null,
      id: npcNode.id.nValue,
      x: npcNode.x.nValue,
      cy: npcNode.cy.nValue,
      f: npcNode.nGet("f").nGet("nValue", 0),
      fh: npcNode.fh.nValue,
      hide: npcNode.nGet("hide").nGet("nValue", 0),
      map: this
    });
  }

  // NPCs this project adds on top of Map.wz. They spawn through the same path
  // as the WZ ones, so clicking, shops and dialogue all behave identically —
  // the only difference is where the placement came from.
  for (const extra of await getCustomNpcs(mapId)) {
    try {
      await this.spawnNPC({
        oId: null,
        id: extra.id,
        x: extra.x,
        cy: extra.cy,
        f: extra.f ?? 0,
        fh: extra.fh,
        hide: extra.hide ?? 0,
        map: this,
      });
    } catch (e) {
      console.warn(`[MapleMap] custom NPC ${extra.id} failed to spawn:`, e);
    }
  }
};

MapleMap.loadBoundaries = function (wzNode, footholds) {
  if ("VRLeft" in wzNode.info) {
    return {
      left: wzNode.info.VRLeft.nValue,
      right: wzNode.info.VRRight.nValue,
      top: wzNode.info.VRTop.nValue,
      bottom: wzNode.info.VRBottom.nValue,
    };
  }

  const xValues: any = Object.values(footholds).reduce((acc: any, fh: any) => {
    acc.push(fh.x1, fh.x2);
    return acc;
  }, []);

  const yValues: any = Object.values(footholds).reduce((acc: any, fh: any) => {
    acc.push(fh.y1, fh.y2);
    return acc;
  }, []);

  return {
    left: Math.min(...xValues) + 10,
    right: Math.max(...xValues) - 10,
    top: Math.min(...yValues) - 360,
    bottom: Math.max(...yValues) + 110,
  };
};

MapleMap.getNearbyTownMapId = function () {
  if (this.isTown) {
    return this.id;
  }
  console.log(this.wzNode);
  return this.wzNode.info.returnMap.nValue;
};

MapleMap.update = function (msPerTick) {
  if (!this.doneLoading) {
    return;
  }

  // Remove destroyed monsters and mark their spawn defs for the respawn tick
  const mapRef = this;
  const isMobHost = (window as any).__mySocket?.isMobHost ?? true;
  const now = Date.now();
  for (const mob of this.monsters) {
    if (mob.destroyed && !mob.respawnScheduled) {
      mob.respawnScheduled = true;
      const spawnDef = monsterSpawnDefs.find((s: any) => s.oId === mob.oId);
      if (!spawnDef) continue;
      spawnDef.alive = false;
      spawnDef.nextPossibleSpawn =
        spawnDef.mobTime > 0
          ? now + spawnDef.mobTime * 1000
          : spawnDef.mobTime < 0
            ? Infinity // mobTime -1 = never respawns
            : now + MOB_INTERVAL_MS;
    }
  }
  this.monsters = this.monsters.filter((m: Monster) => !m.destroyed);

  // Cosmic-style respawn tick (host only): every 10s refill the map up to a
  // capacity that scales 70-100% with player count
  respawnAccumulator += msPerTick;
  if (respawnAccumulator >= RESPAWN_TICK_MS) {
    respawnAccumulator = 0;

    // Boss spawn points come back strictly on their own deadline. They must not
    // go through the capacity refill below: a map sitting at its ~75% cap (the
    // normal state, snails respawn in seconds) leaves no slot, so a boss would
    // wait out its 20 minutes and then queue behind the population forever.
    if (isMobHost) {
      for (const def of monsterSpawnDefs) {
        if (def.alive || def.mobTime < BOSS_MOBTIME_S) continue;
        if (def.nextPossibleSpawn > now) continue;
        def.alive = true;
        (async () => {
          if (mapRef.mapId === def.map?.mapId) {
            await mapRef.spawnMonster({ ...def, fadeIn: true });
            try { (window as any).__mySocket?.sendMobRespawn(def.oId); } catch {}
          }
        })();
      }
    }

    if (isMobHost && monsterSpawnDefs.length > 0) {
      const players = 1 + (this.characters?.length || 0);
      const capacity = Math.ceil(
        (0.70 + 0.05 * Math.min(6, players)) * monsterSpawnDefs.length
      );
      const aliveCount = monsterSpawnDefs.filter((s: any) => s.alive).length;
      let toSpawn = capacity - aliveCount;
      if (toSpawn > 0) {
        const eligible = monsterSpawnDefs
          .filter((s: any) => !s.alive && s.nextPossibleSpawn <= now)
          .sort(() => Math.random() - 0.5);
        for (const def of eligible) {
          if (toSpawn <= 0) break;
          toSpawn--;
          def.alive = true;
          (async () => {
            if (mapRef.mapId === def.map?.mapId) {
              await mapRef.spawnMonster({ ...def, fadeIn: true });
              try { (window as any).__mySocket?.sendMobRespawn(def.oId); } catch {}
            }
          })();
        }
      }
    }
  }

  // Mob attack projectiles
  this.mobProjectiles = (this.mobProjectiles || []).filter((p: any) => !p.destroyed);
  this.mobProjectiles.forEach((p: any) => p.update(msPerTick));

  // Reactor respawn — driven by the deadline stamped at the break, not by a
  // setTimeout. The timer version had two ways to never fire: it was armed
  // only for the mob host (a non-host set respawnScheduled and then waited
  // forever for a broadcast), and every timer was cleared on map change, so
  // walking out re-armed nothing. Both were hidden while re-entering a map
  // rebuilt its reactors from scratch; once state persisted, "broken" became
  // permanent. Comparing wall-clock deadlines needs neither timer nor host,
  // and every client reaches the same conclusion on its own.
  {
    const now = Date.now();
    for (const reactor of this.reactors) {
      if (!reactor.destroyed || !reactor.respawnAt || now < reactor.respawnAt) continue;
      reactor.reset();
      // The host still announces it, so a client that missed the break (and
      // therefore has no deadline of its own) is brought back in sync
      if (isMobHost) {
        try { (window as any).__mySocket?.sendReactorRespawn(reactor.oId); } catch {}
      }
    }
  }

  this.backgrounds.forEach((bg: Background) => bg.update(msPerTick));
  this.shipObject?.update(msPerTick);
  this.objects.forEach((obj: Obj) => obj.update(msPerTick));
  this.npcs.forEach((npc: NPC) => npc.update(msPerTick));
  this.monsters.forEach((mob: Monster) => mob.update(msPerTick));
  this.reactors.forEach((r: Reactor) => r.update(msPerTick));
  this.characters.forEach((chr: MapleCharacter) => {
    try { chr.update(msPerTick); } catch (e) {
      console.error('[MapleMap] Character update crash:', e);
      document.title = `CRASH: ${(e as any)?.message || e}`;
    }
  });
  // Pets tick after their owners moved this frame (local train + remote)
  try { PetManager.update(msPerTick); } catch (e) {
    console.error('[MapleMap] Pet update crash:', e);
  }

  this.portals.forEach((p: Portal) => p.update(msPerTick));

  this.itemDrops = this.itemDrops.filter(
    (drop: DropItemSprite) => !drop.destroyed
  );
  this.itemDrops.forEach((drop: DropItemSprite) => {
    drop.update(msPerTick);
  });
};

// Collision debug overlay, toggled with F10 (F9 is DebugDrag): draws every
// foothold line, the player's touch-damage hitbox, and the position anchor —
// the point whose crossing of a foothold's end is what makes you fall.
let debugCollision = false;
window.addEventListener('keydown', (e) => {
  if (e.key === 'F10') {
    debugCollision = !debugCollision;
    console.log(`[Collision] overlay ${debugCollision ? 'ENABLED' : 'disabled'} — green: footholds, red: touch hitbox, yellow: position anchor`);
  }
});

// Reusable per-layer buckets for dynamic entities. drawLayer runs up to 8
// times a frame, and filtering four collections inside it meant 32 throwaway
// arrays plus 8 full scans of each collection every single frame. These are
// cleared and refilled once per frame instead. Slot 8 collects entities whose
// layer falls outside 0..7 (drawn last, as before).
const OUTSIDE_LAYER = 8;
const makeLayerBuckets = () =>
  Array.from({ length: OUTSIDE_LAYER + 1 }, () => [] as any[]);
const _monsterLayers = makeLayerBuckets();
const _reactorLayers = makeLayerBuckets();
const _characterLayers = makeLayerBuckets();
const _npcLayers = makeLayerBuckets();
const _backLayers = [[] as any[], [] as any[]]; // [behind, front]

// Offscreen compositor for the scaled background pass. Tiles used to be drawn
// straight onto the scaled main context; with smoothing on, every drawImage
// feathers its own edges against transparency, painting a hairline seam at
// each tile boundary (the vertical "cut lines" in the sky at 1280x720).
// Composing the layer 1:1 here and blitting it in ONE scaled draw leaves no
// interior edges to feather.
let _bgCompose: HTMLCanvasElement | null = null;
let _bgComposeCtx: CanvasRenderingContext2D | null = null;

function bucketByLayer(list: any[], buckets: any[][]) {
  for (const b of buckets) b.length = 0;
  for (const o of list) {
    const l = o?.layer;
    // Non-integer layers previously matched neither `layer === i` nor the
    // notInAnyLayer check and were silently never drawn — bucket them here
    buckets[Number.isInteger(l) && l >= 0 && l <= 7 ? l : OUTSIDE_LAYER].push(o);
  }
  return buckets;
}

MapleMap.render = function (
  canvas: GameCanvas,
  camera: CameraInterface,
  lag: number,
  msPerTick: number,
  tdelta: number
) {
  if (!this.doneLoading) {
    return;
  }

  currentMonsters = currentMonsters.filter((m) => !m.destroyed);

  bucketByLayer(this.monsters, _monsterLayers);
  bucketByLayer(this.reactors as any[], _reactorLayers);
  bucketByLayer(this.characters, _characterLayers);
  bucketByLayer(this.npcs, _npcLayers);
  _backLayers[0].length = 0;
  _backLayers[1].length = 0;
  for (const bg of this.backgrounds) _backLayers[bg.front ? 1 : 0].push(bg);
  // One entity's draw error must not abort the frame — everything drawn
  // after it (mobs, portals, HUD) would silently vanish
  const draw = (obj: any) => {
    try {
      obj.draw(canvas, camera, lag, msPerTick, tdelta);
    } catch (e) {
      // Re-log at most every 5s rather than once ever: an entity that throws
      // every frame is invisible for the whole session, and a single line
      // that scrolled past is indistinguishable from "no problem"
      const now = Date.now();
      if (!obj._drawErrorAt || now - obj._drawErrorAt > 5000) {
        obj._drawErrorAt = now;
        console.error(
          `[MapleMap] draw failed for ${obj?.constructor?.name ?? 'entity'}` +
            `${obj === MapleMap.PlayerCharacter ? ' (PLAYER — this is why your character is invisible)' : ''}` +
            `${obj?.name ? ` name=${obj.name}` : ''}` +
            `${obj?.stance ? ` stance=${obj.stance} frame=${obj.frame}` : ''}:`,
          e
        );
      }
    }
  };

  // Backgrounds are composed for the authored 800x600 frame and scaled up to
  // cover a bigger viewport (see getBackgroundScale). Smoothing is off globally
  // to keep sprites crisp, but an upscaled panorama needs it — nearest-neighbour
  // turns the sky gradient into steps. The layer is composed 1:1 on an
  // offscreen canvas and blitted in one smoothed draw (see _bgCompose).
  const drawBackgroundLayer = (layer: any[]) => {
    if (layer.length === 0) return;
    const scale = getBackgroundScale();
    if (scale === 1) {
      layer.forEach(draw);
      return;
    }
    const w = Math.ceil(config.width / scale);
    const h = Math.ceil(config.height / scale);
    if (!_bgCompose || _bgCompose.width !== w || _bgCompose.height !== h) {
      _bgCompose = document.createElement("canvas");
      _bgCompose.width = w;
      _bgCompose.height = h;
      _bgComposeCtx = _bgCompose.getContext("2d");
    }
    const octx = _bgComposeCtx;
    if (!octx) return;
    octx.clearRect(0, 0, w, h);
    // Redirect the entity draw path into the compositor — Background.draw
    // renders through canvas.drawImage, which reads canvas.context.
    const mainCtx = canvas.context;
    canvas.context = octx;
    try {
      layer.forEach(draw);
    } finally {
      canvas.context = mainCtx;
    }
    mainCtx.save();
    mainCtx.imageSmoothingEnabled = true;
    mainCtx.drawImage(_bgCompose, 0, 0, w, h, 0, 0, w * scale, h * scale);
    mainCtx.restore();
  };

  drawBackgroundLayer(_backLayers[0]);

  // Docked/enemy vessel sits on the water behind every gameplay layer
  if (this.shipObject) {
    try { this.shipObject.draw(canvas, camera); } catch (e) {
      if (!this.shipObject._drawErrorLogged) {
        this.shipObject._drawErrorLogged = true;
        console.error('[MapleMap] shipObj draw failed:', e);
      }
    }
  }

  // Draw character effects (level-up, quest clear, quest start, EXP gain)
  const drawEffect = (c: MapleCharacter, frames: any, frameIndex: number) => {
    const frame = frames?.[frameIndex];
    if (!frame || !frame.nGetImage) return;
    const img = frame.nGetImage();
    if (!img || (img instanceof HTMLImageElement && !img.complete)) return;
    const ox = frame.origin?.nX ?? 0;
    const oy = frame.origin?.nY ?? 0;
    canvas.drawImage({
      img,
      dx: c.pos.x - ox - camera.x,
      dy: c.pos.y - oy - camera.y,
    });
  };

  const drawLevelUp = (c: MapleCharacter) => {
    drawEffect(c, c.levelUpFrames, c.levelUpFrame);
  };

  const drawPlayerEffects = (pc: any) => {
    if (pc.levelingUp) drawLevelUp(pc);
    if (pc.questClearActive) drawEffect(pc, pc.questClearFrames, pc.questClearFrame);
    if (pc.jobChangedActive) drawEffect(pc, pc.jobChangedFrames, pc.jobChangedFrame);
    if (pc.questStartActive) drawEffect(pc, pc.questStartFrames, pc.questStartFrame);
    if (pc.cardGetActive) drawEffect(pc, pc.cardGetFrames, pc.cardGetFrame);
    if (pc.incExpActive) drawEffect(pc, pc.incExpFrames, pc.incExpFrame);
    if (pc.skillEffectActive) drawEffect(pc, pc.skillEffectFrames, pc.skillEffectFrame);
    if (pc.afterimage?.active) pc.afterimage.draw(canvas, camera);
  };

  drawSkillHits(canvas, camera);

  // Player's layer from current or last foothold (persists through jumps/climbs)
  if (this.PlayerCharacter?.pos?.fh != null) {
    this._lastPlayerLayer = this.PlayerCharacter.pos.fh.layer;
  }
  const playerLayer = this._lastPlayerLayer ?? 0;
  const isClimbing = this.PlayerCharacter?.pos?.isClimbing === true;

  const drawLayer = (i: number) => {
    const inCurrentLayer = (obj: Obj) => obj.layer === i;
    (this._objectsByLayer?.[i] ?? this.objects.filter(inCurrentLayer)).forEach(draw);
    (this._tilesByLayer?.[i] ?? this.tiles.filter(inCurrentLayer)).forEach(draw);
    _monsterLayers[i].forEach(draw);
    _reactorLayers[i].forEach(draw);
    _characterLayers[i].forEach(draw);
    _npcLayers[i].forEach(draw);
  };

  // v83 draws following pets behind their owner; pets hanging on a climbing
  // owner's back draw AFTER the player instead, so the back-facing hang
  // sprite rides visibly in front (GMS look) — drawn behind, the player
  // sprite covered small pets completely
  const drawPets = (hover?: boolean) => {
    try { PetManager.drawPets(canvas, camera, hover); } catch (e) {
      console.error('[MapleMap] Pet draw crash:', e);
    }
  };

  if (isClimbing) {
    // Climbing: draw ALL layers, then player on top (player in front of rope/chain)
    for (let i = 0; i <= 7; i++) drawLayer(i);

    drawPets(false);
    if (this.PlayerCharacter) {
      draw(this.PlayerCharacter);
      drawPlayerEffects(this.PlayerCharacter);
    }
    drawPets(true);
  } else {
    // Normal/jumping: draw up to player's layer, then player, then higher layers
    for (let i = 0; i <= playerLayer; i++) drawLayer(i);

    drawPets(false);
    if (this.PlayerCharacter) {
      draw(this.PlayerCharacter);
      drawPlayerEffects(this.PlayerCharacter);
    }
    // Remote climbers' hanging pets ride in front of their owner too
    drawPets(true);

    for (let i = playerLayer + 1; i <= 7; i++) drawLayer(i);
  }

  _monsterLayers[OUTSIDE_LAYER].forEach(draw);
  _reactorLayers[OUTSIDE_LAYER].forEach(draw);
  _characterLayers[OUTSIDE_LAYER].forEach(draw);
  _npcLayers[OUTSIDE_LAYER].forEach(draw);

  (this.mobProjectiles || []).forEach((p: any) => p.draw(canvas, camera));

  this.characters
    .filter((c: MapleCharacter) => !!c.levelingUp)
    .forEach(drawLevelUp);

  this.portals.forEach(draw);
  drawBackgroundLayer(_backLayers[1]);

  this.itemDrops.forEach((drop: DropItemSprite) => {
    drop.draw(canvas, camera);
  });

  // NPC overhead UI — chat balloons and quest notices — above every map
  // layer and front background, so a clerk behind a shop sign still talks
  // over it like the original client
  for (const npc of this.npcs) {
    try {
      npc.drawOverlays(canvas, camera);
    } catch (e) {
      if (!(npc as any)._overlayErrorLogged) {
        (npc as any)._overlayErrorLogged = true;
        console.error('[MapleMap] NPC overlay draw failed:', e);
      }
    }
  }

  // Pet name tags + chat balloons — same above-everything treatment
  try { PetManager.drawOverlays(canvas, camera); } catch (e) {
    console.error('[MapleMap] Pet overlay draw failed:', e);
  }

  // Station departure clock (world-space) / timed-ride countdown
  UIShipClock.draw(canvas, camera);

  // v83 shows black beyond the map's VR bounds. On maps narrower than the
  // viewport (only possible at widescreen resolutions — the camera centres
  // them, see Camera.lookAt) the tile stack otherwise ends mid-screen with
  // the parallax sky running on behind the torn-off edge. Only the sides are
  // masked: short maps are bottom-anchored and their top gap is legitimately
  // covered by the scaled background, which many maps rely on for their sky.
  {
    const b = camera.boundaries;
    if (b) {
      const ctx = canvas.context;
      const leftGap = Math.round(b.left - camera.x);
      const rightEdge = Math.round(b.right - camera.x);
      if (leftGap > 0 || rightEdge < config.width) {
        ctx.fillStyle = "#000000";
        if (leftGap > 0) ctx.fillRect(0, 0, leftGap, config.height);
        if (rightEdge < config.width) {
          ctx.fillRect(rightEdge, 0, config.width - rightEdge, config.height);
        }
      }
    }
  }

  // F10 collision overlay — on top of everything so lines stay visible
  if (debugCollision) {
    for (const fh of this.footholdList || []) {
      canvas.drawLine({
        x1: fh.x1 - camera.x, y1: fh.y1 - camera.y,
        x2: fh.x2 - camera.x, y2: fh.y2 - camera.y,
        color: '#00FF00', width: 1,
      });
    }
    const pc = this.PlayerCharacter;
    const box = pc?.getTouchBox?.();
    if (box) {
      const ctx = canvas.context;
      ctx.save();
      // Touch-damage hitbox
      ctx.strokeStyle = '#FF3333';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.round(box.x - camera.x) + 0.5,
        Math.round(box.y - camera.y) + 0.5,
        box.width,
        box.height
      );
      // Position anchor — a crosshair whose arms END exactly at pos, so it
      // cannot visually overshoot the foothold line the way a centred dot did
      ctx.fillStyle = '#FFEE00';
      const ax = Math.round(pc.pos.x - camera.x);
      const ay = Math.round(pc.pos.y - camera.y);
      ctx.fillRect(ax - 4, ay, 9, 1);
      ctx.fillRect(ax, ay - 4, 1, 5);
      ctx.restore();
    }
  }
};

// --- New: Simple click handler for NPCs ---
// When a click occurs, convert mouse coordinates into canvas coordinates,
// check each NPC, and if clicked, log the NPC and set its dialogue flag.
let _clickHandling = false;
MapleMap.handleClick = async function (
  event: MouseEvent,
  canvasElement: HTMLElement,
  camera: CameraInterface
) {
  // Prevent re-entrant clicks (async handler can overlap with rapid clicks)
  if (_clickHandling) return;
  _clickHandling = true;
  try { await _handleClickInner.call(this, event, canvasElement, camera); }
  finally { _clickHandling = false; }
};
async function _handleClickInner(
  this: any,
  event: MouseEvent,
  canvasElement: HTMLElement,
  camera: CameraInterface
) {
  const rect = canvasElement.getBoundingClientRect();
  const scaleX = rect.width / (canvasElement as HTMLCanvasElement).width;
  const scaleY = rect.height / (canvasElement as HTMLCanvasElement).height;
  const mouseX = (event.clientX - rect.left) / scaleX;
  const mouseY = (event.clientY - rect.top) / scaleY;
  console.log("Click detected at:", mouseX, mouseY);

  // A click that lands on a UI window belongs to that window, not to the map
  // behind it. Double-clicking an apple in an inventory that happened to sit
  // over an NPC ate the apple AND opened the NPC's dialogue.
  const { default: DragableMenu } = await import("./UI/Menu/DragableMenu");
  if (DragableMenu.anyHits(mouseX, mouseY)) return;
  // A pending party invite popup owns the screen — its yes/no is handled by
  // the party window's own mouse-down path
  {
    const { default: PartyMgr } = await import('./Party/PartyManager');
    if (PartyMgr.pendingInvite) return;
  }
  const { default: UIKeyConfigRef } = await import("./UI/UIKeyConfig");
  if (
    UIKeyConfigRef.isVisible &&
    mouseX >= UIKeyConfigRef.x && mouseX <= UIKeyConfigRef.x + 629 &&
    mouseY >= UIKeyConfigRef.y && mouseY <= UIKeyConfigRef.y + 373
  ) {
    return;
  }

  for (const npc of this.npcs as any[]) {
    if (!npc.pos || npc.hide) continue;
    // Hitbox = the NPC's drawn sprite unioned with its authored dc* click box
    // (see NPC.getBounds) — NPCs painted into the map scenery have nothing but
    // that box to aim at
    const bounds = npc.getBounds();
    const npcX = bounds.left - camera.x;
    const npcY = bounds.top - camera.y;

    if (
      mouseX >= npcX &&
      mouseX <= bounds.right - camera.x &&
      mouseY >= npcY &&
      mouseY <= bounds.bottom - camera.y
    ) {
      console.log(`Clicked on NPC ${npc.id}:`, npc);
      try {
        // Close all open UI menus when interacting with NPC
        const mapState = (window as any).MapStateInstance;
        mapState?.closeAllMenus?.();

        // Check for quest dialog
        const questManager = (window as any).charecter?.questManager;
        const quests = questManager?.getQuestsForNpc(npc.id);
        console.log(`[NPC Click] questManager=${!!questManager}, quests=`, quests);

        // GMS behavior: when the NPC has any quests, always show the combined
        // quest listing first — scripted quests appear in it like static ones
        // (getQuestsForNpc gates them on Check.img requirements), and their
        // start/end scripts only run when the quest is clicked in the listing.
        let npcHasScript = false;
        try { npcHasScript = await this.npcScriptEngine.hasScript(npc.id); } catch {}
        const hasQuests = questManager && quests &&
          (quests.available.length > 0 || quests.inProgress.length > 0 || quests.completable.length > 0);
        console.log(`[NPC Click] npcHasScript=${npcHasScript}, hasQuests=${hasQuests}`);

        if (hasQuests) {
          // If NPC has a script and ONLY in-progress quests (no available/completable),
          // prefer the NPC script — these quests just say "go talk to X" and the script
          // handles the actual action (warp, etc.). Otherwise show GMS-style quest listing.
          if (npcHasScript && quests.available.length === 0 && quests.completable.length === 0) {
            await this.tryNpcScript(npc);
            return;
          }

          // Build quest listing selections like the original game
          const selections: any[] = [];
          let idx = 0;

          // Completable quests (list3 header)
          for (let i = 0; i < quests.completable.length; i++) {
            const questId = quests.completable[i];
            const questName = QuestData.quests.get(questId)?.name || `Quest #${questId}`;
            selections.push({
              index: idx,
              label: questName,
              headerType: i === 0 ? 'completable' : undefined,
              questId,
              questPhase: 'complete',
            });
            idx++;
          }

          // In-progress quests (list0 header)
          for (let i = 0; i < quests.inProgress.length; i++) {
            const questId = quests.inProgress[i];
            const questName = QuestData.quests.get(questId)?.name || `Quest #${questId}`;
            selections.push({
              index: idx,
              label: questName,
              headerType: i === 0 ? 'inProgress' : undefined,
              questId,
              questPhase: 'inProgress',
            });
            idx++;
          }

          // Available quests (list1 header)
          for (let i = 0; i < quests.available.length; i++) {
            const questId = quests.available[i];
            const questName = QuestData.quests.get(questId)?.name || `Quest #${questId}`;
            selections.push({
              index: idx,
              label: questName,
              headerType: i === 0 ? 'available' : undefined,
              questId,
              questPhase: 'start',
            });
            idx++;
          }

          // Add "ETC" section for NPC conversation if NPC has a script
          if (npcHasScript) {
            selections.push({
              index: idx,
              label: 'What else?',
              headerType: 'etc',
              questId: null,
              questPhase: 'talk',
            });
            idx++;
          }

          // Show combined NPC dialog with quest selections
          const dialog = this.questDialog;
          const npcName = npc.strings.name || 'NPC';
          const mapObj = this;
          await dialog.showScriptDialog({
            npcId: npc.id,
            npcName,
            questName: '',
            text: '',
            dialogType: 'simple',
            selections,
            onAction: async (mode: number, type: number, selIdx: number) => {
              dialog.hide();
              if (mode === -1) return;
              const sel = selections[selIdx];
              if (!sel) return;
              const { questId, questPhase } = sel;
              if (questPhase === 'talk') {
                // Run the NPC script for normal conversation
                await mapObj.tryNpcScript(npc);
                return;
              }
              const reqs = QuestData.requirements.get(questId);
              if (questPhase === 'complete') {
                // Scripted end — run the endscript, like the server does when a
                // completable quest is selected.
                if (reqs?.complete.endscript && await mapObj.scriptEngine.hasScript(questId)) {
                  await mapObj.runQuestScript(npc, questId, 'end');
                  return;
                }
                await dialog.show({
                  questId,
                  npcId: npc.id,
                  npcName,
                  phase: 'complete',
                  onCompleted: () => { questManager.completeQuest(questId, dialog.getSelectedPropItemId()); },
                });
              } else if (questPhase === 'start') {
                // Scripted start — requirements were already checked when the
                // listing was built.
                if (reqs?.start.startscript && await mapObj.scriptEngine.hasScript(questId)) {
                  await mapObj.runQuestScript(npc, questId, 'start');
                  return;
                }
                await dialog.show({
                  questId,
                  npcId: npc.id,
                  npcName,
                  phase: 'start',
                  // startscript quests whose script file is missing fall back to
                  // the static dialog — startQuest refuses them, so force-start
                  // (the listing already verified the start requirements).
                  onAccepted: () => {
                    if (!questManager.startQuest(questId)) questManager.forceStartQuest(questId);
                  },
                });
              } else {
                await dialog.show({
                  questId,
                  npcId: npc.id,
                  npcName,
                  phase: 'inProgress',
                });
              }
            },
          });
        } else {
          await this.tryNpcScript(npc);
        }
      } catch (err) {
        console.error(`[NPC Click] Error handling NPC ${npc.id}:`, err);
      }
      return; // Only handle the first NPC clicked
    }
  }

  // Characters — double-click opens the Character Info window (own or remote).
  // NPCs take priority above, like the original client.
  const candidates = [
    (window as any).charecter,
    ...((this.characters as any[]) ?? []),
  ].filter((c) => c && c.pos && !c.isDead);
  for (const ch of candidates) {
    const cx = ch.pos.x - camera.x;
    const cy = ch.pos.y - camera.y;
    if (mouseX < cx - 25 || mouseX > cx + 25 || mouseY < cy - 75 || mouseY > cy) continue;

    // Party invite mode (armed from the party window): the next click on a
    // player sends the invite instead of opening character info
    const { default: PartyManager } = await import('./Party/PartyManager');
    if (PartyManager.inviteMode) {
      PartyManager.inviteMode = false;
      if (ch !== (window as any).charecter && ch.id) {
        PartyManager.invite(String(ch.id));
      }
      return;
    }

    const now = Date.now();
    if (_lastCharClick.target === ch && now - _lastCharClick.time < 400) {
      _lastCharClick = { target: null, time: 0 };
      const menu = (window as any).MapStateInstance?.charInfoMenu;
      menu?.show?.(ch);
    } else {
      _lastCharClick = { target: ch, time: now };
    }
    return;
  }
};

// Double-click bookkeeping for the character-info window
let _lastCharClick: { target: any; time: number } = { target: null, time: 0 };


// Run a quest's start/end script (QuestScriptEngine) for the given NPC.
// Callers gate on canRunStartScript/canRunEndScript before invoking.
MapleMap.runQuestScript = async function (npc: any, questId: number, phase: 'start' | 'end') {
  const character = (window as any).charecter;
  const questName = QuestData.quests.get(questId)?.name || '';
  const dialog = this.questDialog;
  const engine = this.scriptEngine;

  await engine.begin({
    questId,
    phase,
    character,
    onShowDialog: (pending: any) => {
      dialog.showScriptDialog({
        npcId: npc.id,
        npcName: npc.strings.name || 'NPC',
        questName,
        questId,
        text: pending.text,
        dialogType: pending.type,
        selections: pending.selections,
        input: pending.input,
        onInput: pending.onInput,
        onAction: (mode: number, type: number, selection: number) => {
          if (mode === -1) {
            dialog.hide();
          } else {
            engine.advance(mode, type, selection);
          }
        },
      });
    },
    onDispose: () => {
      dialog.hide();
    },
    changeMap: async (mapId: number, portalName?: string | number) => {
      const mapState = (window as any).MapStateInstance;
      if (mapState?.changeMap) {
        await mapState.changeMap(mapId, portalName);
      }
    },
  });
};

// Try running an NPC script; falls back to the NPC's default dialogue
MapleMap.tryNpcScript = async function (npc: any) {
  const engine = this.npcScriptEngine;
  const hasScript = await engine.hasScript(npc.id);

  if (!hasScript) {
    // Check if NPC has a shop — if so, open it directly
    const { getShopInfo } = await import('./Shop/ShopData');
    const shopInfo = await getShopInfo(npc.id);
    if (shopInfo && shopInfo.items.length > 0) {
      const { default: ShopUI } = await import('./UI/ShopUI');
      ShopUI.show(npc.id);
      return;
    }
    await this.showDefaultNpcTalk(npc);
    return;
  }

  const character = (window as any).charecter;
  const dialog = this.questDialog;

  await engine.begin({
    npcId: npc.id,
    character,
    onShowDialog: (pending: any) => {
      dialog.showScriptDialog({
        npcId: npc.id,
        npcName: npc.strings.name || 'NPC',
        questName: '',
        text: pending.text,
        dialogType: pending.type,
        selections: pending.selections,
        input: pending.input,
        onInput: pending.onInput,
        onAction: (mode: number, type: number, selection: number) => {
          if (mode === -1) {
            dialog.hide();
          } else {
            engine.advance(mode, type, selection);
          }
        },
      });
    },
    onDispose: () => {
      dialog.hide();
    },
    changeMap: async (mapId: number, portalName?: string | number) => {
      const mapState = (window as any).MapStateInstance;
      if (mapState?.changeMap) {
        await mapState.changeMap(mapId, portalName);
      }
    },
  });
};

// Authentic v83 behavior for script-less, quest-less NPCs: show the NPC's
// default dialogue lines (d0/d1 from String.wz/Npc.img) as a paged dialog.
// NPCs with no default dialogue say nothing at all — the original client
// simply doesn't open a chat window for them.
MapleMap.showDefaultNpcTalk = async function (npc: any) {
  const dLines: string[] = npc.strings?.questDialogues || [];
  if (dLines.length === 0) return;

  // d-lines use the same #p/#t/#b/#m format codes as script dialogue — both
  // name tables must be loaded before stripping bakes the text
  const { ensureItemNames, ensureMapNames } = await import('./Quest/QuestData');
  await ensureItemNames();
  await ensureMapNames();

  const dialog = this.questDialog;
  const npcName = npc.strings?.name || '';
  let page = 0;
  const showPage = () => {
    const last = page === dLines.length - 1;
    dialog.showScriptDialog({
      npcId: npc.id,
      npcName,
      questName: '',
      text: stripScriptCodes(dLines[page]),
      dialogType: last ? 'ok' : 'next',
      onAction: (mode: number) => {
        if (mode === -1 || last) {
          dialog.hide();
          return;
        }
        page++;
        showPage();
      },
    });
  };
  showPage();
};

export default MapleMap;
