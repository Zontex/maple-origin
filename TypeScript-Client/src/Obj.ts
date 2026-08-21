import { CameraInterface } from "./Camera";
import config from "./Config";
import GameCanvas from "./GameCanvas";
import WZManager from "./wz-utils/WZManager";

class Obj {
  wzNode: any;
  spriteNode: any;
  frames: any[] = [];
  frame: number = 0;
  delay: number = 0;
  nextDelay: number = 0;
  repeat: number = 0;
  x: number = 0;
  y: number = 0;
  z: number = 0;
  zM: number = 0;
  zid: number = 0;
  flipped: boolean = false;
  flow: number = 0;
  cx: number = 0;
  rx: number = 0;
  cy: number = 0;
  ry: number = 0;
  layer: number = 0;
  // `hide=1` objects start invisible — the job-advancement guide arrows
  // (signboard/market/arrow tagged sordQuest/bowQuest/magicQuest/thiefQuest/
  // pirateQuest) are the only ones in v83, switched on by the server's
  // field-effect tag toggle for the duration of that quest. Drawing them
  // regardless scattered arrows over Henesys, Nautilus and Lith Harbor that
  // pointed wherever the hidden stage of the trail happened to go.
  hide: boolean = false;
  tags: string[] = [];
  visible: boolean = true;
  // `seat/<n>` vectors: where a character sits on this object (a bench, a
  // log, the rim of a fountain), relative to the object's position. World
  // coordinates are resolved by MapleMap once x/y/flip are known.
  seats: Array<{ x: number; y: number }> = [];

  static async fromWzNode(wzNode: any) {
    const obj = new Obj(wzNode);
    await obj.load();
    return obj;
  }
  constructor(wzNode: any) {
    this.wzNode = wzNode;
  }
  async load() {
    const wzNode = this.wzNode;
    const oS = wzNode.oS.nValue;
    const [l0, l1, l2] = [wzNode.l0.nValue, wzNode.l1.nValue, wzNode.l2.nValue];
    const objFile: any = await WZManager.get(`Map.wz/Obj/${oS}.img`);
    const spriteNode: any = objFile[l0][l1][l2];

    this.spriteNode = spriteNode;
    this.frames = [];
    spriteNode.nChildren.forEach((frame: any) => {
      if (frame.nTagName === "canvas" || frame.nTagName === "uol") {
        const Frame = frame.nTagName === "uol" ? frame.nResolveUOL() : frame;
        this.frames.push(Frame);
      } else if (frame.nName === "repeat") {
        this.repeat = frame.nValue;
      } else if (frame.nName === "seat") {
        this.seats = (frame.nChildren || [])
          .filter((v: any) => v.nTagName === "vector")
          .map((v: any) => ({ x: Number(v.nX) || 0, y: Number(v.nY) || 0 }));
      } else {
        console.log(`Unhandled frame=${frame.nTagName} for cls=Obj `, this);
      }
    });

    // Start decoding all frames now — drawImage skips undecoded images, so
    // lazily created animation frames blink on their first render. Fire and
    // forget: awaiting every decode blocks map load for seconds. Frames can
    // be undefined when a UOL fails to resolve.
    for (const f of this.frames) void f?.nPreloadImage?.();

    this.setFrame(0);

    this.x = wzNode.x.nValue;
    this.y = wzNode.y.nValue;
    this.z = wzNode.z.nValue;
    this.zM = wzNode.zM.nValue;
    this.zid = parseInt(wzNode.nName);
    this.flipped = wzNode.f.nValue;
    this.hide = !!wzNode.nGet("hide").nGet("nValue", 0);
    this.visible = !this.hide;
    this.tags = String(wzNode.nGet("tags").nGet("nValue", ""))
      .split(";")
      .map((t: string) => t.trim())
      .filter(Boolean);

    this.flow = wzNode.nGet("flow").nGet("nValue", 0);
    this.cx = wzNode.nGet("cx").nGet("nValue", 0);
    this.rx = wzNode.nGet("rx").nGet("nValue", 0);
    this.cy = wzNode.nGet("cy").nGet("nValue", 0);
    this.ry = wzNode.nGet("ry").nGet("nValue", 0);
  }
  setFrame(frame = 0, carryOverDelay = 0) {
    this.frame = !this.frames[frame] ? 0 : frame;

    this.delay = carryOverDelay;
    this.nextDelay = this.frames[this.frame].nGet("delay").nGet("nValue", 100);
  }
  advanceFrame() {
    let nextFrame = this.frame + 1;
    const finishedLoop = !this.frames[nextFrame];
    const carryOverDelay = this.delay - this.nextDelay;

    if (finishedLoop) {
      nextFrame = Math.abs(this.repeat) || 0;
    }

    this.setFrame(nextFrame, carryOverDelay);
  }
  update(msPerTick: number) {
    this.delay += msPerTick;
    if (this.delay > this.nextDelay) {
      this.advanceFrame();
    }
  }
  draw(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    const firstFrame = this.frames[0];
    const currentFrame = this.frames[this.frame];
    const currentImage = currentFrame.nGetImage();

    const boundaries = camera.boundaries;
    const width = currentFrame.nWidth;
    const height = currentFrame.nHeight;
    const cx = Math.abs(this.cx) || boundaries.right - boundaries.left - 45;
    const cy = Math.abs(this.cy) || boundaries.bottom - boundaries.top - 160;
    const originX = currentFrame.nGet("origin").nGet("nX", 0);
    const originY = currentFrame.nGet("origin").nGet("nY", 0);

    let dx = this.x;
    let dy = this.y;

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
    if ("a0" in currentFrame || "a1" in currentFrame) {
      a0 = currentFrame.nGet("a0").nGet("nValue", 0) / 255;
      a1 = currentFrame.nGet("a1").nGet("nValue", a0 * 255) / 255;
    }
    const percent = this.delay / this.nextDelay;
    const alpha = percent * a1 + (1 - percent) * a0;

    // wtf is flow===3?
    if (this.flow === 1) {
      dx += (tdelta * this.rx) / 200 - camera.x;
      let xBegin = dx;
      let xEnd = dx;

      xBegin += width;
      xBegin %= cx;
      if (xBegin <= 0) {
        xBegin += cx;
      }
      xBegin -= width;

      xEnd -= config.width;
      xEnd %= cx;
      if (xEnd >= 0) {
        xEnd -= cx;
      }
      xEnd += config.width;

      for (dx = Math.floor(xBegin); dx <= xEnd; dx += cx) {
        canvas.drawImage({
          img: currentImage,
          flipped: !!this.flipped,
          dy: dy - camera.y,
          alpha,
          angle,
          dx,
        });
      }
    } else if (this.flow === 2) {
      dy += (tdelta * this.ry) / 200 - camera.y;
      let yBegin = dy;
      let yEnd = dy;

      yBegin += height;
      yBegin %= cy;
      if (yBegin <= 0) {
        yBegin += cy;
      }
      yBegin -= height;

      yEnd -= config.height;
      yEnd %= cy;
      if (yEnd >= 0) {
        yEnd -= cy;
      }
      yEnd += config.height;

      for (dy = Math.floor(yBegin); dy <= yEnd; dy += cy) {
        canvas.drawImage({
          img: currentImage,
          flipped: !!this.flipped,
          dx: dx - camera.x,
          alpha,
          angle,
          dy,
        });
      }
    } else {
      const fx = dx - camera.x;
      const fy = dy - camera.y;
      // Skip non-tiling objects fully outside the viewport (only safe when
      // unrotated — rotation can swing the sprite beyond its bounding box)
      if (
        angle === 0 &&
        (fx > config.width || fy > config.height || fx + width < 0 || fy + height < 0)
      ) {
        return;
      }
      canvas.drawImage({
        img: currentImage,
        dx: fx,
        dy: fy,
        flipped: !!this.flipped,
        alpha,
        angle,
      });
    }
  }
}

export default Obj;
