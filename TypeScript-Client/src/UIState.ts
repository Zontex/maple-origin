import GameCanvas from "./GameCanvas";

export default interface UIState {
  initialize: (canvas?: GameCanvas) => Promise<void>;
  doUpdate: (msPerTick: number, camera: any, canvas: GameCanvas) => void;
  doRender: (canvas: GameCanvas, camera: any, lag: number, msPerTick: number, tdelta: number) => void;
}
