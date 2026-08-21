import { CameraInterface } from "./Camera";
import GameCanvas from "./GameCanvas";
import WZManager from "./wz-utils/WZManager";
import WZNode from "./wz-utils/WZNode";

// Geometry of `Map.wz/MapHelper.img/portal/game/pv` frame 0 — the sprite every
// drawn portal uses, and therefore the game's own idea of how big a portal's
// entry area is. Hardcoded rather than read from the node so an undrawn portal
// does not have to load MapHelper just to know its own bounds.
const PORTAL_WIDTH = 87;
const PORTAL_HEIGHT = 182;
const PORTAL_ORIGIN_X = 43;
const PORTAL_ORIGIN_Y = 173;

// Contact box of a touch portal (types 3 and 9). These fire the moment the
// character's position enters them — no key press — so the box is kept to
// the doorway itself rather than the 182px-tall `pv` frame an Up-portal
// tests against: the tall box would trigger from the platform above, and a
// touch portal has no "nearest wins" second chance. 50 wide, 100 up, with
// the same few px of slack below the authored y as the Up box (portal y is
// the doorway, the foothold under it sits a couple of px lower).
const TOUCH_HALF_WIDTH = 25;
const TOUCH_HEIGHT_UP = 100;
const TOUCH_HEIGHT_DOWN = 10;

// Hidden portals (types 10 and 11) stay invisible until the character is
// close. The reveal zone is sized from the `ph` art (portalContinue is ~100
// to 127 px wide and ~120 tall) and deliberately contains the Up entry box,
// so a portal you are standing in is always one that has revealed itself.
const REVEAL_HALF_WIDTH = 60;
const REVEAL_HEIGHT_UP = 180;
const REVEAL_HEIGHT_DOWN = 30;

/**
 * v83 portal types (`pt`):
 *   0  spawn point             — invisible, not enterable
 *   1  invisible portal        — Up to use, no art
 *   2  visible portal          — `pv` animation, Up to use
 *   3  touch portal            — warps on contact, invisible
 *   4  changeable portal       — drawn with `pv`, Up to use
 *   5  changeable invisible    — Up to use, no art
 *   6  Mystic Door town slot   — `tp`; a door object stands here, see Door/
 *   7  script portal           — drawn with `pv`, Up runs the script
 *   8  script invisible        — Up runs the script, no art
 *   9  script touch            — runs the script on contact, invisible
 *  10  hidden portal           — `ph` reveal when near, then like 2
 *  11  hidden script portal    — `psh/<image>` reveal when near, runs script
 */
export type HiddenPhase = "hidden" | "start" | "shown" | "exit";

class Portal {
  isNormalPortal = false;
  wzNode: any;
  name: string = "";
  type: number = 0;
  x: number = 0;
  y: number = 0;
  toMap: number = 0;
  toName: string = "";
  script: string = "";
  image: string = "";
  // Authored extras. None of them change how the portal is entered here —
  // they are kept so scripts and UI can read them: `onlyOnce` marks one-shot
  // portals, `hideTooltip` hides the destination tooltip, `delay` is the
  // authored entry delay, the impacts belong to spring portals.
  onlyOnce: boolean = false;
  hideTooltip: boolean = false;
  delayMs: number = 0;
  horizontalImpact: number = 0;
  verticalImpact: number = 0;
  frames: any = null;
  frame: number = 0;
  delay: number = 0;
  nextDelay: number = 0;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;
  // Touch portals: the contact box tested every frame (null otherwise)
  touchRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;

  // Hidden portal reveal: the three `ph`/`psh` sequences and which one is
  // playing. `frames` points at the active sequence.
  hiddenStart: any = null;
  hiddenContinue: any = null;
  hiddenExit: any = null;
  hiddenPhase: HiddenPhase = "hidden";

  static async fromWzNode(wzNode: WZNode) {
    const portal = new Portal(wzNode);
    await portal.load();
    return portal;
  }
  constructor(wzNode: WZNode) {
    this.wzNode = wzNode;
  }

  /** Types that fire on contact rather than on Up */
  get isTouchPortal(): boolean {
    return this.type === 3 || this.type === 9;
  }

  /** Types that reveal themselves when the character comes close */
  get isHiddenPortal(): boolean {
    return this.type === 10 || this.type === 11;
  }

  /** Types whose Up press runs a portal script instead of a plain warp */
  get isScriptPortal(): boolean {
    return this.type === 7 || this.type === 8 || this.type === 9 || this.type === 11;
  }

  /** Mystic Door town-side slot (`tp`) */
  get isDoorPortal(): boolean {
    return this.type === 6;
  }

  async load() {
    const wzNode = this.wzNode;

    this.name = wzNode.pn.nValue;
    this.type = wzNode.pt.nValue;
    this.x = wzNode.x.nValue;
    this.y = wzNode.y.nValue;
    this.toMap = wzNode.tm.nValue;
    this.toName = wzNode.tn.nValue;
    this.script = wzNode.script?.nValue || "";
    if (this.script) console.log(`[Portal] "${this.name}" has script: "${this.script}"`);

    this.image = wzNode.nGet("image").nGet("nValue", "default") || "default";
    this.onlyOnce = !!wzNode.nGet("onlyOnce").nGet("nValue", 0);
    this.hideTooltip = !!wzNode.nGet("hideTooltip").nGet("nValue", 0);
    this.delayMs = Number(wzNode.nGet("delay").nGet("nValue", 0)) || 0;
    this.horizontalImpact = Number(wzNode.nGet("horizontalImpact").nGet("nValue", 0)) || 0;
    this.verticalImpact = Number(wzNode.nGet("verticalImpact").nGet("nValue", 0)) || 0;

    const basePath = "Map.wz/MapHelper.img/portal/game";
    switch (this.type) {
      case 2:
      case 4:
      case 7: {
        // Drawn with the regular doorway animation. Script portals (7) are
        // visible in v83 — the Free Market entrances are the everyday case.
        const spriteNode: any = await WZManager.get(`${basePath}/pv`);
        this.frames = spriteNode.nChildren;
        this.isNormalPortal = this.type === 2;
        break;
      }
      case 10:
      case 11: {
        // Hidden: `ph/default` for plain hidden portals, `psh/<image>` for
        // scripted ones (image 1-4 are themed reveals; default otherwise).
        // Each holds portalStart (reveal), portalContinue (loop while near)
        // and portalExit (fade when the character walks away).
        const dir = this.type === 10 ? "ph" : "psh";
        let variant = this.type === 10 ? "default" : this.image;
        let root: any = null;
        try {
          root = await WZManager.get(`${basePath}/${dir}/${variant}`);
        } catch (e) {
          root = null;
        }
        if (!root?.nGet?.("portalContinue")?.nChildren?.length && variant !== "default") {
          variant = "default";
          try {
            root = await WZManager.get(`${basePath}/${dir}/default`);
          } catch (e) {
            root = null;
          }
        }
        if (root) {
          this.hiddenStart = root.nGet("portalStart").nChildren || null;
          this.hiddenContinue = root.nGet("portalContinue").nChildren || null;
          this.hiddenExit = root.nGet("portalExit").nChildren || null;
          if (this.hiddenStart && this.hiddenStart.length === 0) this.hiddenStart = null;
          if (this.hiddenExit && this.hiddenExit.length === 0) this.hiddenExit = null;
          if (this.hiddenContinue && this.hiddenContinue.length === 0) this.hiddenContinue = null;
        }
        // Nothing is drawn until the character comes near (see update)
        this.frames = null;
        this.hiddenPhase = "hidden";
        break;
      }
      default: {
        // 0 spawn, 1 invisible, 3 touch, 5 changeable-invisible, 6 door,
        // 8 script-invisible, 9 script-touch: no art
        break;
      }
    }

    // Start decoding all frames now — drawImage skips undecoded images, so
    // the portal animation blinks on its first cycle otherwise. Fire and
    // forget: awaiting decodes blocks map load.
    for (const seq of [this.frames, this.hiddenStart, this.hiddenContinue, this.hiddenExit]) {
      if (seq) for (const f of seq) void f?.nPreloadImage?.();
    }

    this.setFrame(0);

    // Invisible/non-drawn portals still need a collision rect so
    // checkForPortal() can detect the player standing in them. It has to be
    // the SAME box a drawn portal gets: a type-1 portal is a type-2 portal
    // without the graphic, and nothing about being invisible should shrink
    // where it can be entered. A drawn portal's rect comes from the `pv`
    // sprite (87x182, origin 43,173), so it reaches 9px BELOW the portal's y
    // — and that slack is load-bearing. Portal y is authored at the doorway
    // while the player stands on the foothold under it, which sits a few px
    // lower (Ellinia boat: in00 y=164 over ground y=166, under00 y=477 over
    // ground y=481). The old 40x40 box stopped dead at y, so on the ship —
    // where every portal is invisible — standing in the doorway missed by
    // 2px and you had to jump to lift your feet into it.
    //
    // Hidden portals keep this constant box too (their reveal art is shorter
    // than `pv`, and being hidden must not shrink the doorway). Touch portals
    // get the contact box instead; spawn points and door slots get nothing.
    const enterable = this.toMap !== 999999999 || !!this.script;
    if (this.isTouchPortal) {
      if (enterable) {
        this.touchRect = {
          x: this.x - TOUCH_HALF_WIDTH,
          y: this.y - TOUCH_HEIGHT_UP,
          width: TOUCH_HALF_WIDTH * 2,
          height: TOUCH_HEIGHT_UP + TOUCH_HEIGHT_DOWN,
        };
      }
    } else if (this.type !== 0 && this.type !== 6 && !this.frames && enterable) {
      this.rect = {
        x: this.x - PORTAL_ORIGIN_X,
        y: this.y - PORTAL_ORIGIN_Y,
        width: PORTAL_WIDTH,
        height: PORTAL_HEIGHT,
      };
    }
  }

  setFrame(frame = 0, carryOverDelay = 0) {
    if (!this.frames) {
      return;
    }

    this.frame = !this.frames[frame] ? 0 : frame;
    this.delay = carryOverDelay;
    this.nextDelay = this.frames[this.frame].nGet("delay").nGet("nValue", 100);
  }

  /** Whether a world position is inside the hidden portal's reveal zone */
  isNear(px: number, py: number): boolean {
    const dx = px - this.x;
    const dy = py - this.y;
    return (
      dx >= -REVEAL_HALF_WIDTH &&
      dx <= REVEAL_HALF_WIDTH &&
      dy >= -REVEAL_HEIGHT_UP &&
      dy <= REVEAL_HEIGHT_DOWN
    );
  }

  /** Whether a world position is inside a touch portal's contact box */
  isTouching(px: number, py: number): boolean {
    const r = this.touchRect;
    if (!r) return false;
    return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
  }

  private setHiddenPhase(phase: HiddenPhase) {
    this.hiddenPhase = phase;
    switch (phase) {
      case "start":
        this.frames = this.hiddenStart || this.hiddenContinue;
        break;
      case "shown":
        this.frames = this.hiddenContinue;
        break;
      case "exit":
        this.frames = this.hiddenExit;
        break;
      default:
        this.frames = null;
    }
    this.frame = 0;
    this.delay = 0;
    this.setFrame(0);
  }

  /**
   * Advance the animation. `player` is the local character's position; only
   * hidden portals look at it, to reveal themselves when it comes close and
   * fold away again when it leaves.
   */
  update(msPerTick: number, player?: { x: number; y: number } | null) {
    if (this.isHiddenPortal) {
      const near = !!player && this.isNear(player.x, player.y);
      if (near && this.hiddenPhase === "hidden") {
        this.setHiddenPhase(this.hiddenStart ? "start" : "shown");
      } else if (near && this.hiddenPhase === "exit") {
        // Walked back in mid-fade: reopen
        this.setHiddenPhase(this.hiddenStart ? "start" : "shown");
      } else if (!near && this.hiddenPhase === "shown") {
        this.setHiddenPhase(this.hiddenExit ? "exit" : "hidden");
      } else if (!near && this.hiddenPhase === "start") {
        this.setHiddenPhase(this.hiddenExit ? "exit" : "hidden");
      }
    }

    if (!this.frames) {
      return;
    }

    this.delay += msPerTick;
    if (this.delay > this.nextDelay) {
      const next = this.frame + 1;
      const finished = !this.frames[next];
      if (finished && this.isHiddenPortal && this.hiddenPhase === "start") {
        // Reveal played through — settle into the loop
        this.setHiddenPhase("shown");
      } else if (finished && this.isHiddenPortal && this.hiddenPhase === "exit") {
        this.setHiddenPhase("hidden");
      } else {
        this.setFrame(next, this.delay - this.nextDelay);
      }
    }
  }

  draw(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    if (!this.frames) {
      return;
    }

    const currentFrame = this.frames[this.frame];
    if (!currentFrame) return;
    const currentImage = currentFrame.nGetImage();

    const originX = currentFrame.nGet("origin").nGet("nX", 0);
    const originY = currentFrame.nGet("origin").nGet("nY", 0);
    // A drawn (non-hidden) portal's entry box follows its current frame;
    // hidden portals keep the constant `pv` box set at load
    if (!this.isHiddenPortal) {
      this.rect = {
        x: this.x - originX,
        y: this.y - originY,
        width: currentImage.width,
        height: currentImage.height,
      };
    }

    // `psh/1` fades its single reveal frame in (a0 0 -> a1 200 over 1500ms)
    // and out again; every other sequence is opaque
    let alpha = 1;
    if ("a0" in currentFrame || "a1" in currentFrame) {
      const a0 = currentFrame.nGet("a0").nGet("nValue", 255) / 255;
      const a1 = currentFrame.nGet("a1").nGet("nValue", a0 * 255) / 255;
      const percent = this.nextDelay > 0 ? Math.min(1, this.delay / this.nextDelay) : 1;
      alpha = percent * a1 + (1 - percent) * a0;
    }

    canvas.drawImage({
      img: currentImage,
      dx: this.x - camera.x - originX,
      dy: this.y - camera.y - originY,
      alpha,
    });
  }
}

export default Portal;
