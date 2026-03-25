import GameCanvas from "./GameCanvas";
import ClickManager from "./UI/ClickManager";
import UIState from './UIState';

interface StateManager {
  currentState?: UIState;
  transitioning: boolean;
  initialize: () => void;
  setState: (state: UIState, canvas?: GameCanvas) => Promise<void>;
  doUpdate: (msPerTick: number, camera: any, canvas: GameCanvas) => void; // Replace 'any' with the actual type of your camera if possible
  doRender: (
    canvas: GameCanvas,
    camera: any,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) => void; // Replace 'any' with the actual type of your camera if possible
}

const StateManager: StateManager = {
  currentState: undefined,
  transitioning: false,

  initialize() {
    this.currentState = undefined;
    this.transitioning = false;
  },

  async setState(state: UIState, canvas?: GameCanvas) {
    this.transitioning = true;
    ClickManager.clearButton();
    await state.initialize(canvas);
    this.currentState = state;
    this.transitioning = false;
  },

  doUpdate(msPerTick, camera, canvas) {
    if (!this.transitioning && this.currentState) {
      this.currentState.doUpdate(msPerTick, camera, canvas);
    }
  },

  doRender(canvas, camera, lag, msPerTick, tdelta) {
    if (!this.transitioning && this.currentState) {
      this.currentState.doRender(canvas, camera, lag, msPerTick, tdelta);
      ClickManager.doUpdate(msPerTick, camera);
    }
  },
};

export default StateManager;
