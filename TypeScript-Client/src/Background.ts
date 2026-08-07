import { CameraInterface } from "./Camera";
import GameCanvas from "./GameCanvas";
import config from "./Config";
import WZManager from "./wz-utils/WZManager";

/**
 * Factor that blows the authored background frame up to cover the viewport.
 *
 * Every v83 back layer is drawn to blanket exactly one 800x600 view: the sheets
 * end where the screen ended, and the pieces are placed relative to the screen
 * centre. Give that composition a 1920x1080 window and it comes apart — the
 * island sheets in vicportTown stop in mid-air, and the 256x600 sky tile, typed
 * to repeat on Y where repeating could never show, bands across the lower
 * screen. Rather than tile art that was never meant to tile, the whole layer
 * stack is composed at the authored size and scaled up, so a high-resolution
 * viewport shows the original scene at the original proportions. Only the
 * background scales; the world in front of it stays 1:1.
 */
export function getBackgroundScale(): number {
  return Math.max(
    config.width / config.originalWidth,
    config.height / config.originalHeight
  );
}

class Background {
  wzNode: any;
  ani: boolean = false;
  frames: any[] = [];
  frame: number = 0;
  delay: number = 0;
  nextDelay: number = 0;
  x: number = 0;
  y: number = 0;
  z: number = 0;
  rx: number = 0;
  ry: number = 0;
  cx: number = 0;
  cy: number = 0;
  type: number = 0;
  a: number = 0;
  front: number = 0;
  flipped: boolean = false;
  tileX: boolean = false;
  tileY: boolean = false;
  velocityX: number = 0;
  velocityY: number = 0;

  static async fromWzNode(wzNode: any) {
    const bg = new Background(wzNode);
    await bg.load();
    return bg;
  }
  constructor(wzNode: any) {
    this.wzNode = wzNode;
  }
  async load() {
    const wzNode = this.wzNode;

    this.ani = wzNode.nGet("ani").nGet("nValue", 0);

    const bS = wzNode.bS?.nValue ?? wzNode.nGet('bS')?.nValue;
    const no = wzNode.no?.nValue ?? wzNode.nGet('no')?.nValue;
    (this as any)._bS = bS;
    (this as any)._no = no;
    if (!bS && bS !== 0) { this.frames = []; return; }
    const backFile: any = await WZManager.get(`Map.wz/Back/${bS}.img`);
    if (!backFile) { this.frames = []; return; }
    const category = backFile[!this.ani ? "back" : "ani"];
    if (!category) { this.frames = []; return; }
    const noKey = String(no);
    const spriteNode = category[noKey] || category.nGet?.(noKey);
    if (!spriteNode) { this.frames = []; return; }

    if (!this.ani) {
      this.frames = [spriteNode];
    } else {
      this.frames = [];
      spriteNode.nChildren.forEach((frame: any) => {
        if (frame.nTagName === "canvas" || frame.nTagName === "uol") {
          const Frame = frame.nTagName === "uol" ? frame.nResolveUOL() : frame;
          this.frames.push(Frame);
        } else {
          console.log(`Unhandled frame=${frame.nTagName} for cls=Background`);
        }
      });
    }

    // Start decoding all frames now — drawImage skips undecoded images, so
    // lazily created animation frames blink on their first render. Fire and
    // forget: awaiting every decode blocks map load for seconds. Frames can
    // be undefined when a UOL fails to resolve.
    for (const f of this.frames) void f?.nPreloadImage?.();

    this.setFrame(0);

    this.x = wzNode.x.nValue;
    this.y = wzNode.y.nValue;
    this.z = parseInt(wzNode.nName);
    this.rx = wzNode.rx.nValue;
    this.ry = wzNode.ry.nValue;
    this.cx = wzNode.cx.nValue;
    this.cy = wzNode.cy.nValue;
    this.type = wzNode.type.nValue;
    this.a = wzNode.a.nValue;
    this.front = wzNode.nGet("front").nGet("nValue", 0);
    this.flipped = wzNode.nGet("f").nGet("nValue", 0);

    // v83 background type mapping
    // 0: no tile, no scroll
    // 1: tile X, no scroll
    // 2: tile Y, no scroll
    // 3: tile X+Y, no scroll
    // 4: scroll X, tile X
    // 5: scroll Y, tile Y
    // 6: scroll X, tile X+Y
    // 7: scroll Y, tile X+Y
    this.tileX = false;
    this.tileY = false;
    switch (this.type) {
      case 1: case 4: this.tileX = true; break;
      case 2: case 5: this.tileY = true; break;
      case 3: case 6: case 7: this.tileX = true; this.tileY = true; break;
    }

    this.velocityX = 0;
    this.velocityY = 0;
    switch (this.type) {
      case 4: case 6: this.velocityX = this.rx; break;
      case 5: case 7: this.velocityY = this.ry; break;
    }
  }
  setFrame(frame = 0, carryOverDelay = 0) {
    if (!this.frames || this.frames.length === 0) return;
    this.frame = !this.frames[frame] ? 0 : frame;

    this.delay = carryOverDelay;
    this.nextDelay = this.frames[this.frame]?.nGet?.("delay")?.nGet?.("nValue", 100) ?? 100;
  }
  update(msPerTick: number) {
    if (!this.frames || this.frames.length === 0) return;
    this.delay += msPerTick;
    if (this.delay > this.nextDelay) {
      this.setFrame(this.frame + 1, this.delay - this.nextDelay);
    }
  }
  draw(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    if (!this.frames || this.frames.length === 0) return;
    const firstFrame = this.frames[0];
    const currentFrame = this.frames[this.frame];
    if (!currentFrame) return;
    const currentImage = currentFrame.nGetImage();
    if (!currentImage || !(currentImage instanceof HTMLImageElement) || !currentImage.complete || currentImage.naturalWidth === 0) {
      // Image not loaded or broken — log once and skip
      if (!(this as any)._loggedBroken) {
        (this as any)._loggedBroken = true;
        console.warn('[BG] Broken image for background z=' + this.z, 'bS=' + (this as any)._bS, 'no=' + (this as any)._no);
      }
      return;
    }
    // The caller draws this pass under getBackgroundScale(), so the viewport is
    // measured in authored units here — never in config.width/height, which are
    // device pixels and would put the parallax anchor off-screen.
    const scale = getBackgroundScale();
    const viewW = config.width / scale;
    const viewH = config.height / scale;
    // Camera in authored units. Every term derived from it is magnified by the
    // pass, so feeding it raw device pixels would make a layer track the camera
    // `scale` times too fast — the type-4 cloud bands, which follow the camera
    // 1:1, would race across the sky at more than twice the speed of the ground
    // under them. Divided here, the on-screen parallax rate stays exactly what
    // it is at 800x600. The drift term is scene animation, not camera motion,
    // so it magnifies with the art it belongs to.
    const camX = camera.x / scale;
    const camY = camera.y / scale;

    let dx = this.x;
    let dy = this.y;

    if (this.velocityX !== 0) {
      dx += (tdelta * this.rx) / 200 - camX;
    } else {
      const wOffset = viewW / 2;
      const shiftX = (this.rx * (camX + wOffset)) / 100 + wOffset;
      dx += shiftX;
    }

    if (this.velocityY !== 0) {
      dy += (tdelta * this.ry) / 200 - camY;
    } else {
      const hOffset = viewH / 2;
      const shiftY = (this.ry * (camY + hOffset)) / 100 + hOffset;
      dy += shiftY;
    }

    const width = currentFrame.nWidth;
    const height = currentFrame.nHeight;
    const cx = this.cx || width;
    const cy = this.cy || height;
    const originX = currentFrame.nGet("origin").nGet("nX", 0);
    const originY = currentFrame.nGet("origin").nGet("nY", 0);

    dx = Math.floor(dx);
    dy = Math.floor(dy);
    dx -= !this.flipped ? originX : width - originX;
    dy -= originY;

    const moveType = firstFrame.nGet("moveType").nGet("nValue", 0);
    const moveW = firstFrame.nGet("moveW").nGet("nValue", 0);
    const moveH = firstFrame.nGet("moveH").nGet("nValue", 0);
    const moveP = firstFrame.nGet("moveP").nGet("nValue", Math.PI * 2 * 1000);
    switch (moveType) {
      case 1: {
        dx += moveW * Math.sin((Math.PI * 2 * tdelta) / moveP);
        break;
      }
      case 2: {
        dy += moveH * Math.sin((Math.PI * 2 * tdelta) / moveP);
        break;
      }
      case 3: {
        dx += moveW * Math.cos((Math.PI * 2 * tdelta) / moveP);
        dy += moveH * Math.sin((Math.PI * 2 * tdelta) / moveP);
        break;
      }
    }

    const moveR = firstFrame.nGet("moveR").nGet("nValue", 0);
    const angle = moveR === 0 ? 0 : ((tdelta * 360) / moveR) % 360;

    let a0 = 1;
    let a1 = 1;
    if (!!this.ani && ("a0" in currentFrame || "a1" in currentFrame)) {
      a0 = currentFrame.nGet("a0").nGet("nValue", 0) / 255;
      a1 = currentFrame.nGet("a1").nGet("nValue", 255) / 255;
    }
    const percent = this.delay / this.nextDelay;
    const alpha = percent * a1 + (1 - percent) * a0;

    // Tiling is whatever the WZ type asks for and nothing more. Sheets used to
    // be force-tiled to paper over the gaps a wide viewport opened up, which
    // repeated art that has no seamless join (vicportTown's 800-wide horizon
    // band showed its mountains butting against its own beach). Scaling the
    // pass removes the gaps, so the force-tiling can go.
    const effTileX = this.tileX;
    const effTileY = this.tileY;

    let xBegin = dx;
    let xEnd = dx;
    let yBegin = dy;
    let yEnd = dy;

    if (effTileX) {
      xBegin += width;
      xBegin %= cx;
      if (xBegin <= 0) {
        xBegin += cx;
      }
      xBegin -= width;

      xEnd -= viewW;
      xEnd %= cx;
      if (xEnd >= 0) {
        xEnd -= cx;
      }
      xEnd += viewW;
    }

    if (effTileY) {
      yBegin += height;
      yBegin %= cy;
      if (yBegin <= 0) {
        yBegin += cy;
      }
      yBegin -= height;

      yEnd -= viewH;
      yEnd %= cy;
      if (yEnd >= 0) {
        yEnd -= cy;
      }
      yEnd += viewH;
    }

    for (dx = Math.floor(xBegin); dx <= xEnd; dx += cx) {
      for (dy = Math.floor(yBegin); dy <= yEnd; dy += cy) {
        canvas.drawImage({
          img: currentImage,
          flipped: !!this.flipped,
          alpha,
          angle,
          dx,
          dy,
        });
      }
    }
  }
}

export default Background;
