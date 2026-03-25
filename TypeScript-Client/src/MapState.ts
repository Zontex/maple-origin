import MapleMap from "./MapleMap";
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
import TaxiUI from "./UI/TaxiUI";
import WZManager from "./wz-utils/WZManager";

// henesys 100000000
// 100020100 - maps with pigs - useful to test fast things with mobs
const defaultMap = 1000000; // Southperry (Pio's map - has reactors)
// const defaultMap = 100000000; // henesys
// const defaultMap = 104040000; // left of henesys
// const defaultMap: number = 100040102; // elinia - monkey map

export interface MapState extends UIState {
  changeMap: (map: number) => Promise<void>;
  isTouchControllsEnabled: boolean;
  joyStick: JoyStick;
  statsMenu: StatsMenuSprite;
  inventoryMenu: InventoryMenuSprite;
  questLog: QuestLogMenuSprite;
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
  };
}

const MapStateInstance = {} as MapState;

// Fade overlay for map transitions
let fadeAlpha = 1; // Start fully black
let fadeDirection: 'out' | 'none' = 'none'; // 'out' = revealing
const fadeDuration = 500; // ms
let fadeTimer = 0;
let fadeWaitForDoneLoading = false; // Wait for map to finish loading before fading in

// Call before map.load() — holds black screen until doneLoading
export function fadeToBlack() {
  fadeAlpha = 1;
  fadeDirection = 'none';
  fadeWaitForDoneLoading = true;
  // Hide chat input during transition
  const chatInput = document.querySelector('.game-wrapper input') as HTMLInputElement | null;
  if (chatInput) chatInput.style.visibility = 'hidden';
}

async function initializeMapState(map = defaultMap, isFirstUpdate = false, portalName?: string) {
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
    // Ensure fade-in still happens so user isn't stuck on black screen
    MapleMap.doneLoading = true;
  }

  MyCharacter.map = MapleMap;

  if (isFirstUpdate) {
    await UIMap.initialize();
  }

  // Spawn at named portal if specified, otherwise first spawn portal (index 0)
  let spawned = false;
  if (portalName && portalName !== 'sp' && MapleMap.portals) {
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
  // Fade-in will be triggered automatically when doneLoading becomes true
}

MapStateInstance.changeMap = async function (map = defaultMap, portalName?: string) {
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

  this.UIMenus = [this.statsMenu, this.inventoryMenu, this.questLog];

  // Close all open UI menus (called when NPC/quest dialogs open)
  this.closeAllMenus = () => {
    this.UIMenus.forEach((menu: any) => menu.setIsHidden(true));
  };

  // Set a reference to the player character for TaxiUI
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
  };

  await initializeMapState(map, true);

  // --- Attach click event listener to the canvas element using the correct id ---
  const canvasElement = document.getElementById("game"); // updated to "game"
  if (canvasElement) {
    canvasElement.addEventListener("click", (event) => {
      // Handle selection clicks on quest/NPC script dialogs
      if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
        const rect = canvasElement.getBoundingClientRect();
        const scaleX = rect.width / (canvasElement as HTMLCanvasElement).width;
        const scaleY = rect.height / (canvasElement as HTMLCanvasElement).height;
        const cx = (event.clientX - rect.left) / scaleX;
        const cy = (event.clientY - rect.top) / scaleY;
        if (MapleMap.questDialog.handleClick(cx, cy)) return;
      }
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

    // Update TaxiUI
    if (TaxiUI.isVisible) {
      TaxiUI.update(msPerTick);
      // Don't return early, continue updating the game state
      // This allows the TaxiUI to handle clicks while game runs in background
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
      const questDialogOpen = MapleMap.questDialog && !MapleMap.questDialog.isHidden;
      const dialogOpen = !MapleMap.npcDialog.isHidden || TaxiUI.isVisible || questDialogOpen;

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
        if (canvas.isKeyDown("alt")) {
          MyCharacter.jump();
        }
        if (canvas.isKeyDown("ctrl")) {
          MyCharacter.attack();
        }
        if (canvas.isKeyDown("z")) {
          MyCharacter.pickUp();
        }
      }

      if (canvas.isKeyDown("s") && !this.previousKeyboardState.s) {
        this.statsMenu.setIsHidden(!this.statsMenu.isHidden);
      }
      if (canvas.isKeyDown("i") && !this.previousKeyboardState.i) {
        this.inventoryMenu.setIsHidden(!this.inventoryMenu.isHidden);
      }
      if (canvas.isKeyDown("q") && !this.previousKeyboardState.q) {
        this.questLog.setIsHidden(!this.questLog.isHidden);
      }

      if (canvas.isKeyDown("esc")) {
        // First check if any dialog is open
        if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
          MapleMap.questDialog.hide();
        } else if (!MapleMap.npcDialog.isHidden) {
          MapleMap.npcDialog.setIsHidden(true);
        } else if (TaxiUI.isVisible) {
          TaxiUI.hide();
        } else {
          const notHiddenMenus = this.UIMenus.filter((menu) => !menu.isHidden);
          if (notHiddenMenus.length > 0) {
            notHiddenMenus[notHiddenMenus.length - 1].setIsHidden(true);
          }
        }
      }

      MyCharacter.update(msPerTick);

      if (!canvas.isKeyDown("up")) {
        MyCharacter.upClickRelease();
      }
      if (!canvas.isKeyDown("down")) {
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
    this.previousKeyboardState.up = canvas.isKeyDown("up");
    this.previousKeyboardState.down = canvas.isKeyDown("down");
    this.previousKeyboardState.left = canvas.isKeyDown("left");
    this.previousKeyboardState.right = canvas.isKeyDown("right");

    Camera.lookAt(MyCharacter.pos.x, MyCharacter.pos.y - 78);

    UIMap.doUpdate(msPerTick, camera, canvas);

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

    if (!!MyCharacter.active) {
      MyCharacter.draw(canvas, camera, lag, msPerTick, tdelta);
    }

    // NPC dialog on top of player
    MapleMap.npcDialog.draw(canvas, camera, lag, msPerTick, tdelta);

    // Quest dialog on top of NPC dialog
    if (MapleMap.questDialog && !MapleMap.questDialog.isHidden) {
      MapleMap.questDialog.draw(canvas, camera, lag, msPerTick, tdelta);
    }

    this.UIMenus.forEach((menu) => {
      menu.draw(canvas, camera, lag, msPerTick, tdelta);
    });

    // Draw TaxiUI on top of game elements
    if (TaxiUI.isVisible) {
      TaxiUI.render(canvas, camera);
    }

    // Draw death dialog on top of game but under cursor
    if (MyCharacter.deathDialogVisible) {
      MyCharacter.drawDeathDialog(canvas);
    }

    // UIMap draws HUD + cursor
    UIMap.doRender(canvas, camera, lag, msPerTick, tdelta);
  }

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
