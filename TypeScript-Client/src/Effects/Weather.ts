import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import Config from '../Config';
import ClickManager from '../UI/ClickManager';
import { MapleStanceButton } from '../UI/MapleStanceButton';
import MapleInput from '../UI/MapleInput';
import { MapleInventoryType } from '../Constants/Inventory/MapleInventory';
import { FieldLimit, FIELD_LIMIT_MESSAGE, currentMapForbids } from '../Constants/FieldLimit';

/**
 * Cash Shop weather effects (items 5120000-5122000: Snowy Snow, Sprinkled
 * Flowers, Soap Bubbles, Fireworks, ...): 30 seconds of sprites falling
 * over the whole map plus the sender's message at the top of the screen,
 * seen by everyone on the map.
 *
 * Everything about an item comes from its own WZ entry,
 * `Item.wz/Cash/0512.img/<id>/info`:
 *  - `path`      "Map/MapHelper.img/weather/<key>" — the sprite set to use
 *                (37 sets ship in MapHelper: snow, flower, soap, snowCrystal,
 *                present, chocolate, flowerage, candy, maple, squib/squib,
 *                coke, ghost, christmasSocks, kairin, firecracker, dogandcat,
 *                korea, red, soccer, chicken, ricecake, ricesnack, witch,
 *                tree, birthday, rose, wedding, fishBread, snowmanSnow,
 *                sweetHeart, water, knitsWithWarmWinter, happyNewyear,
 *                lovelypartybear, foodFromsky, cloud, none)
 *  - `type`      1/2 = falling particles, 3 = burst animations (squib) or
 *                message-only ("none"), 4 = the firecracker plume
 *  - `floatType` how the sprite drifts sideways on the way down
 *  - `stateChangeItem` a potion applied to everyone on the map (Soccer
 *                Fever, Tree Decor, Petite Rose...) — NOT implemented
 * and the banner text from `String.wz/Cash.img/<id>/msg`, "%s's snow : %s"
 * with the sender's name and typed message (Cosmic fills both the same way).
 *
 * Protocol: the user's client consumes the item and sends
 *   { type: 'weather', data: { itemId, message } }
 * server/handlers/weather.js stamps the sender's name and relays it to the
 * whole room INCLUDING the sender, so everyone starts the same effect from
 * the same packet. Offline, the effect starts locally.
 *
 * Sprites are drawn in screen space over the map (before the HUD) — the
 * original composes the weather layer over the field the same way, and a
 * screen-space sheet is what lets "the whole map" be covered without
 * spawning thousands of particles.
 */

const WEATHER_DURATION_MS = 30000;
const MAX_MESSAGE = 60;
const FALLING_TARGET = 48; // particles kept on screen for type 1/2 sets
const BURST_INTERVAL_MS = 350; // type 3 (squib) bursts
const PLUME_INTERVAL_MS = 650; // type 4 (firecracker) plumes

interface Frame {
  img: HTMLImageElement;
  ox: number;
  oy: number;
  delay: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  sway: number;
  frames: Frame[]; // one frame for a falling sprite, many for an animation
  frameIdx: number;
  frameTimer: number;
  oneShot: boolean; // burst/plume: removed after its frames have played
}

interface WeatherSet {
  key: string;
  type: number;
  floatType: number;
  // Falling sets: each entry a single-frame list. Animated sets (squib
  // subdirs, firecracker/0): each entry the animation's frames.
  sprites: Frame[][];
}

interface ActiveWeather {
  set: WeatherSet;
  endsAt: number;
  banner: string;
  mapId: number; // weather belongs to the map it was used on
}

export function isWeatherItem(itemId: number): boolean {
  return itemId >= 5120000 && itemId < 5130000;
}

function frameOf(node: any): Frame | null {
  let n = node;
  if (n?.nTagName === 'uol' && n.nResolveUOL) n = n.nResolveUOL();
  if (!n || n.nTagName !== 'canvas') return null;
  const img = n.nGetImage?.();
  if (!img) return null;
  return {
    img,
    ox: n.origin?.nX ?? 0,
    oy: n.origin?.nY ?? 0,
    delay: Number(n.delay?.nValue) || 100,
  };
}

/** Numbered canvas children of a node, in order */
function framesOf(node: any): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < 64; i++) {
    const child = node?.[String(i)];
    if (!child) break;
    const f = frameOf(child);
    if (!f) break;
    out.push(f);
  }
  return out;
}

const setCache: Map<string, WeatherSet | null> = new Map();

async function loadWeatherSet(itemId: number): Promise<WeatherSet | null> {
  const padded = String(itemId).padStart(8, '0');
  if (setCache.has(padded)) return setCache.get(padded)!;
  let result: WeatherSet | null = null;
  try {
    const itemImg: any = await WZManager.get('Item.wz/Cash/0512.img');
    const info = itemImg?.nGet?.(padded)?.nGet?.('info');
    const path: string = String(info?.nGet?.('path')?.nValue ?? '');
    const type = Number(info?.nGet?.('type')?.nValue ?? 2);
    const floatType = Number(info?.nGet?.('floatType')?.nValue ?? 0);
    const m = /weather\/(.+)$/.exec(path);
    const key = m ? m[1] : 'none';

    const helper: any = await WZManager.get('Map.wz/MapHelper.img');
    let node: any = helper?.nGet?.('weather');
    for (const part of key.split('/')) node = node?.nGet?.(part);

    const sprites: Frame[][] = [];
    if (node && key !== 'none') {
      const direct = framesOf(node);
      const animated = !!node.nGet?.('ani')?.nValue;
      if (direct.length > 0 && !animated) {
        // Falling set: every numbered canvas is a sprite variant
        for (const f of direct) sprites.push([f]);
      } else {
        // Animated set: each imgdir child (squib0..4, firecracker/0) is an
        // animation, and a numbered canvas run under the node itself is one
        for (const child of node.nChildren || []) {
          if (child.nTagName !== 'imgdir') continue;
          const frames = framesOf(child);
          if (frames.length > 0) sprites.push(frames);
        }
        if (sprites.length === 0 && direct.length > 0) sprites.push(direct);
      }
    }
    result = { key, type, floatType, sprites };
  } catch (e) {
    console.warn(`[Weather] failed to load set for ${itemId}:`, e);
    result = null;
  }
  setCache.set(padded, result);
  return result;
}

async function itemMessageTemplate(itemId: number): Promise<string> {
  try {
    const cash: any = await WZManager.get('String.wz/Cash.img');
    const msg = cash?.nGet?.(String(itemId))?.nGet?.('msg')?.nValue;
    if (msg) return String(msg);
  } catch {}
  return '%s : %s';
}

function formatBanner(template: string, name: string, message: string): string {
  let out = template.replace('%s', name);
  out = out.replace('%s', message);
  return out;
}

const Weather = {
  active: null as ActiveWeather | null,
  particles: [] as Particle[],
  spawnTimer: 0,
  _hookedSocket: null as any,

  // --- Message input dialog (CSNotice/2, the Cash Shop message box) ------
  _dialogOpen: false,
  _dialogItem: null as any,
  _dialogSlot: -1,
  _dialogInput: null as MapleInput | null,
  _dialogButtons: [] as MapleStanceButton[],
  _dialogBg: null as HTMLImageElement | null,

  get isActive(): boolean {
    return !!this.active;
  },

  get isDialogOpen(): boolean {
    return this._dialogOpen;
  },

  /**
   * Start (or restart) a weather effect on this client. `name` is the
   * sender; the banner is the item's String.wz msg with both %s filled.
   */
  async start(opts: { itemId: number; message: string; name: string; durationMs?: number }): Promise<void> {
    const set = await loadWeatherSet(opts.itemId);
    if (!set) return;
    const template = await itemMessageTemplate(opts.itemId);
    const banner = formatBanner(template, opts.name, opts.message);
    this.active = {
      set,
      endsAt: Date.now() + (opts.durationMs ?? WEATHER_DURATION_MS),
      banner,
      mapId: Number((window as any).charecter?.map?.id ?? 0),
    };
    this.particles = [];
    this.spawnTimer = 0;
    // Falling sets open with the sky already full, like the original —
    // staggered down the screen so it reads as ongoing snow, not a curtain
    if (set.type !== 3 && set.type !== 4 && set.sprites.length > 0) {
      for (let i = 0; i < FALLING_TARGET; i++) {
        const p = this.spawnFalling(set);
        p.y = Math.random() * Config.height;
      }
    }
    import('../UI/UIChatLog')
      .then(({ default: UIChatLog }) => UIChatLog.notice(banner))
      .catch(() => {});
  },

  stop(): void {
    this.active = null;
    this.particles = [];
  },

  spawnFalling(set: WeatherSet): Particle {
    const frames = set.sprites[Math.floor(Math.random() * set.sprites.length)];
    const size = Math.max(frames[0].img.width || 16, frames[0].img.height || 16);
    // Big sprites fall faster than flakes; floatType sets how much they drift
    const base = size <= 20 ? 55 : size <= 40 ? 80 : 110;
    const p: Particle = {
      x: -40 + Math.random() * (Config.width + 80),
      y: -40 - Math.random() * 40,
      vx: 0,
      vy: base + Math.random() * base * 0.6,
      phase: Math.random() * Math.PI * 2,
      sway: set.floatType > 0 ? 18 + Math.random() * 22 : 6 + Math.random() * 6,
      frames,
      frameIdx: 0,
      frameTimer: 0,
      oneShot: false,
    };
    this.particles.push(p);
    return p;
  },

  spawnBurst(set: WeatherSet, x: number, y: number): void {
    const frames = set.sprites[Math.floor(Math.random() * set.sprites.length)];
    this.particles.push({
      x, y, vx: 0, vy: 0, phase: 0, sway: 0,
      frames, frameIdx: 0, frameTimer: 0, oneShot: true,
    });
  },

  update(msPerTick: number): void {
    this.hookSocket();
    const a = this.active;
    if (!a) return;
    // Map-bound: walking out leaves the snow behind
    const hereId = Number((window as any).charecter?.map?.id ?? 0);
    if (a.mapId && hereId && hereId !== a.mapId) {
      this.stop();
      return;
    }
    const now = Date.now();
    const running = now < a.endsAt;
    const dt = msPerTick / 1000;
    const set = a.set;

    if (running && set.sprites.length > 0) {
      if (set.type === 3) {
        this.spawnTimer += msPerTick;
        while (this.spawnTimer >= BURST_INTERVAL_MS) {
          this.spawnTimer -= BURST_INTERVAL_MS;
          this.spawnBurst(set, 60 + Math.random() * (Config.width - 120), 50 + Math.random() * (Config.height * 0.5));
        }
      } else if (set.type === 4) {
        this.spawnTimer += msPerTick;
        while (this.spawnTimer >= PLUME_INTERVAL_MS) {
          this.spawnTimer -= PLUME_INTERVAL_MS;
          // The firecracker frames are 150x410 with their origin at mid
          // height — planted low so the plume climbs the screen
          this.spawnBurst(set, 80 + Math.random() * (Config.width - 160), Config.height - 120);
        }
      } else {
        const falling = this.particles.filter((p) => !p.oneShot).length;
        for (let i = falling; i < FALLING_TARGET; i++) this.spawnFalling(set);
      }
    }

    for (const p of this.particles) {
      if (p.oneShot) {
        p.frameTimer += msPerTick;
        const delay = p.frames[p.frameIdx]?.delay || 100;
        if (p.frameTimer >= delay) {
          p.frameTimer -= delay;
          p.frameIdx++;
        }
        continue;
      }
      p.phase += dt * 2.2;
      p.x += Math.sin(p.phase) * p.sway * dt + p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) =>
      p.oneShot ? p.frameIdx < p.frames.length : p.y < Config.height + 60
    );

    // Over: keep the banner until the last sprite has left the screen
    if (!running && this.particles.length === 0) this.active = null;
  },

  draw(canvas: GameCanvas, _camera: CameraInterface): void {
    const a = this.active;
    if (a) {
      for (const p of this.particles) {
        const f = p.frames[p.frameIdx] || p.frames[0];
        if (!f?.img?.width) continue;
        canvas.drawImage({ img: f.img, dx: Math.round(p.x - f.ox), dy: Math.round(p.y - f.oy) });
      }
      if (a.banner) {
        // The sender's line, top centre — white over a dark edge so it reads
        // on any sky, the way the original draws its map-effect text
        canvas.drawText({
          text: a.banner,
          x: Config.width / 2,
          y: 28,
          align: 'center',
          color: '#FFFFFF',
          stroke: '#000000',
          strokeWidth: 3,
          fontSize: 12,
          fontWeight: 'bold',
        });
      }
    }

    if (this._dialogOpen && this._dialogBg) {
      const dw = this._dialogBg.width;
      const dh = this._dialogBg.height;
      const dx = Math.floor((Config.width - dw) / 2);
      const dy = Math.floor((Config.height - dh) / 2);
      canvas.drawImage({ img: this._dialogBg, dx, dy });
      // The art bakes "To :" with a recipient field — a weather item goes
      // to the whole map
      canvas.drawText({ text: 'Everyone on the map', x: dx + 68, y: dy + 21, fontSize: 12, color: '#000000' });
      for (const btn of this._dialogButtons) {
        btn.draw(canvas, { x: 0, y: 0 } as CameraInterface, 0, 16, 0);
      }
    }
  },

  /** Receive `weather` relays — registered once per socket instance */
  hookSocket(): void {
    const socket = (window as any).__mySocket;
    if (!socket || socket === this._hookedSocket || typeof socket.on !== 'function') return;
    this._hookedSocket = socket;
    socket.on('weather', (msg: any) => {
      const data = msg?.data || {};
      const myMap = Number((window as any).charecter?.map?.id ?? NaN);
      if (data.mapId !== undefined && Number(data.mapId) !== myMap) return;
      void this.start({
        itemId: Number(data.itemId) || 0,
        message: String(data.message ?? ''),
        name: String(data.name ?? 'Someone'),
      });
    });
  },

  /**
   * Double-clicked a weather item in the CASH tab: ask for the message,
   * then consume the item and send it to the room.
   */
  async promptAndUse(item: any, slotIndex: number, character: any): Promise<void> {
    if (this._dialogOpen) return;
    if (currentMapForbids(FieldLimit.CASHWEATHER)) {
      import('../UI/UIChatLog')
        .then(({ default: UIChatLog }) => UIChatLog.system(FIELD_LIMIT_MESSAGE))
        .catch(() => {});
      return;
    }
    const canvas: GameCanvas | null = (ClickManager as any).GameCanvas ?? null;
    if (!canvas) return;
    this._dialogOpen = true;
    this._dialogItem = item;
    this._dialogSlot = slotIndex;

    try {
      const cs: any = await WZManager.get('UI.wz/CashShop.img');
      this._dialogBg = cs.nGet('CSNotice').nGet('2')?.nGet?.('backgrnd')?.nGetImage?.() || null;
      const basic: any = await WZManager.get('UI.wz/Basic.img');

      const dw = this._dialogBg?.width ?? 266;
      const dh = this._dialogBg?.height ?? 142;
      const dx = Math.floor((Config.width - dw) / 2);
      const dy = Math.floor((Config.height - dh) / 2);

      // On the art's baked message box, (17,43)-(254,95) of the 266x142 dialog
      this._dialogInput = new MapleInput(canvas, {
        x: dx + 18,
        y: dy + 44,
        width: dw - 38,
        height: 50,
        color: '#000000',
        background: '#ffffff',
        border: 'none',
        fontSize: 12,
        submitListeners: [() => this._submitDialog(character)],
      });
      this._dialogInput.input.maxLength = MAX_MESSAGE;
      this._dialogInput.input.focus();

      const ok = new MapleStanceButton(canvas, {
        x: dx + Math.floor(dw / 2) - 70, y: dy + dh - 32,
        img: basic.nGet('BtOK').nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this._submitDialog(character),
      });
      const cancel = new MapleStanceButton(canvas, {
        x: dx + Math.floor(dw / 2) + 8, y: dy + dh - 32,
        img: basic.nGet('BtCancel').nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this.closeDialog(),
      });
      this._dialogButtons = [ok, cancel];
      ClickManager.addButton(ok);
      ClickManager.addButton(cancel);
    } catch (e) {
      console.error('[Weather] dialog failed to open:', e);
      this.closeDialog();
    }
  },

  _submitDialog(character: any): void {
    const message = (this._dialogInput?.input?.value ?? '').trim();
    const item = this._dialogItem;
    if (!message || !item) {
      this.closeDialog();
      return;
    }
    const itemId = Number(item.itemId);
    const slot = this._dialogSlot;
    this.closeDialog();

    // One use, one item — consumed before the effect goes out
    const inv = character?.inventory;
    if (inv) {
      if (typeof inv.removeAt === 'function' && slot >= 0 && inv.cash?.[slot]?.itemId === itemId) {
        inv.removeAt(MapleInventoryType.CASH, slot);
      } else {
        inv.removeFromInventory(itemId, 1);
      }
    }

    const name = character?.name || 'Player';
    const socket = (window as any).__mySocket;
    const mapId = Number(character?.map?.id ?? 0);
    if (socket?.isConnected) {
      socket.sendMessage({ type: 'weather', data: { itemId, message, mapId } });
    } else {
      void this.start({ itemId, message, name });
    }
  },

  closeDialog(): void {
    for (const btn of this._dialogButtons) ClickManager.removeButton(btn);
    this._dialogButtons = [];
    this._dialogInput?.remove();
    this._dialogInput = null;
    this._dialogOpen = false;
    this._dialogItem = null;
    this._dialogSlot = -1;
  },
};

export default Weather;
