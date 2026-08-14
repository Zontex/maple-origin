import MapleMap from "./MapleMap";
// Exposed through a getter, not a direct assignment. There is an import
// cycle (mysocket -> MapleMap -> NpcScriptEngine -> MapState -> MapleMap),
// so when MapleMap is the module that entered it, its own `const MapleMap`
// has not been initialised by the time this file runs — reading the binding
// here threw "Cannot access 'MapleMap' before initialization" and killed
// the boot. A getter defers the read until something actually asks for it.
Object.defineProperty(window, '__MapleMap', {
  get: () => MapleMap,
  configurable: true,
});
import MyCharacter from "./MyCharacter";
import UIState from './UIState';
import Camera, { CameraInterface } from "./Camera";
import config from "./Config";
import { applyConfiguredResolution } from "./Resolution";
import GameCanvas from "./GameCanvas";
import UIMap from "./UI/UIMap";
import StatsMenuSprite from "./UI/Menu/StatsMenuSprite";
import InventoryMenuSprite from "./UI/Menu/InventoryMenuSprite";
import QuestLogMenuSprite from "./UI/Menu/QuestLogMenuSprite";
import TouchJoyStick, {
  JoyStick,
  JoyStickDirections,
} from "./UI/TouchJoyStick";
import ClickManager from "./UI/ClickManager";
import ShopUI from "./UI/ShopUI";
import CashShopUI from "./UI/CashShopUI";
import UIAvatarMegaphone from "./UI/UIAvatarMegaphone";
import WZManager from "./wz-utils/WZManager";
import UIMiniMap from "./UI/UIMiniMap";
import UIQuestAlarm from "./UI/UIQuestAlarm";
import EquipMenuSprite from "./UI/Menu/EquipMenuSprite";
import SkillMenuSprite from "./UI/Menu/SkillMenuSprite";
import CharInfoMenuSprite from "./UI/Menu/CharInfoMenuSprite";
import PartyMenuSprite from "./UI/Menu/PartyMenuSprite";
import UIHotkeyBar from "./UI/UIHotkeyBar";
import PetManager from "./Pet/PetManager";
import TouchControls, { isTouchDevice as isTouchDeviceTC } from "./UI/TouchControls";
import MobileHUD from "./UI/MobileHUD";
import UIGameMenu from "./UI/UIGameMenu";
import UIChannelSelect from "./UI/UIChannelSelect";
import UISystemOption from "./UI/UISystemOption";
import UIGameOption from "./UI/UIGameOption";
import UIKeyConfig from "./UI/UIKeyConfig";
import UIWorldMap from "./UI/UIWorldMap";
import KeyBindings, { ACTIONS, BindableAction, FACE_EXPRESSIONS } from "./KeyBindings";
import HenesysPQ from "./Events/HenesysPQ";

// Bound-key helpers. Everything below asks for an ACTION, never a letter, so
// rebinding takes effect immediately and the edge-triggered checks keep
// working — previousActionState is keyed by action for the same reason.
const previousActionState: Partial<Record<BindableAction, boolean>> = {};
function actionDown(canvas: GameCanvas, action: BindableAction): boolean {
  const key = KeyBindings.keyNameFor(action);
  return !!key && canvas.isKeyDown(key);
}
/** True only on the frame the action's key goes down. */
function actionPressed(canvas: GameCanvas, action: BindableAction): boolean {
  return actionDown(canvas, action) && !previousActionState[action];
}
/**
 * Items bound straight onto a keyboard key, which is how anything outside the
 * eight quickslot keys gets used — a chair on X, for instance. Edge-triggered
 * per key, so holding it does not re-fire.
 */
/** Held across frames so a press raises a window once, not every frame. */
let menuFocusLatched = false;
const previousItemKeyState: Record<number, boolean> = {};
function checkItemKeys(canvas: GameCanvas) {
  const codes = new Set([
    ...Object.keys(KeyBindings.itemBindings),
    ...Object.keys(KeyBindings.skillBindings),
  ]);
  for (const codeStr of codes) {
    const code = Number(codeStr);
    const keyName = KeyBindings.keyNameForScancode(code);
    if (!keyName) continue;
    const down = canvas.isKeyDown(keyName);
    if (down && !previousItemKeyState[code]) {
      const itemId = KeyBindings.itemBindings[code];
      const skillId = KeyBindings.skillBindings[code];
      if (itemId !== undefined) UIHotkeyBar.activateItem(itemId);
      else if (skillId !== undefined) void UIHotkeyBar.activateSkill(skillId);
    }
    previousItemKeyState[code] = down;
  }
}

function latchActions(canvas: GameCanvas) {
  // Driven off ACTIONS rather than a hand-written list so a newly bindable
  // action cannot be left unlatched and fire on every frame it is held.
  for (const { action } of ACTIONS) {
    previousActionState[action] = actionDown(canvas, action);
  }
}
import MySocket from "./mysocket";
import DebugDrag from "./UI/DebugDrag";
import DragManager from "./UI/DragManager";
import DragableMenu from "./UI/Menu/DragableMenu";
import DirectionScene from "./Effects/DirectionScene";
import TransportationManager from "./Transport/TransportationManager";
import MapStateCache from "./MapStateCache";

// Ride maps are instanced per voyage in the original client — the deck and
// cabin are rebuilt each sailing — so remembered map state must not survive a
// cycle rollover. Wired here rather than inside the cache to keep it ignorant
// of transport, and inside TransportationManager would be an import cycle.
MapStateCache.setInstanceTokenProvider((mapId) =>
  TransportationManager.getInstanceToken(mapId)
);

// henesys 100000000
// 100020100 - maps with pigs - useful to test fast things with mobs
const defaultMap = 1000000; // Southperry (Pio's map - has reactors)
// const defaultMap = 100000000; // henesys
// const defaultMap = 104040000; // left of henesys
// const defaultMap: number = 100040102; // elinia - monkey map

export interface MapState extends UIState {
  changeMap: (map: number, portalName?: string | number) => Promise<void>;
  isTouchControllsEnabled: boolean;
  joyStick: JoyStick;
  statsMenu: StatsMenuSprite;
  inventoryMenu: InventoryMenuSprite;
  equipMenu: EquipMenuSprite;
  questLog: QuestLogMenuSprite;
  skillMenu: SkillMenuSprite;
  charInfoMenu: CharInfoMenuSprite;
  partyMenu: PartyMenuSprite;
  UIMenus: any[];
  closeAllMenus: () => void;
  PlayerCharacter: any; // Reference to MyCharacter
  getMapName: (mapId: number) => Promise<{ streetName: string, mapName: string }>;
  previousKeyboardState: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    i: boolean;
    s: boolean;
    q: boolean;
    m: boolean;
    e: boolean;
    k: boolean;
    esc: boolean;
    enter: boolean;
    alt: boolean;
  };
}

const MapStateInstance = {} as MapState;

// Fade overlay for map transitions
let fadeAlpha = 1; // Start fully black
let fadeDirection: 'out' | 'none' = 'none'; // 'out' = revealing
const fadeDuration = 500; // ms
let fadeTimer = 0;
let fadeWaitForDoneLoading = false; // Wait for map to finish loading before fading in
let oobRespawning = false; // Out-of-bounds respawn in progress
// Map loads can race (reconnect re-login, cutscene warps, double-fired
// transitions). Each initializeMapState takes a sequence number; a run that
// has been superseded stops after its awaits instead of clobbering the
// newer load's state — that half-applied state was rendering maps with no
// player and no HUD.
let mapLoadSeq = 0;

// Call before map.load() — holds black screen until doneLoading
export function fadeToBlack() {
  fadeAlpha = 1;
  fadeDirection = 'none';
  fadeWaitForDoneLoading = true;
  // Hide chat input during transition
  const chatInput = document.querySelector('.game-wrapper input') as HTMLInputElement | null;
  if (chatInput) chatInput.style.visibility = 'hidden';
}

/**
 * Toggle the whole bottom HUD for a cutscene.
 *
 * The canvas HUD is suppressed via UIMap.hudHidden, but the chat field is a
 * real <input> layered over the canvas — skipping a draw call cannot hide
 * it, so it needs its own visibility flip. Edge-triggered: touching the DOM
 * every frame would fight the chat's own focus handling.
 */
let hudHiddenForCutscene = false;
function setHudHiddenForCutscene(hidden: boolean) {
  UIMap.hudHidden = hidden;
  if (hidden === hudHiddenForCutscene) return;
  hudHiddenForCutscene = hidden;
  const chatInput = document.querySelector('.game-wrapper input') as HTMLInputElement | null;
  if (chatInput) chatInput.style.visibility = hidden ? 'hidden' : 'visible';
}

async function initializeMapState(map = defaultMap, isFirstUpdate = false, portalName?: string | number) {
  const loadSeq = ++mapLoadSeq;

  // Any cutscene from the previous map is void now — restores the character
  // and invalidates in-flight scene loads (map loads can race)
  DirectionScene.cancel();

  // Hold black screen until map is fully loaded
  fadeAlpha = 1;
  fadeDirection = 'none';
  fadeWaitForDoneLoading = true;

  try {
    if (isFirstUpdate) {
      await MyCharacter.load();
    }
    MyCharacter.activate();
    await MapleMap.load(map);
  } catch (e) {
    console.error('Error loading map:', map, e);
    // load() resets all per-frame collections before its first await, so the
    // map is a safe empty state — releasing the fade here avoids a stuck
    // black screen without crash-looping update()/render()
    MapleMap.doneLoading = true;
  }

  // A newer load started while we were awaiting — let it finish the job
  if (loadSeq !== mapLoadSeq) {
    console.log(`[MapState] Map load ${map} superseded — aborting stale initialization`);
    return;
  }

  MyCharacter.map = MapleMap;

  if (isFirstUpdate) {
    await UIMap.initialize();
    await UIMiniMap.initialize();
    await UIQuestAlarm.initialize();
    UIQuestAlarm.setCharacter(MyCharacter);
    if (loadSeq !== mapLoadSeq) {
      console.log(`[MapState] Map load ${map} superseded — aborting stale initialization`);
      return;
    }
  }

  // Portal y is authored at the doorway, not at the floor, and the two differ
  // by a pixel or so in either direction — Perion's Free Market door sits at
  // y=581 above a platform at y=580.2. Spawning at the raw y therefore puts
  // the character *below* the platform they are meant to stand on, and since
  // a map change clears pos.fh they fall straight past it to whatever is
  // underneath: in Perion, all the way down to the first floor.
  //
  // Snap onto the foothold under the portal, but only when one is genuinely
  // there — it must span the portal's x (an interpolated point that had to be
  // clamped belongs to a platform off to the side) and be close enough
  // vertically that it is the same floor. Anything else is a portal really
  // meant to be entered in mid-air, and is left alone.
  // Land *just above* the floor rather than exactly on it. Physics acquires a
  // foothold by intersecting the movement segment against it, so a character
  // standing precisely on the line gives an intersection at parameter ~0 that
  // rounding can push just under — no crossing is detected and they drop
  // straight through. Portals that already work (the boat's, for one) sit a
  // couple of pixels above their floor and fall onto it, so this makes every
  // snapped spawn look like the case that was never broken.
  const SPAWN_SNAP_MAX_DY = 40;
  const SPAWN_GROUND_CLEARANCE = 3;
  const spawnAt = (x: number, y: number) => {
    MyCharacter.pos.x = x;
    const ground = MapleMap.getNearestFootholdPosition?.(x, y);
    const onSameFloor =
      ground && Math.abs(ground.x - x) <= 1 && Math.abs(ground.y - y) <= SPAWN_SNAP_MAX_DY;
    MyCharacter.pos.y = onSameFloor ? ground!.y - SPAWN_GROUND_CLEARANCE : y;
  };

  // Spawn at named portal if specified, otherwise first spawn portal (index 0)
  let spawned = false;
  if (typeof portalName === 'number' && MapleMap.portals?.[portalName]) {
    // Portal INDEX (Cosmic warpEveryone(map, pto) semantics — transport arrivals)
    const indexedPortal = MapleMap.portals[portalName];
    spawnAt(indexedPortal.x, indexedPortal.y);
    spawned = true;
  } else if (typeof portalName === 'string' && portalName && portalName !== 'sp' && MapleMap.portals) {
    // Named portal (e.g. portal-to-portal transitions)
    const namedPortal = MapleMap.portals.find((p: any) => p.name === portalName);
    if (namedPortal) {
      spawnAt(namedPortal.x, namedPortal.y);
      spawned = true;
    }
  }
  if (!spawned && MapleMap.portals?.length > 0) {
    // Try spawn portal (type 0) first
    const spawnPortal = MapleMap.portals.find((p: any) => p.type === 0);
    // Fall back to first portal regardless of type
    const fallbackPortal = spawnPortal || MapleMap.portals[0];
    if (fallbackPortal) {
      spawnAt(fallbackPortal.x, fallbackPortal.y);
      spawned = true;
    }
  }
  if (!spawned) {
    const spawnPos = MapleMap.getCenterFootholdLocation?.();
    if (spawnPos) {
      MyCharacter.pos.x = spawnPos.x;
      MyCharacter.pos.y = spawnPos.y;
    } else {
      MyCharacter.pos.x = Math.floor((MapleMap.boundaries.right + MapleMap.boundaries.left) / 2);
      MyCharacter.pos.y = Math.floor((MapleMap.boundaries.bottom + MapleMap.boundaries.top) / 2);
    }
  }

  // Reset physics state so player lands naturally on the new map
  MyCharacter.pos.vx = 0;
  MyCharacter.pos.vy = 0;
  MyCharacter.pos.fh = null;
  MyCharacter.pos.lf = null;
  MyCharacter.pos.djump = null;
  MyCharacter.pos.isClimbing = false;
  MyCharacter.pos.fallStartY = MyCharacter.pos.y;
  MyCharacter.pos.fallDistance = 0;
  MyCharacter.pos.landingImpactVy = 0;
  oobRespawning = false;

  // Pets follow across maps: re-anchor live pets at the owner, and (on
  // login) summon the ones whose blobs were saved as summoned
  PetManager.onMapChange();
  void PetManager.spawnFromInventory(MyCharacter);

  // v83 map-enter scripts (info/onUserEnter): the Maple Island job-experience
  // rooms play a Direction3 cutscene that ends by warping back out
  // Where the Aran intro deposits you — Rien, which is also the returnMap the
  // last two cutscene chambers name
  const ARAN_INTRO_END_MAP = 140000000;
  const JOB_INTRO_SCRIPTS: Record<string, string> = {
    goSwordman: 'swordman',
    goMagician: 'magician',
    goArcher: 'archer',
    goRogue: 'rogue',
    goPirate: 'pirate',
  };
  const onUserEnter = MapleMap.wzNode?.info?.onUserEnter?.nValue;
  const introJob = onUserEnter && JOB_INTRO_SCRIPTS[onUserEnter];
  if (introJob) {
    const started = await DirectionScene.startJobIntro(introJob, MyCharacter);
    // The intro rooms have no exit portal — if the scene can't load, warp
    // back out rather than stranding the player in an empty room
    if (!started && loadSeq === mapLoadSeq) {
      const returnMap = MapleMap.wzNode?.info?.returnMap?.nValue || 1020000;
      console.warn(`[MapState] Job intro failed — returning to map ${returnMap}`);
      MapStateInstance.changeMap(returnMap);
    }
  } else if (onUserEnter === 'aranDirection' && loadSeq === mapLoadSeq) {
    // Aran's closing cutscene chambers (914090010-015, 914090100, 914090200).
    // Same shape as the job-intro rooms — a single spawn portal, no way out —
    // except the first six also carry returnMap 999999999, so there is no
    // destination to fall back to. Athena's farewell warps you straight into
    // the first one, which is a soft-lock until the scenes are played.
    // Passing through to where the intro ends is the only safe behaviour.
    const returnMap = MapleMap.wzNode?.info?.returnMap?.nValue;
    const dest = returnMap && returnMap > 0 && returnMap < 999999999 ? returnMap : ARAN_INTRO_END_MAP;
    console.warn(`[MapState] aranDirection cutscene not implemented — continuing to map ${dest}`);
    MapStateInstance.changeMap(dest);
  }
  // Fade-in will be triggered automatically when doneLoading becomes true
}

MapStateInstance.changeMap = async function (map = defaultMap, portalName?: string | number) {
  // Auto-save character before map transition
  MySocket.saveCharacterToServer();
  await initializeMapState(map, false, portalName);
};

// Event warps (HPQ start/clear/exile) go through the same map-change path;
// registered here because a static import back into MapState would cycle
HenesysPQ.changeMapFn = (mapId: number, portal?: number | string) => {
  void MapStateInstance.changeMap(mapId, portal);
};

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

// Function to get map names from the String.wz/Map.img file
MapStateInstance.getMapName = async function(mapId: number) {
  try {
    const strMap = await WZManager.get("String.wz/Map.img");
    
    const firstDigit = Math.floor(mapId / 100000000);
    const firstTwoDigits = Math.floor(mapId / 10000000);
    const firstThreeDigits = Math.floor(mapId / 1000000);
    
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
    
    const nameNode = (strMap as any)?.[area]?.[mapId];
    const streetName = nameNode?.streetName?.nValue || "";
    const mapName = nameNode?.mapName?.nValue || `Map ${mapId}`;
    
    return { streetName, mapName };
  } catch (error) {
    console.error(`Error getting map name for ${mapId}:`, error);
    return { streetName: "", mapName: `Map ${mapId}` };
  }
};

// StateManager passes its (optional) canvas like it does to every state; the
// starting map always arrives via _startMapOverride, set by the login flow
// and dev auto-login before setState.
MapStateInstance.initialize = async function (_canvas?: GameCanvas) {
  let map: number = defaultMap;

  // Every path into the game must land on the configured resolution —
  // manual login, dev auto-login, quit-and-reenter. The login flow itself
  // runs at the classic 800x600; the saved resolution exists only in-game.
  applyConfiguredResolution(ClickManager.GameCanvas ?? null);

  // On-screen controls for touch devices (joystick + jump/attack/loot),
  // wired into GameCanvas so control touches never double as UI taps
  const touchCanvas = ClickManager.GameCanvas ?? _canvas ?? null;
  if (touchCanvas) {
    touchCanvas._touchControls = TouchControls;
    TouchControls.active = isTouchDeviceTC();
  }

  // Use saved map override from character select if available
  if ((this as any)._startMapOverride) {
    map = (this as any)._startMapOverride;
    delete (this as any)._startMapOverride;
  }

  // Ensure quest data is loaded before map (NPCs need it for indicators)
  if (MyCharacter.questManager) {
    await MyCharacter.questManager.initialize();
  }

  this.isTouchControllsEnabled = false; // Touch controls disabled

  this.statsMenu = await StatsMenuSprite.fromOpts({
    x: 200,
    y: 200,
    charecter: MyCharacter,
    isHidden: true,
  });
  
  // We'll use ClickManager's GameCanvas reference instead
  this.inventoryMenu = await InventoryMenuSprite.fromOpts({
    x: 400,
    y: 200,
    charecter: MyCharacter,
    isHidden: true,
    canvas: ClickManager.GameCanvas, // Pass the canvas for mouse interaction
  });

  this.questLog = await QuestLogMenuSprite.fromOpts({
    x: 100,
    y: 100,
    charecter: MyCharacter,
    isHidden: true,
  });

  this.equipMenu = await EquipMenuSprite.fromOpts({
    x: 300,
    y: 100,
    charecter: MyCharacter,
    isHidden: true,
    canvas: ClickManager.GameCanvas,
  });

  this.skillMenu = await SkillMenuSprite.fromOpts({
    x: 600,
    y: 200,
    charecter: MyCharacter,
    isHidden: true,
  });

  this.charInfoMenu = await CharInfoMenuSprite.fromOpts({
    x: 260,
    y: 70,
    isHidden: true,
    canvas: ClickManager.GameCanvas,
  });

  this.partyMenu = await PartyMenuSprite.fromOpts({
    x: 244,
    y: 90,
    isHidden: true,
    canvas: ClickManager.GameCanvas,
  });

  this.UIMenus = [this.statsMenu, this.inventoryMenu, this.equipMenu, this.questLog, this.skillMenu, this.charInfoMenu, this.partyMenu];
  // Same array, same order as the draw pass — so "later in the list" means
  // "drawn on top", which is what click ownership is decided on.
  DragableMenu.setStack(this.UIMenus);

  // Initialize hotkey bar (visible by default so players can use skill slots)
  UIHotkeyBar.initialize();
  UIHotkeyBar.isVisible = true;
  (window as any).__uiHotkeyBar = UIHotkeyBar;

  // Close all open UI menus (called when NPC/quest dialogs open)
  this.closeAllMenus = () => {
    this.UIMenus.forEach((menu: any) => menu.setIsHidden(true));
  };

  this.PlayerCharacter = MyCharacter;

  // Initialize previous keyboard state with all keys set to false.
  this.previousKeyboardState = {
    up: false,
    down: false,
    left: false,
    right: false,
    i: false,
    s: false,
    q: false,
    m: false,
    e: false,
    k: false,
    esc: false,
    enter: false,
    alt: false,
  } as any;

  await initializeMapState(map, true);

  // --- Attach click event listener to the canvas element using the correct id ---
  const canvasElement = document.getElementById("game"); // updated to "game"
  if (canvasElement) {
    canvasElement.addEventListener("click", (event) => {
      const rect = canvasElement.getBoundingClientRect();
      const scaleX = rect.width / (canvasElement as HTMLCanvasElement).width;
      const scaleY = rect.height / (canvasElement as HTMLCanvasElement).height;
      const cx = (event.clientX - rect.left) / scaleX;
      const cy = (event.clientY - rect.top) / scaleY;

      // The world map covers the middle of the screen, so a click that lands
      // on it must not also reach an NPC or a portal underneath. Its own
      // buttons and links are driven from doUpdate; this only swallows.
      if (UIWorldMap.isVisible && UIWorldMap.containsPoint(cx, cy)) return;

      // Minimap click (world button)
      if (UIMiniMap.handleClick(cx, cy)) return;

      // Touch devices: mobile HUD icons + quickslot taps
      if (MobileHUD.handleTap(cx, cy, MapStateInstance)) return;
      if (TouchControls.active && UIHotkeyBar.handleTap(cx, cy)) return;

      // Quest Helper widget — swallow clicks over it (handled via wasClicked)
      if (UIQuestAlarm.containsPoint(cx, cy)) return;

      // Handle selection clicks on quest/NPC script dialogs
      if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
        if (MapleMap.questDialog.handleClick(cx, cy)) return;
      }
      // Block NPC/map clicks when any dialog is open.
      // Both dialogs are created partway through MapleMap.load, so neither
      // exists if a load throws before that point — and then every frame
      // rethrows out of the game loop and the tab is dead until a refresh.
      // questDialog was already null-checked everywhere; npcDialog was not,
      // which is what turned a failed warp into an unrecoverable crash loop
      // ("Cannot read properties of undefined (reading 'isHidden')").
      if ((MapleMap.npcDialog && !MapleMap.npcDialog.isHidden) || (MapleMap.questDialog && !MapleMap.questDialog.isHidden)) return;
      MapleMap.handleClick(event, canvasElement, Camera);
    });
    canvasElement.addEventListener("mousemove", (event) => {
      if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
        const rect = canvasElement.getBoundingClientRect();
        const scaleX = rect.width / (canvasElement as HTMLCanvasElement).width;
        const scaleY = rect.height / (canvasElement as HTMLCanvasElement).height;
        const cx = (event.clientX - rect.left) / scaleX;
        const cy = (event.clientY - rect.top) / scaleY;
        MapleMap.questDialog.handleMouseMove(cx, cy);
      }
    });
  } else {
    console.warn("Canvas element with id 'game' not found.");
  }
};

MapStateInstance.doUpdate = function (
  msPerTick: number,
  camera: CameraInterface,
  canvas: GameCanvas
) {
  // Touch controls inject virtual key state before anything polls input
  TouchControls.update(canvas);

  // Update fade overlay
  if (fadeWaitForDoneLoading && MapleMap.doneLoading) {
    // Map finished loading — start revealing
    fadeWaitForDoneLoading = false;
    fadeDirection = 'out';
    fadeTimer = 0;
    // Show chat input again
    const chatInput = document.querySelector('.game-wrapper input') as HTMLInputElement | null;
    if (chatInput) chatInput.style.visibility = 'visible';
  }
  if (fadeDirection === 'out') {
    fadeTimer += msPerTick;
    fadeAlpha = Math.max(0, 1 - fadeTimer / fadeDuration);
    if (fadeAlpha <= 0) {
      fadeDirection = 'none';
      fadeAlpha = 0;
    }
  }

  if (!!MapleMap.doneLoading) {
    MapleMap.update(msPerTick);

    // Transportation schedules (boats/trains/elevator/timed rides) — wall-clock
    // driven, so it belongs here rather than in any map-local timer
    TransportationManager.update(MapleMap, (m, p) => MapStateInstance.changeMap(m, p));
    HenesysPQ.update(msPerTick);

    // Update ShopUI
    if (ShopUI.isVisible) {
      ShopUI.update(msPerTick);
    }

    // Cash Shop overlay — the world underneath keeps ticking (mob host!)
    if (CashShopUI.isVisible) {
      CashShopUI.update(msPerTick);
    }

    // Megaphone banner animation/expiry (world-wide shouts)
    UIAvatarMegaphone.update(msPerTick);

    // When dead, only update tombstone animation + death dialog, block all input
    if (MyCharacter.isDead) {
      MyCharacter.update(msPerTick);
      if (canvas.clicked && MyCharacter.deathDialogVisible) {
        MyCharacter.handleDeathDialogClick(canvas);
      }
      Camera.lookAt(MyCharacter.deathPosX, MyCharacter.deathPosY - 78);
      UIMap.doUpdate(msPerTick, camera, canvas);
      return;
    }

    if (this.isTouchControllsEnabled) {
      switch (this.joyStick.cardinalDirection) {
        case JoyStickDirections.N:
          MyCharacter.upClick();
          break;
        case JoyStickDirections.S:
          MyCharacter.downClick();
          break;
        case JoyStickDirections.E:
          MyCharacter.rightClick();
          break;
        case JoyStickDirections.W:
          MyCharacter.leftClick();
          break;
        case JoyStickDirections.NE:
          MyCharacter.upClick();
          MyCharacter.rightClick();
          break;
        case JoyStickDirections.NW:
          MyCharacter.upClick();
          MyCharacter.leftClick();
          break;
        case JoyStickDirections.SE:
          MyCharacter.downClick();
          MyCharacter.rightClick();
          break;
        case JoyStickDirections.SW:
          MyCharacter.downClick();
          MyCharacter.leftClick();
          break;
        case JoyStickDirections.C:
          MyCharacter.downClickRelease();
          MyCharacter.upClickRelease();
          MyCharacter.leftClickRelease();
          MyCharacter.rightClickRelease();
          break;
        default:
          break;
      }
      MyCharacter.update(msPerTick);
    } else {
      // Cutscene: advance the scene and swallow all player input (GMS locks
      // the UI while a Direction intro plays)
      DirectionScene.update(msPerTick);
      const questDialogOpen = MapleMap.questDialog && !MapleMap.questDialog.isHidden;
      // UIGameMenu is included so its arrow-key navigation doesn't also walk
      // the character around underneath the open panel; the windows it opens
      // are included for the same reason — the character should stand still
      // while an option dialog has the screen.
      const dialogOpen =
        (MapleMap.npcDialog && !MapleMap.npcDialog.isHidden) || ShopUI.isVisible ||
        CashShopUI.isVisible || UIAvatarMegaphone.isDialogOpen || questDialogOpen ||
        DirectionScene.isActive || UIGameMenu.isVisible ||
        UISystemOption.isVisible || UIGameOption.isVisible ||
        UIChannelSelect.isVisible || UIKeyConfig.isVisible || UIWorldMap.isVisible;

      if (!dialogOpen) {
        if (canvas.isKeyDown("up")) {
          MyCharacter.upClick();
        }
        if (canvas.isKeyDown("down")) {
          MyCharacter.downClick();
        }
        if (canvas.isKeyDown("left")) {
          MyCharacter.leftClick();
        }
        if (canvas.isKeyDown("right")) {
          MyCharacter.rightClick();
        }
        // Held, not edge-triggered: holding jump while walking keeps hopping,
        // re-firing each time the last jump lands. What stops that flying is
        // the landed check in canJump, not the key edge — Physics.jump()
        // assigns vy outright, so anything that lets it run while the
        // character is still rising re-launches at full speed every frame.
        if (actionDown(canvas, "jump")) {
          MyCharacter.tryJump(
            canvas.isKeyDown("left") || canvas.isKeyDown("right")
          );
        } else {
          // Letting go re-arms the rope push-off. Catching a rope disarms it,
          // so a jump key that was already held when the rope was caught
          // cannot launch until it has been released and pressed again.
          MyCharacter.ropePushArmed = true;
        }
        if (actionDown(canvas, "attack")) {
          MyCharacter.attack();
        }
        if (actionDown(canvas, "pickup")) {
          MyCharacter.pickUp();
        }
      }

      if (actionPressed(canvas, "stats") && !DirectionScene.isActive) {
        this.statsMenu.setIsHidden(!this.statsMenu.isHidden);
      }
      if (actionPressed(canvas, "inventory") && !DirectionScene.isActive) {
        this.inventoryMenu.setIsHidden(!this.inventoryMenu.isHidden);
      }
      if (actionPressed(canvas, "questLog") && !DirectionScene.isActive) {
        this.questLog.setIsHidden(!this.questLog.isHidden);
      }
      if (actionPressed(canvas, "miniMap")) {
        // v83: M toggles the minimap between full view and the collapsed
        // title strip — it can never be removed completely
        UIMiniMap.viewMode = UIMiniMap.viewMode === 'max' ? 'min' : 'max';
      }
      if (actionPressed(canvas, "worldMap") && !DirectionScene.isActive) {
        UIWorldMap.toggle(Number(MapleMap.mapId ?? 0));
      }
      if (actionPressed(canvas, "equipment") && !DirectionScene.isActive) {
        this.equipMenu.setIsHidden(!this.equipMenu.isHidden);
      }
      if (actionPressed(canvas, "skills") && !DirectionScene.isActive) {
        this.skillMenu.setIsHidden(!this.skillMenu.isHidden);
      }
      if (actionPressed(canvas, "party") && !DirectionScene.isActive) {
        this.partyMenu.setIsHidden(!this.partyMenu.isHidden);
      }
      // Face emotes (F1-F7 by default) — held 5s, synced to other players
      for (const faceAction of Object.keys(FACE_EXPRESSIONS) as BindableAction[]) {
        if (actionPressed(canvas, faceAction)) {
          MyCharacter.playEmote(FACE_EXPRESSIONS[faceAction]);
        }
      }
      if (actionPressed(canvas, "keyConfig") && !DirectionScene.isActive) {
        UIKeyConfig.toggle();
      }
      if (actionPressed(canvas, "sit") && !DirectionScene.isActive) {
        // v83 sits on a seat defined in the map; this client has no map
        // seats, so the key drives the chair system instead — stand up if
        // seated, otherwise sit on the first chair in the Setup tab.
        const chr: any = MyCharacter;
        if (chr.chairId) {
          chr.standUpFromChair();
        } else if (!chr.isDead && !chr.isInClimbingRope && chr.pos?.fh) {
          // Same guards the inventory double-click applies: no sitting
          // mid-air, on a rope or while dead.
          const chair = chr.inventory?.setup?.find(
            (it: any) => it && it.itemId >= 3010000 && it.itemId < 3020000
          );
          if (chair) chr.sitOnChair(chair.itemId);
        }
      }

      // Edge-triggered: ESC now toggles the game menu, and without this a held
      // key would open and close it once per frame.
      if (canvas.isKeyDown("esc") && !this.previousKeyboardState.esc && !DirectionScene.isActive) {
        // First check if any dialog is open
        if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
          MapleMap.questDialog.hide();
        } else if (MapleMap.npcDialog && !MapleMap.npcDialog.isHidden) {
          MapleMap.npcDialog.setIsHidden(true);
        } else if (CashShopUI.isVisible) {
          // First ESC closes the confirm dialog, the next one leaves the shop
          CashShopUI.escape();
        } else if (ShopUI.isVisible) {
          ShopUI.hide();
        } else if (UIWorldMap.isVisible) {
          UIWorldMap.escape();
        } else if (UIKeyConfig.isVisible) {
          UIKeyConfig.hide();
        } else if (UISystemOption.isVisible) {
          UISystemOption.hide();
        } else if (UIGameOption.isVisible) {
          UIGameOption.hide();
        } else if (UIChannelSelect.isVisible) {
          UIChannelSelect.hide();
        } else if (UIGameMenu.isVisible) {
          UIGameMenu.hide();
        } else {
          const notHiddenMenus = this.UIMenus.filter((menu) => !menu.isHidden);
          if (notHiddenMenus.length > 0) {
            notHiddenMenus[notHiddenMenus.length - 1].setIsHidden(true);
          } else {
            // Nothing left to dismiss — v83 opens the game menu instead.
            UIGameMenu.open();
          }
        }
      }

      // Keyboard navigation for the game menu. Movement is already suppressed
      // via dialogOpen above, so the arrows are free to drive the cursor.
      if (UIGameMenu.isVisible) {
        if (canvas.isKeyDown("up") && !this.previousKeyboardState.up) {
          UIGameMenu.moveSelection(-1);
        }
        if (canvas.isKeyDown("down") && !this.previousKeyboardState.down) {
          UIGameMenu.moveSelection(1);
        }
        if (canvas.isKeyDown("enter") && !this.previousKeyboardState.enter) {
          UIGameMenu.activateSelected();
        }
      }

      // Check hotkey bar activations
      if (!dialogOpen) {
        UIHotkeyBar.checkKeyActivations(canvas);
      }

      // Process drag and drop
      const drop = DragManager.update(canvas);
      if (drop) {
        // The key config window gets first refusal: it is the only way to put
        // an item on a key outside the eight quickslots.
        if (!UIKeyConfig.handleDrop(drop)) {
          UIHotkeyBar.handleDrop(drop);
        }
      }

      // Items bound directly to a key (see KeyBindings.itemBindings)
      if (!dialogOpen) {
        checkItemKeys(canvas);
      }

      MyCharacter.update(msPerTick);

      // Releases must fire only on the actual key-up transition. Calling
      // them every not-held frame broke climbing: downClickRelease() ran on
      // every frame while climbing UP, zeroing the climb velocity and the
      // isClimbMoving animation flag right before each draw
      if (!canvas.isKeyDown("up") && this.previousKeyboardState.up) {
        MyCharacter.upClickRelease();
      }
      if (!canvas.isKeyDown("down") && this.previousKeyboardState.down) {
        MyCharacter.downClickRelease();
      }
      if (!canvas.isKeyDown("left")) {
        MyCharacter.leftClickRelease();
      }
      if (!canvas.isKeyDown("right")) {
        MyCharacter.rightClickRelease();
      }
    }

    // Latch every bound action once per frame (see previousActionState).
    latchActions(canvas);
    this.previousKeyboardState.esc = canvas.isKeyDown("esc");
    this.previousKeyboardState.enter = canvas.isKeyDown("enter");
    this.previousKeyboardState.alt = canvas.isKeyDown("alt");
    // Release the Enter that confirmed a game-menu entry, so the next press is
    // free to open the chat again.
    if (!canvas.isKeyDown("enter")) UIGameMenu.swallowEnter = false;
    this.previousKeyboardState.up = canvas.isKeyDown("up");
    this.previousKeyboardState.down = canvas.isKeyDown("down");
    this.previousKeyboardState.left = canvas.isKeyDown("left");
    this.previousKeyboardState.right = canvas.isKeyDown("right");

    // Out-of-bounds detection: if player falls below map bottom, fade + respawn
    if (!oobRespawning && MapleMap.boundaries && !MyCharacter.isDead) {
      const bottomLimit = MapleMap.boundaries.bottom + 300;
      if (MyCharacter.pos.y > bottomLimit || !MapleMap.isPositionValid(MyCharacter.pos.x, MyCharacter.pos.y)) {
        oobRespawning = true;
        fadeAlpha = 1;
        fadeDirection = 'none';

        // Find a safe position: spawn portal or nearest foothold
        let safePos: { x: number; y: number } | null = null;
        if (MapleMap.portals?.length > 0) {
          const spawnPortal = MapleMap.portals.find((p: any) => p.type === 0);
          if (spawnPortal) safePos = { x: spawnPortal.x, y: spawnPortal.y };
        }
        if (!safePos) {
          safePos = MapleMap.getCenterFootholdLocation?.() || null;
        }
        if (safePos) {
          MyCharacter.pos.x = safePos.x;
          MyCharacter.pos.y = safePos.y;
        }
        MyCharacter.pos.vx = 0;
        MyCharacter.pos.vy = 0;
        MyCharacter.pos.fh = null;
        MyCharacter.pos.lf = null;
        MyCharacter.pos.djump = null;
        MyCharacter.pos.isClimbing = false;
        MyCharacter.pos.fallStartY = MyCharacter.pos.y;
        MyCharacter.pos.fallDistance = 0;
        MyCharacter.pos.landingImpactVy = 0;

        // Short delay then fade in
        setTimeout(() => {
          fadeDirection = 'out';
          fadeTimer = 0;
          oobRespawning = false;
        }, 300);
      }
    }

    Camera.lookAt(MyCharacter.pos.x, MyCharacter.pos.y - 78);

    UIMap.doUpdate(msPerTick, camera, canvas);
    UIMiniMap.update(msPerTick);
    UIQuestAlarm.update(msPerTick, canvas);
    DebugDrag.update(canvas.mouseX, canvas.mouseY, canvas.clicked);

    // A press raises the window under it before anything reads the click, so
    // the window you clicked is both on top and the one that responds.
    // Latched: canvas.clicked stays true for the whole press.
    // Re-registered every tick rather than once at map load: the menu list is
    // rebuilt when a map loads, and a stale stack means ownership is decided
    // against instances nobody is looking at any more.
    DragableMenu.setStack(this.UIMenus);

    if (canvas.clicked) {
      if (!menuFocusLatched) {
        menuFocusLatched = true;
        DragableMenu.raiseAt(canvas.mouseX, canvas.mouseY);
      }
    } else {
      menuFocusLatched = false;
    }

    this.UIMenus.forEach((menu) => {
      menu.update(msPerTick, camera, canvas);
    });
  }
};

MapStateInstance.doRender = function (
  canvas: GameCanvas,
  camera: CameraInterface,
  lag: number,
  msPerTick: number,
  tdelta: number
) {
  if (!!MapleMap.doneLoading) {
    MapleMap.render(canvas, camera, lag, msPerTick, tdelta);

    // Player character is now drawn within MapleMap.render() at the correct layer

    // NPC dialog on top of player
    MapleMap.npcDialog?.draw(canvas, camera, lag, msPerTick, tdelta);

    // Quest dialog on top of NPC dialog
    if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
      MapleMap.questDialog.draw(canvas, camera, lag, msPerTick, tdelta);
    }

    // KEYBOARD SETTING sits under the draggable menus. Its input still runs
    // from UIMap.doUpdate; only the drawing moved here, because that block
    // runs after this one and the window covered anything opened on top.
    UIKeyConfig.draw(canvas, camera, lag, msPerTick, tdelta);

    this.UIMenus.forEach((menu) => {
      menu.draw(canvas, camera, lag, msPerTick, tdelta);
    });

    // Draw ShopUI on top of game elements
    if (ShopUI.isVisible) {
      ShopUI.render(canvas, camera);
    }

    // Draw death dialog on top of game but under cursor
    if (MyCharacter.deathDialogVisible) {
      MyCharacter.drawDeathDialog(canvas);
    }

    // Job-intro cutscenes are full-screen: everything that frames the game
    // stays down for the duration so only the scene shows. The Cash Shop
    // overlay borrows the same treatment — HUD, minimap and chat input all
    // drop while it has the screen.
    // Touch devices replace the desktop status bar/quickslot with the
    // MobileHUD + touch controls (MapleStory M style)
    const mobileHud = TouchControls.active;
    MobileHUD.active = mobileHud;
    if (mobileHud) {
      for (const btn of (UIMap as any).buttons ?? []) btn.isHidden = true;
      UIHotkeyBar.isVisible = false;
    }

    const inCutscene = DirectionScene.isActive || CashShopUI.isVisible;
    setHudHiddenForCutscene(inCutscene || mobileHud);

    if (!inCutscene) {
      // Hotkey bar above status bar
      UIHotkeyBar.render(canvas, camera);

      // Buff icons at top-right of screen
      if (MyCharacter.buffManager?.count > 0) {
        const buffBarX = canvas.game.width - 30 - (MyCharacter.buffManager.count * 26);
        MyCharacter.buffManager.renderBuffIcons(canvas, buffBarX, 5);
      }

      // Minimap on top of game world
      UIMiniMap.render(canvas, camera);

      // Quest Helper widget + quest notice balloons
      UIQuestAlarm.render(canvas);
    }

    // Direction cutscene overlay (job-experience rooms) above the world
    DirectionScene.render(canvas, camera);

    // Cash Shop covers everything except the cursor (UIMap draws it next)
    if (CashShopUI.isVisible) {
      CashShopUI.render(canvas, camera);
    }

    // Megaphone banner + message dialog — over the world and the cash shop,
    // under the cursor
    UIAvatarMegaphone.render(canvas);

    // UIMap draws HUD + cursor (HUD suppressed while hudHidden)
    UIMap.doRender(canvas, camera, lag, msPerTick, tdelta);

    // Party quest overlays: event timer clock, map-effect banner, clear effect
    HenesysPQ.render(canvas);

    // On-screen joystick/buttons + mobile HUD (touch devices only) — topmost
    TouchControls.draw(canvas);
    MobileHUD.draw(canvas);
  }

  // Drag ghost icon — on top of all UI
  DragManager.render(canvas);

  // Debug drag overlay (F9)
  DebugDrag.drawAll(canvas);

  // Fade overlay on top of everything (including cursor during transitions)
  if (fadeAlpha > 0) {
    canvas.context.save();
    canvas.context.globalAlpha = fadeAlpha;
    canvas.context.fillStyle = '#000000';
    canvas.context.fillRect(0, 0, canvas.game.width, canvas.game.height);
    canvas.context.restore();
  }
};

declare global {
  interface Window {
    MapStateInstance: MapState;
  }
}

// Expose MapStateInstance globally
window.MapStateInstance = MapStateInstance;

export default MapStateInstance;
