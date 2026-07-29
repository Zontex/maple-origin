import GameCanvas from "../GameCanvas";

class MapleInput {
  opts: any = {};
  input: any = {};
  focusListeners: any = [];
  focusoutListeners: any = [];
  submitListeners: any = [];
  reposition: () => void = () => {};
  private resizeHandler: (() => void) | null = null;

  constructor(canvas: GameCanvas, opts: any) {
    const x = opts.x || 0;
    const y = opts.y || 0;
    const width = opts.width || 150;
    const height = opts.height || 12;
    const background = opts.background || "transparent";
    const border = opts.border || "none";
    const color = opts.color || "#000000";
    const fontSize = opts.fontSize || 12;
    const cursor = opts.cursor || "none";
    const type = opts.type || "text";
    const focusListeners = opts.focusListeners || [];
    const focusoutListeners = opts.focusoutListeners || [];
    const submitListeners = opts.submitListeners || [];
    const input = document.createElement("input");

    this.opts = opts;
    this.input = input;
    this.focusListeners = [
      () => {
        canvas.focusInput = true;
      },
      ...focusListeners,
    ];
    this.focusoutListeners = [
      () => {
        canvas.focusInput = false;
      },
      ...focusoutListeners,
    ];
    this.submitListeners = [...submitListeners];

    // Scale DOM position to match the CSS-scaled canvas; recomputed on
    // window resize so the input tracks the canvas instead of going stale
    this.reposition = () => {
      const gameEl = document.getElementById('game') as HTMLCanvasElement | null;
      let scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0;
      if (gameEl) {
        const rect = gameEl.getBoundingClientRect();
        scaleX = rect.width / gameEl.width;
        scaleY = rect.height / gameEl.height;
        offsetX = rect.left;
        offsetY = rect.top;
      }
      input.style.left = `${offsetX + (this.opts.x || 0) * scaleX}px`;
      input.style.top = `${offsetY + (this.opts.y || 0) * scaleY}px`;
      input.style.width = `${width * scaleX}px`;
      input.style.height = `${height * scaleY}px`;
      input.style.fontSize = `${fontSize * scaleY}px`;
    };
    this.reposition();
    this.resizeHandler = () => this.reposition();
    window.addEventListener('resize', this.resizeHandler);

    input.style.background = background;
    input.style.border = border;
    input.style.color = color;
    input.style.cursor = cursor;
    input.style.position = "fixed";
    input.style.outline = "none";
    input.style.boxShadow = "none";
    input.style.padding = "0";
    input.style.caretColor = color;
    input.style.zIndex = "10";

    input.type = type;

    input.addEventListener("focus", () => {
      this.focusListeners.forEach((listener: Function) => listener());
    });
    input.addEventListener("focusout", () => {
      this.focusoutListeners.forEach((listener: Function) => listener());
    });
    input.addEventListener("keydown", (e) => {
      if (e.keyCode === canvas.keys.enter) {
        e.preventDefault();
        e.stopPropagation();
        this.submitListeners.forEach((listener: Function) => listener());
      }
    });

    canvas.gameWrapper.appendChild(input);
  }
  addFocusListener(listener: Function) {
    this.focusListeners.push(listener);
  }
  addFocusoutListener(listener: Function) {
    this.focusoutListeners.push(listener);
  }
  addSubmitListener(listener: Function) {
    this.submitListeners.push(listener);
  }
  /** Move the input to a new canvas-space position (e.g. tracking the camera) */
  setCanvasPos(x: number, y: number) {
    if (this.opts.x === x && this.opts.y === y) return;
    this.opts.x = x;
    this.opts.y = y;
    this.reposition();
  }

  remove() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    this.input.remove();
  }
}

export default MapleInput;
