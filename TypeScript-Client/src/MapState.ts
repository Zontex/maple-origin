import MapleMap from "./MapleMap";
(window as any).__MapleMap = MapleMap;
import MyCharacter from "./MyCharacter";
import UIState from './UIState';
import Camera, { CameraInterface } from "./Camera";
import { enterBrowserFullscreen } from "./Config";
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
import WZManager from "./wz-utils/WZManager";
import UIMiniMap from "./UI/UIMiniMap";
import UIQuestAlarm from "./UI/UIQuestAlarm";
import EquipMenuSprite from "./UI/Menu/EquipMenuSprite";
import SkillMenuSprite from "./UI/Menu/SkillMenuSprite";
import UIHotkeyBar from "./UI/UIHotkeyBar";
import UIGameMenu from "./UI/UIGameMenu";
import UIChannelSelect from "./UI/UIChannelSelect";
import UISystemOption from "./UI/UISystemOption";
import UIGameOption from "./UI/UIGameOption";
import MySocket from "./mysocket";
import DebugDrag from "./UI/DebugDrag";
import DragManager from "./UI/DragManager";
import DirectionScene from "./Effects/DirectionScene";
import TransportationManager from "./Transport/TransportationManager";

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
  UIMenus: any[];
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

  // Spawn at named portal if specified, otherwise first spawn portal (index 0)
  let spawned = false;
  if (typeof portalName === 'number' && MapleMap.portals?.[portalName]) {
    // Portal INDEX (Cosmic warpEveryone(map, pto) semantics — transport arrivals)
    const indexedPortal = MapleMap.portals[portalName];
    MyCharacter.pos.x = indexedPortal.x;
    MyCharacter.pos.y = indexedPortal.y;
    spawned = true;
  } else if (typeof portalName === 'string' && portalName && portalName !== 'sp' && MapleMap.portals) {
    // Named portal (e.g. portal-to-portal transitions)
    const namedPortal = MapleMap.portals.find((p: any) => p.name === portalName);
    if (namedPortal) {
      MyCharacter.pos.x = namedPortal.x;
      MyCharacter.pos.y = namedPortal.y;
      spawned = true;
    }
  }
  if (!spawned && MapleMap.portals?.length > 0) {
    // Try spawn portal (type 0) first
    const spawnPortal = MapleMap.portals.find((p: any) => p.type === 0);
    // Fall back to first portal regardless of type
    const fallbackPortal = spawnPortal || MapleMap.portals[0];
    if (fallbackPortal) {
      MyCharacter.pos.x = fallbackPortal.x;
      MyCharacter.pos.y = fallbackPortal.y;
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

  // v83 map-enter scripts (info/onUserEnter): the Maple Island job-experience
  // rooms play a Direction3 cutscene that ends by warping back out
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
  }
  // Fade-in will be triggered automatically when doneLoading becomes true
}

MapStateInstance.changeMap = async function (map = defaultMap, portalName?: string | number) {
  // Auto-save character before map transition
  MySocket.saveCharacterToServer();
  await initializeMapState(map, false, portalName);
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
    
    const nameNode = strMap[area]?.[mapId];
    const streetName = nameNode?.streetName?.nValue || "";
    const mapName = nameNode?.mapName?.nValue || `Map ${mapId}`;
    
    return { streetName, mapName };
  } catch (error) {
    console.error(`Error getting map name for ${mapId}:`, error);
    return { streetName: "", mapName: `Map ${mapId}` };
  }
};

MapStateInstance.initialize = async function (map: number = defaultMap) {
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

  this.UIMenus = [this.statsMenu, this.inventoryMenu, this.equipMenu, this.questLog, this.skillMenu];

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

      // Minimap click (world button)
      if (UIMiniMap.handleClick(cx, cy)) return;

      // Quest Helper widget — swallow clicks over it (handled via wasClicked)
      if (UIQuestAlarm.containsPoint(cx, cy)) return;

      // Handle selection clicks on quest/NPC script dialogs
      if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
        if (MapleMap.questDialog.handleClick(cx, cy)) return;
      }
      // Block NPC/map clicks when any dialog is open
      if (!MapleMap.npcDialog.isHidden || (MapleMap.questDialog && !MapleMap.questDialog.isHidden)) return;
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

    // Update ShopUI
    if (ShopUI.isVisible) {
      ShopUI.update(msPerTick);
    }

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
        !MapleMap.npcDialog.isHidden || ShopUI.isVisible || questDialogOpen ||
        DirectionScene.isActive || UIGameMenu.isVisible ||
        UISystemOption.isVisible || UIGameOption.isVisible ||
        UIChannelSelect.isVisible;

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
        // Edge-triggered: a jump is one impulse per press. Physics.jump()
        // assigns vy outright, so calling it on every frame ALT is held kept
        // re-setting vy to full jump speed and gravity never got to bite —
        // the character rose at constant max speed off the ground, and flew
        // straight up a rope (the isClimbing branch has no airborne check).
        if (canvas.isKeyDown("alt") && !this.previousKeyboardState.alt) {
          MyCharacter.jump();
        }
        if (canvas.isKeyDown("ctrl")) {
          MyCharacter.attack();
        }
        if (canvas.isKeyDown("z")) {
          MyCharacter.pickUp();
        }
      }

      if (canvas.isKeyDown("s") && !this.previousKeyboardState.s && !DirectionScene.isActive) {
        this.statsMenu.setIsHidden(!this.statsMenu.isHidden);
      }
      if (canvas.isKeyDown("i") && !this.previousKeyboardState.i && !DirectionScene.isActive) {
        this.inventoryMenu.setIsHidden(!this.inventoryMenu.isHidden);
      }
      if (canvas.isKeyDown("q") && !this.previousKeyboardState.q && !DirectionScene.isActive) {
        this.questLog.setIsHidden(!this.questLog.isHidden);
      }
      if (canvas.isKeyDown("m") && !this.previousKeyboardState.m) {
        // v83: M toggles the minimap between full view and the collapsed
        // title strip — it can never be removed completely
        UIMiniMap.viewMode = UIMiniMap.viewMode === 'max' ? 'min' : 'max';
      }
      if (canvas.isKeyDown("e") && !this.previousKeyboardState.e && !DirectionScene.isActive) {
        this.equipMenu.setIsHidden(!this.equipMenu.isHidden);
      }
      if (canvas.isKeyDown("k") && !(this.previousKeyboardState as any).k && !DirectionScene.isActive) {
        this.skillMenu.setIsHidden(!this.skillMenu.isHidden);
      }

      // Edge-triggered: ESC now toggles the game menu, and without this a held
      // key would open and close it once per frame.
      if (canvas.isKeyDown("esc") && !this.previousKeyboardState.esc && !DirectionScene.isActive) {
        // First check if any dialog is open
        if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
          MapleMap.questDialog.hide();
        } else if (!MapleMap.npcDialog.isHidden) {
          MapleMap.npcDialog.setIsHidden(true);
        } else if (ShopUI.isVisible) {
          ShopUI.hide();
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
        UIHotkeyBar.handleDrop(drop);
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

    this.previousKeyboardState.i = canvas.isKeyDown("i");
    this.previousKeyboardState.s = canvas.isKeyDown("s");
    this.previousKeyboardState.q = canvas.isKeyDown("q");
    this.previousKeyboardState.m = canvas.isKeyDown("m");
    this.previousKeyboardState.e = canvas.isKeyDown("e");
    (this.previousKeyboardState as any).k = canvas.isKeyDown("k");
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
    MapleMap.npcDialog.draw(canvas, camera, lag, msPerTick, tdelta);

    // Quest dialog on top of NPC dialog
    if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
      MapleMap.questDialog.draw(canvas, camera, lag, msPerTick, tdelta);
    }

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

    // Direction cutscene overlay (job-experience rooms) above the world
    DirectionScene.render(canvas, camera);

    // UIMap draws HUD + cursor
    UIMap.doRender(canvas, camera, lag, msPerTick, tdelta);
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
