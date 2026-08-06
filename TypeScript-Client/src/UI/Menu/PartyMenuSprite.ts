import WZManager from '../../wz-utils/WZManager';
import DragableMenu from './DragableMenu';
import ClickManager from '../ClickManager';
import GameCanvas from '../../GameCanvas';
import config from '../../Config';
import { CameraInterface } from '../../Camera';
import PartyManager from '../../Party/PartyManager';
import { getJobNameById } from '../../Constants/Jobs';

/**
 * Party window — v83 UIWindow.img/UserList (P key). Only the Party tab is
 * live; Buddy/Guild/Alliance/Blacklist tabs render disabled until those
 * systems exist. The bottom band carries the party controls:
 *   CREATE (no party) · INVITE / EXPEL / PARTY LEADER (leader) · LEAVE
 * INVITE arms click-to-invite: the next click on a nearby player sends the
 * invite (the Character Info window's REQ PARTY button does the same thing
 * by name). Incoming invites pop the Basic.img YesNo dialog, drawn and
 * click-handled here even while the window itself is closed.
 */

const W = 312;
const H = 389;

const ROW_X = 16;
const HEADER_Y = 94; // party0 "PARTY MEMBER ONLINE"
const COLS_Y = 121; // party5 NAME | JOB | LV
const ROWS_Y = 139; // member rows, 18px each
const ROW_H = 18;
const MAX_ROWS = 6;

const BOTTOM_ROW1_Y = H - 43;
const BOTTOM_ROW2_Y = H - 23;

interface BtnSprites {
  normal: HTMLImageElement | null;
  mouseOver: HTMLImageElement | null;
  disabled: HTMLImageElement | null;
  pressed: HTMLImageElement | null;
}

interface BtnPlace {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
}

class PartyMenuSprite extends DragableMenu {
  opts: any;
  GameCanvas: GameCanvas | null = null;

  private bg: HTMLImageElement | null = null;
  private tabImgs: { enabled: (HTMLImageElement | null)[]; disabled: (HTMLImageElement | null)[] } =
    { enabled: [], disabled: [] };
  private partyPieces: Record<string, HTMLImageElement | null> = {};
  private buttons: Record<string, BtnSprites> = {};
  private btClose: HTMLImageElement | null = null;
  private yesNoBg: HTMLImageElement | null = null;
  private btYes: BtnSprites | null = null;
  private btNo: BtnSprites | null = null;

  selectedMemberId: string | null = null;

  static async fromOpts(opts: any) {
    const obj = new PartyMenuSprite(opts);
    await obj.load();
    return obj;
  }

  constructor(opts: any) {
    super(opts);
    this.opts = opts;
  }

  private btnOf(node: any): BtnSprites {
    return {
      normal: node?.normal?.['0']?.nGetImage?.() ?? null,
      mouseOver: node?.mouseOver?.['0']?.nGetImage?.() ?? null,
      disabled: node?.disabled?.['0']?.nGetImage?.() ?? null,
      pressed: node?.pressed?.['0']?.nGetImage?.() ?? null,
    };
  }

  async load() {
    this.x = this.opts.x;
    this.y = this.opts.y;
    this.isHidden = this.opts.isHidden ?? true;
    this.GameCanvas = this.opts.canvas ?? null;

    try {
      const ul: any = await WZManager.get('UI.wz/UIWindow.img/UserList');
      this.bg = ul.backgrnd?.nGetImage?.() ?? null;
      for (let i = 0; i < 5; i++) {
        this.tabImgs.enabled.push(ul.Tab?.enabled?.[String(i)]?.nGetImage?.() ?? null);
        this.tabImgs.disabled.push(ul.Tab?.disabled?.[String(i)]?.nGetImage?.() ?? null);
      }
      const party = ul.Party;
      for (const n of ['party0', 'party1', 'party4', 'party5', 'icon0']) {
        this.partyPieces[n] = party?.[n]?.nGetImage?.() ?? null;
      }
      for (const n of ['BtCreate', 'BtInvite', 'BtKick', 'BtWithdraw', 'BtChangeBoss', 'BtWhisper', 'BtChat', 'BtSearch']) {
        this.buttons[n] = this.btnOf(party?.[n]);
      }
      const basic: any = await WZManager.get('UI.wz/Basic.img');
      this.btClose = basic?.BtClose?.normal?.['0']?.nGetImage?.() ?? null;
      this.yesNoBg = basic?.YesNo?.backgrnd?.nGetImage?.() ?? null;
      this.btYes = this.btnOf(basic?.BtYes);
      this.btNo = this.btnOf(basic?.BtNo);
    } catch (e) {
      console.error('[PartyMenu] Failed to load UserList assets:', e);
    }

    ClickManager.addDragableMenu(this);
  }

  getRect(_camera: CameraInterface) {
    // While an invite popup is up it owns its screen area even if the
    // window itself is closed — map clicks must not fall through it
    if (this.isHidden && PartyManager.pendingInvite) {
      return this.popupRect();
    }
    return { x: this.x, y: this.y, width: W, height: H };
  }

  private popupRect() {
    const w = this.yesNoBg?.width || 264;
    const h = this.yesNoBg?.height || 132;
    return {
      x: Math.floor((config.width - w) / 2),
      y: Math.floor((config.height - h) / 2) - 40,
      width: w,
      height: h,
    };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
    if (isHidden) PartyManager.inviteMode = false;
  }

  update(_msPerTick: number, _camera?: any, _canvas?: GameCanvas) {}

  /** The buttons for the current party state (party window bottom band) */
  private buttonPlaces(): BtnPlace[] {
    const inParty = PartyManager.isInParty();
    const leader = PartyManager.isLeader();
    const hasSelection =
      !!this.selectedMemberId &&
      this.selectedMemberId !== (window as any).__mySocket?.playerId &&
      PartyManager.getMembers().some((m) => m.id === this.selectedMemberId);
    return [
      { key: 'BtCreate', x: 14, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: !inParty },
      { key: 'BtInvite', x: 63, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: inParty && leader },
      { key: 'BtKick', x: 112, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: inParty && leader && hasSelection },
      { key: 'BtWithdraw', x: 161, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: inParty },
      { key: 'BtChangeBoss', x: 14, y: BOTTOM_ROW2_Y, w: 47, h: 18, enabled: inParty && leader && hasSelection },
      { key: 'BtWhisper', x: 64, y: BOTTOM_ROW2_Y, w: 46, h: 17, enabled: false },
      { key: 'BtChat', x: 113, y: BOTTOM_ROW2_Y, w: 46, h: 17, enabled: false },
      { key: 'BtSearch', x: 162, y: BOTTOM_ROW2_Y, w: 47, h: 18, enabled: false },
    ];
  }

  onMouseDown(mouseX: number, mouseY: number): boolean {
    // Invite popup first — it works even while the window is closed
    if (PartyManager.pendingInvite) {
      const r = this.popupRect();
      const btnY = r.y + r.height - 34;
      const yesX = r.x + Math.floor(r.width / 2) - 70;
      const noX = r.x + Math.floor(r.width / 2) + 5;
      if (mouseY >= btnY && mouseY <= btnY + 24) {
        if (mouseX >= yesX && mouseX <= yesX + 65) {
          PartyManager.respondInvite(true);
          return true;
        }
        if (mouseX >= noX && mouseX <= noX + 65) {
          PartyManager.respondInvite(false);
          return true;
        }
      }
      if (
        mouseX >= r.x && mouseX <= r.x + r.width &&
        mouseY >= r.y && mouseY <= r.y + r.height
      ) {
        return true; // swallow clicks on the popup body
      }
    }

    if (this.isHidden || !this.ownsPoint(mouseX, mouseY)) return false;

    // Close button
    if (
      mouseX >= this.x + W - 21 && mouseX <= this.x + W - 5 &&
      mouseY >= this.y + 5 && mouseY <= this.y + 20
    ) {
      this.setIsHidden(true);
      return true;
    }

    // Member row selection
    const members = PartyManager.getMembers();
    for (let i = 0; i < Math.min(members.length, MAX_ROWS); i++) {
      const ry = this.y + ROWS_Y + i * ROW_H;
      if (
        mouseX >= this.x + ROW_X && mouseX <= this.x + ROW_X + 279 &&
        mouseY >= ry && mouseY <= ry + ROW_H
      ) {
        this.selectedMemberId = members[i].id;
        return true;
      }
    }

    // Bottom-band buttons
    for (const def of this.buttonPlaces()) {
      const bx = this.x + def.x;
      const by = this.y + def.y;
      if (mouseX >= bx && mouseX < bx + def.w && mouseY >= by && mouseY < by + def.h) {
        if (!def.enabled) return true;
        this.onButton(def.key);
        return true;
      }
    }

    return false; // drag the window
  }

  private onButton(key: string) {
    switch (key) {
      case 'BtCreate':
        PartyManager.create();
        break;
      case 'BtInvite':
        PartyManager.inviteMode = !PartyManager.inviteMode;
        if (PartyManager.inviteMode) {
          PartyManager.onNotice('Click a nearby player to invite them to your party.');
        }
        break;
      case 'BtKick':
        if (this.selectedMemberId) PartyManager.expel(this.selectedMemberId);
        this.selectedMemberId = null;
        break;
      case 'BtWithdraw':
        PartyManager.leave();
        this.selectedMemberId = null;
        break;
      case 'BtChangeBoss':
        if (this.selectedMemberId) PartyManager.changeLeader(this.selectedMemberId);
        break;
    }
  }

  draw(canvas: GameCanvas, _camera: CameraInterface, _lag: number, _ms: number, _t: number) {
    if (!this.isHidden) this.drawWindow(canvas);
    this.drawInvitePopup(canvas);
  }

  private drawWindow(canvas: GameCanvas) {
    if (!this.bg?.width) return;
    canvas.drawImage({ img: this.bg, dx: this.x, dy: this.y });

    if (this.btClose?.width) {
      canvas.drawImage({ img: this.btClose, dx: this.x + W - 21, dy: this.y + 6 });
    }

    // Tab strip on the blue band, hung from the red underline (y=90); only
    // Party (index 1) is live
    let tx = this.x + 18;
    for (let i = 0; i < 5; i++) {
      const img = i === 1 ? this.tabImgs.enabled[i] : this.tabImgs.disabled[i];
      if (img?.width) {
        canvas.drawImage({ img, dx: tx, dy: this.y + 88 - img.height });
        tx += img.width + 14;
      } else {
        tx += 40;
      }
    }

    // Section header + column headers
    const p0 = this.partyPieces['party0'];
    if (p0?.width) canvas.drawImage({ img: p0, dx: this.x + 15, dy: this.y + HEADER_Y });
    const p5 = this.partyPieces['party5'];
    if (p5?.width) canvas.drawImage({ img: p5, dx: this.x + ROW_X, dy: this.y + COLS_Y });

    // Member rows
    const members = PartyManager.getMembers();
    const leaderId = PartyManager.party?.leaderId;
    const rowBg = this.partyPieces['party1'];
    const star = this.partyPieces['icon0'];
    for (let i = 0; i < MAX_ROWS; i++) {
      const ry = this.y + ROWS_Y + i * ROW_H;
      if (rowBg?.width) canvas.drawImage({ img: rowBg, dx: this.x + ROW_X, dy: ry });
      const m = members[i];
      if (!m) continue;

      if (m.id === this.selectedMemberId) {
        const ctx = canvas.context;
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#3366cc';
        ctx.fillRect(this.x + ROW_X + 1, ry + 1, 277, ROW_H - 2);
        ctx.restore();
      }

      if (m.id === leaderId && star?.width) {
        canvas.drawImage({ img: star, dx: this.x + ROW_X + 3, dy: ry + 2 });
      }
      canvas.drawText({
        text: m.name, x: this.x + ROW_X + 20, y: ry + 4, color: '#000000', fontSize: 11,
      });
      canvas.drawText({
        text: getJobNameById(m.job) || '-', x: this.x + ROW_X + 150, y: ry + 4, color: '#000000', fontSize: 11,
      });
      canvas.drawText({
        text: String(m.level || '-'), x: this.x + ROW_X + 245, y: ry + 4, color: '#000000', fontSize: 11,
      });
    }

    // Bottom-band buttons
    const mx = this.GameCanvas?.mouseX ?? -1;
    const my = this.GameCanvas?.mouseY ?? -1;
    for (const def of this.buttonPlaces()) {
      const sprites = this.buttons[def.key];
      if (!sprites) continue;
      const bx = this.x + def.x;
      const by = this.y + def.y;
      const hover = mx >= bx && mx < bx + def.w && my >= by && my < by + def.h;
      // Invite mode keeps its button lit as a latch
      const latched = def.key === 'BtInvite' && PartyManager.inviteMode;
      const img = !def.enabled
        ? sprites.disabled ?? sprites.normal
        : latched
          ? sprites.pressed ?? sprites.normal
          : hover
            ? sprites.mouseOver ?? sprites.normal
            : sprites.normal;
      if (img?.width) canvas.drawImage({ img, dx: bx, dy: by });
    }
  }

  private drawInvitePopup(canvas: GameCanvas) {
    const invite = PartyManager.pendingInvite;
    if (!invite) return;
    const r = this.popupRect();
    if (this.yesNoBg?.width) {
      canvas.drawImage({ img: this.yesNoBg, dx: r.x, dy: r.y });
    }
    canvas.drawText({
      text: `'${invite.fromName}' has invited you`,
      x: r.x + Math.floor(r.width / 2), y: r.y + 38,
      color: '#000000', fontSize: 12, align: 'center',
    });
    canvas.drawText({
      text: 'to their party.',
      x: r.x + Math.floor(r.width / 2), y: r.y + 56,
      color: '#000000', fontSize: 12, align: 'center',
    });
    const btnY = r.y + r.height - 34;
    const yesX = r.x + Math.floor(r.width / 2) - 70;
    const noX = r.x + Math.floor(r.width / 2) + 5;
    const mx = this.GameCanvas?.mouseX ?? -1;
    const my = this.GameCanvas?.mouseY ?? -1;
    const hovYes = mx >= yesX && mx <= yesX + 65 && my >= btnY && my <= btnY + 24;
    const hovNo = mx >= noX && mx <= noX + 65 && my >= btnY && my <= btnY + 24;
    const yes = hovYes ? this.btYes?.mouseOver ?? this.btYes?.normal : this.btYes?.normal;
    const no = hovNo ? this.btNo?.mouseOver ?? this.btNo?.normal : this.btNo?.normal;
    if (yes?.width) canvas.drawImage({ img: yes, dx: yesX, dy: btnY });
    if (no?.width) canvas.drawImage({ img: no, dx: noX, dy: btnY });
  }
}

export default PartyMenuSprite;
