import config from "./Config";
import Settings from "./Settings";
import Camera from "./Camera";
import GameCanvas from "./GameCanvas";

// Selectable internal resolutions, MapleStory-Classic style: a larger
// internal resolution renders more world (the sprites stay 1:1), and the
// HUD re-anchors to the true screen edges. 800x600 is the authentic v83
// client and the default.
export const RESOLUTIONS = [
  { width: 800, height: 600 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

export function currentResolutionIndex(): number {
  const idx = RESOLUTIONS.findIndex(
    (r) => r.width === config.width && r.height === config.height
  );
  return idx >= 0 ? idx : 0;
}

/**
 * Enter-game sizing: apply the saved SYSTEM OPTION resolution (or classic
 * 800x600) to config, canvas and camera. Called from MapState.initialize so
 * every path into the game gets it — and only the game: the login flow
 * stays at the classic size.
 */
export function applyConfiguredResolution(canvas: GameCanvas | null) {
  const res = Settings.resolution;
  const width = res?.width ?? config.originalWidth;
  const height = res?.height ?? config.originalHeight;
  config.width = width;
  config.height = height;
  canvas?.setInternalSize(width, height);
  Camera.width = width;
  Camera.height = height;
}

/**
 * Revert to the classic login-screen size. The login map, its camera
 * positions and UILogin's layout are all authored against 800x600.
 */
export function applyLoginResolution(canvas: GameCanvas | null) {
  config.width = config.originalWidth;
  config.height = config.originalHeight;
  canvas?.setInternalSize(config.originalWidth, config.originalHeight);
  Camera.width = config.originalWidth;
  Camera.height = config.originalHeight;
}

/**
 * Switch the game's internal resolution live: config, canvas + CSS aspect,
 * camera viewport, and the status-bar buttons (anchored to the bottom edge
 * at creation time) all follow. Persisted, so the next boot starts with it.
 */
export function applyResolution(
  canvas: GameCanvas | null,
  width: number,
  height: number
) {
  config.width = width;
  config.height = height;
  Settings.setResolution(width, height);

  canvas?.setInternalSize(width, height);

  // Camera reads config only at initialize(); mid-game it must be told.
  // lookAt() re-clamps to the map bounds with the new viewport next frame.
  Camera.width = width;
  Camera.height = height;

  // Dynamic import: UIMap sits behind the game-menu chain that reaches back
  // here (UIMap → UIGameMenu → UISystemOption → Resolution), so a static
  // import would close a cycle.
  if (canvas) {
    import("./UI/UIMap").then(({ default: UIMap }) => {
      (UIMap as any).reanchorButtons?.(canvas);
    });
  }
}
