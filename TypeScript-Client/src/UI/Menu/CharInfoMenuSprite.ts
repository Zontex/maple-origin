import WZManager from '../../wz-utils/WZManager';
import DragableMenu from './DragableMenu';
import ClickManager from '../ClickManager';
import GameCanvas from '../../GameCanvas';
import { CameraInterface } from '../../Camera';
import { ensureItemNames, getItemNameSync } from '../../Quest/QuestData';
import {
  ensureMobNames,
  ensureMonsterBookData,
  getCard,
  getCardIcon,
  getMobName,
} from '../../MonsterBook/MonsterBookData';

/**
 * Character Info window — v83 UIWindow.img/UserInfo, opened by double-clicking
 * a character (own or another player's).
 *
 * Layout is the WZ's own backgrnd7 (275x404): avatar + name plate, the
 * LEVEL/JOB/FAME/GUILD/ALLIANCE rows, FAMILY / REQ PARTY / REQ TRADE / ITEM /
 * WISHLIST buttons in the top band, the Monster Book section (LEVEL, BOOK
 * COVER, TOTAL / REG CARD / SPC CARD) and the medal COLLECTION section
 * (EQUIPPED, TOTAL MEDALS, OBTAINED MEDALS). The bottom band carries the
 * section toggles; BOOK INFO / COLLECTION collapse to the short backgrnd
 * (275x199). TAMING MOB and PET INFO sections need systems that don't exist
 * yet and render disabled.
 */

const W = 275;
const H_FULL = 404;
const H_MIN = 199;

interface BtnSprites {
  normal: HTMLImageElement | null;
  mouseOver: HTMLImageElement | null;
  disabled: HTMLImageElement | null;
}

interface BtnDef {
  key: string;
  x: number;
  y: number; // negative = anchored from the window bottom
  w: number;
  h: number;
  disabled?: boolean;
}

// Top band (positions from the GMS window: FAMILY left, two stacked pairs).
// REQ PARTY resolves its disabled state at draw/click time — it works on
// other players once a party system exists.
const TOP_BUTTONS: BtnDef[] = [
  { key: 'BtFamily', x: 110, y: 20, w: 40, h: 37, disabled: true },
  { key: 'BtParty', x: 153, y: 21, w: 59, h: 17 },
  { key: 'BtTrade', x: 153, y: 39, w: 59, h: 17, disabled: true },
  { key: 'BtItem', x: 212, y: 20, w: 60, h: 18, disabled: true },
  { key: 'BtWish', x: 212, y: 39, w: 60, h: 18, disabled: true },
];

class CharInfoMenuSprite extends DragableMenu {
  opts: any;
  GameCanvas: GameCanvas | null = null;
  target: any = null; // MapleCharacter being inspected

  private bgFull: HTMLImageElement | null = null;
  private bgMin: HTMLImageElement | null = null;
  private btClose: HTMLImageElement | null = null;
  private buttons: Record<string, BtnSprites> = {};
  expanded = true;

  static async fromOpts(opts: any) {
    const obj = new CharInfoMenuSprite(opts);
    await obj.load();
    return obj;
  }

  constructor(opts: any) {
    super(opts);
    this.opts = opts;
  }

  async load() {
    this.x = this.opts.x;
    this.y = this.opts.y;
    this.isHidden = this.opts.isHidden ?? true;
    this.GameCanvas = this.opts.canvas ?? null;

    try {
      const node: any = await WZManager.get('UI.wz/UIWindow.img/UserInfo');
      this.bgFull = node.backgrnd7?.nGetImage?.() ?? null;
      this.bgMin = node.backgrnd?.nGetImage?.() ?? null;
      const names = [
        'BtFamily', 'BtParty', 'BtTrade', 'BtItem', 'BtWish',
        'BtTamingShow', 'BtPetShow',
        'BtBookShow', 'BtBookHide', 'BtCollectionShow', 'BtCollectionHide',
      ];
      for (const n of names) {
        const b = node[n];
        this.buttons[n] = {
          normal: b?.normal?.['0']?.nGetImage?.() ?? null,
          mouseOver: b?.mouseOver?.['0']?.nGetImage?.() ?? null,
          disabled: b?.disabled?.['0']?.nGetImage?.() ?? null,
        };
      }
      const basic: any = await WZManager.get('UI.wz/Basic.img');
      this.btClose = basic?.BtClose?.normal?.['0']?.nGetImage?.() ?? null;
    } catch (e) {
      console.error('[CharInfo] Failed to load UserInfo assets:', e);
    }

    ensureItemNames().catch(() => {});
    // The Monster Book section names the cover card's monster
    ensureMonsterBookData().catch(() => {});
    ensureMobNames().catch(() => {});
    ClickManager.addDragableMenu(this);
  }

  getRect(_camera: CameraInterface) {
    return {
      x: this.x,
      y: this.y,
      width: W,
      height: this.expanded ? H_FULL : H_MIN,
    };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
  }

  /** Open on a character (called from the map's double-click handler) */
  show(target: any) {
    this.target = target;
    this.isHidden = false;
  }

  private get height(): number {
    return this.expanded ? H_FULL : H_MIN;
  }

  /** Bottom toggle row, dependent on the expanded state */
  private bottomButtons(): BtnDef[] {
    const y = -(21);
    return [
      { key: 'BtTamingShow', x: 8, y, w: 85, h: 17, disabled: true },
      { key: 'BtPetShow', x: 96, y, w: 49, h: 17, disabled: true },
      { key: this.expanded ? 'BtBookHide' : 'BtBookShow', x: 148, y, w: 48, h: 17 },
      { key: this.expanded ? 'BtCollectionHide' : 'BtCollectionShow', x: 199, y, w: 49, h: 17 },
    ];
  }

  private btnScreenY(def: BtnDef): number {
    return def.y >= 0 ? this.y + def.y : this.y + this.height + def.y;
  }

  onMouseDown(mouseX: number, mouseY: number): boolean {
    if (this.isHidden || !this.ownsPoint(mouseX, mouseY)) return false;

    // Close button
    if (
      mouseX >= this.x + W - 19 && mouseX <= this.x + W - 4 &&
      mouseY >= this.y + 3 && mouseY <= this.y + 18
    ) {
      this.isHidden = true;
      return true;
    }

    for (const def of [...TOP_BUTTONS, ...this.bottomButtons()]) {
      const bx = this.x + def.x;
      const by = this.btnScreenY(def);
      if (mouseX >= bx && mouseX < bx + def.w && mouseY >= by && mouseY < by + def.h) {
        if (this.isDisabled(def)) return true;
        if (def.key === 'BtParty') {
          // Invite the inspected player (auto-creates a party if needed)
          void import('../../Party/PartyManager').then(({ default: PartyManager }) => {
            PartyManager.invite(String(this.target.id));
          });
          return true;
        }
        if (def.key.startsWith('BtBook') || def.key.startsWith('BtCollection')) {
          this.expanded = !this.expanded;
        }
        return true;
      }
    }

    return false; // anywhere else on the window: let the drag begin
  }

  /** REQ PARTY only works on other players (a remote character with an id) */
  private isDisabled(def: BtnDef): boolean {
    if (def.key === 'BtParty') {
      const t = this.target;
      return !t || t === (window as any).charecter || !t.id;
    }
    return !!def.disabled;
  }

  // ---- data helpers ----------------------------------------------------
  /**
   * Monster Book figures for whoever is being inspected. The local player has
   * the live book; a remote character carries the summary that rides their
   * roster entry, which is exactly the five values this section prints.
   */
  private bookSummary(): { level: number; cover: number; total: number; basic: number; special: number } {
    const t = this.target;
    if (t?.monsterBook) return t.monsterBook.summary();
    if (t?.monsterBookInfo) return t.monsterBookInfo;
    return { level: 1, cover: 0, total: 0, basic: 0, special: 0 };
  }

  private medalIds(): number[] {
    const ids: number[] = [];
    const t = this.target;
    if (!t) return ids;
    const equipped = Object.values(t.equippedItemIds ?? {}) as number[];
    const bag = (t.inventory?.equip ?? [])
      .filter((it: any) => it)
      .map((it: any) => it.itemId as number);
    for (const id of [...equipped, ...bag]) {
      if (Math.floor(id / 10000) === 114) ids.push(id);
    }
    return ids;
  }

  update(_msPerTick: number, _camera?: any, _canvas?: GameCanvas) {
    // Static window — nothing animates per frame
  }

  draw(canvas: GameCanvas, _camera: CameraInterface, _lag: number, _ms: number, _t: number) {
    if (this.isHidden || !this.target) return;
    const bg = this.expanded ? this.bgFull : this.bgMin;
    if (!bg?.width) return;
    canvas.drawImage({ img: bg, dx: this.x, dy: this.y });

    // Close X
    if (this.btClose?.width) {
      canvas.drawImage({ img: this.btClose, dx: this.x + W - 19, dy: this.y + 4 });
    }

    // Buttons (normal / mouseOver / disabled)
    const mx = this.GameCanvas?.mouseX ?? -1;
    const my = this.GameCanvas?.mouseY ?? -1;
    for (const def of [...TOP_BUTTONS, ...this.bottomButtons()]) {
      const sprites = this.buttons[def.key];
      if (!sprites) continue;
      const bx = this.x + def.x;
      const by = this.btnScreenY(def);
      const hover = mx >= bx && mx < bx + def.w && my >= by && my < by + def.h;
      const img = this.isDisabled(def)
        ? sprites.disabled ?? sprites.normal
        : hover
          ? sprites.mouseOver ?? sprites.normal
          : sprites.normal;
      if (img?.width) canvas.drawImage({ img, dx: bx, dy: by });
    }

    const t = this.target;

    // Avatar — feet on the baked shadow, facing left like the live sprite
    const standStance = t.weaponStandType === 2 ? 'stand2' : 'stand1';
    const frames = t.getDrawableFrames?.(standStance, 0, false);
    if (frames) {
      const feetX = this.x + 59;
      const feetY = this.y + 128;
      for (const frame of frames) {
        if (frame.img?.complete && frame.img.naturalWidth > 0) {
          canvas.drawImage({
            img: frame.img,
            dx: feetX + (frame.x || 0),
            dy: feetY + (frame.y || 0),
          });
        }
      }
    }

    // Name plate (blue strip under the avatar)
    canvas.drawText({
      text: String(t.name ?? ''),
      x: this.x + 58, y: this.y + 147,
      color: '#FFFFFF', fontSize: 11, align: 'center',
    });

    // Info rows — values right of the baked pink labels
    const stats = t.stats;
    const rows: [number, string][] = [
      [80, String(stats?.level ?? '-')],
      [98, String(stats?.job ?? 'Beginner')],
      [116, String(t.fame ?? 0)],
      [134, '-'], // guild
      [152, '-'], // alliance
    ];
    for (const [ry, text] of rows) {
      canvas.drawText({
        text, x: this.x + 160, y: this.y + ry, color: '#000000', fontSize: 11,
      });
    }

    if (!this.expanded) return;

    // Monster Book: book level, the registered cover card, and the card counts
    const book = this.bookSummary();
    canvas.drawText({
      text: String(book.level), x: this.x + 100, y: this.y + 183,
      color: '#000000', fontSize: 11,
    });

    const coverMob = book.cover ? getCard(book.cover)?.mob ?? 0 : 0;
    canvas.drawText({
      text: coverMob ? getMobName(coverMob) : '-',
      x: this.x + 100, y: this.y + 203, color: '#000000', fontSize: 11,
    });
    if (book.cover) {
      const icon = getCardIcon(book.cover);
      // The card face at half size, tucked left of its name in the row
      if (icon?.width) {
        canvas.drawImage({ img: icon, dx: this.x + 82, dy: this.y + 200, dw: 14, dh: 19 });
      }
    }

    canvas.drawText({
      text: String(book.total), x: this.x + 98, y: this.y + 221,
      color: '#000000', fontSize: 11,
    });
    canvas.drawText({
      text: String(book.basic), x: this.x + 182, y: this.y + 221,
      color: '#000000', fontSize: 11,
    });
    canvas.drawText({
      text: String(book.special), x: this.x + 252, y: this.y + 221,
      color: '#000000', fontSize: 11,
    });

    // Collection (medals)
    const medals = this.medalIds();
    const equippedMedal = (Object.entries(this.target.equippedItemIds ?? {}) as [string, number][])
      .map(([, id]) => id)
      .find((id) => Math.floor(id / 10000) === 114);
    canvas.drawText({
      text: equippedMedal ? (getItemNameSync(equippedMedal) || '-') : '-',
      x: this.x + 110, y: this.y + 250, color: '#000000', fontSize: 11,
    });
    canvas.drawText({
      text: String(medals.length),
      x: this.x + 98, y: this.y + 269, color: '#000000', fontSize: 11,
    });
    let ly = this.y + 300;
    for (const id of medals.slice(0, 7)) {
      canvas.drawText({
        text: getItemNameSync(id) || `Medal ${id}`,
        x: this.x + 52, y: ly, color: '#000000', fontSize: 11,
      });
      ly += 13;
    }
  }
}

export default CharInfoMenuSprite;
