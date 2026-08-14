import GameCanvas from '../GameCanvas';
import config from '../Config';
import KeyBindings from '../KeyBindings';
import UIHotkeyBar from './UIHotkeyBar';
import DragableMenu from './Menu/DragableMenu';

/**
 * MapleStory-M-style on-screen controls for touch devices.
 *
 * Movement is a FLOATING pad: any touch in the lower-left region of the
 * screen becomes the stick, anchored where the thumb lands — there is no
 * small grab circle to miss, which is what made earlier joystick touches
 * fall through to cursor emulation ("can't move"). The right side is the
 * action cluster: big ATK, JUMP, LOOT, and four skill slots that mirror
 * the first hotkey-bar slots (icons included, tap to fire).
 *
 * Controls inject VIRTUAL KEY STATE (GameCanvas.setVirtualKey), so the
 * entire existing input layer — movement, tryJump's rope re-arm, attack
 * cadence, pickup — works unchanged and follows user rebindings.
 */

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

interface VButton {
  id: string;
  label: string;
  action: string;
  radius: number;
  pos: () => { x: number; y: number };
  touchId: number | null;
}

const JOY_RADIUS = 70;
const JOY_NUB = 30;
const JOY_DEADZONE_PX = 14;      // floating stick: small fixed deadzone
const DIAGONAL_RATIO = 0.45;

const TouchControls = {
  active: false,

  /** Set by MapState while a full-screen dialog (world map, game menu,
   *  NPC talk, shops...) is up — controls stop claiming touches so the
   *  dialog's own buttons are tappable, and stop drawing. */
  claimSuppressed: false,

  // Floating pad state
  _joyTouchId: null as number | null,
  _joyOrigin: { x: 0, y: 0 },
  _joyDX: 0,
  _joyDY: 0,

  _buttons: [
    {
      id: 'attack', label: 'ATK', action: 'attack', radius: 52,
      pos: () => ({ x: config.width - 86, y: config.height - 96 }),
      touchId: null,
    },
    {
      id: 'jump', label: 'JUMP', action: 'jump', radius: 40,
      pos: () => ({ x: config.width - 198, y: config.height - 74 }),
      touchId: null,
    },
    {
      id: 'loot', label: 'LOOT', action: 'pickup', radius: 30,
      pos: () => ({ x: config.width - 206, y: config.height - 168 }),
      touchId: null,
    },
  ] as VButton[],

  // Skill arc: mirrors UIHotkeyBar slots (index 0..3), arcing up-left of ATK
  _skillSlots: [
    { slotIndex: 0, radius: 27, touchId: null as number | null,
      pos: () => ({ x: config.width - 96, y: config.height - 208 }) },
    { slotIndex: 1, radius: 27, touchId: null as number | null,
      pos: () => ({ x: config.width - 168, y: config.height - 258 }) },
    { slotIndex: 2, radius: 27, touchId: null as number | null,
      pos: () => ({ x: config.width - 252, y: config.height - 280 }) },
    { slotIndex: 3, radius: 27, touchId: null as number | null,
      pos: () => ({ x: config.width - 338, y: config.height - 284 }) },
  ],

  /** Default (idle) pad anchor — also where the ghost pad draws */
  padAnchor() {
    return { x: 120, y: config.height - 150 };
  },

  /** The whole lower-left region summons the floating pad */
  inPadZone(x: number, y: number): boolean {
    return x < config.width * 0.42 && y > config.height * 0.30;
  },

  claimTouch(x: number, y: number, id: number): boolean {
    if (!this.active || this.claimSuppressed) return false;

    // A touch over an open window (inventory, quest log, ...) belongs to
    // the window — otherwise a window overlapping the pad zone becomes
    // untappable and taps on it walk the character instead
    if (DragableMenu.anyHits(x, y)) return false;

    // Action buttons and skill slots first (they sit right of the pad zone)
    for (const b of this._buttons) {
      const p = b.pos();
      if (b.touchId === null && Math.hypot(x - p.x, y - p.y) <= b.radius * 1.3) {
        b.touchId = id;
        return true;
      }
    }
    for (const s of this._skillSlots) {
      const p = s.pos();
      if (s.touchId === null && Math.hypot(x - p.x, y - p.y) <= s.radius * 1.3) {
        s.touchId = id;
        // Fire on press for responsiveness (same path as the bound key)
        const slot = UIHotkeyBar.slots?.[s.slotIndex];
        if (slot && slot.type !== 'none' && slot.actionId != null) {
          if (slot.type === 'item') UIHotkeyBar.activateItem(slot.actionId);
          else if (slot.type === 'skill') void UIHotkeyBar.activateSkill(slot.actionId);
        }
        return true;
      }
    }

    // Floating movement pad
    if (this._joyTouchId === null && this.inPadZone(x, y)) {
      this._joyTouchId = id;
      // Anchor at the touch, clamped so the full pad stays on screen
      this._joyOrigin = {
        x: Math.max(JOY_RADIUS, Math.min(config.width * 0.42, x)),
        y: Math.max(config.height * 0.30 + JOY_RADIUS * 0.5,
            Math.min(config.height - JOY_RADIUS * 0.6, y)),
      };
      this._joyDX = 0;
      this._joyDY = 0;
      return true;
    }

    return false;
  },

  moveTouch(x: number, y: number, id: number): boolean {
    if (id === this._joyTouchId) {
      this._joyDX = x - this._joyOrigin.x;
      this._joyDY = y - this._joyOrigin.y;
      return true;
    }
    return this._buttons.some((b) => b.touchId === id) ||
      this._skillSlots.some((s) => s.touchId === id);
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
      if (b.touchId === id) { b.touchId = null; handled = true; }
    }
    for (const s of this._skillSlots) {
      if (s.touchId === id) { s.touchId = null; handled = true; }
    }
    return handled;
  },

  /** Drop every held control (fullscreen transitions, tab blur, and OS
   *  gestures can cancel touches without touchend — anything held would
   *  otherwise stick forever). */
  resetTouches() {
    this._joyTouchId = null;
    this._joyDX = 0;
    this._joyDY = 0;
    for (const b of this._buttons) b.touchId = null;
    for (const s of this._skillSlots) s.touchId = null;
  },

  /** Per-frame: control state → virtual keys. Written AUTHORITATIVELY
   *  every frame — no edge cache. Mobile browsers clear the key store
   *  behind our backs (fullscreen enter, blur, URL-bar transitions), and
   *  an edge cache desyncs from that and leaves controls dead until a
   *  full release+repress. Touch devices have no physical keyboard to
   *  conflict with; desktop has active=false. */
  update(canvas: GameCanvas) {
    const setKey = (name: string, down: boolean) => canvas.setVirtualKey(name, down);

    if (!this.active) return;

    if (this.claimSuppressed) {
      // Dialog opened mid-hold: release everything so nothing sticks
      this.resetTouches();
      for (const name of ['left', 'right', 'up', 'down']) setKey(name, false);
      for (const b of this._buttons) {
        const keyName = KeyBindings.keyNameFor(b.action as any);
        if (keyName) setKey(keyName, false);
      }
      return;
    }

    let left = false, right = false, up = false, down = false;
    if (this._joyTouchId !== null) {
      const dx = this._joyDX;
      const dy = this._joyDY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (Math.hypot(dx, dy) > JOY_DEADZONE_PX) {
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
      const keyName = KeyBindings.keyNameFor(b.action as any);
      if (keyName) setKey(keyName, b.touchId !== null);
    }
  },

  draw(canvas: GameCanvas) {
    if (!this.active || this.claimSuppressed) return;
    const ctx = canvas.context;
    ctx.save();

    // Movement pad: ghost at anchor when idle, full pad at the floating
    // origin while held — with M-style direction chevrons
    const held = this._joyTouchId !== null;
    const c = held ? this._joyOrigin : this.padAnchor();
    ctx.globalAlpha = held ? 0.4 : 0.22;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(c.x, c.y, JOY_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = held ? 0.7 : 0.4;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, JOY_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Chevrons
    ctx.globalAlpha = held ? 0.85 : 0.5;
    ctx.fillStyle = '#ffffff';
    const ch = (px: number, py: number, rot: number) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(-7, 5);
      ctx.lineTo(0, -5);
      ctx.lineTo(7, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    ch(c.x, c.y - JOY_RADIUS + 16, 0);
    ch(c.x, c.y + JOY_RADIUS - 16, Math.PI);
    ch(c.x - JOY_RADIUS + 16, c.y, -Math.PI / 2);
    ch(c.x + JOY_RADIUS - 16, c.y, Math.PI / 2);

    // Nub
    let nx = c.x, ny = c.y;
    if (held) {
      const len = Math.hypot(this._joyDX, this._joyDY) || 1;
      const clamped = Math.min(len, JOY_RADIUS - 10);
      nx = c.x + (this._joyDX / len) * clamped;
      ny = c.y + (this._joyDY / len) * clamped;
    }
    ctx.globalAlpha = held ? 0.8 : 0.4;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(nx, ny, JOY_NUB, 0, Math.PI * 2);
    ctx.fill();

    // Action buttons
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
        text: b.label, x: p.x, y: p.y - 6, color: '#ffffff',
        fontSize: 13, fontWeight: 'bold', align: 'center',
      });
    }

    // Skill arc — hotkey slot icons in round frames
    for (const s of this._skillSlots) {
      const p = s.pos();
      const slot = UIHotkeyBar.slots?.[s.slotIndex];
      const filled = slot && slot.type !== 'none' && slot.actionId != null;
      const pressed = s.touchId !== null;

      ctx.globalAlpha = pressed ? 0.65 : 0.3;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.radius, 0, Math.PI * 2);
      ctx.fill();

      if (filled && slot!.icon) {
        ctx.save();
        ctx.globalAlpha = pressed ? 1 : 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.radius - 2, 0, Math.PI * 2);
        ctx.clip();
        const size = (s.radius - 2) * 2;
        ctx.drawImage(slot!.icon, p.x - size / 2, p.y - size / 2, size, size);
        ctx.restore();
      } else {
        ctx.globalAlpha = 0.4;
        canvas.drawText({
          text: '+', x: p.x, y: p.y - 8, color: '#ffffff',
          fontSize: 16, align: 'center',
        });
      }

      ctx.globalAlpha = pressed ? 0.95 : 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  },
};

export default TouchControls;
