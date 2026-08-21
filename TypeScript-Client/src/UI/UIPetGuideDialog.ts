import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import ClickManager from './ClickManager';
import { MapleStanceButton } from './MapleStanceButton';
import { getItemNameSync } from '../Quest/QuestData';
import Config from '../Config';

/**
 * The Pet Command Guide reader — every 416xxxx guide (91 ETC items) carries
 * its pages in its own WZ record, `book/<page>/<paragraph>/{text, align}`,
 * and v83 shows them in `UI.wz/UIWindow.img/UtilDlgEx_Pet`: the pet talk
 * frame — text box on top, the pet of that species standing on the shelf
 * below with the baked LEVEL / CLOSENESS boxes (filled from your own pet of
 * that kind when you have one), PREV / NEXT / END CHAT from the shared
 * UtilDlgEx set.
 *
 * Measured off the 419x297 backgrnd: text box x=101..399 y=24..126; shelf
 * y=150..239 with the alignment dots framing x=107..313, feet line y=238;
 * LEVEL value box x=178..207, CLOSENESS value box x=265..294, both
 * y=241..254; button band y=267..292.
 */

const BG_W = 419;
const BG_H = 297;
const TEXT_X = 110;
const TEXT_Y = 33;
const TEXT_W = 280;
const TEXT_BOTTOM = 124;
const LINE_H = 14;
const PARA_GAP = 6;
const PET_X = 210;
const PET_FEET_Y = 238;
const LEVEL_BOX = { x: 178, w: 30 };
const CLOSENESS_BOX = { x: 265, w: 30 };
const VALUE_Y = 243;
const BAND_Y = 271;
const BLUE = '#0000ff';
const RED = '#ff0000';

interface Paragraph {
  text: string;
  center: boolean;
}

interface Segment {
  text: string;
  color: string;
}

interface Line {
  segments: Segment[];
  center: boolean;
  width: number;
}

/** Pet species names (String.wz/Pet.img) by id, loaded once. */
let petNames: Map<number, string> | null = null;
async function loadPetNames(): Promise<Map<number, string>> {
  if (petNames) return petNames;
  const names = new Map<number, string>();
  try {
    const root: any = await WZManager.get('String.wz/Pet.img');
    for (const child of root?.nChildren ?? []) {
      const id = Number(child.nName);
      const name = child.name?.nValue;
      if (Number.isFinite(id) && typeof name === 'string') names.set(id, name);
    }
  } catch { /* no names, no portrait */ }
  petNames = names;
  return names;
}

/**
 * The pets a guide is about: "Pet Command Guide : Puppy" → every species
 * named exactly "Puppy", else those whose name ends in it ("Brown Puppy"),
 * else those containing any of its slash-separated words ("Green/Red/Blue
 * Dragon"). Empty when nothing fits.
 */
function petsForGuide(guideName: string, names: Map<number, string>): number[] {
  const species = (guideName.split(':')[1] || '').trim();
  if (!species) return [];
  const all = [...names.entries()];
  const exact = all.filter(([, n]) => n === species).map(([id]) => id);
  if (exact.length) return exact;
  const suffix = all.filter(([, n]) => n.endsWith(' ' + species)).map(([id]) => id);
  if (suffix.length) return suffix;
  const words = species.split(/[\/ ]+/).filter((w) => w.length > 2);
  return all.filter(([, n]) => words.some((w) => n.includes(w))).map(([id]) => id);
}

const UIPetGuideDialog: any = {
  isVisible: false,
  loaded: false,
  backgrndImg: null as HTMLImageElement | null,
  shadowImg: null as HTMLImageElement | null,
  btNodes: null as any,

  itemId: 0,
  pages: [] as Paragraph[][],
  /** Wrapped text flowed into box-sized screens — a WZ page may need several. */
  screens: [] as Line[][],
  page: 0,
  lines: [] as Line[],
  petSprite: null as HTMLImageElement | null,
  petOrigin: { x: 0, y: 0 },
  petLevel: null as number | null,
  petCloseness: null as number | null,
  _gen: 0,

  buttons: [] as MapleStanceButton[],
  buttonsRegistered: false,
  x: 0,
  y: 0,
  canvas: null as GameCanvas | null,

  /** Open the guide carried by an inventory item (its WZ node must have `book`). */
  async show(item: any) {
    const book = item?.node?.book;
    if (!book) return;
    if (this.isVisible) this.hide();
    this._gen++;
    const gen = this._gen;
    this.itemId = item.itemId;
    this.pages = this.parseBook(book);
    this.page = 0;
    this.petSprite = null;
    this.petLevel = null;
    this.petCloseness = null;

    if (!this.loaded) await this.loadAssets();
    this.x = Math.floor((Config.width - BG_W) / 2);
    this.y = Math.floor((Config.height - BG_H) / 2);
    this.layoutScreens();
    this.isVisible = true;
    this.buttonsRegistered = false;
    void this.loadPet(gen);
  },

  hide() {
    this.isVisible = false;
    this._gen++;
    this.unregisterButtons();
  },

  escape() {
    this.hide();
  },

  async loadAssets() {
    try {
      const pet: any = await WZManager.get('UI.wz/UIWindow.img/UtilDlgEx_Pet');
      this.backgrndImg = pet?.backgrnd?.nGetImage?.() || null;
      const avatar: any = await WZManager.get('UI.wz/UIWindow.img/UtilDlgEx_Avatar');
      this.shadowImg = avatar?.shadow?.nGetImage?.() || null;
      const util: any = await WZManager.get('UI.wz/UIWindow.img/UtilDlgEx');
      this.btNodes = { prev: util?.BtPrev, next: util?.BtNext, close: util?.BtClose };
      this.loaded = true;
    } catch (e) {
      console.error('Failed to load pet guide dialog assets:', e);
    }
  },

  /** `book/<page>` is either paragraphs `<i>/{text, align}` or a lone `text`. */
  parseBook(book: any): Paragraph[][] {
    const pages: Paragraph[][] = [];
    const pageNodes = [...(book.nChildren ?? [])].sort((a: any, b: any) => Number(a.nName) - Number(b.nName));
    for (const pageNode of pageNodes) {
      const paras: Paragraph[] = [];
      if (typeof pageNode.text?.nValue === 'string') {
        paras.push({ text: pageNode.text.nValue, center: false });
      } else {
        const paraNodes = [...(pageNode.nChildren ?? [])].sort((a: any, b: any) => Number(a.nName) - Number(b.nName));
        for (const p of paraNodes) {
          const text = p.text?.nValue;
          if (typeof text !== 'string') continue;
          paras.push({ text, center: String(p.align?.nValue ?? '0') === '1' });
        }
      }
      if (paras.length) pages.push(paras);
    }
    return pages.length ? pages : [[{ text: '', center: false }]];
  },

  // ------------------------------------------------------------------ text

  /** Split `#b..#k` / `#r` runs into coloured segments, one list per line. */
  colourRuns(text: string): Segment[][] {
    const lines: Segment[][] = [];
    let color = '#000000';
    for (const raw of text.replace(/\\r/g, '').replace(/\r/g, '').split(/\\n|\n/)) {
      const segs: Segment[] = [];
      const parts = raw.split(/(#b|#r|#k|#d|#g)/);
      for (const part of parts) {
        if (part === '#b') color = BLUE;
        else if (part === '#r') color = RED;
        else if (part === '#k') color = '#000000';
        else if (part === '#d') color = '#7a28b8';
        else if (part === '#g') color = '#009000';
        else if (part) segs.push({ text: part.replace(/#[a-zA-Z]\d*#?/g, ''), color });
      }
      lines.push(segs);
    }
    return lines;
  },

  /**
   * Word-wrap every WZ page and flow the lines into screens the text box can
   * hold (six lines of 14px between y=33 and y=124); a new WZ page always
   * starts a new screen, an overlong one spills onto the next.
   */
  layoutScreens() {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = '12px Arial';
    const boxH = TEXT_BOTTOM - TEXT_Y;
    const screens: Line[][] = [];
    for (const paras of this.pages as Paragraph[][]) {
      const lines: Line[] = [];
      paras.forEach((para, pi) => {
        for (const segs of this.colourRuns(para.text)) {
          let cur: Segment[] = [];
          let curW = 0;
          const flush = () => {
            lines.push({ segments: cur, center: para.center, width: curW });
            cur = [];
            curW = 0;
          };
          for (const seg of segs) {
            for (const word of seg.text.split(/(\s+)/)) {
              if (!word) continue;
              const w = ctx.measureText(word).width;
              if (curW + w > TEXT_W && curW > 0 && !/^\s+$/.test(word)) flush();
              if (/^\s+$/.test(word) && curW === 0) continue;
              const last = cur[cur.length - 1];
              if (last && last.color === seg.color) last.text += word;
              else cur.push({ text: word, color: seg.color });
              curW += w;
            }
          }
          flush();
        }
        if (pi < paras.length - 1) lines.push({ segments: [], center: false, width: 0 });
      });
      let screen: Line[] = [];
      let h = 0;
      for (const line of lines) {
        const lh = line.segments.length ? LINE_H : PARA_GAP;
        if (h + lh > boxH && screen.length) {
          screens.push(screen);
          screen = [];
          h = 0;
          if (!line.segments.length) continue; // no leading gap on a new screen
        }
        screen.push(line);
        h += lh;
      }
      if (screen.length) screens.push(screen);
    }
    this.screens = screens.length ? screens : [[]];
    this.page = Math.min(this.page, this.screens.length - 1);
    this.lines = this.screens[this.page];
  },

  // ------------------------------------------------------------------- pet

  async loadPet(gen: number) {
    const names = await loadPetNames();
    if (gen !== this._gen) return;
    const guideName = getItemNameSync(this.itemId) || '';
    const candidates = petsForGuide(guideName, names);
    if (!candidates.length) return;

    // Your own pet of that kind fills LEVEL / CLOSENESS
    const cash: any[] = (window as any).charecter?.inventory?.cash || [];
    const owned = cash.find((it) => it && candidates.includes(it.itemId));
    if (owned?.equipData) {
      this.petLevel = owned.equipData.petLevel ?? 1;
      this.petCloseness = owned.equipData.closeness ?? 0;
    }
    const petId = owned?.itemId ?? candidates[0];
    try {
      const node: any = await WZManager.get(`Item.wz/Pet/${petId}.img`);
      if (gen !== this._gen) return;
      const frame = node?.stand0?.[0];
      this.petSprite = frame?.nGetImage?.() || null;
      this.petOrigin = { x: frame?.origin?.nX ?? 0, y: frame?.origin?.nY ?? 0 };
    } catch { /* no portrait */ }
  },

  // --------------------------------------------------------------- buttons

  registerButtons() {
    this.unregisterButtons();
    if (!this.btNodes || !this.canvas) return;
    const add = (node: any, x: number, onClick: () => void) => {
      if (!node) return;
      const btn = new MapleStanceButton(this.canvas, {
        x: this.x + x, y: this.y + BAND_Y,
        img: node.nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick,
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    };
    add(this.btNodes.close, 8, () => this.hide());
    if (this.screens.length > 1) {
      add(this.btNodes.prev, BG_W - 8 - 46 - 4 - 46, () => this.turn(-1));
      add(this.btNodes.next, BG_W - 8 - 46, () => this.turn(1));
    }
  },

  unregisterButtons() {
    for (const btn of this.buttons) ClickManager.removeButton(btn);
    this.buttons = [];
  },

  turn(dir: number) {
    const next = this.page + dir;
    if (next < 0 || next >= this.screens.length) return;
    this.page = next;
    this.lines = this.screens[next];
  },

  // ------------------------------------------------------------- rendering

  update(_msPerTick: number) {},

  render(canvas: GameCanvas, camera: CameraInterface) {
    if (!this.isVisible) return;
    this.canvas = canvas;
    if (!this.buttonsRegistered) {
      this.registerButtons();
      this.buttonsRegistered = true;
    }
    if (this.backgrndImg) canvas.drawImage({ img: this.backgrndImg, dx: this.x, dy: this.y });

    // Page text — coloured runs, centred paragraphs honoured, clipped to the box
    const ctx = canvas.context;
    ctx.save();
    ctx.font = '12px Arial';
    ctx.textBaseline = 'top';
    let ty = this.y + TEXT_Y;
    for (const line of this.lines) {
      if (ty + LINE_H > this.y + TEXT_BOTTOM) break;
      if (!line.segments.length) { ty += PARA_GAP; continue; }
      let tx = this.x + TEXT_X + (line.center ? Math.floor((TEXT_W - line.width) / 2) : 0);
      for (const seg of line.segments) {
        ctx.fillStyle = seg.color;
        ctx.fillText(seg.text, tx, ty);
        tx += ctx.measureText(seg.text).width;
      }
      ty += LINE_H;
    }
    ctx.restore();

    // The pet on the shelf
    const feetY = this.y + PET_FEET_Y;
    if (this.shadowImg?.complete) {
      canvas.drawImage({ img: this.shadowImg, dx: this.x + PET_X - Math.floor(this.shadowImg.width / 2), dy: feetY - 5 });
    }
    if (this.petSprite && this.petSprite.complete && this.petSprite.naturalWidth > 0) {
      canvas.drawImage({
        img: this.petSprite,
        dx: this.x + PET_X - (this.petOrigin.x || Math.floor(this.petSprite.width / 2)),
        dy: feetY - (this.petOrigin.y || this.petSprite.height),
      });
    }

    // LEVEL / CLOSENESS from your own pet of this kind
    if (this.petLevel !== null) {
      canvas.drawText({
        text: `${this.petLevel}`, x: this.x + LEVEL_BOX.x + LEVEL_BOX.w / 2, y: this.y + VALUE_Y,
        color: '#000000', fontSize: 10, align: 'center',
      });
      canvas.drawText({
        text: `${this.petCloseness}`, x: this.x + CLOSENESS_BOX.x + CLOSENESS_BOX.w / 2, y: this.y + VALUE_Y,
        color: '#000000', fontSize: 10, align: 'center',
      });
    }

    if (this.screens.length > 1) {
      canvas.drawText({
        text: `${this.page + 1} / ${this.screens.length}`, x: this.x + Math.floor(BG_W / 2), y: this.y + BAND_Y + 3,
        color: '#000000', fontSize: 10, align: 'center',
      });
    }

    for (const btn of this.buttons) btn.draw(canvas, camera, 0, 0, 0);
  },
};

(window as any).__UIPetGuideDialog = UIPetGuideDialog;

export default UIPetGuideDialog;
