import Timer from "./Timer";
import Camera, { CameraInterface } from "./Camera";
import StateManager from "./StateManager";
import config from "./Config";
import GameCanvas from "./GameCanvas";
import UIDevTools from "./UI/UIDevTools";

class GameLoop {
  fps = 60;
  msPerTick = 1000 / this.fps;
  lag = 0;
  gameCanvas: GameCanvas;

  constructor(gameCanvas: GameCanvas) {
    this.gameCanvas = gameCanvas;
  }

  doUpdate(msPerTick: number, camera: CameraInterface, canvas: GameCanvas) {
    StateManager.doUpdate(msPerTick, camera, canvas);
    camera.update();
  }

  doRender(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    UIDevTools.beginFrame();
    canvas.drawRect({
      x: 0,
      y: 0,
      width: config.width,
      height: config.height,
      color: "#000000",
    });
    StateManager.doRender(canvas, camera, lag, msPerTick, tdelta);
    UIDevTools.endFrame(canvas);
  }

  postRender(canvas: GameCanvas) {
    canvas.resetMousewheel();
  }

  gameLoop(highResTimestamp: number = 0) {
    requestAnimationFrame(() => this.gameLoop());

    Timer.update();
    // Liveness heartbeat. Driven from here on purpose: rAF stops in a
    // background tab while setInterval keeps running, so this is what tells
    // the server whether our game loop is actually alive. Reached through
    // the window global to avoid an import cycle (mysocket -> MapleMap -> …).
    (window as any).__mySocket?.notifyFrame?.();
    this.lag += Timer.delta;
    // Cap catch-up: rAF pauses in background tabs, so after minutes away an
    // uncapped lag would run thousands of update ticks in one frame and hang
    // the page ("Page Unresponsive"). Skip the lost time instead.
    if (this.lag > 250) this.lag = 250;
    while (this.lag >= this.msPerTick) {
      this.lag -= this.msPerTick;
      Timer.tdelta += this.msPerTick;
      // TODO: fix ordering of these variables
      this.doUpdate(this.msPerTick, Camera, this.gameCanvas);
    }
    this.doRender(
      this.gameCanvas,
      Camera,
      this.lag,
      this.msPerTick,
      Timer.tdelta
    );
    this.postRender(this.gameCanvas);
  }
}

export default GameLoop;
