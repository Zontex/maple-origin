/**
 * v83 Direction-scene player (Effect.wz/Direction3.img) — the fullscreen
 * scripted cutscenes GMS plays via the showIntro packet. Used by the Maple
 * Island job-experience rooms (maps 1020100-1020500, onUserEnter goSwordman
 * etc.): the player's character is dressed in that job's gear, performs its
 * skill stances with effect overlays and a title splash, then the scene's
 * field event warps them back to Split Road of Destiny.
 *
 * Scene item types (from WZ):
 *   0 — visual: animated canvas frames at (x,y), optional lerp to (x1,y1)
 *       over `duration`, optional sound, layered by z
 *   2 — field: warp to another map at `start` ms (ends the scene)
 *   3 — avatar: temporary cosmetic equips on the player (visual only —
 *       equippedItemIds is never touched, so saves stay clean)
 *   4 — action: play a body stance on the player (burster1, alert3, ...)
 */
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import WZManager from '../wz-utils/WZManager';
import PLAY_AUDIO from '../Audio/PlayAudio';

interface SceneFrame {
  img: HTMLImageElement;
  originX: number;
  originY: number;
  delay: number;
}

interface SceneVisual {
  start: number;
  x: number;
  y: number;
  x1: number;
  y1: number;
  duration: number;
  z: number;
  frames: SceneFrame[];
  soundPath: string | null;
  started: boolean;
  frameIdx: number;
  frameElapsed: number;
  done: boolean;
}

interface SceneEvent {
  kind: 'warp' | 'action' | 'avatar';
  start: number;
  fired: boolean;
  field?: number;
  action?: string;
  equipIds?: number[];
}

// Item id prefix (id/10000) → Character.wz directory + visual equip slot,
// matching MapleCharacter.attachEquip's routing
const EQUIP_DIRS: Record<number, { dir: string; slot: number }> = {
  100: { dir: 'Cap', slot: 0 },
  101: { dir: 'Accessory', slot: 1 },
  102: { dir: 'Accessory', slot: 2 },
  103: { dir: 'Accessory', slot: 3 },
  104: { dir: 'Coat', slot: 4 },
  105: { dir: 'Longcoat', slot: 4 },
  106: { dir: 'Pants', slot: 5 },
  107: { dir: 'Shoes', slot: 6 },
  108: { dir: 'Glove', slot: 7 },
  109: { dir: 'Shield', slot: 9 },
  110: { dir: 'Cape', slot: 8 },
  111: { dir: 'Ring', slot: 11 },
  112: { dir: 'Accessory', slot: 16 },
  113: { dir: 'Accessory', slot: 18 },
  114: { dir: 'Accessory', slot: 15 },
};
for (let p = 130; p <= 149; p++) EQUIP_DIRS[p] = { dir: 'Weapon', slot: 10 };
EQUIP_DIRS[160] = { dir: 'Weapon', slot: 10 };
EQUIP_DIRS[170] = { dir: 'Weapon', slot: 10 };

// 'Effect/Direction3.img/...' / 'Sound/Skill.img/...' → WZManager path
function toWzPath(path: string): string {
  return path.replace(/^(\w+)\//, '$1.wz/');
}

const DirectionScene = {
  isActive: false,
  _t: 0,
  _visuals: [] as SceneVisual[],
  _events: [] as SceneEvent[],
  _character: null as any,
  _savedEquips: null as any[] | null,
  // Guards against re-entry: map loads can race (double initializeMapState),
  // and the first Direction3.img load is slow — without these, two concurrent
  // scenes both play and both fire their warp
  _starting: false,
  _generation: 0,

  /**
   * Play Effect.wz/Direction3.img/<job>/Scene<gender> on the given character.
   * Resolves false only when the scene genuinely failed to load — the caller
   * should then warp the player out (the room has no other exit).
   */
  async startJobIntro(job: string, character: any): Promise<boolean> {
    if (this.isActive || this._starting) return true; // already handled
    this._starting = true;
    const gen = ++this._generation;
    try {
      const gender = character?.gender === 1 ? 1 : 0;
      const scene: any = await WZManager.get(`Effect.wz/Direction3.img/${job}/Scene${gender}`);
      if (!scene?.nChildren?.length) {
        console.warn(`[DirectionScene] Scene not found: ${job}/Scene${gender}`);
        return false;
      }

      const visuals: SceneVisual[] = [];
      const events: SceneEvent[] = [];

      for (const item of scene.nChildren) {
        const type = item.nGet('type').nGet('nValue', 0);
        const start = item.nGet('start').nGet('nValue', 0);
        if (type === 0) {
          const visualPath = item.nGet('visual').nGet('nValue', '');
          if (!visualPath) continue;
          const frames = await this._loadFrames(visualPath);
          if (!frames.length) continue;
          const x = item.nGet('x').nGet('nValue', 0);
          const y = item.nGet('y').nGet('nValue', 0);
          visuals.push({
            start,
            x,
            y,
            x1: item.nGet('x1').nGet('nValue', x),
            y1: item.nGet('y1').nGet('nValue', y),
            duration: item.nGet('duration').nGet('nValue', 0),
            z: item.nGet('z').nGet('nValue', 0),
            frames,
            soundPath: item.nGet('sound').nGet('nValue', null),
            started: false,
            frameIdx: 0,
            frameElapsed: 0,
            done: false,
          });
        } else if (type === 2) {
          events.push({
            kind: 'warp',
            start,
            fired: false,
            field: item.nGet('field').nGet('nValue', 0),
          });
        } else if (type === 3) {
          // Numbered children are equipped-slot → item id pairs; the slot is
          // re-derived from the item id prefix so only the ids matter
          const equipIds: number[] = [];
          for (const c of item.nChildren) {
            if (/^\d+$/.test(c.nName) && typeof c.nValue === 'number') {
              equipIds.push(c.nValue);
            }
          }
          events.push({ kind: 'avatar', start, fired: false, equipIds });
        } else if (type === 4) {
          events.push({
            kind: 'action',
            start,
            fired: false,
            action: item.nGet('action').nGet('nValue', ''),
          });
        }
      }

      // Superseded while loading (map changed, or a newer scene started) —
      // discard silently, the newer owner is in charge
      if (gen !== this._generation) return true;

      this._visuals = visuals;
      this._events = events;
      this._character = character;
      this._savedEquips = null;
      this._t = 0;
      // Scene effect positions (muzzle flames, the Gaviota target) are laid
      // out for the sprite's natural left-facing orientation — entering the
      // room mid-walk must not leave the avatar mirrored
      if (character) character.flipped = false;
      this.isActive = true;
      console.log(`[DirectionScene] Playing ${job}/Scene${gender} (${visuals.length} visuals, ${events.length} events)`);
      return true;
    } catch (e) {
      console.error('[DirectionScene] Failed to start scene:', e);
      return false;
    } finally {
      if (gen === this._generation) this._starting = false;
    }
  },

  /**
   * Abort any active or still-loading scene without firing its warp —
   * called when a new map initializes. Restores the character's own gear.
   */
  cancel() {
    this._generation++;
    this._starting = false;
    if (this.isActive) this._end();
  },

  async _loadFrames(visualPath: string): Promise<SceneFrame[]> {
    const frames: SceneFrame[] = [];
    try {
      const node: any = await WZManager.get(toWzPath(visualPath));
      const anim = node?.nGet?.('0');
      if (!anim?.nChildren) return frames;
      for (const f of anim.nChildren) {
        if (f.nTagName !== 'canvas') continue;
        frames.push({
          img: f.nGetImage(),
          originX: f.nGet('origin').nGet('nX', 0),
          originY: f.nGet('origin').nGet('nY', 0),
          delay: Math.abs(f.nGet('delay').nGet('nValue', 100)),
        });
      }
    } catch (e) {
      console.warn(`[DirectionScene] Failed to load visual ${visualPath}:`, e);
    }
    return frames;
  },

  update(msPerTick: number) {
    if (!this.isActive) return;
    this._t += msPerTick;

    for (const ev of this._events) {
      if (ev.fired || this._t < ev.start) continue;
      ev.fired = true;
      if (ev.kind === 'avatar') {
        this._applyAvatar(ev.equipIds || []);
      } else if (ev.kind === 'action') {
        if (this._character && ev.action) {
          // isInAttack keeps draw()'s movement logic from overriding the
          // stance; when the animation ends setFrame switches to alert
          this._character.isInAttack = true;
          this._character.flipped = false; // stances play left-facing
          this._character.setStance(ev.action, 0, true);
        }
      } else if (ev.kind === 'warp') {
        const field = ev.field || 0;
        this._end();
        const ms = (window as any).MapStateInstance;
        if (field && ms?.changeMap) ms.changeMap(field);
        return;
      }
    }

    for (const v of this._visuals) {
      if (v.done || this._t < v.start) continue;
      if (!v.started) {
        v.started = true;
        if (v.soundPath) this._playSound(v.soundPath);
      }
      v.frameElapsed += msPerTick;
      while (!v.done && v.frameElapsed > v.frames[v.frameIdx].delay) {
        v.frameElapsed -= v.frames[v.frameIdx].delay;
        if (v.frameIdx + 1 < v.frames.length) {
          v.frameIdx += 1;
        } else {
          v.done = true; // played through once — hide
        }
      }
    }
  },

  render(canvas: GameCanvas, camera: CameraInterface) {
    if (!this.isActive) return;
    const active = this._visuals
      .filter((v) => v.started && !v.done)
      .sort((a, b) => a.z - b.z);
    for (const v of active) {
      const f = v.frames[v.frameIdx];
      if (!f?.img) continue;
      // Positions are map coordinates; lerp toward (x1,y1) over duration
      const p = v.duration > 0 ? Math.min(1, (this._t - v.start) / v.duration) : 0;
      const wx = v.x + (v.x1 - v.x) * p;
      const wy = v.y + (v.y1 - v.y) * p;
      canvas.drawImage({
        img: f.img,
        dx: Math.floor(wx - f.originX - camera.x),
        dy: Math.floor(wy - f.originY - camera.y),
      });
    }
  },

  async _playSound(path: string) {
    try {
      const node: any = await WZManager.get(toWzPath(path));
      if (node?.nGetAudio) PLAY_AUDIO(node.nGetAudio());
    } catch (e) {
      console.warn(`[DirectionScene] Failed to play sound ${path}:`, e);
    }
  },

  async _applyAvatar(equipIds: number[]) {
    const character = this._character;
    if (!character) return;
    if (!this._savedEquips) this._savedEquips = [...character.equips];
    for (const id of equipIds) {
      const mapping = EQUIP_DIRS[Math.floor(id / 10000)];
      if (!mapping) continue;
      try {
        // Visual-only: swap the WZ node the renderer reads, never
        // equippedItemIds (which feeds saves and network sync)
        character.equips[mapping.slot] = await WZManager.get(`Character.wz/${mapping.dir}/0${id}.img`);
      } catch {
        /* medals etc. without sprite data — skip */
      }
    }
  },

  _end() {
    if (this._character) {
      if (this._savedEquips) {
        this._character.equips = this._savedEquips;
        // Anything that recalculated stats mid-scene picked up the costume's
        // equip bonuses (e.g. inflated max HP) — recompute from the real gear
        this._character.recalcLocalStats?.();
      }
      this._character.isInAttack = false;
    }
    this._cleanup();
  },

  _cleanup() {
    this.isActive = false;
    this._visuals = [];
    this._events = [];
    this._character = null;
    this._savedEquips = null;
  },
};

export default DirectionScene;
