import config from "./Config";
import Settings from "./Settings";
import Camera from "./Camera";
import GameCanvas from "./GameCanvas";
import { showLoginBackdrop, hideLoginBackdrop } from "./LoginBackdrop";

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
 * Enter-game sizing: apply the saved SYSTEM OPTION resolution (or the
 * default) to config, canvas and camera. Called from MapState.initialize so
 * every path into the game gets it — and only the game: the login flow
 * stays at the classic size.
 */
export function applyConfiguredResolution(canvas: GameCanvas | null) {
  const res = Settings.resolution;
  // Desktop default is 1280x720 — widescreen fills modern displays without
  // letterboxing; the classic 800x600 stays available in SYSTEM OPTION.
  // Touch devices with no saved preference get an aspect-fit resolution:
  // fixed 540px world height (closer than desktop 720 — phone screens are
  // small), width matched to the actual screen aspect so the game covers
  // the display edge-to-edge with no pillarboxing. ~1200x540 on a 20:9
  // phone. Still user-overridable in SYSTEM OPTION.
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  let fallbackW = 1280;
  let fallbackH = 720;
  if (isTouch) {
    const long = Math.max(window.innerWidth, window.innerHeight);
    const short = Math.min(window.innerWidth, window.innerHeight);
    const aspect = short > 0 ? long / short : 16 / 9;
    fallbackH = 540;
    fallbackW = Math.min(1440, Math.max(900, Math.round((fallbackH * aspect) / 2) * 2));
  }
  const width = res?.width ?? fallbackW;
  const height = res?.height ?? fallbackH;
  config.width = width;
  config.height = height;
  canvas?.setInternalSize(width, height);
  Camera.width = width;
  Camera.height = height;
  // In-game the canvas covers the window (or the player chose a 4:3 size on
  // purpose) — the wood desk is a login-flow dressing only
  hideLoginBackdrop();
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
  // Classic-style wood desk fills the widescreen letterbox around the book
  showLoginBackdrop();
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
