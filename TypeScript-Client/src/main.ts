import "./style.css";

import GameLoop from "./Gameloop";
import Timer from "./Timer";
import WZManager from "./wz-utils/WZManager";
import Camera from "./Camera";
import SessionManager from "./SessionManager";
import MySocket, { DISCONNECTED_FLAG } from "./mysocket";
import UILogin from "./UI/UILogin";
import { NoticeType, NoticeMessage } from "./UI/UILoginNotice";
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

  // Set by the socket when it gives up reconnecting and reloads us back to
  // login. Read once and cleared, so it only explains the reload it followed.
  let wasDisconnected = false;
  try {
    wasDisconnected = sessionStorage.getItem(DISCONNECTED_FLAG) !== null;
    if (wasDisconnected) sessionStorage.removeItem(DISCONNECTED_FLAG);
  } catch {}

  // Dev auto-login: skip login screen on HMR reload. All network steps
  // inside reject on timeout, so a hung server connection can never leave
  // the game on a black screen — worst case we fall back to normal login.
  // Skipped after a disconnect, which would otherwise silently drop the
  // player straight back into the session they were just kicked out of.
  let autoLoggedIn = false;
  if (!wasDisconnected && hasDevSession()) {
    autoLoggedIn = await tryAutoLogin(canvas);
  }

  if (!autoLoggedIn) {
    await StateManager.setState(LoginState, canvas);
    if (wasDisconnected) {
      UILogin.showNotice(
        NoticeType.NORMAL,
        NoticeMessage.UNABLE_TO_CONNECT_GAME_SERVER
      );
    }
  }

  let Loop = new GameLoop(canvas);
  Loop.gameLoop();
};

startGame();
