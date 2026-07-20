/**
 * Global drag-and-drop manager for skills and items.
 *
 * Drag sources (SkillMenu, Inventory) call startDrag().
 * Drop targets (HotkeyBar) call checkDrop() on mouseUp.
 * The ghost icon is rendered by render() called at end of frame.
 */

import GameCanvas from '../GameCanvas';

export type DragType = 'skill' | 'item';

interface DragState {
  active: boolean;
  type: DragType;
  id: number;           // skillId or itemId
  icon: HTMLImageElement | null;
  startX: number;
  startY: number;
}

const DRAG_THRESHOLD = 4; // pixels before drag activates

const DragManager = {
  _state: {
    active: false,
    type: 'skill' as DragType,
    id: 0,
    icon: null as HTMLImageElement | null,
    startX: 0,
    startY: 0,
  } as DragState,

  // Pending drag — set on mousedown, promoted to active drag once threshold met
  _pending: null as {
    type: DragType;
    id: number;
    icon: HTMLImageElement | null;
    startX: number;
    startY: number;
  } | null,

  get isDragging(): boolean {
    return this._state.active;
  },

  get dragType(): DragType {
    return this._state.type;
  },

  get dragId(): number {
    return this._state.id;
  },

  get dragIcon(): HTMLImageElement | null {
    return this._state.icon;
  },

  /**
   * Begin a pending drag. Called on mousedown over a draggable element.
   * The drag becomes active only after the mouse moves past the threshold.
   */
  beginPending(type: DragType, id: number, icon: HTMLImageElement | null, mouseX: number, mouseY: number) {
    this._pending = { type, id, icon, startX: mouseX, startY: mouseY };
  },

  /**
   * Update every frame — promotes pending to active if threshold met, ends drag on mouseup.
   * Returns a drop result if a drag just ended, otherwise null.
   */
  update(canvas: GameCanvas): { type: DragType; id: number; icon: HTMLImageElement | null; mouseX: number; mouseY: number } | null {
    const mx = canvas.mouseX;
    const my = canvas.mouseY;

    // Promote pending drag to active if mouse moved enough
    if (this._pending && canvas.clicked) {
      const dx = mx - this._pending.startX;
      const dy = my - this._pending.startY;
      if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
        this._state = {
          active: true,
          type: this._pending.type,
          id: this._pending.id,
          icon: this._pending.icon,
          startX: this._pending.startX,
          startY: this._pending.startY,
        };
        this._pending = null;
      }
    }

    // Cancel pending if mouse released before threshold
    if (this._pending && !canvas.clicked) {
      this._pending = null;
    }

    // End active drag on mouse release
    if (this._state.active && canvas.wasMouseUp) {
      const result = {
        type: this._state.type,
        id: this._state.id,
        icon: this._state.icon,
        mouseX: mx,
        mouseY: my,
      };
      this._state.active = false;
      this._state.id = 0;
      this._state.icon = null;
      return result;
    }

    return null;
  },

  /**
   * Cancel current drag without dropping.
   */
  cancel() {
    this._state.active = false;
    this._state.id = 0;
    this._state.icon = null;
    this._pending = null;
  },

  /**
   * Render the ghost icon following the cursor.
   * Call this LAST in the render pipeline so it draws on top of everything.
   */
  render(canvas: GameCanvas) {
    if (!this._state.active || !this._state.icon) return;

    const icon = this._state.icon;
    if (!icon.complete || icon.width === 0) return;

    const mx = canvas.mouseX;
    const my = canvas.mouseY;
    const ctx = canvas.context;

    ctx.save();
    ctx.globalAlpha = 0.55;
    // Draw icon centered on cursor
    ctx.drawImage(icon, mx - 16, my - 16, 32, 32);
    ctx.restore();
  },
};

export default DragManager;
