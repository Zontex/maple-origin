import WZManager from '../../wz-utils/WZManager';
import DragableMenu from './DragableMenu';
import ClickManager from '../ClickManager';
import GameCanvas from '../../GameCanvas';
import config from '../../Config';
import MapleInput from '../MapleInput';
import { CameraInterface } from '../../Camera';
import GuildManager, { GuildMember } from '../../Guild/GuildManager';
import {
  GuildEmblemSpec,
  EMBLEM_COLOR_COUNT,
  backgroundIds,
  markPartIds,
  getEmblemImage,
  preloadEmblemParts,
} from '../../Guild/GuildEmblem';
import { getJobNameById } from '../../Constants/Jobs';
import { drawSelectionBar } from '../UISelectionBar';

/**
 * Guild window — v83 UIWindow.img/UserList with the Guild tab live (G key).
 *
 * Main window (UserList/backgrnd 312x389): emblem slot + guild name, the
 * notice field (guildinfo6, pencil Btnotice edits it in place for Master /
 * Jr. Master), then one scrolling list built from the GuildInfo row plates:
 * "GUILD MEMBER ONLINE" header, column plate, member rows, "GUILD MEMBER
 * OFFLINE" header, column plate, rows. Selecting a row arms EXPEL / TITLE
 * up-down / GUILD LEADER / PARTY INVITE. The band at the bottom carries the
 * GuildInfo buttons; BOARD, MAP, WHISPER and TALK are disabled (BBS, buddy
 * and whisper are separate systems).
 *
 * GUILD INFO. docks the 233x304 Guild/backgrnd side panel on the right with
 * the GuildGrade pieces (GUILD HIERARCHY table: rank / title / how many hold
 * it; GUILD INFORMATION: GP). For the Master, EDIT swaps the table for the
 * GuildEdit version with a text field per title and SAVE sends them.
 *
 * Popups drawn even while the window is closed: an incoming invite (Basic
 * YesNo), the INVITE name prompt (same frame + MapleInput), and the MakeMark
 * emblem designer (the 250x343 scroll, cycling GuildMark.img parts with
 * BtLeft/BtRight) that Lea opens after her 5,000,000 meso confirmation.
 *
 * The WZ carries no layout coordinates — the original client hardcodes them
 * — so the constants below were measured off the plates (281-wide rows with
 * column dividers at 120 / 190 / 240; 221-wide panel table with dividers at
 * 47 / 135; 18px rows, 27px headers).
 */

const W = 312;
const H = 389;
const PANEL_W = 233;
const PANEL_H = 304;

const ROW_X = 16;
const NAME_ROW_Y = 94;
const NOTICE_Y = 117;
const LIST_Y = 140;
const LIST_BOTTOM = 320;
const ROW_H = 18;
const HEADER_H = 27;

const BAND_ROW0_Y = 324;
const BAND_ROW1_Y = 348;
const BAND_ROW2_Y = 368;
const BAND_XS = [14, 85, 156, 227];
const BTN_W = 65;
const BTN_H = 18;

// Column text x (relative to ROW_X) — NAME | JOB | LV | TITLE plates
const COL_NAME_X = 6;
const COL_JOB_X = 124;
const COL_LV_X = 194;
const COL_TITLE_X = 244;

// Side panel
const PANEL_X0 = 6;
const PANEL_HEAD_Y = 6;
const PANEL_COLS_Y = 33;
const PANEL_TABLE_Y = 51;
const PANEL_INFO_Y = 147;
const PANEL_GP_Y = 174;
const PANEL_BTN_Y = 275;
const PANEL_RANK_X = 8;
const PANEL_TITLE_X = 52;
const PANEL_POS_X = 140;

// Emblem designer (MakeMark scroll, 250x343)
const MM_W = 250;
const MM_H = 343;
const MM_ROW_YS = [150, 185, 220, 255];
const MM_LABEL_X = 26;
const MM_LEFT_X = 108;
const MM_VALUE_X = 170;
const MM_RIGHT_X = 192;
const MM_OK_Y = 300;

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

type ListEntry =
  | { kind: 'header'; img: HTMLImageElement | null; h: number }
  | { kind: 'cols'; img: HTMLImageElement | null; h: number }
  | { kind: 'member'; member: GuildMember; h: number };

interface TextPrompt {
  title: string;
  input: MapleInput;
  onSubmit: (value: string) => void;
}

interface DesignerState {
  bgIdx: number; // -1 = none
  bgColor: number;
  markIdx: number; // -1 = none
  markColor: number;
}

class GuildMenuSprite extends DragableMenu {
  opts: any;
  GameCanvas: GameCanvas | null = null;

  private bg: HTMLImageElement | null = null;
  private panelBg: HTMLImageElement | null = null;
  private tabImgs: { enabled: (HTMLImageElement | null)[]; disabled: (HTMLImageElement | null)[] } =
    { enabled: [], disabled: [] };
  private info: Record<string, HTMLImageElement | null> = {};
  private grade: Record<string, HTMLImageElement | null> = {};
  private mark: Record<string, HTMLImageElement | null> = {};
  private buttons: Record<string, BtnSprites> = {};
  private btClose: HTMLImageElement | null = null;
  private yesNoBg: HTMLImageElement | null = null;
  private btYes: BtnSprites | null = null;
  private btNo: BtnSprites | null = null;
  private btOk: BtnSprites | null = null;
  private btCancel: BtnSprites | null = null;

  selectedCharacterId = 0;
  private scroll = 0;
  private panelOpen = false;
  private panelEdit = false;
  private titleInputs: MapleInput[] = [];
  private noticeInput: MapleInput | null = null;
  private prompt: TextPrompt | null = null;
  private designer: DesignerState | null = null;
  private lastX = 0;
  private lastY = 0;

  static async fromOpts(opts: any) {
    const obj = new GuildMenuSprite(opts);
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
    this.lastX = this.x;
    this.lastY = this.y;
    this.isHidden = this.opts.isHidden ?? true;
    this.GameCanvas = this.opts.canvas ?? null;

    try {
      const ul: any = await WZManager.get('UI.wz/UIWindow.img/UserList');
      this.bg = ul.backgrnd?.nGetImage?.() ?? null;
      for (let i = 0; i < 5; i++) {
        this.tabImgs.enabled.push(ul.Tab?.enabled?.[String(i)]?.nGetImage?.() ?? null);
        this.tabImgs.disabled.push(ul.Tab?.disabled?.[String(i)]?.nGetImage?.() ?? null);
      }
      const guild = ul.Guild;
      this.panelBg = guild?.backgrnd?.nGetImage?.() ?? null;
      const gi = guild?.GuildInfo;
      for (const n of ['guildmark', 'guildinfo0', 'guildinfo1', 'guildinfo2', 'guildinfo3', 'guildinfo6', 'guildinfo7']) {
        this.info[n] = gi?.[n]?.nGetImage?.() ?? null;
      }
      for (const b of ['Btnotice', 'BtKick', 'BtInvite', 'BtWhere', 'BtUp', 'BtDown', 'BtWhisper', 'BtWithdraw', 'BtChat', 'BtInfo', 'BtPartyInvite', 'BtBoard', 'BtChange']) {
        this.buttons[b] = this.btnOf(gi?.[b]);
      }
      const gg = guild?.GuildGrade;
      for (const n of ['guildgrade0', 'guildgrade1', 'guildgrade2', 'guildgrade3', 'guildgrade4']) {
        this.grade[n] = gg?.[n]?.nGetImage?.() ?? null;
      }
      this.buttons.BtModf = this.btnOf(gg?.BtModf);
      this.buttons.BtSave = this.btnOf(gg?.BtSave);
      const ge = guild?.GuildEdit;
      for (const n of ['guildinfo0', 'guildinfo1', 'guildinfo2']) {
        this.grade['edit_' + n] = ge?.[n]?.nGetImage?.() ?? null;
      }
      const mm = guild?.MakeMark;
      this.mark.backgrnd = mm?.backgrnd?.['14']?.nGetImage?.() ?? null;
      for (let i = 0; i < 5; i++) this.mark['message' + i] = mm?.['message' + i]?.nGetImage?.() ?? null;
      this.mark.inner = mm?.inner?.nGetImage?.() ?? null;
      for (const b of ['BtLeft', 'BtRight', 'BtAgree', 'BtDisagree']) {
        this.buttons['MM_' + b] = this.btnOf(mm?.[b]);
      }

      const basic: any = await WZManager.get('UI.wz/Basic.img');
      this.btClose = basic?.BtClose?.normal?.['0']?.nGetImage?.() ?? null;
      this.yesNoBg = basic?.YesNo?.backgrnd?.nGetImage?.() ?? null;
      this.btYes = this.btnOf(basic?.BtYes);
      this.btNo = this.btnOf(basic?.BtNo);
      this.btOk = this.btnOf(basic?.BtOK);
      this.btCancel = this.btnOf(basic?.BtCancel);
    } catch (e) {
      console.error('[GuildMenu] Failed to load UserList/Guild assets:', e);
    }

    GuildManager.init();
    ClickManager.addDragableMenu(this);
  }

  // ---- geometry ----------------------------------------------------------

  getRect(_camera: CameraInterface) {
    if (this.isHidden) {
      if (this.designer) return this.designerRect();
      if (GuildManager.pendingInvite || this.prompt) return this.popupRect();
      return { x: this.x, y: this.y, width: 0, height: 0 };
    }
    return { x: this.x, y: this.y, width: W + (this.panelOpen ? PANEL_W : 0), height: H };
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

  private designerRect() {
    return {
      x: Math.floor((config.width - MM_W) / 2),
      y: Math.floor((config.height - MM_H) / 2),
      width: MM_W,
      height: MM_H,
    };
  }

  private panelX() {
    return this.x + W;
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
    if (isHidden) {
      this.closeNoticeInput();
      this.setPanelEdit(false);
      this.closePrompt();
    }
  }

  // ---- list model ----------------------------------------------------------

  private entries(): ListEntry[] {
    const members = GuildManager.getMembers();
    const online = members.filter((m) => m.online);
    const offline = members.filter((m) => !m.online);
    const out: ListEntry[] = [];
    out.push({ kind: 'header', img: this.info.guildinfo0, h: HEADER_H });
    out.push({ kind: 'cols', img: this.info.guildinfo2, h: ROW_H });
    for (const m of online) out.push({ kind: 'member', member: m, h: ROW_H });
    out.push({ kind: 'header', img: this.info.guildinfo1, h: HEADER_H });
    out.push({ kind: 'cols', img: this.info.guildinfo7, h: ROW_H });
    for (const m of offline) out.push({ kind: 'member', member: m, h: ROW_H });
    return out;
  }

  private maxScroll(entries: ListEntry[]): number {
    // Largest first-entry index that still leaves the viewport full
    let total = entries.reduce((s, e) => s + e.h, 0);
    let idx = 0;
    while (idx < entries.length - 1 && total - entries[idx].h >= LIST_BOTTOM - LIST_Y) {
      total -= entries[idx].h;
      idx++;
    }
    return idx;
  }

  private selectedMember(): GuildMember | null {
    if (!this.selectedCharacterId) return null;
    return GuildManager.getMembers().find((m) => m.characterId === this.selectedCharacterId) ?? null;
  }

  // ---- buttons ---------------------------------------------------------------

  private buttonPlaces(): BtnPlace[] {
    const inGuild = GuildManager.isInGuild();
    const myRank = GuildManager.myRank();
    const master = myRank === 1;
    const canInvite = GuildManager.canInvite();
    const sel = this.selectedMember();
    const selOther = !!sel && sel.characterId !== GuildManager.me()?.characterId;
    const selLower = selOther && !!sel && sel.rank > myRank;
    const places: BtnPlace[] = [
      { key: 'BtWhere', x: BAND_XS[0], y: BAND_ROW0_Y, w: BTN_W, h: BTN_H, enabled: false },
      { key: 'BtWhisper', x: BAND_XS[1], y: BAND_ROW0_Y, w: BTN_W, h: BTN_H, enabled: false },
      { key: 'BtChat', x: BAND_XS[2], y: BAND_ROW0_Y, w: BTN_W, h: BTN_H, enabled: false },
      { key: 'BtPartyInvite', x: BAND_XS[3], y: BAND_ROW0_Y, w: BTN_W, h: BTN_H, enabled: selOther && !!sel?.online && !!sel?.playerId },
      { key: 'BtInvite', x: BAND_XS[0], y: BAND_ROW1_Y, w: BTN_W, h: BTN_H, enabled: inGuild && canInvite },
      { key: 'BtKick', x: BAND_XS[1], y: BAND_ROW1_Y, w: BTN_W, h: BTN_H, enabled: inGuild && canInvite && selLower },
      { key: 'BtUp', x: BAND_XS[2], y: BAND_ROW1_Y, w: BTN_W, h: BTN_H, enabled: inGuild && canInvite && selLower && !!sel && sel.rank - 1 > myRank },
      { key: 'BtDown', x: BAND_XS[3], y: BAND_ROW1_Y, w: BTN_W, h: BTN_H, enabled: inGuild && canInvite && selLower && !!sel && sel.rank < 5 },
      { key: 'BtWithdraw', x: BAND_XS[0], y: BAND_ROW2_Y, w: BTN_W, h: BTN_H, enabled: inGuild && !master },
      { key: 'BtChange', x: BAND_XS[1], y: BAND_ROW2_Y, w: BTN_W, h: BTN_H, enabled: inGuild && master && selOther },
      { key: 'BtInfo', x: BAND_XS[2], y: BAND_ROW2_Y, w: BTN_W, h: BTN_H, enabled: inGuild },
      { key: 'BtBoard', x: BAND_XS[3], y: BAND_ROW2_Y, w: 60, h: BTN_H, enabled: false },
    ];
    return places;
  }

  private panelButtonPlaces(): BtnPlace[] {
    const master = GuildManager.isMaster();
    const px = PANEL_W; // relative to window x (panel docks at x + W)
    return [
      { key: 'BtModf', x: px + 30, y: PANEL_BTN_Y, w: 80, h: 17, enabled: master && !this.panelEdit },
      { key: 'BtSave', x: px + 123, y: PANEL_BTN_Y, w: 80, h: 17, enabled: master && this.panelEdit },
    ];
  }

  private onButton(key: string) {
    const sel = this.selectedMember();
    switch (key) {
      case 'BtInvite':
        this.openPrompt('Enter the name of the character to invite.', (name) => GuildManager.invite(name));
        break;
      case 'BtKick':
        if (sel) GuildManager.expel(sel.characterId);
        this.selectedCharacterId = 0;
        break;
      case 'BtUp':
        if (sel) GuildManager.changeRank(sel.characterId, sel.rank - 1);
        break;
      case 'BtDown':
        if (sel) GuildManager.changeRank(sel.characterId, sel.rank + 1);
        break;
      case 'BtWithdraw':
        GuildManager.leave();
        this.selectedCharacterId = 0;
        break;
      case 'BtChange':
        if (sel) GuildManager.changeLeader(sel.characterId);
        break;
      case 'BtInfo':
        this.panelOpen = !this.panelOpen;
        if (!this.panelOpen) this.setPanelEdit(false);
        break;
      case 'BtPartyInvite':
        if (sel?.playerId) {
          import('../../Party/PartyManager')
            .then(({ default: PartyManager }) => PartyManager.invite(sel.playerId as string))
            .catch(() => {});
        }
        break;
      case 'BtModf':
        this.setPanelEdit(true);
        break;
      case 'BtSave': {
        const titles = this.titleInputs.map((i) => String(i.input?.value ?? '').trim());
        GuildManager.setTitles(titles);
        this.setPanelEdit(false);
        break;
      }
    }
  }

  // ---- DOM inputs (MapleInput, positioned over WZ fields) ----------------

  private makeInput(x: number, y: number, width: number, value: string, onSubmit: () => void): MapleInput {
    const canvas = this.GameCanvas ?? ClickManager.GameCanvas;
    const input = new MapleInput(canvas, {
      x,
      y,
      width,
      height: 14,
      color: '#000000',
      background: 'transparent',
      border: 'none',
      fontSize: 11,
      submitListeners: [onSubmit],
    });
    input.input.value = value;
    input.input.maxLength = 100;
    input.input.focus();
    return input;
  }

  private openNoticeInput() {
    this.closeNoticeInput();
    const current = GuildManager.guild?.notice ?? '';
    this.noticeInput = this.makeInput(this.x + ROW_X + 6, this.y + NOTICE_Y + 3, 262, current, () => {
      const v = String(this.noticeInput?.input?.value ?? '');
      GuildManager.setNotice(v);
      this.closeNoticeInput();
    });
    this.noticeInput.input.maxLength = 100;
  }

  /** Hand the keyboard back to the game after a DOM field goes away */
  private releaseFocus() {
    const canvas = this.GameCanvas ?? ClickManager.GameCanvas;
    canvas?.releaseFocusInput?.();
  }

  private closeNoticeInput() {
    if (this.noticeInput) {
      this.noticeInput.remove();
      this.noticeInput = null;
      this.releaseFocus();
    }
  }

  private setPanelEdit(on: boolean) {
    const hadInputs = this.titleInputs.length > 0;
    for (const i of this.titleInputs) i.remove();
    this.titleInputs = [];
    this.panelEdit = on && GuildManager.isMaster();
    if (!this.panelEdit) {
      if (hadInputs) this.releaseFocus();
      return;
    }
    const ranks = GuildManager.guild?.ranks ?? [];
    for (let r = 0; r < 5; r++) {
      const input = this.makeInput(
        this.panelX() + PANEL_X0 + PANEL_TITLE_X - 2,
        this.y + PANEL_TABLE_Y + r * ROW_H + 2,
        80,
        ranks[r] ?? '',
        () => this.onButton('BtSave')
      );
      input.input.maxLength = 12;
      this.titleInputs.push(input);
    }
    this.titleInputs[0]?.input?.focus?.();
  }

  private openPrompt(title: string, onSubmit: (value: string) => void) {
    this.closePrompt();
    const r = this.popupRect();
    const input = this.makeInput(r.x + 32, r.y + 64, 200, '', () => {
      const v = String(this.prompt?.input?.input?.value ?? '');
      this.closePrompt();
      if (v.trim()) onSubmit(v);
    });
    input.input.maxLength = 12;
    this.prompt = { title, input, onSubmit };
  }

  private closePrompt() {
    if (this.prompt) {
      this.prompt.input.remove();
      this.prompt = null;
      this.releaseFocus();
    }
  }

  /** Keep the DOM fields glued to the window when it is dragged */
  private repositionInputs() {
    if (this.x === this.lastX && this.y === this.lastY) return;
    this.lastX = this.x;
    this.lastY = this.y;
    if (this.noticeInput) {
      this.noticeInput.opts.x = this.x + ROW_X + 6;
      this.noticeInput.opts.y = this.y + NOTICE_Y + 3;
      this.noticeInput.reposition();
    }
    this.titleInputs.forEach((input, r) => {
      input.opts.x = this.panelX() + PANEL_X0 + PANEL_TITLE_X - 2;
      input.opts.y = this.y + PANEL_TABLE_Y + r * ROW_H + 2;
      input.reposition();
    });
  }

  // ---- emblem designer --------------------------------------------------------

  private openDesigner() {
    void preloadEmblemParts().then(() => {
      const cur = GuildManager.guild?.emblem;
      const bgs = backgroundIds();
      const marks = markPartIds();
      this.designer = {
        bgIdx: cur?.bg ? Math.max(-1, bgs.indexOf(cur.bg)) : -1,
        bgColor: cur?.bgColor || 1,
        markIdx: cur?.mark ? Math.max(-1, marks.indexOf(cur.mark)) : -1,
        markColor: cur?.markColor || 1,
      };
    });
  }

  private designerSpec(): GuildEmblemSpec {
    const d = this.designer;
    if (!d) return { bg: 0, bgColor: 0, mark: 0, markColor: 0 };
    const bgs = backgroundIds();
    const marks = markPartIds();
    return {
      bg: d.bgIdx >= 0 ? bgs[d.bgIdx] ?? 0 : 0,
      bgColor: d.bgIdx >= 0 ? d.bgColor : 0,
      mark: d.markIdx >= 0 ? marks[d.markIdx] ?? 0 : 0,
      markColor: d.markIdx >= 0 ? d.markColor : 0,
    };
  }

  private cycleDesigner(row: number, dir: number) {
    const d = this.designer;
    if (!d) return;
    const wrap = (v: number, lo: number, hi: number) => (v < lo ? hi : v > hi ? lo : v);
    switch (row) {
      case 0: d.bgIdx = wrap(d.bgIdx + dir, -1, backgroundIds().length - 1); break;
      case 1: d.bgColor = wrap(d.bgColor + dir, 1, EMBLEM_COLOR_COUNT); break;
      case 2: d.markIdx = wrap(d.markIdx + dir, -1, markPartIds().length - 1); break;
      case 3: d.markColor = wrap(d.markColor + dir, 1, EMBLEM_COLOR_COUNT); break;
    }
  }

  private designerButtons(): BtnPlace[] {
    const r = this.designerRect();
    const out: BtnPlace[] = [];
    MM_ROW_YS.forEach((ry, i) => {
      out.push({ key: `L${i}`, x: r.x + MM_LEFT_X, y: r.y + ry, w: 40, h: 19, enabled: true });
      out.push({ key: `R${i}`, x: r.x + MM_RIGHT_X, y: r.y + ry, w: 40, h: 19, enabled: true });
    });
    out.push({ key: 'OK', x: r.x + 82, y: r.y + MM_OK_Y, w: 38, h: 17, enabled: true });
    out.push({ key: 'CANCEL', x: r.x + 130, y: r.y + MM_OK_Y, w: 38, h: 17, enabled: true });
    return out;
  }

  // ---- input ---------------------------------------------------------------------

  update(_msPerTick: number, _camera?: any, canvas?: GameCanvas) {
    GuildManager.update();
    if (GuildManager.emblemDesignerRequested) {
      GuildManager.emblemDesignerRequested = false;
      if (GuildManager.isMaster()) this.openDesigner();
      else GuildManager.onNotice('You must be the Guild Master to change the Emblem.');
    }
    if (!GuildManager.isInGuild()) {
      this.panelOpen = false;
      if (this.panelEdit) this.setPanelEdit(false);
      if (this.noticeInput) this.closeNoticeInput();
    }
    this.repositionInputs();

    const c = canvas ?? this.GameCanvas;
    if (!c || this.isHidden) return;
    const up = !!(c as any).scrolledUp;
    const down = !!(c as any).scrolledDown;
    if (!up && !down) return;
    const mx = c.mouseX;
    const my = c.mouseY;
    if (!this.ownsPoint(mx, my)) return;
    if (my < this.y + LIST_Y || my > this.y + LIST_BOTTOM || mx > this.x + W) return;
    const entries = this.entries();
    this.scroll = Math.max(0, Math.min(this.maxScroll(entries), this.scroll + (down ? 1 : -1)));
  }

  onMouseDown(mouseX: number, mouseY: number): boolean {
    // Popups first — they work even while the window is closed
    if (this.designer) {
      const r = this.designerRect();
      for (const b of this.designerButtons()) {
        if (mouseX >= b.x && mouseX < b.x + b.w && mouseY >= b.y && mouseY < b.y + b.h) {
          if (b.key === 'OK') {
            const spec = this.designerSpec();
            this.designer = null;
            GuildManager.setEmblem(spec);
          } else if (b.key === 'CANCEL') {
            this.designer = null;
          } else {
            this.cycleDesigner(Number(b.key.slice(1)), b.key[0] === 'L' ? -1 : 1);
          }
          return true;
        }
      }
      if (mouseX >= r.x && mouseX <= r.x + r.width && mouseY >= r.y && mouseY <= r.y + r.height) return true;
    }

    if (GuildManager.pendingInvite || this.prompt) {
      const r = this.popupRect();
      const btnY = r.y + r.height - 34;
      const yesX = r.x + Math.floor(r.width / 2) - 70;
      const noX = r.x + Math.floor(r.width / 2) + 5;
      if (mouseY >= btnY && mouseY <= btnY + 24) {
        if (mouseX >= yesX && mouseX <= yesX + 65) {
          if (this.prompt) {
            const v = String(this.prompt.input.input?.value ?? '');
            const cb = this.prompt.onSubmit;
            this.closePrompt();
            if (v.trim()) cb(v);
          } else {
            GuildManager.respondInvite(true);
          }
          return true;
        }
        if (mouseX >= noX && mouseX <= noX + 65) {
          if (this.prompt) this.closePrompt();
          else GuildManager.respondInvite(false);
          return true;
        }
      }
      if (mouseX >= r.x && mouseX <= r.x + r.width && mouseY >= r.y && mouseY <= r.y + r.height) {
        return true;
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

    // Side panel
    if (this.panelOpen && mouseX >= this.panelX()) {
      for (const def of this.panelButtonPlaces()) {
        const bx = this.x + def.x;
        const by = this.y + def.y;
        if (mouseX >= bx && mouseX < bx + def.w && mouseY >= by && mouseY < by + def.h) {
          if (def.enabled) this.onButton(def.key);
          return true;
        }
      }
      return true; // the panel body is not a drag handle
    }

    // Notice pencil
    if (
      GuildManager.isInGuild() && GuildManager.canInvite() &&
      mouseX >= this.x + 276 && mouseX < this.x + 296 &&
      mouseY >= this.y + NAME_ROW_Y && mouseY < this.y + NAME_ROW_Y + 20
    ) {
      if (this.noticeInput) this.closeNoticeInput();
      else this.openNoticeInput();
      return true;
    }

    // Member rows
    if (mouseY >= this.y + LIST_Y && mouseY < this.y + LIST_BOTTOM && mouseX >= this.x + ROW_X && mouseX <= this.x + ROW_X + 281) {
      const entries = this.entries();
      let y = this.y + LIST_Y;
      for (let i = this.scroll; i < entries.length && y < this.y + LIST_BOTTOM; i++) {
        const e = entries[i];
        if (mouseY >= y && mouseY < y + e.h) {
          if (e.kind === 'member') {
            this.selectedCharacterId = e.member.characterId === this.selectedCharacterId ? 0 : e.member.characterId;
          }
          return true;
        }
        y += e.h;
      }
      return true;
    }

    // Band buttons
    for (const def of this.buttonPlaces()) {
      const bx = this.x + def.x;
      const by = this.y + def.y;
      if (mouseX >= bx && mouseX < bx + def.w && mouseY >= by && mouseY < by + def.h) {
        if (def.enabled) this.onButton(def.key);
        return true;
      }
    }

    return false; // drag the window
  }

  // ---- drawing ---------------------------------------------------------------------

  draw(canvas: GameCanvas, _camera: CameraInterface, _lag: number, _ms: number, _t: number) {
    if (!this.isHidden) {
      this.drawWindow(canvas);
      if (this.panelOpen) this.drawPanel(canvas);
    }
    this.drawPopup(canvas);
    this.drawDesigner(canvas);
  }

  private hover(x: number, y: number, w: number, h: number): boolean {
    const mx = this.GameCanvas?.mouseX ?? -1;
    const my = this.GameCanvas?.mouseY ?? -1;
    return mx >= x && mx < x + w && my >= y && my < y + h;
  }

  private drawButton(canvas: GameCanvas, sprites: BtnSprites | undefined, x: number, y: number, w: number, h: number, enabled: boolean) {
    if (!sprites) return;
    const img = !enabled
      ? sprites.disabled ?? sprites.normal
      : this.hover(x, y, w, h)
        ? sprites.mouseOver ?? sprites.normal
        : sprites.normal;
    if (img?.width) canvas.drawImage({ img, dx: x, dy: y });
  }

  private drawClippedText(canvas: GameCanvas, text: string, x: number, y: number, maxW: number, color: string, fontSize = 11, fontWeight = '') {
    if (!text) return;
    const ctx = canvas.context;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y - 2, maxW, fontSize + 6);
    ctx.clip();
    canvas.drawText({ text, x, y, color, fontSize, fontWeight });
    ctx.restore();
  }

  private drawWindow(canvas: GameCanvas) {
    if (!this.bg?.width) return;
    canvas.drawImage({ img: this.bg, dx: this.x, dy: this.y });

    if (this.btClose?.width) {
      canvas.drawImage({ img: this.btClose, dx: this.x + W - 21, dy: this.y + 6 });
    }

    // Tab strip on the blue band, hung from the red underline (y=90); only
    // Guild (index 2) is live here
    let tx = this.x + 18;
    for (let i = 0; i < 5; i++) {
      const img = i === 2 ? this.tabImgs.enabled[i] : this.tabImgs.disabled[i];
      if (img?.width) {
        canvas.drawImage({ img, dx: tx, dy: this.y + 88 - img.height });
        tx += img.width + 14;
      } else {
        tx += 40;
      }
    }

    const guild = GuildManager.guild;

    // Emblem slot + guild name + notice pencil
    const slot = this.info.guildmark;
    if (slot?.width) canvas.drawImage({ img: slot, dx: this.x + ROW_X, dy: this.y + NAME_ROW_Y });
    if (guild) {
      const emblem = getEmblemImage(guild.emblem);
      if (emblem) canvas.drawImage({ img: emblem as any, dx: this.x + ROW_X + 1, dy: this.y + NAME_ROW_Y + 1 });
      this.drawClippedText(canvas, guild.name, this.x + ROW_X + 26, this.y + NAME_ROW_Y + 4, 200, '#000000', 12, 'bold');
      if (GuildManager.canInvite()) {
        this.drawButton(canvas, this.buttons.Btnotice, this.x + 276, this.y + NAME_ROW_Y, 20, 20, true);
      }
    }

    // Notice field
    const field = this.info.guildinfo6;
    if (field?.width) canvas.drawImage({ img: field, dx: this.x + ROW_X - 1, dy: this.y + NOTICE_Y });
    if (guild && !this.noticeInput) {
      this.drawClippedText(canvas, guild.notice, this.x + ROW_X + 6, this.y + NOTICE_Y + 4, 264, '#000000', 11);
    }

    // Scrolling member list (headers, column plates, rows), clipped to the viewport
    const ctx = canvas.context;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + ROW_X - 1, this.y + LIST_Y, 284, LIST_BOTTOM - LIST_Y);
    ctx.clip();
    const entries = this.entries();
    this.scroll = Math.min(this.scroll, this.maxScroll(entries));
    let y = this.y + LIST_Y;
    const rowBg = this.info.guildinfo3;
    for (let i = this.scroll; i < entries.length && y < this.y + LIST_BOTTOM; i++) {
      const e = entries[i];
      if (e.kind === 'header' || e.kind === 'cols') {
        if (e.img?.width) canvas.drawImage({ img: e.img, dx: this.x + ROW_X, dy: y });
      } else {
        const m = e.member;
        if (rowBg?.width) canvas.drawImage({ img: rowBg, dx: this.x + ROW_X, dy: y });
        if (m.characterId === this.selectedCharacterId) {
          drawSelectionBar(ctx, this.x + ROW_X + 1, y + 1, 279, ROW_H - 2);
        }
        const color = m.online ? '#000000' : '#808080';
        this.drawClippedText(canvas, m.name, this.x + ROW_X + COL_NAME_X, y + 4, 112, color);
        this.drawClippedText(canvas, getJobNameById(m.job) || '-', this.x + ROW_X + COL_JOB_X, y + 4, 66, color);
        canvas.drawText({ text: String(m.level || '-'), x: this.x + ROW_X + COL_LV_X, y: y + 4, color, fontSize: 11 });
        this.drawClippedText(canvas, GuildManager.rankTitle(m.rank), this.x + ROW_X + COL_TITLE_X, y + 4, 36, color);
      }
      y += e.h;
    }
    // Empty state: the window with nothing in it, as v83 shows non-members
    ctx.restore();

    // Buttons
    for (const def of this.buttonPlaces()) {
      this.drawButton(canvas, this.buttons[def.key], this.x + def.x, this.y + def.y, def.w, def.h, def.enabled);
    }
  }

  private drawPanel(canvas: GameCanvas) {
    const px = this.panelX();
    const py = this.y;
    if (this.panelBg?.width) canvas.drawImage({ img: this.panelBg, dx: px, dy: py });
    const guild = GuildManager.guild;

    const head = this.panelEdit ? this.grade.edit_guildinfo0 : this.grade.guildgrade0;
    const cols = this.panelEdit ? this.grade.edit_guildinfo1 : this.grade.guildgrade1;
    const table = this.panelEdit ? this.grade.edit_guildinfo2 : this.grade.guildgrade2;
    if (head?.width) canvas.drawImage({ img: head, dx: px + PANEL_X0, dy: py + PANEL_HEAD_Y });
    if (cols?.width) canvas.drawImage({ img: cols, dx: px + PANEL_X0, dy: py + PANEL_COLS_Y });
    if (table?.width) canvas.drawImage({ img: table, dx: px + PANEL_X0, dy: py + PANEL_TABLE_Y });

    if (guild) {
      const counts = [0, 0, 0, 0, 0];
      for (const m of guild.members) if (m.rank >= 1 && m.rank <= 5) counts[m.rank - 1]++;
      for (let r = 0; r < 5; r++) {
        const ry = py + PANEL_TABLE_Y + r * ROW_H + 4;
        canvas.drawText({ text: String(r + 1), x: px + PANEL_X0 + PANEL_RANK_X, y: ry, color: '#000000', fontSize: 11 });
        if (!this.panelEdit) {
          this.drawClippedText(canvas, guild.ranks[r] ?? '', px + PANEL_X0 + PANEL_TITLE_X, ry, 80, '#000000');
        }
        canvas.drawText({ text: String(counts[r]), x: px + PANEL_X0 + PANEL_POS_X, y: ry, color: '#000000', fontSize: 11 });
      }
    }

    const info = this.grade.guildgrade3;
    const gp = this.grade.guildgrade4;
    if (info?.width) canvas.drawImage({ img: info, dx: px + PANEL_X0, dy: py + PANEL_INFO_Y });
    if (gp?.width) canvas.drawImage({ img: gp, dx: px + PANEL_X0, dy: py + PANEL_GP_Y });
    if (guild) {
      canvas.drawText({ text: String(guild.gp), x: px + PANEL_X0 + 8, y: py + PANEL_GP_Y + 22, color: '#000000', fontSize: 11 });
    }

    for (const def of this.panelButtonPlaces()) {
      this.drawButton(canvas, this.buttons[def.key], this.x + def.x, this.y + def.y, def.w, def.h, def.enabled);
    }
  }

  private drawPopup(canvas: GameCanvas) {
    const invite = GuildManager.pendingInvite;
    const prompt = this.prompt;
    if (!invite && !prompt) return;
    const r = this.popupRect();
    if (this.yesNoBg?.width) {
      canvas.drawImage({ img: this.yesNoBg, dx: r.x, dy: r.y });
    }
    const cx = r.x + Math.floor(r.width / 2);
    if (prompt) {
      canvas.drawText({ text: prompt.title, x: cx, y: r.y + 38, color: '#000000', fontSize: 12, align: 'center' });
      // The entry field under the DOM input: UserList/Guild/GuildInfo/guildinfo6,
      // the window's own white rounded field (282x20), sliced end-cap /
      // stretch / end-cap down to the 200px the input occupies
      const field = this.info.guildinfo6;
      if (field?.width) {
        const fx = r.x + 32, fy = r.y + 62, fw = 200, cap = 10;
        const fh = field.height;
        canvas.drawImage({ img: field, sx: 0, sy: 0, sw: cap, sh: fh, dx: fx, dy: fy });
        canvas.drawImage({
          img: field, sx: cap, sy: 0, sw: field.width - cap * 2, sh: fh,
          dx: fx + cap, dy: fy, dw: fw - cap * 2, dh: fh,
        });
        canvas.drawImage({
          img: field, sx: field.width - cap, sy: 0, sw: cap, sh: fh,
          dx: fx + fw - cap, dy: fy,
        });
      }
    } else if (invite) {
      canvas.drawText({
        text: `'${invite.fromName}' has invited you`,
        x: cx, y: r.y + 34, color: '#000000', fontSize: 12, align: 'center',
      });
      canvas.drawText({
        text: `to join the guild '${invite.guildName}'.`,
        x: cx, y: r.y + 52, color: '#000000', fontSize: 12, align: 'center',
      });
    }
    const btnY = r.y + r.height - 34;
    const yesX = cx - 70;
    const noX = cx + 5;
    const yes = prompt ? this.btOk : this.btYes;
    const no = prompt ? this.btCancel : this.btNo;
    this.drawButton(canvas, yes ?? undefined, yesX, btnY, 65, 24, true);
    this.drawButton(canvas, no ?? undefined, noX, btnY, 65, 24, true);
  }

  private drawDesigner(canvas: GameCanvas) {
    const d = this.designer;
    if (!d) return;
    const r = this.designerRect();
    if (this.mark.backgrnd?.width) canvas.drawImage({ img: this.mark.backgrnd, dx: r.x, dy: r.y });

    const m0 = this.mark.message0;
    if (m0?.width) canvas.drawImage({ img: m0, dx: r.x + Math.floor((MM_W - m0.width) / 2), dy: r.y + 42 });

    // Preview plate (inner is origin-anchored at its centre) with the emblem at 2x
    const inner = this.mark.inner;
    const cx = r.x + Math.floor(MM_W / 2);
    const cy = r.y + 104;
    if (inner?.width) canvas.drawImage({ img: inner, dx: cx - 45, dy: cy - 23 });
    const spec = this.designerSpec();
    const emblem = getEmblemImage(spec);
    if (emblem) {
      const ctx = canvas.context;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(emblem, cx - 17, cy - 17, 34, 34);
      ctx.restore();
    }

    const bgs = backgroundIds();
    const marks = markPartIds();
    const values = [
      d.bgIdx >= 0 ? `${d.bgIdx + 1} / ${bgs.length}` : 'None',
      String(d.bgColor),
      d.markIdx >= 0 ? `${d.markIdx + 1} / ${marks.length}` : 'None',
      String(d.markColor),
    ];
    MM_ROW_YS.forEach((ry, i) => {
      const label = this.mark['message' + (i + 1)];
      if (label?.width) canvas.drawImage({ img: label, dx: r.x + MM_LABEL_X, dy: r.y + ry + 1 });
      canvas.drawText({ text: values[i], x: r.x + MM_VALUE_X, y: r.y + ry + 4, color: '#000000', fontSize: 11, align: 'center' });
    });
    for (const b of this.designerButtons()) {
      const key = b.key === 'OK' ? 'MM_BtAgree' : b.key === 'CANCEL' ? 'MM_BtDisagree' : b.key[0] === 'L' ? 'MM_BtLeft' : 'MM_BtRight';
      this.drawButton(canvas, this.buttons[key], b.x, b.y, b.w, b.h, true);
    }
  }
}

export default GuildMenuSprite;
