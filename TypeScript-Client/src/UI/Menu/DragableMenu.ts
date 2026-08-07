import { CameraInterface } from "../../Camera";
import { Position } from "../../Effects/DamageIndicator";

class DragableMenu {
  x: number;
  y: number;
  isHidden: boolean;

  constructor(opts: any) {
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.isHidden = opts.isHidden || 0;
  }

  moveTo(position: Position) {
    this.x = position.x;
    this.y = position.y;
  }

  getRect(camera: CameraInterface) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
  }

  /**
   * The open menus in draw order, back to front. MapState owns the order and
   * registers it here.
   */
  static stack: DragableMenu[] = [];

  static setStack(menus: DragableMenu[]) {
    DragableMenu.stack = menus;
  }

  /**
   * Raise the front-most open menu under the point to the top of the stack.
   *
   * Without this the order is whatever MapState happened to list, so the
   * skill window always sat above the inventory no matter which one you were
   * using — you could never drag an item out of an inventory that overlapped
   * it. Reordered in place, because the stack IS MapState's UIMenus array and
   * the draw pass walks the same one, so raising a window also draws it on
   * top. Returns the menu that was raised, if any.
   */
  static raiseAt(x: number, y: number): DragableMenu | null {
    const stack = DragableMenu.stack;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!DragableMenu.hits(stack[i], x, y)) continue;
      const [menu] = stack.splice(i, 1);
      stack.push(menu);
      return menu;
    }
    return null;
  }

  /**
   * Whether any open menu covers the point. For windows that are not menus
   * themselves — the key config window draws beneath all of them, so a press
   * landing on a menu must not also reach a key underneath it.
   */
  static anyHits(x: number, y: number): boolean {
    return DragableMenu.stack.some((m) => DragableMenu.hits(m, x, y));
  }

  private static hits(menu: DragableMenu, x: number, y: number): boolean {
    if (!menu || menu.isHidden) return false;
    const r = menu.getRect({} as CameraInterface);
    if (!r || r.width <= 0 || r.height <= 0) return false;
    return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
  }

  /**
   * Whether this menu is the front-most open one under the point.
   *
   * Every menu reads the mouse independently, so overlapping windows all
   * reacted to the same click — dragging an item out of the inventory also
   * started a skill drag from the skill window sitting underneath it, and
   * because the skill window is drawn last it won, so the thing being carried
   * was a skill and dropping it on a key did nothing. A click belongs to
   * exactly one window: the one you can actually see at that point.
   */
  ownsPoint(x: number, y: number): boolean {
    if (!DragableMenu.hits(this, x, y)) return false;
    const stack = DragableMenu.stack;
    // Topmost menu that covers the point wins, full stop. The previous
    // version looked up its own index first and claimed ownership when that
    // came back -1 — so if the stack ever held instances other than the live
    // ones (it is rebuilt per map load), EVERY window fell through to "yes"
    // and they all dragged at once, which is the overlap bug over again.
    for (let i = stack.length - 1; i >= 0; i--) {
      if (DragableMenu.hits(stack[i], x, y)) return stack[i] === this;
    }
    // Nothing registered covers the point, so there is no one to defer to.
    return true;
  }
}

export default DragableMenu;
