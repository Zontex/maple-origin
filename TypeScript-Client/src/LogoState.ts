import GameCanvas from "./GameCanvas";
import UIState from "./UIState";
import StateManager from "./StateManager";
import LoginState from "./LoginState";
import WZManager from "./wz-utils/WZManager";
import AudioManager from "./Audio/AudioManager";
import config from "./Config";
import { applyLoginResolution } from "./Resolution";
import { preloadFrames } from "./wz-utils/WZNode";

/**
 * The boot logos — UI.wz/Logo.img played the way the v83 client opens:
 *
 *   Wizet  61 frames 550x420  + Sound.wz/BgmUI.img/WzLogo   (6.7s)
 *   Nexon 137 frames 720x480  + Sound.wz/BgmUI.img/NxLogoMS (9.5s, the
 *          MapleStory cut with the characters running across the logo;
 *          `NxLogo` is the bare 1.9s sting)
 *
 * The frames carry no `delay`, so each segment is paced to its clip. Nexon
 * plays first, then Wizet. Both cards are white, drawn centred on a white
 * screen — by the live canvas size, since the boot canvas may not yet match
 * config. A click or Enter/Esc/Space skips the current logo; the login
 * screen follows.
 */

interface Segment {
  frames: any[];
  frameMs: number;
  bgm: string;
  // How the card sits on the 800x600 screen: the Nexon art is centred within
  // its 720x480 frame, but the Wizet card (550x420) carries its logo in the
  // bottom-right with a blank top-left margin — it is authored for the
  // screen's top-left corner (logo centre then lands at 395,313). Centring
  // that card pushed the logo to the bottom-right of the screen.
  anchor: 'centre' | 'topLeft';
}

const WIZET_FRAME_MS = 110; // 61 frames over the 6.7s clip
const NEXON_FRAME_MS = 70;  // 136 frames over the 9.5s clip

interface LogoState extends UIState {
  _canvas: GameCanvas | null;
  segments: Segment[];
  seg: number;
  frame: number;
  clock: number;
  done: boolean;
  skipArmed: boolean;
  next: () => Promise<void>;
  startSegment: (i: number) => void;
}

const LogoState: LogoState = {
  _canvas: null,
  segments: [],
  seg: 0,
  frame: 0,
  clock: 0,
  done: false,
  skipArmed: false,

  async initialize(canvas?: GameCanvas): Promise<void> {
    this._canvas = canvas ?? null;
    applyLoginResolution(canvas ?? null);
    this.done = false;
    this.segments = [];
    try {
      const logo: any = await WZManager.get("UI.wz/Logo.img");
      const framesOf = (node: any) => (node?.nChildren || []).filter((c: any) => c.nTagName === "canvas");
      const wizet = framesOf(logo?.Wizet);
      const nexon = framesOf(logo?.Nexon);
      // Nexon first, then Wizet — the order the v83 client opens with
      if (nexon.length) this.segments.push({ frames: nexon, frameMs: NEXON_FRAME_MS, bgm: "BgmUI/NxLogoMS", anchor: 'centre' });
      if (wizet.length) this.segments.push({ frames: wizet, frameMs: WIZET_FRAME_MS, bgm: "BgmUI/WzLogo", anchor: 'topLeft' });
      // Decode ahead: a logo that strobes through its first play is no logo
      await preloadFrames(nexon);
      void preloadFrames(wizet);
    } catch (e) {
      console.warn("[Logo] UI.wz/Logo.img unavailable, skipping the logos", e);
    }
    if (this.segments.length === 0) {
      await this.next();
      return;
    }
    this.startSegment(0);
  },

  startSegment(i: number): void {
    this.seg = i;
    this.frame = 0;
    this.clock = 0;
    // Key/click must be released between logos so one press skips one logo
    this.skipArmed = false;
    const seg = this.segments[i];
    void AudioManager.playBackgroundMusic(seg.bgm).then(() => {
      // The logo clips play once; the login map loops its own Title
      if (AudioManager.bgmName === seg.bgm) AudioManager.bgm.loop = false;
    });
  },

  async next(): Promise<void> {
    if (this.done) return;
    const i = this.seg + 1;
    if (i < this.segments.length) {
      this.startSegment(i);
      return;
    }
    this.done = true;
    await StateManager.setState(LoginState, this._canvas ?? undefined);
  },

  doUpdate(msPerTick: number, _camera: any, canvas: GameCanvas): void {
    if (this.done || this.segments.length === 0) return;
    const seg = this.segments[this.seg];

    const pressed = canvas.wasClicked || canvas.isKeyDown("enter") || canvas.isKeyDown("esc") || canvas.isKeyDown("space");
    if (!pressed) this.skipArmed = true;
    if (pressed && this.skipArmed) {
      this.skipArmed = false;
      void this.next();
      return;
    }

    this.clock += msPerTick;
    while (this.clock >= seg.frameMs) {
      this.clock -= seg.frameMs;
      this.frame++;
      if (this.frame >= seg.frames.length) {
        void this.next();
        return;
      }
    }
  },

  doRender(canvas: GameCanvas): void {
    const W = canvas.game?.width || config.width;
    const H = canvas.game?.height || config.height;
    canvas.drawRect({ x: 0, y: 0, width: W, height: H, color: "#ffffff" });
    if (this.done || this.segments.length === 0) return;
    const seg = this.segments[this.seg];
    const node = seg.frames[Math.min(this.frame, seg.frames.length - 1)];
    const img = node?.nGetImage?.();
    if (!img?.width) return;
    if (seg.anchor === 'topLeft') {
      canvas.drawImage({ img, dx: 0, dy: 0 });
    } else {
      canvas.drawImage({
        img,
        dx: Math.floor((W - img.width) / 2),
        dy: Math.floor((H - img.height) / 2),
      });
    }
  },
};

export default LogoState;
