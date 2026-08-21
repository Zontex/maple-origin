import WZManager from './wz-utils/WZManager';
import PLAY_AUDIO from './Audio/PlayAudio';
import GameCanvas from './GameCanvas';
import { CameraInterface } from './Camera';
import ReactorScriptEngine, { spawnReactorDrops } from './ReactorScriptEngine';

interface ReactorItemEvent {
  itemId: number;
  count: number;
  lt: { x: number; y: number };
  rb: { x: number; y: number };
  nextState: number;
}

interface ReactorState {
  frames: HTMLImageElement[];
  origins: { x: number; y: number }[];
  delays: number[];
  hitFrames: HTMLImageElement[];
  hitOrigins: { x: number; y: number }[];
  hitDelays: number[];
  hitSound: HTMLAudioElement | null;
  nextState: number; // state to transition to on hit (from event)
  // Type-100 event: reactor advances when the matching item is dropped
  // inside its lt/rb box (HPQ moonflowers take primrose seeds this way)
  itemEvent: ReactorItemEvent | null;
}

// Reactors with no entry of their own in Sound.wz/Reactor.img borrow a sibling's sounds
// (e.g. the Maple Island generic box 2001 uses box 2000's wooden hit sound)
const REACTOR_SOUND_FALLBACK: Record<number, number> = {
  2001: 2000,
};

// Reactors that only scripts may advance (weapon hits pass through):
// 9101000 = the HPQ moon, filled one state per planted primrose
const SCRIPT_ONLY_REACTORS = new Set<number>([9101000]);

export default class Reactor {
  id: number = 0;
  oId: number = 0; // Unique spawn index for network identification
  x: number = 0;
  y: number = 0;
  reactorTime: number = 0; // respawn delay in seconds; 0 = no respawn
  // Map-side `name` from the reactor life node — scripts look siblings up by
  // it (HPQ's 9108xxx act() asks for "fullmoon")
  name: string = '';
  facing: number = 0;
  layer: number = 0;
  map: any = null;

  private states: ReactorState[] = [];
  private currentState: number = 0;
  private maxState: number = 0;
  destroyed: boolean = false;
  // Wall-clock time this reactor is due back, stamped when it breaks and
  // carried across map changes. 0 means it is standing, or that reactorTime
  // says it never returns.
  respawnAt: number = 0;
  private pendingDestroy: boolean = false;
  private pendingAdvance: number = -1;
  private _isRemoteHit: boolean = false; // True if hit was triggered by network
  private hitAnimState: number = -1; // which state's hit animation is playing

  // Animation
  private frame: number = 0;
  private frameTimer: number = 0;
  private isHit: boolean = false;
  private hitFrame: number = 0;
  private hitTimer: number = 0;

  // Dimensions for hit detection
  width: number = 48;
  height: number = 34;

  pos: { x: number; y: number } = { x: 0, y: 0 };
  /** WZ info/link target — sprite/state donor for stateless reactors */
  private linkId: number = 0;

  static async fromOpts(opts: {
    id: number;
    x: number;
    y: number;
    reactorTime: number;
    f?: number;
    map?: any;
    name?: string;
  }): Promise<Reactor> {
    const reactor = new Reactor();
    reactor.id = opts.id;
    reactor.oId = (opts as any).oId ?? 0;
    reactor.name = opts.name ? String(opts.name) : '';
    reactor.x = opts.x;
    reactor.y = opts.y;
    reactor.pos = { x: opts.x, y: opts.y };
    reactor.reactorTime = opts.reactorTime;
    reactor.facing = opts.f || 0;
    reactor.map = opts.map;
    await reactor.load();
    return reactor;
  }

  /** Resolve a WZ node, following UOL references */
  private resolveNode(node: any): any {
    if (!node) return null;
    if (node.nTagName === 'uol' && node.nResolveUOL) {
      return node.nResolveUOL();
    }
    return node;
  }

  /** Extract image + origin + delay from a canvas WZ node */
  private extractFrame(node: any): { img: HTMLImageElement; ox: number; oy: number; delay: number } | null {
    const resolved = this.resolveNode(node);
    if (!resolved) return null;
    const img = resolved.nGetImage?.();
    if (!img) return null;
    // Origin is a WZ vector child: origin.nX, origin.nY
    const origin = resolved.origin;
    const ox = origin?.nX ?? 0;
    const oy = origin?.nY ?? 0;
    const delay = resolved.delay?.nValue || 200;
    return { img, ox, oy, delay };
  }

  private async load(): Promise<void> {
    const padded = String(this.id).padStart(7, '0');
    const path = `Reactor.wz/${padded}.img`;

    try {
      let node: any = await WZManager.get(path);
      if (!node) {
        console.warn(`[Reactor] No WZ data for reactor ${this.id}`);
        return;
      }

      // Linked reactors (info/link, like mobs) carry no states of their own —
      // the HPQ primrose leaves 9102003-9102007 all borrow 9102002's sprites
      // and hit chain while keeping their own id (and so their own drops)
      const linkId = node.info?.link?.nValue;
      if (linkId) {
        this.linkId = Number(linkId);
        const linkedPath = `Reactor.wz/${String(linkId).padStart(7, '0')}.img`;
        const linked: any = await WZManager.get(linkedPath);
        if (linked) node = linked;
        else console.warn(`[Reactor] Broken link ${this.id} -> ${linkId}`);
      }

      // Parse states (numbered 0, 1, 2, ...)
      let stateIndex = 0;
      while (true) {
        let stateNode = node[String(stateIndex)];
        if (!stateNode) break;
        stateNode = this.resolveNode(stateNode);
        if (!stateNode) break;

        const state: ReactorState = {
          frames: [],
          origins: [],
          delays: [],
          hitFrames: [],
          hitOrigins: [],
          hitDelays: [],
          hitSound: null,
          nextState: stateIndex + 1,
          itemEvent: null,
        };

        // Parse event (tells us what triggers state transition)
        const eventNode = stateNode.event;
        if (eventNode?.nChildren) {
          for (const evt of eventNode.nChildren) {
            if (evt.state?.nValue !== undefined) {
              state.nextState = evt.state.nValue;
            }
            // type 100 = item-drop trigger: child "0" is the item id, "1" the
            // count, lt/rb the activation box relative to the reactor position
            if (evt.type?.nValue === 100) {
              state.itemEvent = {
                itemId: evt['0']?.nValue ?? 0,
                count: evt['1']?.nValue ?? 1,
                lt: { x: evt.lt?.nX ?? 0, y: evt.lt?.nY ?? 0 },
                rb: { x: evt.rb?.nX ?? 0, y: evt.rb?.nY ?? 0 },
                nextState: evt.state?.nValue ?? stateIndex + 1,
              };
            }
          }
        }

        // Parse idle frame(s) — numbered canvas children ("0", "1", etc.)
        for (let i = 0; i < 10; i++) {
          let frameNode = stateNode[String(i)];
          if (!frameNode) break;
          const frame = this.extractFrame(frameNode);
          if (!frame) break;
          state.frames.push(frame.img);
          state.origins.push({ x: frame.ox, y: frame.oy });
          state.delays.push(frame.delay);
        }

        // Parse hit animation frames
        let hitNode = stateNode.hit;
        hitNode = this.resolveNode(hitNode);
        if (hitNode?.nChildren) {
          for (let i = 0; i < 10; i++) {
            let hf = hitNode[String(i)];
            if (!hf) break;
            const frame = this.extractFrame(hf);
            if (!frame) break;
            state.hitFrames.push(frame.img);
            state.hitOrigins.push({ x: frame.ox, y: frame.oy });
            state.hitDelays.push(frame.delay);
          }
        }

        this.states.push(state);
        stateIndex++;
      }

      this.maxState = stateIndex;

      // Set dimensions from first frame
      if (this.states.length > 0 && this.states[0].frames.length > 0) {
        const firstFrame = this.states[0].frames[0];
        // Wait for image to load to get dimensions
        if (firstFrame.width > 0) {
          this.width = firstFrame.width;
          this.height = firstFrame.height;
        } else {
          firstFrame.onload = () => {
            this.width = firstFrame.width;
            this.height = firstFrame.height;
          };
        }
      }

      await this.loadHitSounds();

      console.log(`[Reactor] Loaded reactor ${this.id}: ${this.states.length} states (maxState=${this.maxState})`);
      for (let i = 0; i < this.states.length; i++) {
        const s = this.states[i];
        console.log(`  State ${i}: ${s.frames.length} frames, ${s.hitFrames.length} hit frames, nextState=${s.nextState}`);
      }
    } catch (e) {
      console.error(`[Reactor] Failed to load reactor ${this.id}:`, e);
    }
  }

  /** Load per-state hit sounds from Sound.wz/Reactor.img/<id>/<state>/Hit */
  private async loadHitSounds(): Promise<void> {
    const soundIds = [this.id];
    if (REACTOR_SOUND_FALLBACK[this.id] !== undefined) {
      soundIds.push(REACTOR_SOUND_FALLBACK[this.id]);
    }
    if (this.linkId) soundIds.push(this.linkId);

    for (const soundId of soundIds) {
      try {
        const soundNode: any = await WZManager.get(`Sound.wz/Reactor.img/${soundId}`);
        if (!soundNode) continue;
        let found = false;
        for (let i = 0; i < this.states.length; i++) {
          const hitNode = this.resolveNode(soundNode[String(i)]?.Hit);
          if (hitNode?.nGetAudio) {
            this.states[i].hitSound = hitNode.nGetAudio();
            found = true;
          }
        }
        if (found) return;
      } catch {
        // No sound entry for this id — try the next candidate
      }
    }
  }

  hit(isRemoteHit: boolean = false): boolean {
    if (this.destroyed || this.isHit || this.pendingDestroy) return false;

    const state = this.states[this.currentState];
    if (!state) return false;

    // Item-triggered states (HPQ moonflowers) and script-driven reactors
    // (the HPQ moon) don't respond to weapon hits at all
    if (state.itemEvent || SCRIPT_ONLY_REACTORS.has(this.id)) return false;

    // Check if this hit will destroy the reactor
    // The last state (e.g. state 4) is always the "destroyed" state (1x1 pixel).
    // Transitioning TO that state = destruction. maxState counts all states including the destroyed one.
    const nextState = state.nextState;
    const willDestroy = nextState >= this.maxState - 1;
    this._isRemoteHit = isRemoteHit;

    // Hit sound is audible for remote players' hits too
    if (state.hitSound) {
      try { PLAY_AUDIO(state.hitSound); } catch {}
    }

    // Play hit animation from the CURRENT state (before advancing)
    if (state.hitFrames.length > 0) {
      this.isHit = true;
      this.hitFrame = 0;
      this.hitTimer = 0;
      // Store which state's hit animation we're playing (don't advance yet)
      this.hitAnimState = this.currentState;
      if (willDestroy) {
        this.pendingDestroy = true; // Destroy after animation completes
      } else {
        this.pendingAdvance = nextState; // Advance after animation completes
      }
    } else if (willDestroy) {
      // No hit animation, destroy immediately
      this.destroy();
      return true;
    } else {
      // No hit animation, advance immediately
      this.currentState = nextState;
      this.frame = 0;
      this.frameTimer = 0;
    }

    return willDestroy;
  }

  getState(): number {
    return this.currentState;
  }

  /** The item-drop trigger of the current state, if any (and still pending) */
  getItemEvent(): ReactorItemEvent | null {
    if (this.destroyed || this.isHit || this.pendingAdvance >= 0) return null;
    return this.states[this.currentState]?.itemEvent ?? null;
  }

  /**
   * Advance to a specific state without the last-state-destroys heuristic —
   * used by scripted transitions (moonflower blooming on a planted seed, the
   * HPQ moon filling per bloom). Plays the current state's hit animation as
   * the transition when one exists.
   */
  forceAdvance(toState: number): void {
    if (this.destroyed || toState === this.currentState) return;
    if (toState < 0 || toState >= this.states.length) return;

    const state = this.states[this.currentState];
    if (state?.hitSound) {
      try { PLAY_AUDIO(state.hitSound); } catch {}
    }
    if (this.isHit) {
      // A transition animation is still playing — retarget it so the stale
      // pendingAdvance can't rewind a newer state (two quick moon fills)
      this.pendingAdvance = toState;
    } else if (state && state.hitFrames.length > 0) {
      this.isHit = true;
      this.hitFrame = 0;
      this.hitTimer = 0;
      this.hitAnimState = this.currentState;
      this.pendingAdvance = toState;
    } else {
      this.currentState = toState;
      this.frame = 0;
      this.frameTimer = 0;
    }
  }

  private destroy(): void {
    this.destroyed = true;
    // Stamp the deadline at the moment of the break. Wall-clock rather than a
    // countdown so it survives leaving the map, and set here rather than by
    // whoever schedules the respawn so every client agrees on when it is due.
    this.respawnAt = this.reactorTime > 0 ? Date.now() + this.reactorTime * 1000 : 0;

    // Only the player who hit the reactor acts on the break: the reactor's
    // ACT script if it has one (public/scripts/reactor/<id>.js — drops,
    // spawns, PQ stage bookkeeping), else the static drop table
    if (!this._isRemoteHit) {
      void this.runAct();
    }

    // Play break sound
    try {
      WZManager.get('Sound.wz/Game.img/DropItem').then((node: any) => {
        if (node?.nGetAudio) PLAY_AUDIO(node.nGetAudio());
      });
    } catch {}
  }

  private async runAct(): Promise<void> {
    const character = (window as any).charecter;
    try {
      const ran = await ReactorScriptEngine.runAct(this, this.map, character);
      if (ran) return;
    } catch (e) {
      console.error(`[Reactor] act() failed for ${this.id}:`, e);
    }
    await this.dropItems();
  }

  /** Static-table drops — what `rm.dropItems()` does, for reactors without a script */
  private async dropItems(): Promise<void> {
    if (!this.map) return;
    await spawnReactorDrops(this, this.map);
  }

  // Come back already destroyed, carrying the deadline from the visit that
  // broke it — the clock kept running while we were on another map, so this
  // must not restart it. Jumped straight to the final state with no hit
  // animation or drops: those already happened, to someone who was there.
  restoreDestroyed(respawnAt: number): void {
    this.destroyed = true;
    this.respawnAt = respawnAt;
    this.currentState = this.maxState;
    this.frame = 0;
    this.frameTimer = 0;
  }

  reset(): void {
    this.destroyed = false;
    this.respawnAt = 0;
    this.pendingDestroy = false;
    this.pendingAdvance = -1;
    this.hitAnimState = -1;
    this.currentState = 0;
    this.frame = 0;
    this.frameTimer = 0;
    this.isHit = false;
    this.hitFrame = 0;
    this.hitTimer = 0;
  }

  update(msPerTick: number): void {
    if (this.destroyed) return;

    const state = this.states[this.currentState];
    if (!state) return;

    // Update hit animation (uses hitAnimState, not currentState)
    if (this.isHit) {
      const hitState = this.states[this.hitAnimState] || state;
      if (hitState.hitFrames.length > 0) {
        this.hitTimer += msPerTick;
        const delay = hitState.hitDelays[this.hitFrame] || 150;
        if (this.hitTimer >= delay) {
          this.hitTimer -= delay;
          this.hitFrame++;
          if (this.hitFrame >= hitState.hitFrames.length) {
            this.isHit = false;
            this.hitFrame = 0;
            this.hitAnimState = -1;
            // After animation: advance state or destroy
            if (this.pendingDestroy) {
              this.destroy();
            } else if (this.pendingAdvance >= 0) {
              this.currentState = this.pendingAdvance;
              this.pendingAdvance = -1;
              this.frame = 0;
              this.frameTimer = 0;
            }
          }
        }
      }
    }

    // Update idle animation (only if multiple frames)
    if (!this.isHit && state.frames.length > 1) {
      this.frameTimer += msPerTick;
      const delay = state.delays[this.frame] || 200;
      if (this.frameTimer >= delay) {
        this.frameTimer -= delay;
        this.frame = (this.frame + 1) % state.frames.length;
      }
    }
  }

  draw(canvas: GameCanvas, camera: CameraInterface, _lag: number, _msPerTick: number, _tdelta: number): void {
    if (this.destroyed) return;

    const state = this.states[this.currentState];
    if (!state) return;

    let img: HTMLImageElement;
    let originX: number;
    let originY: number;

    // Show hit frame if animating hit (from hitAnimState, not current state)
    const hitState = this.isHit ? (this.states[this.hitAnimState] || state) : null;
    if (this.isHit && hitState && hitState.hitFrames.length > this.hitFrame) {
      img = hitState.hitFrames[this.hitFrame];
      originX = hitState.hitOrigins[this.hitFrame]?.x || 0;
      originY = hitState.hitOrigins[this.hitFrame]?.y || 0;
    } else if (state.frames.length > 0) {
      const f = this.frame % state.frames.length;
      img = state.frames[f];
      originX = state.origins[f]?.x || 0;
      originY = state.origins[f]?.y || 0;
    } else {
      return;
    }

    if (!img || !img.width) return;

    const screenX = this.x - originX - camera.x;
    const screenY = this.y - originY - camera.y;

    if (this.facing === 1) {
      // Flipped
      canvas.drawImage({
        img,
        dx: screenX,
        dy: screenY,
        flipped: true,
      });
    } else {
      canvas.drawImage({
        img,
        dx: screenX,
        dy: screenY,
      });
    }
  }
}
