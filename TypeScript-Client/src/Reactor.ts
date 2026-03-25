import WZManager from './wz-utils/WZManager';
import PLAY_AUDIO from './Audio/PlayAudio';
import GameCanvas from './GameCanvas';
import { CameraInterface } from './Camera';
import DropItemSprite from './DropItem/DropItemSprite';
import REACTOR_DROPS from './Constants/ReactorDropData';

interface ReactorState {
  frames: HTMLImageElement[];
  origins: { x: number; y: number }[];
  delays: number[];
  hitFrames: HTMLImageElement[];
  hitOrigins: { x: number; y: number }[];
  hitDelays: number[];
  nextState: number; // state to transition to on hit (from event)
}

export default class Reactor {
  id: number = 0;
  x: number = 0;
  y: number = 0;
  reactorTime: number = 0; // respawn delay in seconds; 0 = no respawn
  facing: number = 0;
  layer: number = 0;
  map: any = null;

  private states: ReactorState[] = [];
  private currentState: number = 0;
  private maxState: number = 0;
  destroyed: boolean = false;
  respawnScheduled: boolean = false;
  private pendingDestroy: boolean = false;
  private pendingAdvance: number = -1;
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

  static async fromOpts(opts: {
    id: number;
    x: number;
    y: number;
    reactorTime: number;
    f?: number;
    map?: any;
  }): Promise<Reactor> {
    const reactor = new Reactor();
    reactor.id = opts.id;
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
      const node: any = await WZManager.get(path);
      if (!node) {
        console.warn(`[Reactor] No WZ data for reactor ${this.id}`);
        return;
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
          nextState: stateIndex + 1,
        };

        // Parse event (tells us what triggers state transition)
        const eventNode = stateNode.event;
        if (eventNode?.nChildren) {
          for (const evt of eventNode.nChildren) {
            if (evt.state?.nValue !== undefined) {
              state.nextState = evt.state.nValue;
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

      console.log(`[Reactor] Loaded reactor ${this.id}: ${this.states.length} states (maxState=${this.maxState})`);
      for (let i = 0; i < this.states.length; i++) {
        const s = this.states[i];
        console.log(`  State ${i}: ${s.frames.length} frames, ${s.hitFrames.length} hit frames, nextState=${s.nextState}`);
      }
    } catch (e) {
      console.error(`[Reactor] Failed to load reactor ${this.id}:`, e);
    }
  }

  hit(): boolean {
    if (this.destroyed || this.isHit || this.pendingDestroy) return false;

    const state = this.states[this.currentState];
    if (!state) return false;

    // Check if this hit will destroy the reactor
    // The last state (e.g. state 4) is always the "destroyed" state (1x1 pixel).
    // Transitioning TO that state = destruction. maxState counts all states including the destroyed one.
    const nextState = state.nextState;
    const willDestroy = nextState >= this.maxState - 1;
    console.log(`[Reactor] Hit! state=${this.currentState}, nextState=${nextState}, maxState=${this.maxState}, willDestroy=${willDestroy}`);

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

  private destroy(): void {
    this.destroyed = true;
    this.dropItems();

    // Play break sound
    try {
      WZManager.get('Sound.wz/Game.img/DropItem').then((node: any) => {
        if (node?.nGetAudio) PLAY_AUDIO(node.nGetAudio());
      });
    } catch {}
  }

  private async dropItems(): Promise<void> {
    const drops = REACTOR_DROPS.get(this.id);
    if (!drops || !this.map) return;

    const questManager = (window as any).charecter?.questManager;
    const spacing = 25;
    let dropIndex = 0;

    for (const drop of drops) {
      // Quest-gated drops: only drop if player has the quest active
      if (drop.questId > 0) {
        if (!questManager?.activeQuests?.has(drop.questId)) continue;
        // Check if player already has enough
        const currentCount = questManager.getItemCount(drop.itemId);
        // Look up required count from quest requirements
        const QuestData = (await import('./Quest/QuestData')).default;
        const reqs = QuestData.requirements.get(drop.questId);
        if (reqs?.complete?.items) {
          const needed = reqs.complete.items.find((i: any) => i.id === drop.itemId);
          if (needed && currentCount >= needed.count) continue;
        }
      }

      // Chance check — higher chance value = rarer (1 = 100%, 2 = 50%, 10 = 10%)
      // Formula from Cosmic: Math.random() < (dropRate / chance)
      if (Math.random() >= (1 / drop.chance)) continue;

      // Create the drop using DropItemSprite.fromOpts (same pattern as Monster)
      const offsetX = (dropIndex - 1) * spacing;
      try {
        const dropItem = await DropItemSprite.fromOpts({
          id: drop.itemId,
          monster: {
            pos: { x: this.x + offsetX, y: this.y, vx: 0, vy: 0 },
          },
          amount: 1,
        });
        if (dropItem && !dropItem.destroyed) {
          this.map.addItemDrop(dropItem);
        }
      } catch (e) {
        console.warn(`[Reactor] Failed to create drop ${drop.itemId}:`, e);
      }
      dropIndex++;
    }
  }

  reset(): void {
    this.destroyed = false;
    this.respawnScheduled = false;
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
