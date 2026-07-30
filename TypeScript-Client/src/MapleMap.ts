import WZManager from "./wz-utils/WZManager";

import Background from "./Background";
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
import UIMiniMap from './UI/UIMiniMap';
import UIShipClock from './UI/UIShipClock';
import ShipObject from './Transport/ShipObject';
import { _setMapleMap } from './Physics';

export interface MapleMap {
  id: number | string;
  wzNode: any;
  isTown: boolean;
  isSwimMap: boolean;
  footholds: any;
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
  isPositionValid: (x: number, y: number) => boolean;
  loadBoundaries: (wzNode: any, footholds: any) => any;
  getNearbyTownMapId: () => any;
  loadBackgrounds: (wzNode: any) => Promise<any>;
  loadPortals: (wzNode: any) => Promise<any>;
  loadNames: (id: number) => Promise<any>;
  loadTiles: (wzNode: any) => Promise<any>;
  loadObjects: (wzNode: any) => Promise<any>;
  loadNPCs: (wzNode: any) => Promise<any>;
  loadMonsters: (wzNode: any) => Promise<any>;
  loadReactors: (wzNode: any) => Promise<void>;
  spawnMonster: (opts: any) => Promise<void>;
  spawnNPC: (opts: any) => Promise<void>;
  setMobHostMode: (isHost: boolean) => void;
  findMonsterByOId: (oId: number) => Monster | undefined;
  getMonsterSpawnDefs: () => any[];
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
  showDefaultNpcTalk: (npc: any) => Promise<void>;
}

const MapleMap = {} as MapleMap;
_setMapleMap(MapleMap);
const minLoadTimeInSeconds = 1;

MapleMap.load = async function (id: number | string) {
  // Clear respawn timers from previous map
  this.clearRespawnTimers?.();

  const startTime = new Date().getTime();
  this.doneLoading = false;

  // Free map-specific assets (Mob.wz, Map.wz, Npc.wz) from previous map
  WZManager.unloadTransient();

  let filename = "UI.wz/MapLogin.img";
  if (id !== "MapLogin") {
    const prefix = Math.floor((id as number) / 100000000);
    const strId = `${id}`.padStart(9, "0");
    filename = `Map.wz/Map/Map${prefix}/${strId}.img`;
  }
  this.wzNode = await WZManager.get(filename);
  this.isTown = !!this.wzNode.info.town.nValue;
  // Swim maps (info/swim=1) switch airborne physics to water physics
  this.isSwimMap = !!this.wzNode.info.nGet("swim").nGet("nValue", 0);
  console.log(`is town: ${this.isTown}, swim: ${this.isSwimMap}`);
  console.log("Map WZ Node:", this.wzNode);
  this.npcs = [];
  this.monsters = [];
  this.mobProjectiles = [];
  this.reactors = [];
  this.characters = [];

  if (!this.PlayerCharacter) {
    this.PlayerCharacter = null;
  }

  // Phase 1: Footholds + boundaries (sync, needed by NPCs/monsters)
  this.footholds = this.loadFootholds(this.wzNode.foothold);
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

  // Transport visuals: docked/enemy vessel (shipObj node) + departure clock
  this.shipObject = await ShipObject.fromMapNode(this.wzNode, id as number);
  UIShipClock.setFromMap(this.wzNode, id as number);

  // Phase 3: NPCs, monsters, reactors in parallel (all depend on footholds, not each other)
  await Promise.all([
    this.loadNPCs(this.wzNode.life),
    this.loadMonsters(this.wzNode.life),
    this.loadReactors(this.wzNode.reactor),
  ]);

  // BGM can start without blocking — fire and forget
  AudioManager.playBackgroundMusic(this.wzNode.info.bgm.nValue);

  Timer.doReset();

  this.id = id;
  this.itemDrops = [];

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
  for (const timer of reactorRespawnTimers) clearTimeout(timer);
  reactorRespawnTimers = [];
  reactorSpawnDefs = [];
};

let currentMonsters: Monster[] = [];
MapleMap.loadMonsters = async function (wzNode) {
  footholds = this.footholds;
  monsterSpawnDefs = [];

  let spawnIndex = 0;
  for (const mobNode of wzNode.nChildren.filter(
    (n: any) => n.type.nValue === "m"
  )) {
    const mobTime = mobNode.mobTime?.nValue ?? mobNode.nGet('mobTime').nGet('nValue', 0);
    const cy = mobNode.cy?.nValue ?? mobNode.y.nValue;
    const spawnDef = {
      oId: spawnIndex++,
      id: mobNode.id.nValue,
      x: mobNode.x.nValue,
      y: cy,              // Use cy (foothold Y) so mob spawns on ground, not mid-air
      stance: "",
      fh: mobNode.fh.nValue,
      minX: mobNode.rx0.nValue,
      maxX: mobNode.rx1.nValue,
      mobTime,            // Respawn time in seconds (-1 = no respawn, 0 = default)
      map: this,
      alive: true,
      nextPossibleSpawn: 0,
    };
    monsterSpawnDefs.push(spawnDef);
    await this.spawnMonster(spawnDef);
  }
  currentMonsters = this.monsters;
};

// --- Reactor loading ---
let reactorSpawnDefs: any[] = [];
let reactorRespawnTimers: any[] = [];

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

MapleMap.loadNPCs = async function (wzNode) {
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

  // Reactor respawn handling
  // Reactor respawn — only the mob host handles timers, broadcasts to others
  for (const reactor of this.reactors) {
    if (reactor.destroyed && !reactor.respawnScheduled && reactor.reactorTime > 0) {
      reactor.respawnScheduled = true;
      if (!isMobHost) continue; // Non-host waits for reactor_respawn message
      const r = reactor;
      const timer = setTimeout(() => {
        r.reset();
        try { (window as any).__mySocket?.sendReactorRespawn(r.oId); } catch {}
      }, reactor.reactorTime * 1000);
      reactorRespawnTimers.push(timer);
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
  this.portals.forEach((p: Portal) => p.update(msPerTick));

  this.itemDrops = this.itemDrops.filter(
    (drop: DropItemSprite) => !drop.destroyed
  );
  this.itemDrops.forEach((drop: DropItemSprite) => {
    drop.update(msPerTick);
  });
};

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
  // One entity's draw error must not abort the frame — everything drawn
  // after it (mobs, portals, HUD) would silently vanish
  const draw = (obj: any) => {
    try {
      obj.draw(canvas, camera, lag, msPerTick, tdelta);
    } catch (e) {
      if (!(obj as any)._drawErrorLogged) {
        (obj as any)._drawErrorLogged = true;
        console.error('[MapleMap] draw failed for entity:', e);
      }
    }
  };

  this.backgrounds.filter((bg: Background) => !bg.front).forEach(draw);

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
    if (pc.questStartActive) drawEffect(pc, pc.questStartFrames, pc.questStartFrame);
    if (pc.incExpActive) drawEffect(pc, pc.incExpFrames, pc.incExpFrame);
    if (pc.skillEffectActive) drawEffect(pc, pc.skillEffectFrames, pc.skillEffectFrame);
  };

  // Player's layer from current or last foothold (persists through jumps/climbs)
  if (this.PlayerCharacter?.pos?.fh != null) {
    this._lastPlayerLayer = this.PlayerCharacter.pos.fh.layer;
  }
  const playerLayer = this._lastPlayerLayer ?? 0;
  const isClimbing = this.PlayerCharacter?.pos?.isClimbing === true;

  const drawLayer = (i: number) => {
    const inCurrentLayer = (obj: Obj) => obj.layer === i;
    this.objects.filter(inCurrentLayer).forEach(draw);
    this.tiles.filter(inCurrentLayer).forEach(draw);
    this.monsters.filter(inCurrentLayer).forEach(draw);
    (this.reactors as any[]).filter(inCurrentLayer).forEach(draw);
    this.characters.filter(inCurrentLayer).forEach(draw);
    this.npcs.filter(inCurrentLayer).forEach(draw);
  };

  if (isClimbing) {
    // Climbing: draw ALL layers, then player on top (player in front of rope/chain)
    for (let i = 0; i <= 7; i++) drawLayer(i);

    if (this.PlayerCharacter) {
      draw(this.PlayerCharacter);
      drawPlayerEffects(this.PlayerCharacter);
    }
  } else {
    // Normal/jumping: draw up to player's layer, then player, then higher layers
    for (let i = 0; i <= playerLayer; i++) drawLayer(i);

    if (this.PlayerCharacter) {
      draw(this.PlayerCharacter);
      drawPlayerEffects(this.PlayerCharacter);
    }

    for (let i = playerLayer + 1; i <= 7; i++) drawLayer(i);
  }

  const notInAnyLayer = (obj: any) => !(obj.layer >= 0 && obj.layer <= 7);
  this.monsters.filter(notInAnyLayer).forEach(draw);
  (this.reactors as any[]).filter(notInAnyLayer).forEach(draw);
  this.characters.filter(notInAnyLayer).forEach(draw);
  this.npcs.filter(notInAnyLayer).forEach(draw);

  (this.mobProjectiles || []).forEach((p: any) => p.draw(canvas, camera));

  this.characters
    .filter((c: MapleCharacter) => !!c.levelingUp)
    .forEach(drawLevelUp);

  this.portals.forEach(draw);
  this.backgrounds.filter((bg: Background) => !!bg.front).forEach(draw);

  this.itemDrops.forEach((drop: DropItemSprite) => {
    drop.draw(canvas, camera);
  });

  // Station departure clock (world-space) / timed-ride countdown
  UIShipClock.draw(canvas, camera);

  // Object.values(this.footholds).forEach(draw); // debug: draw foothold lines
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

  for (const npc of this.npcs as any[]) {
    if (!npc.pos || npc.hide) continue;
    // Compute hitbox from the NPC's current sprite frame (same coords as draw())
    const currentFrame = npc.stances?.[npc.stance]?.frames?.[npc.frame];
    const spriteW = currentFrame?.nWidth || 56;
    const spriteH = currentFrame?.nHeight || 70;
    const originX = currentFrame?.nGet?.("origin")?.nGet?.("nX", 0) || Math.floor(spriteW / 2);
    const originY = currentFrame?.nGet?.("origin")?.nGet?.("nY", 0) || spriteH;
    const adjustX = !npc.flipped ? originX : spriteW - originX;
    const npcX = npc.x - camera.x - adjustX;
    const npcY = npc.cy - camera.y - originY;

    if (
      mouseX >= npcX &&
      mouseX <= npcX + spriteW &&
      mouseY >= npcY &&
      mouseY <= npcY + spriteH
    ) {
      console.log(`Clicked on NPC ${npc.id}:`, npc);
      try {
        // Close all open UI menus when interacting with NPC
        const mapState = (window as any).MapStateInstance;
        mapState?.closeAllMenus?.();

        // Check for quest dialog
        const questManager = (window as any).charecter?.questManager;
        const character = (window as any).charecter;
        const quests = questManager?.getQuestsForNpc(npc.id);
        console.log(`[NPC Click] questManager=${!!questManager}, quests=`, quests);

        // Check for script-based quests first
        const npcQuestIds = QuestData.npcToQuests.get(npc.id) || [];
        let scriptHandled = false;

        for (const questId of npcQuestIds) {
          const reqs = QuestData.requirements.get(questId);
          if (!reqs) continue;
          const state = questManager?.getQuestState(questId);

          // Determine phase: if not started and this NPC starts it, run start()
          // If started and this NPC completes it, run end()
          // Only use script path if the matching phase has a script (startscript vs endscript)
          let phase: 'start' | 'end' | null = null;
          if (state === 0 && reqs.start.npc === npc.id && reqs.start.startscript) {
            // Check prerequisite quests before offering this quest
            const prereqsMet = !reqs.start.quests || reqs.start.quests.every(
              (pq: any) => questManager?.getQuestState(pq.id) >= pq.state
            );
            if (!prereqsMet) continue;
            phase = 'start';
          } else if (state === 1 && reqs.complete.npc === npc.id && reqs.complete.endscript) {
            phase = 'end';
          }
          if (!phase) continue;
          // Note: do NOT re-run startscript when quest is in-progress (state=1) on the start NPC.
          // The quest is already started — the NPC's own script should handle the next action (warp, etc.).

          if (phase && await this.scriptEngine.hasScript(questId)) {
            const questName = QuestData.quests.get(questId)?.name || '';
            const dialog = this.questDialog;
            const engine = this.scriptEngine;

            await engine.begin({
              questId,
              phase,
              character,
              onShowDialog: (pending) => {
                dialog.showScriptDialog({
                  npcId: npc.id,
                  npcName: npc.strings.name || 'NPC',
                  questName,
                  questId,
                  text: pending.text,
                  dialogType: pending.type,
                  selections: (pending as any).selections,
                  input: (pending as any).input,
                  onInput: (pending as any).onInput,
                  onAction: (mode, type, selection) => {
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

            scriptHandled = true;
            break;
          }
        }

        if (!scriptHandled) {
          let npcHasScript = false;
          try { npcHasScript = await this.npcScriptEngine.hasScript(npc.id); } catch {}
          const hasQuests = questManager && quests &&
            (quests.available.length > 0 || quests.inProgress.length > 0 || quests.completable.length > 0);
          console.log(`[NPC Click] scriptHandled=${scriptHandled}, npcHasScript=${npcHasScript}, hasQuests=${hasQuests}`);

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
                if (questPhase === 'complete') {
                  await dialog.show({
                    questId,
                    npcId: npc.id,
                    npcName,
                    phase: 'complete',
                    onCompleted: () => { questManager.completeQuest(questId, dialog.getSelectedPropItemId()); },
                  });
                } else if (questPhase === 'start') {
                  await dialog.show({
                    questId,
                    npcId: npc.id,
                    npcName,
                    phase: 'start',
                    onAccepted: () => { questManager.startQuest(questId); },
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
        }
      } catch (err) {
        console.error(`[NPC Click] Error handling NPC ${npc.id}:`, err);
      }
      break; // Only handle the first NPC clicked
    }
  }
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

  // d-lines use the same #p/#t/#b format codes as script dialogue
  const { ensureItemNames } = await import('./Quest/QuestData');
  await ensureItemNames();

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
