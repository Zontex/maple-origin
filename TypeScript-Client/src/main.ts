import "./style.css";

import GameLoop from "./Gameloop";
import Timer from "./Timer";
import WZManager from "./wz-utils/WZManager";
import Camera from "./Camera";
import SessionManager from "./SessionManager";
import MySocket, { wasDisconnected } from "./mysocket";
import StateManager from "./StateManager";
import LoginState from "./LoginState";
import GameCanvas from "./GameCanvas";
import ClickManager from "./UI/ClickManager";
import { tryAutoLogin, hasDevSession, saveDevSnapshot } from "./DevAutoLogin";

import config from "./Config";

// Landscape guard for touch devices: show the rotate overlay in portrait,
// and opportunistically lock orientation where the platform allows it
// (Android fullscreen; iOS has no lock API — overlay only).
const setupOrientationGuard = () => {
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return;
  const overlay = document.getElementById("rotate-overlay");
  const update = () => {
    const portrait = window.innerHeight > window.innerWidth;
    if (overlay) overlay.style.display = portrait ? "block" : "none";
  };
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  update();
  // Best-effort native lock (works in installed/fullscreen contexts)
  (screen.orientation as any)?.lock?.("landscape").catch(() => {});

  // First touch: go fullscreen where supported (Android). Hides the URL
  // bar and system chrome, stops edge-swipe gesture theft, and makes the
  // orientation lock actually take. iOS Safari has no element fullscreen —
  // there, "Add to Home Screen" (PWA manifest) gives the same result.
  const goFullscreen = () => {
    const el: any = document.documentElement;
    const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement) {
      Promise.resolve(req.call(el, { navigationUI: "hide" }))
        .then(() => (screen.orientation as any)?.lock?.("landscape").catch(() => {}))
        .catch(() => {});
    }
  };
  window.addEventListener("touchend", goFullscreen, { passive: true });
};

const startGame = async () => {
  setupOrientationGuard();
  const gameWrapper = document.getElementById("game-wrapper");
  const canvas: GameCanvas = new GameCanvas(gameWrapper!);

  canvas.drawRect({
    x: 0,
    y: 0,
    width: config.width,
    height: config.height,
    color: "#000000",
  });
  // First run (production/Capacitor): download the full asset set into
  // Cache Storage with a progress screen, then everything below serves
  // cache-first. Instant no-op once downloaded; skipped in dev.
  const { default: AssetDownloader } = await import("./AssetDownloader");
  await AssetDownloader.ensure(canvas);

  StateManager.initialize();
  ClickManager.initialize(canvas);
  WZManager.initialize();
  Camera.initialize();
  Timer.initialize();

  // Register snapshot saver for beforeunload (used by mysocket.ts)
  (window as any).__saveDevSnapshot = saveDevSnapshot;

  // Dev auto-login: skip login screen on HMR reload. All network steps
  // inside reject on timeout, so a hung server connection can never leave
  // the game on a black screen — worst case we fall back to normal login.
  // Skipped after a disconnect, which would otherwise silently drop the
  // player straight back into the session they were just kicked out of.
  // UILogin.initialize shows the notice; doing it here would mean importing
  // UILogin into the boot path and letting a UI error black-screen the game.
  let autoLoggedIn = false;
  if (!wasDisconnected() && hasDevSession()) {
    autoLoggedIn = await tryAutoLogin(canvas);
  }

  if (!autoLoggedIn) {
    await StateManager.setState(LoginState, canvas);
  }

  let Loop = new GameLoop(canvas);
  Loop.gameLoop();
};

// Anything thrown before Loop.gameLoop() leaves a black screen with no clue
// what happened, so surface it loudly and still start the loop — a login
// screen that renders is recoverable, a dead canvas is not.
startGame().catch((e) => {
  console.error('[BOOT] startGame failed:', e);
  document.title = `BOOT FAILED: ${(e as any)?.message || e}`;
});
