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

const startGame = async () => {
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
