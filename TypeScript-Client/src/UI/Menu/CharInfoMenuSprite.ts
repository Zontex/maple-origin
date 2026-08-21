import WZManager from '../../wz-utils/WZManager';
import DragableMenu from './DragableMenu';
import ClickManager from '../ClickManager';
import GameCanvas from '../../GameCanvas';
import { CameraInterface } from '../../Camera';
import { ensureItemNames, getItemNameSync } from '../../Quest/QuestData';
import UIFameDialog from '../UIFameDialog';
import UIChatLog from '../UIChatLog';
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
  { key: 'BtTrade', x: 153, y: 39, w: 59, h: 17 },
  { key: 'BtItem', x: 212, y: 20, w: 60, h: 18, disabled: true },
  { key: 'BtWish', x: 212, y: 39, w: 60, h: 18, disabled: true },
];

// The FAME row: v83 has no fame button — clicking the row itself on another
// player's window opens the raise/drop prompt. The pink plate is baked into
// backgrnd at x 106..151, y 113..126 (measured off the art); the hit box runs
// across the value too.
const FAME_ROW = { x: 106, y: 112, w: W - 10 - 106, h: 16 };

// v83 GiveFameResponse texts, keyed by the server's fame_result error
const FAME_ERRORS: Record<string, string> = {
  not_found: 'Unable to find the character.',
  level: "You can't fame at your level (Lv. 15+)",
  today: 'You have already given fame today.',
  month: 'You have already famed that character this month.',
  self: "You can't raise or drop your own fame.",
  error: 'The fame has not been raised or dropped due to an unexpected error.',
};

class CharInfoMenuSprite extends DragableMenu {
  opts: any;
  GameCanvas: GameCanvas | null = null;
  target: any = null; // MapleCharacter being inspected

  private bgFull: HTMLImageElement | null = null;
  private bgMin: HTMLImageElement | null = null;
  private btClose: HTMLImageElement | null = null;
  private buttons: Record<string, BtnSprites> = {};
  expanded = true;
  fameDialog: UIFameDialog | null = null;
  private static fameHooked = false;

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

    if (this.GameCanvas) {
      try {
        this.fameDialog = await UIFameDialog.fromOpts({ canvas: this.GameCanvas });
      } catch (e) {
        console.error('[CharInfo] Failed to load fame dialog:', e);
      }
    }
    this.hookFameMessages();
  }

  // ---- fame ------------------------------------------------------------
  /**
   * Socket subscriptions for the fame flow. Module-wide (one socket), so they
   * are installed once and look the live window up through MapStateInstance.
   */
  private hookFameMessages() {
    const sock = (window as any).__mySocket;
    if (!sock?.on || CharInfoMenuSprite.fameHooked) return;
    CharInfoMenuSprite.fameHooked = true;

    const remoteChar = (id: string) => sock.otherPlayers?.get?.(id);
    const liveDialog = (): UIFameDialog | null =>
      (window as any).MapStateInstance?.charInfoMenu?.fameDialog ?? null;

    // Giver's answer
    sock.on('fame_result', (msg: any) => {
      const d = msg?.data ?? {};
      if (d.ok) {
        const ch = remoteChar(String(d.targetId));
        if (ch) ch.fame = Number(d.fame) || 0;
        UIChatLog.system(
          `You have ${d.mode === 1 ? 'raised' : 'dropped'} ${d.targetName}'s level of fame.`,
        );
      } else {
        const text = FAME_ERRORS[d.error] ?? FAME_ERRORS.error;
        const dlg = liveDialog();
        if (dlg) dlg.showMessage(text); else UIChatLog.system(text);
      }
    });

    // Target's side: take the server's value so the next client save (which
    // still carries fame) writes the same number back
    sock.on('fame_changed', (msg: any) => {
      const d = msg?.data ?? {};
      const me = (window as any).charecter;
      if (me) me.fame = Number(d.fame) || 0;
      UIChatLog.system(`You have ${d.mode === 1 ? 'gained' : 'lost'} fame from ${d.fromName}.`);
    });

    // Reply to the fame_query sent when the window opens on another player
    sock.on('fame_info', (msg: any) => {
      const d = msg?.data ?? {};
      const ch = remoteChar(String(d.targetId));
      if (ch) ch.fame = Number(d.fame) || 0;
    });
  }

  /** Another player's character — a remote MapleCharacter with a socket id */
  private isRemoteTarget(): boolean {
    const t = this.target;
    return !!t && t !== (window as any).charecter && !!t.id;
  }

  isFameDialogOpen(): boolean {
    return !!this.fameDialog && !this.fameDialog.isHidden;
  }

  private openFameDialog() {
    if (!this.fameDialog || !this.isRemoteTarget()) return;
    const target = this.target;
    this.fameDialog.show(String(target.name ?? ''), (raise: boolean) => {
      (window as any).__mySocket?.sendMessage?.({
        type: 'fame_give',
        data: { targetId: String(target.id), mode: raise ? 1 : 0 },
      });
    });
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
    // player_info never carried fame — ask the server for the real number
    if (this.isRemoteTarget()) {
      this.hookFameMessages();
      (window as any).__mySocket?.sendMessage?.({
        type: 'fame_query',
        data: { targetId: String(target.id) },
      });
    }
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
    // The fame prompt sits over the window — its clicks are its own
    if (this.fameDialog?.containsPoint(mouseX, mouseY)) return true;
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
        if (def.key === 'BtTrade') {
          // REQ TRADE: ask the inspected player to open a trade window
          void import('../../Trade/TradeManager').then(({ default: TradeManager }) => {
            TradeManager.request(String(this.target.id));
          });
          return true;
        }
        if (def.key.startsWith('BtBook') || def.key.startsWith('BtCollection')) {
          this.expanded = !this.expanded;
        }
        return true;
      }
    }

    // FAME row on another player's window: raise/drop prompt
    if (
      this.isRemoteTarget() &&
      mouseX >= this.x + FAME_ROW.x && mouseX < this.x + FAME_ROW.x + FAME_ROW.w &&
      mouseY >= this.y + FAME_ROW.y && mouseY < this.y + FAME_ROW.y + FAME_ROW.h
    ) {
      this.openFameDialog();
      return true;
    }

    return false; // anywhere else on the window: let the drag begin
  }

  /** REQ PARTY only works on other players (a remote character with an id) */
  private isDisabled(def: BtnDef): boolean {
    if (def.key === 'BtParty' || def.key === 'BtTrade') {
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

  update(msPerTick: number, _camera?: any, _canvas?: GameCanvas) {
    // Static window — only the fame prompt (if up) reads input per frame
    this.fameDialog?.update(msPerTick);
  }

  draw(canvas: GameCanvas, camera: CameraInterface, lag: number, ms: number, tdelta: number) {
    // The prompt outlives the window it was opened from (closing the window
    // doesn't cancel a pending question), so it draws regardless
    this.fameDialog?.draw(canvas, camera, lag, ms, tdelta);
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
