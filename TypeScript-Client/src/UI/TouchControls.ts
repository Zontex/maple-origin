import GameCanvas from '../GameCanvas';
import config from '../Config';
import KeyBindings from '../KeyBindings';

/**
 * MapleStory-M-style on-screen controls for touch devices: a virtual
 * joystick (bottom-left) and action buttons (bottom-right), drawn on the
 * game canvas and multi-touch aware — move with one thumb while attacking
 * with the other.
 *
 * Integration model: the controls inject VIRTUAL KEY STATE into
 * GameCanvas.pressedKeys through setVirtualKey. The entire input layer
 * (movement, tryJump's rope re-arm, attack cadence, pickup) already polls
 * isKeyDown, so every keyboard nuance works unchanged. GameCanvas routes
 * touches here first (claimTouch); unclaimed touches fall through to the
 * mouse emulation that drives regular UI taps.
 */

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

interface VButton {
  id: string;
  label: string;
  /** action name in KeyBindings (jump/attack/pickup) or a raw key name */
  action: string;
  rawKey?: string; // when set, inject this key name instead of an action
  radius: number;
  /** position factory — recomputed per frame so resolution changes follow */
  pos: () => { x: number; y: number };
  touchId: number | null;
}

const JOY_RADIUS = 66;
const JOY_NUB = 30;
const JOY_DEADZONE = 0.28; // fraction of radius before a direction engages
const DIAGONAL_RATIO = 0.5; // |dy/dx| beyond which the vertical also engages

const TouchControls = {
  /** true while the map state wants the controls (touch device + in game) */
  active: false,

  _joyTouchId: null as number | null,
  _joyDX: 0,
  _joyDY: 0,

  _buttons: [
    {
      id: 'jump', label: 'JUMP', action: 'jump', radius: 42,
      pos: () => ({ x: config.width - 74, y: config.height - 118 }),
      touchId: null,
    },
    {
      id: 'attack', label: 'ATK', action: 'attack', radius: 34,
      pos: () => ({ x: config.width - 164, y: config.height - 88 }),
      touchId: null,
    },
    {
      id: 'loot', label: 'LOOT', action: 'pickup', radius: 27,
      pos: () => ({ x: config.width - 138, y: config.height - 176 }),
      touchId: null,
    },
  ] as VButton[],

  joyCenter() {
    return { x: 104, y: config.height - 118 };
  },

  /**
   * Try to claim a starting touch. Returns true when the touch belongs to
   * the controls (GameCanvas must then NOT treat it as a mouse tap).
   */
  claimTouch(x: number, y: number, id: number): boolean {
    if (!this.active) return false;

    const c = this.joyCenter();
    // Generous grab area around the stick so thumbs don't need precision
    if (this._joyTouchId === null && Math.hypot(x - c.x, y - c.y) <= JOY_RADIUS * 1.6) {
      this._joyTouchId = id;
      this._joyDX = x - c.x;
      this._joyDY = y - c.y;
      return true;
    }

    for (const b of this._buttons) {
      const p = b.pos();
      if (b.touchId === null && Math.hypot(x - p.x, y - p.y) <= b.radius * 1.35) {
        b.touchId = id;
        return true;
      }
    }
    return false;
  },

  moveTouch(x: number, y: number, id: number): boolean {
    if (id === this._joyTouchId) {
      const c = this.joyCenter();
      this._joyDX = x - c.x;
      this._joyDY = y - c.y;
      return true;
    }
    // Buttons are press-and-hold; movement within/out of them is ignored
    return this._buttons.some((b) => b.touchId === id);
  },

  endTouch(id: number): boolean {
    let handled = false;
    if (id === this._joyTouchId) {
      this._joyTouchId = null;
      this._joyDX = 0;
      this._joyDY = 0;
      handled = true;
    }
    for (const b of this._buttons) {
      if (b.touchId === id) {
        b.touchId = null;
        handled = true;
      }
    }
    return handled;
  },

  _virtualState: {} as Record<string, boolean>,

  /** Per-frame: convert control state into virtual key state. Call BEFORE
   *  the input polling in MapState.doUpdate. Edge-detected so a held
   *  physical key is never stomped by the per-frame refresh. */
  update(canvas: GameCanvas) {
    const setKey = (name: string, down: boolean) => {
      if (this._virtualState[name] === down) return;
      this._virtualState[name] = down;
      canvas.setVirtualKey(name, down);
    };

    if (!this.active) {
      // Make sure nothing sticks when controls get disabled mid-hold
      for (const name of ['left', 'right', 'up', 'down']) setKey(name, false);
      return;
    }

    // Joystick → 8-way directions with hysteresis-free deadzone
    let left = false, right = false, up = false, down = false;
    if (this._joyTouchId !== null) {
      const dx = this._joyDX;
      const dy = this._joyDY;
      const dead = JOY_RADIUS * JOY_DEADZONE;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (Math.hypot(dx, dy) > dead) {
        if (adx > ady * DIAGONAL_RATIO) {
          left = dx < 0;
          right = dx > 0;
        }
        if (ady > adx * DIAGONAL_RATIO) {
          up = dy < 0;
          down = dy > 0;
        }
      }
    }
    setKey('left', left);
    setKey('right', right);
    setKey('up', up);
    setKey('down', down);

    for (const b of this._buttons) {
      const keyName = b.rawKey ?? KeyBindings.keyNameFor(b.action as any);
      if (keyName) setKey(keyName, b.touchId !== null);
    }
  },

  /** Draw the overlay — call late in the render so it sits above the HUD */
  draw(canvas: GameCanvas) {
    if (!this.active) return;
    const ctx = canvas.context;
    ctx.save();

    // Joystick base + nub
    const c = this.joyCenter();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(c.x, c.y, JOY_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, JOY_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    let nx = c.x, ny = c.y;
    if (this._joyTouchId !== null) {
      const len = Math.hypot(this._joyDX, this._joyDY) || 1;
      const clamped = Math.min(len, JOY_RADIUS - 8);
      nx = c.x + (this._joyDX / len) * clamped;
      ny = c.y + (this._joyDY / len) * clamped;
    }
    ctx.globalAlpha = this._joyTouchId !== null ? 0.75 : 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(nx, ny, JOY_NUB, 0, Math.PI * 2);
    ctx.fill();

    // Buttons
    for (const b of this._buttons) {
      const p = b.pos();
      const pressed = b.touchId !== null;
      ctx.globalAlpha = pressed ? 0.6 : 0.3;
      ctx.fillStyle = pressed ? '#ffcc44' : '#000000';
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = pressed ? 0.9 : 0.55;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = pressed ? 1 : 0.7;
      canvas.drawText({
        text: b.label,
        x: p.x,
        y: p.y - 6,
        color: '#ffffff',
        fontSize: 13,
        fontWeight: 'bold',
        align: 'center',
      });
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  },
};

export default TouchControls;
