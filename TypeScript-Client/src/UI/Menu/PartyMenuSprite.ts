import WZManager from '../../wz-utils/WZManager';
import DragableMenu from './DragableMenu';
import ClickManager from '../ClickManager';
import GameCanvas from '../../GameCanvas';
import config from '../../Config';
import { CameraInterface } from '../../Camera';
import PartyManager, { PartyMember } from '../../Party/PartyManager';
import { getJobNameById } from '../../Constants/Jobs';
import { drawSelectionBar } from '../UISelectionBar';

/**
 * Party window — v83 UIWindow.img/UserList (P key). Only the Party tab is
 * live; Buddy/Guild/Alliance/Blacklist tabs render disabled until those
 * systems exist. The list has two sections, exactly the art the WZ ships:
 * party0 "PARTY MEMBER ONLINE" and party4 "PARTY MEMBER OFFLINE" — a member
 * whose connection dropped sits under OFFLINE for the server's grace period.
 *
 * The bottom band carries the party controls, all from UserList/Party:
 *   row 1 (46x17): CREATE · INVITE · KICK · WITHDRAW · TALK · WHISPER
 *   row 2 (47x18): CHANGE BOSS · HP MARK · SEARCH
 * INVITE arms click-to-invite: the next click on a nearby player sends the
 * invite (the Character Info window's REQ PARTY button does the same thing
 * by name). TALK opens the chat box pre-filled with the "/p " party prefix.
 * HP MARK toggles the floating party HP panel: the translucent PartyHP
 * 9-patch with a GaugeBar row per member on this map. WHISPER / SEARCH hand
 * the selected name to the buddy system when that module is present.
 * Incoming invites pop the Basic.img YesNo dialog, drawn and click-handled
 * here even while the window itself is closed.
 */

const W = 312;
const H = 389;

const ROW_X = 16;
const HEADER_Y = 94; // party0 "PARTY MEMBER ONLINE"
const COLS_Y = 121; // party5 NAME | JOB | LV
const ROWS_Y = 139; // member rows, 18px each
const ROW_H = 18;
const MAX_ROWS = 6;
const OFFLINE_HEADER_H = 27; // party4, same plate as party0
const OFFLINE_GAP = 2;

const BOTTOM_ROW1_Y = H - 43;
const BOTTOM_ROW2_Y = H - 23;

// Floating party HP panel (HP MARK). PartyHP's side pieces are 144 wide, so
// the panel has one fixed width: nw(5) + ne(144). Rows carry the name on the
// left and the 69x13 GaugeBar on the right.
const HP_PANEL_X = 10;
const HP_PANEL_Y = 280;
const HP_PANEL_W = 5 + 144;
const HP_PANEL_EDGE = 7;
const HP_ROW_H = 17;
const HP_NAME_X = 8;
const HP_GAUGE_X = 72;
const HP_BAR_W = 63; // GaugeBar/bar — the fill runs its full width

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
  latched?: boolean;
}

interface RowPlace {
  member: PartyMember | null;
  y: number;
  online: boolean;
}

class PartyMenuSprite extends DragableMenu {
  opts: any;
  GameCanvas: GameCanvas | null = null;

  private bg: HTMLImageElement | null = null;
  private tabImgs: { enabled: (HTMLImageElement | null)[]; disabled: (HTMLImageElement | null)[] } =
    { enabled: [], disabled: [] };
  private partyPieces: Record<string, HTMLImageElement | null> = {};
  private hpFrame: Record<string, HTMLImageElement | null> = {};
  private gaugePieces: Record<string, HTMLImageElement | null> = {};
  private buttons: Record<string, BtnSprites> = {};
  private btClose: HTMLImageElement | null = null;
  private yesNoBg: HTMLImageElement | null = null;
  private btYes: BtnSprites | null = null;
  private btNo: BtnSprites | null = null;

  selectedCharId: number | null = null;

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
      for (const n of ['BtCreate', 'BtInvite', 'BtKick', 'BtWithdraw', 'BtChangeBoss', 'BtWhisper', 'BtChat', 'BtSearch', 'BtHP']) {
        this.buttons[n] = this.btnOf(party?.[n]);
      }
      const hp = party?.PartyHP;
      for (const n of ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e', 'c']) {
        this.hpFrame[n] = hp?.[n]?.nGetImage?.() ?? null;
      }
      for (const n of ['graduation', 'bar', 'gauge']) {
        this.gaugePieces[n] = hp?.GaugeBar?.[n]?.nGetImage?.() ?? null;
      }
      const basic: any = await WZManager.get('UI.wz/Basic.img');
      this.btClose = basic?.BtClose?.normal?.['0']?.nGetImage?.() ?? null;
      this.yesNoBg = basic?.YesNo?.backgrnd?.nGetImage?.() ?? null;
      this.btYes = this.btnOf(basic?.BtYes);
      this.btNo = this.btnOf(basic?.BtNo);
    } catch (e) {
      console.error('[PartyMenu] Failed to load UserList assets:', e);
    }

    PartyManager.installSocketHandlers();
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

  update(msPerTick: number, _camera?: any, _canvas?: GameCanvas) {
    // The window is the party system's only per-frame hook: the sync /
    // HP feed tick runs from here whether or not the window is open
    PartyManager.installSocketHandlers();
    PartyManager.update(msPerTick);
  }

  private myId(): string {
    return (window as any).__mySocket?.playerId ?? '';
  }

  private selectedMember(): PartyMember | null {
    if (this.selectedCharId === null) return null;
    return PartyManager.getMembers().find((m) => m.charId === this.selectedCharId) ?? null;
  }

  /**
   * Rows for both sections. Six rows in all, like the art: with no offline
   * member the ONLINE list has all six; otherwise the OFFLINE plate takes
   * its rows from the bottom of the online list.
   */
  private rowLayout(): { rows: RowPlace[]; offlineHeaderY: number | null } {
    const online = PartyManager.getOnlineMembers();
    const offline = PartyManager.getOfflineMembers();
    const rows: RowPlace[] = [];
    const offlineRows = Math.min(offline.length, MAX_ROWS - 1);
    const onlineRows = MAX_ROWS - offlineRows;
    let y = this.y + ROWS_Y;
    for (let i = 0; i < onlineRows; i++) {
      rows.push({ member: online[i] ?? null, y, online: true });
      y += ROW_H;
    }
    let offlineHeaderY: number | null = null;
    if (offlineRows > 0) {
      offlineHeaderY = y + OFFLINE_GAP;
      y = offlineHeaderY + OFFLINE_HEADER_H;
      for (let i = 0; i < offlineRows; i++) {
        rows.push({ member: offline[i] ?? null, y, online: false });
        y += ROW_H;
      }
    }
    return { rows, offlineHeaderY };
  }

  /** The buttons for the current party state (party window bottom band) */
  private buttonPlaces(): BtnPlace[] {
    const inParty = PartyManager.isInParty();
    const leader = PartyManager.isLeader();
    const sel = this.selectedMember();
    const selOther = !!sel && sel.id !== this.myId();
    const selOnline = selOther && sel!.online;
    const buddy = PartyManager.hasBuddyFeature();
    return [
      { key: 'BtCreate', x: 11, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: !inParty },
      { key: 'BtInvite', x: 60, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: inParty && leader, latched: PartyManager.inviteMode },
      { key: 'BtKick', x: 109, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: inParty && leader && selOther },
      { key: 'BtWithdraw', x: 158, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: inParty },
      { key: 'BtChat', x: 207, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: inParty },
      { key: 'BtWhisper', x: 256, y: BOTTOM_ROW1_Y, w: 46, h: 17, enabled: inParty && selOnline && buddy },
      { key: 'BtChangeBoss', x: 11, y: BOTTOM_ROW2_Y, w: 47, h: 18, enabled: inParty && leader && selOnline },
      { key: 'BtHP', x: 60, y: BOTTOM_ROW2_Y, w: 47, h: 18, enabled: inParty, latched: PartyManager.showHpBars },
      { key: 'BtSearch', x: 109, y: BOTTOM_ROW2_Y, w: 47, h: 18, enabled: selOther && buddy },
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

    // Member row selection (either section)
    for (const row of this.rowLayout().rows) {
      if (!row.member) continue;
      if (
        mouseX >= this.x + ROW_X && mouseX <= this.x + ROW_X + 279 &&
        mouseY >= row.y && mouseY <= row.y + ROW_H
      ) {
        this.selectedCharId = row.member.charId;
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
    const sel = this.selectedMember();
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
        if (sel) PartyManager.expel(sel.charId);
        this.selectedCharId = null;
        break;
      case 'BtWithdraw':
        PartyManager.leave();
        this.selectedCharId = null;
        break;
      case 'BtChangeBoss':
        if (sel) PartyManager.changeLeader(sel.charId);
        break;
      case 'BtChat':
        this.openPartyChat();
        break;
      case 'BtWhisper':
        if (sel) void PartyManager.whisperTo(sel.name);
        break;
      case 'BtSearch':
        if (sel) void PartyManager.findPlayer(sel.name);
        break;
      case 'BtHP':
        PartyManager.toggleHpBars();
        break;
    }
  }

  /** TALK: open the chat box with the party prefix already typed */
  private openPartyChat() {
    Promise.all([import('../UIMap'), import('../UIChatLog')])
      .then(([{ default: UIMap }, { default: UIChatLog }]) => {
        const chat: any = UIMap.chat;
        if (!chat?.input) return;
        if (!UIChatLog.expanded) UIChatLog.typing = true;
        chat.input.style.display = '';
        chat.input.value = '/p ';
        chat.input.focus();
        try { chat.input.setSelectionRange(3, 3); } catch { /* not a text input */ }
      })
      .catch(() => {});
  }

  draw(canvas: GameCanvas, _camera: CameraInterface, _lag: number, _ms: number, _t: number) {
    if (!this.isHidden) this.drawWindow(canvas);
    this.drawHpPanel(canvas);
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

    // Member rows — ONLINE section, then the OFFLINE plate and its rows
    const leaderCharId = PartyManager.party?.leaderCharId;
    const rowBg = this.partyPieces['party1'];
    const star = this.partyPieces['icon0'];
    const { rows, offlineHeaderY } = this.rowLayout();
    const p4 = this.partyPieces['party4'];
    if (offlineHeaderY !== null && p4?.width) {
      canvas.drawImage({ img: p4, dx: this.x + 15, dy: offlineHeaderY });
    }
    for (const row of rows) {
      const ry = row.y;
      if (rowBg?.width) canvas.drawImage({ img: rowBg, dx: this.x + ROW_X, dy: ry });
      const m = row.member;
      if (!m) continue;

      if (m.charId === this.selectedCharId) {
        drawSelectionBar(canvas.context, this.x + ROW_X + 1, ry + 1, 277, ROW_H - 2);
      }

      if (m.charId === leaderCharId && star?.width) {
        canvas.drawImage({ img: star, dx: this.x + ROW_X + 3, dy: ry + 2 });
      }
      const color = row.online ? '#000000' : '#808080';
      canvas.drawText({
        text: m.name, x: this.x + ROW_X + 20, y: ry + 4, color, fontSize: 11,
      });
      canvas.drawText({
        text: getJobNameById(m.job) || '-', x: this.x + ROW_X + 150, y: ry + 4, color, fontSize: 11,
      });
      canvas.drawText({
        text: String(m.level || '-'), x: this.x + ROW_X + 245, y: ry + 4, color, fontSize: 11,
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
      // Toggles (INVITE mode, HP MARK) keep their button lit as a latch
      const img = !def.enabled
        ? sprites.disabled ?? sprites.normal
        : def.latched
          ? sprites.pressed ?? sprites.normal
          : hover
            ? sprites.mouseOver ?? sprites.normal
            : sprites.normal;
      if (img?.width) canvas.drawImage({ img, dx: bx, dy: by });
    }
  }

  /**
   * HP MARK panel — PartyHP 9-patch with one GaugeBar row per online member
   * on this map (self included, read live). Drawn whether or not the party
   * window is open; it is a map overlay, not part of the window.
   */
  private drawHpPanel(canvas: GameCanvas) {
    if (!PartyManager.showHpBars || !PartyManager.isInParty()) return;
    const mapId = Number((window as any).charecter?.map?.mapId ?? NaN);
    const members = PartyManager.getMembersOnMap(mapId);
    if (members.length === 0) return;
    const graduation = this.gaugePieces['graduation'];
    const bar = this.gaugePieces['bar'];
    const gauge = this.gaugePieces['gauge'];
    if (!graduation?.width || !bar?.width || !gauge?.width) return;

    const px = HP_PANEL_X;
    const py = HP_PANEL_Y;
    const innerH = members.length * HP_ROW_H + 2;
    this.drawHpFrame(canvas, px, py, innerH);

    const me = (window as any).charecter;
    const myId = this.myId();
    let ry = py + HP_PANEL_EDGE + 1;
    for (const m of members) {
      let hp = m.hp;
      let maxHp = m.maxHp;
      if (m.id === myId && me) {
        hp = Number(me.hp) || 0;
        maxHp = Number(me.maxHp) || 1;
      }
      const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
      canvas.drawText({ text: m.name, x: px + HP_NAME_X, y: ry + 2, color: '#000000', fontSize: 11 });
      const gx = px + HP_GAUGE_X;
      canvas.drawImage({ img: graduation, dx: gx, dy: ry });
      // bar's origin is (-3,-3): it sits 3px inside the graduation frame
      canvas.drawImage({ img: bar, dx: gx + 3, dy: ry + 3 });
      const fillW = Math.round(HP_BAR_W * ratio);
      if (fillW > 0) {
        canvas.drawImage({ img: gauge, dx: gx + 3, dy: ry + 3, dw: fillW, dh: gauge.height });
      }
      ry += HP_ROW_H;
    }
  }

  /** The PartyHP 9-patch at its one width, stretched to `innerH` rows */
  private drawHpFrame(canvas: GameCanvas, x: number, y: number, innerH: number) {
    const f = this.hpFrame;
    const e = HP_PANEL_EDGE;
    const right = x + 5;
    if (f.nw?.width) canvas.drawImage({ img: f.nw, dx: x, dy: y });
    if (f.ne?.width) canvas.drawImage({ img: f.ne, dx: right, dy: y });
    if (innerH > 0) {
      if (f.w?.width) canvas.drawImage({ img: f.w, dx: x, dy: y + e, dw: 5, dh: innerH });
      if (f.e?.width) canvas.drawImage({ img: f.e, dx: right, dy: y + e, dw: 144, dh: innerH });
    }
    if (f.sw?.width) canvas.drawImage({ img: f.sw, dx: x, dy: y + e + innerH });
    if (f.se?.width) canvas.drawImage({ img: f.se, dx: right, dy: y + e + innerH });
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
