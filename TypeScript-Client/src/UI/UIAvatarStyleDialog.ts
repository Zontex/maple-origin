import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import ClickManager from './ClickManager';
import { MapleStanceButton } from './MapleStanceButton';
import MapleStandingCharacter from '../MapleStandingCharacter';
import { getItemNameSync } from '../Quest/QuestData';
import { drawSelectionBar } from './UISelectionBar';
import Config from '../Config';

/**
 * The v83 style picker — `cm.sendStyle(text, styles)` — drawn from
 * `UI.wz/UIWindow.img/UtilDlgEx_Avatar`: the keeper talks in the white box at
 * the top, a row of three copies of your character model the candidate
 * hair / face / skin on the shelf below (BACK / NEXT page through the rest),
 * the chosen style's name sits in the blue name tag, TAKE OFF ALL / DEFAULT
 * SETTINGS strip or restore your gear so the cut is easy to judge, OK sends
 * the pick back to the script and LEAVE STORE walks away.
 *
 * Layout measured off the 419x306 backgrnd: header panel y=15..135 with the
 * speaker's blue column x=15..100 and the text box x=102..397, y=25..127;
 * shelf y=150..272 with the side columns (x<85, x>335) for the arrows; the
 * four alignment dots at x=106/313, y=181/238 mark the outer preview columns
 * and the feet line; button band y=275..306.
 */

const BG_W = 419;
const BG_H = 306;
const TEXT_X = 110;
const TEXT_Y = 34;
const TEXT_W = 280;
const TEXT_LINE_H = 14;
const TEXT_MAX_LINES = 6;
const NPC_X = 57;
const NPC_FEET_Y = 128;
const PREVIEW_XS = [106, 210, 313];
const PREVIEW_FEET_Y = 238;
const PREVIEW_BOX = { y: 158, w: 72, h: 90 };
const NAMETAG_Y = 251;
const ARROW_Y = 194;
const BACK_X = 10;
const NEXT_X = 345;
const BAND_Y = 282;
const PER_PAGE = PREVIEW_XS.length;
/** Cosmic's NPC talk type for a style pick (what the script's action() sees). */
const STYLE_TYPE = 7;

const SKIN_NAMES: Record<number, string> = { 0: 'Light', 1: 'Tanned', 2: 'Dark', 3: 'Pale', 4: 'Blue' };

function styleKind(id: number): 'skin' | 'face' | 'hair' {
  if (id < 100) return 'skin';
  if (id < 30000) return 'face';
  return 'hair';
}

function styleName(id: number): string {
  if (styleKind(id) === 'skin') return SKIN_NAMES[id] || `Skin ${id}`;
  return getItemNameSync(id) || `${id}`;
}

const UIAvatarStyleDialog: any = {
  isVisible: false,
  loaded: false,
  node: null as any,
  backgrndImg: null as HTMLImageElement | null,
  nameTagImg: null as HTMLImageElement | null,
  shadowImg: null as HTMLImageElement | null,
  okNode: null as any,

  text: '',
  lines: [] as string[],
  styles: [] as number[],
  page: 0,
  selected: 0,
  showEquips: true,
  onAction: null as null | ((mode: number, type: number, selection: number) => void),

  npcSprite: null as HTMLImageElement | null,
  npcOrigin: { x: 0, y: 0 },
  /** Preview models keyed by `${styleId}:${equips}` — built on demand per page. */
  _previews: new Map<string, MapleStandingCharacter | null>(),
  _baseLook: null as any,
  _gen: 0,

  buttons: [] as MapleStanceButton[],
  toggleBtn: null as MapleStanceButton | null,
  buttonsRegistered: false,
  x: 0,
  y: 0,
  canvas: null as GameCanvas | null,

  async show(opts: {
    npcId: number;
    text: string;
    styles: number[];
    character: any;
    onAction: (mode: number, type: number, selection: number) => void;
  }) {
    if (this.isVisible) this.hide();
    this._gen++;
    this.text = opts.text;
    this.styles = opts.styles.slice();
    this.page = 0;
    this.selected = 0;
    this.showEquips = true;
    this.onAction = opts.onAction;
    this.npcSprite = null;
    this._previews.clear();
    const c = opts.character;
    this._baseLook = {
      skin: c?.skinColor ?? 0,
      face: c?.face ?? 20000,
      hair: c?.hair ?? 30030,
      equips: Object.values(c?.equippedItemIds || {}).filter((id: any) => typeof id === 'number') as number[],
    };

    if (!this.loaded) await this.loadAssets();
    this.x = Math.floor((Config.width - BG_W) / 2);
    this.y = Math.floor((Config.height - BG_H) / 2);
    this.lines = this.wrap(this.text);
    void this.loadNpcSprite(opts.npcId);
    this.isVisible = true;
    this.buttonsRegistered = false;
    void this.buildPage();
  },

  hide() {
    this.isVisible = false;
    this._gen++;
    this.unregisterButtons();
    this.onAction = null;
    this._previews.clear();
  },

  /** ESC / LEAVE STORE — closes like any other script dialog (mode -1). */
  escape() {
    const cb = this.onAction;
    this.hide();
    cb?.(-1, STYLE_TYPE, 0);
  },

  async loadAssets() {
    try {
      this.node = await WZManager.get('UI.wz/UIWindow.img/UtilDlgEx_Avatar');
      this.backgrndImg = this.node?.backgrnd?.nGetImage?.() || null;
      this.nameTagImg = this.node?.nameTag?.nGetImage?.() || null;
      this.shadowImg = this.node?.shadow?.nGetImage?.() || null;
      const utilDlgEx: any = await WZManager.get('UI.wz/UIWindow.img/UtilDlgEx');
      this.okNode = utilDlgEx?.BtOK || null;
      this.loaded = true;
    } catch (e) {
      console.error('Failed to load avatar style dialog assets:', e);
    }
  },

  async loadNpcSprite(npcId: number) {
    try {
      const strId = `${npcId}`.padStart(7, '0');
      let npcFile: any = await WZManager.get(`Npc.wz/${strId}.img`);
      if (npcFile?.info?.link) {
        const linkId = npcFile.info.link.nValue;
        npcFile = await WZManager.get(`Npc.wz/${`${linkId}`.padStart(7, '0')}.img`);
      }
      const standFrame = npcFile?.stand?.[0];
      this.npcSprite = standFrame?.nGetImage?.() || null;
      this.npcOrigin = { x: standFrame?.origin?.nX ?? 0, y: standFrame?.origin?.nY ?? 0 };
    } catch { /* ignore */ }
  },

  wrap(text: string): string[] {
    const canvas = document.createElement('canvas').getContext('2d')!;
    canvas.font = '12px Arial';
    const out: string[] = [];
    for (const para of text.replace(/\r/g, '').split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? `${line} ${word}` : word;
        if (canvas.measureText(test).width > TEXT_W && line) {
          out.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      out.push(line);
    }
    return out.slice(0, TEXT_MAX_LINES);
  },

  // -------------------------------------------------------------- previews

  pageCount(): number {
    return Math.max(1, Math.ceil(this.styles.length / PER_PAGE));
  },

  previewKey(styleId: number): string {
    return `${styleId}:${this.showEquips ? 'eq' : 'bare'}`;
  },

  /** Build the models for the visible page (cached; stale builds are dropped). */
  async buildPage() {
    const gen = this._gen;
    const start = this.page * PER_PAGE;
    for (const styleId of this.styles.slice(start, start + PER_PAGE)) {
      const key = this.previewKey(styleId);
      if (this._previews.has(key)) continue;
      this._previews.set(key, null);
      const base = this._baseLook;
      const kind = styleKind(styleId);
      try {
        const model = await MapleStandingCharacter.fromAppearance({
          skinColor: kind === 'skin' ? styleId : base.skin,
          faceId: kind === 'face' ? styleId : base.face,
          hairId: kind === 'hair' ? styleId : base.hair,
          equipIds: this.showEquips ? base.equips : [],
          flipped: false,
          blink: { enabled: true },
        });
        if (gen !== this._gen) return;
        this._previews.set(key, model);
      } catch (e) {
        console.warn('[AvatarStyle] preview failed for', styleId, e);
      }
    }
  },

  // --------------------------------------------------------------- buttons

  registerButtons() {
    this.unregisterButtons();
    if (!this.node || !this.canvas) return;
    const canvas = this.canvas;
    const add = (node: any, x: number, y: number, onClick: () => void) => {
      if (!node) return null;
      const btn = new MapleStanceButton(canvas, {
        x: this.x + x, y: this.y + y,
        img: node.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick,
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
      return btn;
    };
    add(this.node.BtPrev, BACK_X, ARROW_Y, () => this.turnPage(-1));
    add(this.node.BtNext, NEXT_X, ARROW_Y, () => this.turnPage(1));
    add(this.node.BtExit, 8, BAND_Y, () => this.escape());
    // OK sits at the band's right; UtilDlgEx_Avatar ships no OK of its own
    const okW = 46; // UtilDlgEx/BtOK is 46x18
    add(this.okNode, BG_W - 8 - okW, BAND_Y, () => this.confirm());
    this.toggleBtn = null;
    this.rebuildToggle();
  },

  /** TAKE OFF ALL while gear is shown, DEFAULT SETTINGS while it is stripped. */
  rebuildToggle() {
    if (this.toggleBtn) {
      ClickManager.removeButton(this.toggleBtn);
      this.buttons = this.buttons.filter((b: any) => b !== this.toggleBtn);
      this.toggleBtn = null;
    }
    const node = this.showEquips ? this.node?.BtOff : this.node?.BtOn;
    if (!node || !this.canvas) return;
    const btn = new MapleStanceButton(this.canvas, {
      x: this.x + Math.floor((BG_W - 81) / 2), y: this.y + BAND_Y,
      img: node.nChildren,
      isRelativeToCamera: true, isPartOfUI: true,
      onClick: () => {
        this.showEquips = !this.showEquips;
        this.rebuildToggle();
        void this.buildPage();
      },
    });
    this.buttons.push(btn);
    ClickManager.addButton(btn);
    this.toggleBtn = btn;
  },

  unregisterButtons() {
    for (const btn of this.buttons) ClickManager.removeButton(btn);
    this.buttons = [];
    this.toggleBtn = null;
  },

  turnPage(dir: number) {
    const next = this.page + dir;
    if (next < 0 || next >= this.pageCount()) return;
    this.page = next;
    void this.buildPage();
  },

  confirm() {
    if (this.selected < 0 || this.selected >= this.styles.length) return;
    const cb = this.onAction;
    const sel = this.selected;
    this.hide();
    cb?.(1, STYLE_TYPE, sel);
  },

  // ------------------------------------------------------------- rendering

  update(msPerTick: number) {
    if (!this.isVisible) return;
    const start = this.page * PER_PAGE;
    for (const styleId of this.styles.slice(start, start + PER_PAGE)) {
      const model: any = this._previews.get(this.previewKey(styleId));
      model?.update?.(msPerTick);
    }
  },

  render(canvas: GameCanvas, camera: CameraInterface) {
    if (!this.isVisible) return;
    this.canvas = canvas;
    if (!this.buttonsRegistered) {
      this.registerButtons();
      this.buttonsRegistered = true;
    }

    if (this.backgrndImg) canvas.drawImage({ img: this.backgrndImg, dx: this.x, dy: this.y });

    // Speaker on the blue column
    if (this.npcSprite && this.npcSprite.complete && this.npcSprite.naturalWidth > 0) {
      const w = this.npcSprite.width;
      const ox = this.npcOrigin.x || Math.floor(w / 2);
      const oy = this.npcOrigin.y || this.npcSprite.height;
      // Keep it inside the column: tall keepers are scaled down to fit
      const maxH = 100;
      const scale = this.npcSprite.height > maxH ? maxH / this.npcSprite.height : 1;
      const ctx = canvas.context;
      ctx.save();
      ctx.translate(this.x + NPC_X, this.y + NPC_FEET_Y);
      ctx.scale(scale, scale);
      ctx.drawImage(this.npcSprite, -ox, -oy);
      ctx.restore();
    }

    // Talk text
    let ty = this.y + TEXT_Y;
    for (const line of this.lines) {
      canvas.drawText({ text: line, x: this.x + TEXT_X, y: ty, color: '#000000', fontSize: 12 });
      ty += TEXT_LINE_H;
    }

    // Shelf: the page's previews on their shadows, the pick highlighted
    const start = this.page * PER_PAGE;
    const zeroCam = { x: 0, y: 0 } as any;
    for (let i = 0; i < PER_PAGE; i++) {
      const idx = start + i;
      if (idx >= this.styles.length) break;
      const px = this.x + PREVIEW_XS[i];
      const feetY = this.y + PREVIEW_FEET_Y;
      if (idx === this.selected) {
        drawSelectionBar(canvas.context, px - PREVIEW_BOX.w / 2, this.y + PREVIEW_BOX.y, PREVIEW_BOX.w, PREVIEW_BOX.h);
      }
      if (this.shadowImg?.complete) {
        canvas.drawImage({ img: this.shadowImg, dx: px - Math.floor(this.shadowImg.width / 2), dy: feetY - 5 });
      }
      const model: any = this._previews.get(this.previewKey(this.styles[idx]));
      if (model) {
        model.setPosition(px, feetY);
        model.draw(canvas, zeroCam, 0, 0, 0);
      }
    }

    // Name tag with the chosen style's name
    if (this.nameTagImg?.complete) {
      const tx = this.x + Math.floor((BG_W - this.nameTagImg.width) / 2);
      canvas.drawImage({ img: this.nameTagImg, dx: tx, dy: this.y + NAMETAG_Y });
      const sel = this.styles[this.selected];
      if (sel !== undefined) {
        canvas.drawText({
          text: styleName(sel), x: this.x + Math.floor(BG_W / 2), y: this.y + NAMETAG_Y + 3,
          color: '#ffffff', fontSize: 11, align: 'center',
        });
      }
    }

    // Page counter beside the arrows, as the dialog has no other cue
    if (this.pageCount() > 1) {
      canvas.drawText({
        text: `${this.page + 1} / ${this.pageCount()}`, x: this.x + Math.floor(BG_W / 2),
        y: this.y + 152, color: '#000000', fontSize: 10, align: 'center',
      });
    }

    for (const btn of this.buttons) btn.draw(canvas, camera, 0, 0, 0);

    if ((canvas as any).wasClicked) {
      this.handleClick((canvas as any).mouseX || 0, (canvas as any).mouseY || 0);
    }
  },

  handleClick(mx: number, my: number) {
    const start = this.page * PER_PAGE;
    for (let i = 0; i < PER_PAGE; i++) {
      const idx = start + i;
      if (idx >= this.styles.length) break;
      const px = this.x + PREVIEW_XS[i];
      const top = this.y + PREVIEW_BOX.y;
      if (mx >= px - PREVIEW_BOX.w / 2 && mx < px + PREVIEW_BOX.w / 2 && my >= top && my < top + PREVIEW_BOX.h) {
        this.selected = idx;
        return;
      }
    }
  },
};

(window as any).__UIAvatarStyleDialog = UIAvatarStyleDialog;

export default UIAvatarStyleDialog;
