import StateManager from "./StateManager";
import MapState from "./MapState";
import MapleMap from "./MapleMap";
import MyCharacter from "./MyCharacter";
import Camera, { CameraInterface } from "./Camera";
import UILogin from "./UI/UILogin";
import UIState from './UIState';
import GameCanvas from "./GameCanvas";
import MySocket from "./mysocket";
import config from "./Config";

export enum LoginSubState {
  LOGIN_SCREEN = 'LOGIN_SCREEN',
  WORLD_SELECT = 'WORLD_SELECT',
  CHARACTER_SELECT = 'CHARACTER_SELECT',
  CREATE_CHARACTER = 'CREATE_CHARACTER',
}

// v83 MapLogin camera positions (found via debug tool)
const LOGIN_CAMERA_POSITIONS = {
  [LoginSubState.LOGIN_SCREEN]: { x: -370, y: -305 },
  [LoginSubState.WORLD_SELECT]: { x: -375, y: -900 },
  [LoginSubState.CHARACTER_SELECT]: { x: -375, y: -1525 },
  [LoginSubState.CREATE_CHARACTER]: { x: -375, y: -3325 },
};

interface LoginState extends UIState {
  currentSubState: LoginSubState;
  switchToSubState: (subState: LoginSubState) => Promise<void>;
  enterGame: () => Promise<void>;
}

const LoginState: LoginState = {
  currentSubState: LoginSubState.LOGIN_SCREEN,

  async initialize(canvas?: GameCanvas): Promise<void> {
    MyCharacter.deactivate();
    await MapleMap.load("MapLogin");

    // Load the character early so we can render it on the select screen
    if (!MyCharacter.baseBody) {
      await MyCharacter.load();
    }

    // Extend camera boundaries to allow scrolling to all login screen sections
    // (the map footholds don't cover the create character area)
    Camera.setBoundaries({ left: -800, right: 1600, top: -5000, bottom: 1200 });

    const initialPos = LOGIN_CAMERA_POSITIONS[LoginSubState.LOGIN_SCREEN];
    Camera.setTopLeft(initialPos.x, initialPos.y);

    this.currentSubState = LoginSubState.LOGIN_SCREEN;
    await UILogin.initialize(canvas);
  },

  async switchToSubState(subState: LoginSubState): Promise<void> {
    const previousState = this.currentSubState;
    this.currentSubState = subState;

    if (subState !== LoginSubState.LOGIN_SCREEN) {
      UILogin.removeInputs();
    }

    if (subState === LoginSubState.WORLD_SELECT) {
      UILogin.startSelectWorldChannelImgSlideIn();
    }
    if (previousState === LoginSubState.WORLD_SELECT) {
      UILogin.startSelectWorldChannelImgFadeOut();
    }

    if (subState === LoginSubState.CHARACTER_SELECT) {
      UILogin.startSelectCharacterImgSlideIn();
      UILogin.startSelectedWorldSlideIn();
    }
    if (previousState === LoginSubState.CHARACTER_SELECT) {
      UILogin.startSelectCharacterImgFadeOut();
      UILogin.selectedWorldImageAnimation.active = false;
    }

    if (subState === LoginSubState.CREATE_CHARACTER) {
      UILogin.initCreateCharacter();
    }
    if (previousState === LoginSubState.CREATE_CHARACTER) {
      UILogin.cleanupCreateCharacter();
    }

    const newPos = LOGIN_CAMERA_POSITIONS[subState];
    Camera.setTopLeft(newPos.x, newPos.y);
    Camera.update();
  },

  doUpdate(
    msPerTick: number,
    camera: CameraInterface,
    canvas: GameCanvas
  ): void {
    if (MapleMap.doneLoading) {
      MapleMap.update(msPerTick);

      UILogin.doUpdate(msPerTick, camera, canvas);
    }
  },

  doRender(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ): void {
    if (MapleMap.doneLoading) {
      MapleMap.render(canvas, camera, lag, msPerTick, tdelta);
      UILogin.doRender(canvas, camera, lag, msPerTick, tdelta);
    }
  },

  async enterGame(): Promise<void> {
    UILogin.removeInputs();

    // Set starting map from saved character data (MapState.initialize reads this)
    const startMapId = (MyCharacter as any)._startMapId;
    if (startMapId) {
      (MapState as any)._startMapOverride = startMapId;
    }

    await StateManager.setState(MapState);
    MapleMap.PlayerCharacter = MyCharacter;

    // Set saved position if available
    const posX = (MyCharacter as any)._startPosX;
    const posY = (MyCharacter as any)._startPosY;
    if (posX !== undefined && posY !== undefined) {
      MyCharacter.pos.x = posX;
      MyCharacter.pos.y = posY;
    }

    // Initialize multiplayer (update loop, player info) — socket is already connected from login
    await MySocket.initialize();
  },
};

export default LoginState;
