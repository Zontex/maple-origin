import "./style.css";

import GameLoop from "./Gameloop";
import Timer from "./Timer";
import WZManager from "./wz-utils/WZManager";
import Camera from "./Camera";
import SessionManager from "./SessionManager";
import MySocket from "./mysocket";
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
  let autoLoggedIn = false;
  if (hasDevSession()) {
    autoLoggedIn = await tryAutoLogin(canvas);
  }

  if (!autoLoggedIn) {
    await StateManager.setState(LoginState, canvas);
  }

  let Loop = new GameLoop(canvas);
  Loop.gameLoop();
};

startGame();
