import WZManager from '../../wz-utils/WZManager';
import DragableMenu from './DragableMenu';
import ClickManager from '../ClickManager';
import GameCanvas from '../../GameCanvas';
import { CameraInterface } from '../../Camera';
import MapleInput from '../MapleInput';
import UIDevTools from '../UIDevTools';
import { Position } from '../../Effects/DamageIndicator';
import {
  ensureItemNames,
  ensureMapNames,
  getItemNameSync,
  getMapNameSync,
} from '../../Quest/QuestData';
import MonsterBook from '../../MonsterBook/MonsterBook';
import {
  CARDS_PER_PAGE,
  MAX_COPIES,
  MonsterBookCard,
  TAB_COUNT,
  TAB_LABELS,
  ensureMobNames,
  ensureMonsterBookData,
  findCardByName,
  getCardIcon,
  getCardsForTab,
  getMobInfo,
  getMobName,
  getRewardIcon,
  pageCount,
  preloadTabIcons,
  tabOf,
} from '../../MonsterBook/MonsterBookData';

/**
 * MONSTER BOOK — v83 UIWindow.img/MonsterBook.
 *
 * The art is an open book (475x349). Its left page carries the 5x5 card grid
 * (`cardSlot`, whose 25 holes are transparent so the card faces sit in the
 * page), the search field baked into that same sprite, and the page arrows.
 * The nine coloured bookmarks down the left edge are the level bands; the
 * brown bookmark above them swaps the left page for the book's own summary
 * (`infoPage`). The right page belongs to whichever card is selected: its face
 * enlarged, its name, and the four BASIC INFO / EPISODE / DROPPING / FOUND IN
 * tabs.
 *
 * Those four tabs are why `RightTab` ships a `disabled` frame. A card unlocks
 * in stages as copies of it are collected — one copy is the picture, two adds
 * HP/MP, three the episode and the rest of the stat block, four the drop list,
 * five the habitat list and the `fullMark` medal on the card itself.
 *
 * No layout coordinates exist in the WZ (the original client hardcodes them),
 * so the constants below are derived from the art: the page bounds and grid
 * holes were measured off `backgrnd` and `cardSlot` pixel by pixel, and the
 * bookmarks are placed so a `selected` tab — which is 22px wider than a
 * `normal` one, growing rightward — stops exactly where the card panel starts.
 */

const W = 475;
const H = 349;

// Left page paper runs x 25..225, right page x 250..449 (measured off backgrnd)
const LEFT_PAGE_RIGHT = 225;

// cardSlot (174x256) is right-aligned on the left page so the widest selected
// bookmark can never reach it
const SLOT_X = LEFT_PAGE_RIGHT - 174; // 51
const SLOT_Y = 24;

// Grid holes in cardSlot: 27x38 cells, 33px apart across and 45px down
const GRID_X = SLOT_X + 8;
const GRID_Y = SLOT_Y + 31;
const CELL_W = 27;
const CELL_H = 38;
const COL_PITCH = 33;
const ROW_PITCH = 45;
const GRID_COLS = 5;
const GRID_ROWS = 5;

// The white field baked into the top of cardSlot, and the button beside it
const SEARCH_X = SLOT_X + 10;
const SEARCH_Y = SLOT_Y + 6;
const SEARCH_W = 118;
const SEARCH_H = 14;
const BTSEARCH_X = SLOT_X + 133;
const BTSEARCH_Y = SLOT_Y + 4;

// Footer: band name, pager, band progress. The left page gives it 174px and
// the five elements need 154 at their worst ("Lv. 91 ~ 105", "20 / 20", both
// arrows, "4 / 4"), so the positions below are spaced off those widths rather
// than eyeballed — anything wider and the pager runs into the counters.
const ARROW_Y = SLOT_Y + 259;
const ARROW_L_X = SLOT_X + 62;
const ARROW_R_X = SLOT_X + 115;
const PAGE_TEXT_X = SLOT_X + 100;
const FOOTER_TEXT_Y = ARROW_Y + 4;
const FOOTER_FONT = 10;
const LABEL_X = SLOT_X;
const COUNT_X = SLOT_X + 174;

// Bookmarks: left-aligned on the book's inner margin. `normal` art is 20x20
// with only its top 13 rows solid (the rest is the drop shadow), so a 15px
// pitch stacks them with a hairline gap.
const TAB_X = 8;
const TAB_TOP = 58;
const TAB_PITCH = 17;
const TAB_HIT_W = 20;
const TAB_HIT_H = TAB_PITCH;
// Clear of the book's top-left gold corner bracket, which runs to about y=30
const INFO_TAB_Y = 30;
const INFO_TAB_W = 27;
const INFO_TAB_H = 26;

// Book summary panel, when the brown bookmark is active
const INFO_X = SLOT_X + 12;
const INFO_Y = SLOT_Y + 30;
// Label bands measured in infoPage: "Book Master Lvl" y1..15, "Total Cards"
// y52..65, "Special Cards" y85..100, "Basic Cards" y105..116, "Book Cover"
// y137..159. Values go right of each label's own ink.
const INFO_LEVEL_Y = INFO_Y + 2;
const INFO_TOTAL_Y = INFO_Y + 53;
const INFO_SPECIAL_Y = INFO_Y + 86;
const INFO_BASIC_Y = INFO_Y + 105;
const INFO_VALUE_X = INFO_X + 92;
const INFO_LEVEL_VALUE_X = INFO_X + 110;
const INFO_COVER_X = INFO_X + 52;
const INFO_COVER_Y = INFO_Y + 133;

// Right page
const RP_CX = 350;
const PORTRAIT_SCALE = 2;
const PORTRAIT_Y = 14;
const NAME_Y = 96;
const SUB_Y = 111;
const RTAB_Y = 124;
const RTAB_H = 39;
// Four tabs, one slot each the width of the `normal` art. `selected` art is
// solid to its edges and 11px wider, so it always overhangs into its
// neighbours — the slot width decides by how much. At 51 the overhang is 5.5px
// a side, which lands on the next tab's bevel; the 47 this started at cost
// 7.5px and clipped the neighbouring label's first letter. The row runs to
// x=454, past the paper's edge at 449 but well inside the 475 window, which is
// the only way four tabs and a widened one fit at all.
const RTAB_X0 = 250;
const RTAB_SLOT_W = 51;
const CONTENT_X = 258;
const CONTENT_Y = 168;
const CONTENT_W = 184;
const CONTENT_H = 134;

const CLOSE_X = 427;
const CLOSE_Y = 10;

const COLOR_LABEL = '#6b4a2a';
const COLOR_VALUE = '#000000';
const COLOR_UNKNOWN = '#a08c72';

/**
 * Copies of a card each right-hand tab needs. One copy is the picture, and
 * every further copy opens another section.
 */
const RIGHT_TABS: { label: string; need: number }[] = [
  { label: 'Basic Info', need: 1 },
  { label: 'Episode', need: 3 },
  { label: 'Dropping', need: 4 },
  { label: 'Found In', need: 5 },
];

/** Copies needed before the HP/MP line reads as anything but "?" */
const NEED_HPMP = 2;
/** Copies needed for the rest of the stat block and the monster's form */
const NEED_STATS = 3;

type LeftView = number | 'info';

function stance(node: any, name: string): HTMLImageElement | null {
  const frame = node?.nGet?.(name)?.nGet?.('0');
  return frame?.nTagName === 'canvas' ? (frame.nGetImage() as HTMLImageElement) : null;
}

interface Sprites {
  normal: HTMLImageElement | null;
  mouseOver: HTMLImageElement | null;
  pressed: HTMLImageElement | null;
  disabled: HTMLImageElement | null;
  /** RightTab is the only button here with a latched state */
  selected: HTMLImageElement | null;
}

function sprites(node: any): Sprites {
  return {
    normal: stance(node, 'normal'),
    mouseOver: stance(node, 'mouseOver'),
    pressed: stance(node, 'pressed'),
    disabled: stance(node, 'disabled'),
    selected: stance(node, 'selected'),
  };
}

class MonsterBookMenuSprite extends DragableMenu {
  opts: any;
  private canvas: GameCanvas | null = null;
  private book: MonsterBook | null = null;

  // --- WZ art
  private bg: HTMLImageElement | null = null;
  private cardSlot: HTMLImageElement | null = null;
  private infoPage: HTMLImageElement | null = null;
  private selectFrame: any = null;
  private coverFrame: any = null;
  private fullMark: HTMLImageElement | null = null;
  private bookIcons: (HTMLImageElement | null)[] = [];
  private leftTabs: { normal: HTMLImageElement | null; selected: HTMLImageElement | null; mouseOver: HTMLImageElement | null; newNormal: HTMLImageElement[]; newSelected: HTMLImageElement[] }[] = [];
  private infoTab: { normal: HTMLImageElement | null; selected: HTMLImageElement | null } = { normal: null, selected: null };
  private rightTabs: Sprites[] = [];
  private btClose: Sprites | null = null;
  private btSearch: Sprites | null = null;
  private arrowLeft: Sprites | null = null;
  private arrowRight: Sprites | null = null;
  private ctx: {
    t: HTMLImageElement | null;
    s: HTMLImageElement | null;
    register: Sprites | null;
    release: Sprites | null;
  } | null = null;
  private digits: HTMLImageElement[] = [];

  // --- view state
  private leftView: LeftView = 0;
  /** Last card tab looked at, so the brown bookmark can hand the page back */
  private tab = 0;
  private page = 0;
  private selected = 0;
  private rightTab = 0;
  private scroll = 0;
  /** Blink phase for the `new_n`/`new_s` bookmark art */
  private blink = 0;

  private contextCard = 0;
  private contextX = 0;
  private contextY = 0;

  private searchInput: MapleInput | null = null;
  private prevRightClick = false;

  static async fromOpts(opts: any) {
    const obj = new MonsterBookMenuSprite(opts);
    await obj.load();
    return obj;
  }

  constructor(opts: any) {
    super(opts);
    this.opts = opts;
  }

  async load() {
    this.x = this.opts.x ?? 60;
    this.y = this.opts.y ?? 60;
    this.isHidden = this.opts.isHidden ?? true;
    this.canvas = this.opts.canvas ?? null;
    this.book = this.opts.book ?? null;

    try {
      const node: any = await WZManager.get('UI.wz/UIWindow.img/MonsterBook');
      this.bg = node.backgrnd?.nGetImage?.() ?? null;
      this.cardSlot = node.cardSlot?.nGetImage?.() ?? null;
      this.infoPage = node.infoPage?.nGetImage?.() ?? null;
      this.selectFrame = node.select ?? null;
      this.coverFrame = node.cover ?? null;
      this.fullMark = node.fullMark?.nGetImage?.() ?? null;

      for (let i = 0; i < 8; i++) {
        this.bookIcons[i] = node.icon?.nGet?.(`${i}`)?.nGetImage?.() ?? null;
      }

      for (let i = 0; i < TAB_COUNT; i++) {
        const t = node.LeftTab?.nGet?.(`${i}`);
        const frames = (dir: string): HTMLImageElement[] => {
          const out: HTMLImageElement[] = [];
          const parent = t?.nGet?.(dir);
          for (const child of parent?.nChildren ?? []) {
            if (child.nTagName === 'canvas') out.push(child.nGetImage());
          }
          return out;
        };
        this.leftTabs[i] = {
          normal: stance(t, 'normal'),
          selected: stance(t, 'selected'),
          mouseOver: stance(t, 'mouseOver'),
          newNormal: frames('new_n'),
          newSelected: frames('new_s'),
        };
      }

      const it = node.LeftTabInfo?.nGet?.('0');
      this.infoTab = { normal: stance(it, 'normal'), selected: stance(it, 'selected') };

      for (let i = 0; i < RIGHT_TABS.length; i++) {
        this.rightTabs[i] = sprites(node.RightTab?.nGet?.(`${i}`));
      }

      this.btClose = sprites(node.BtClose);
      this.btSearch = sprites(node.BtSearch);
      this.arrowLeft = sprites(node.arrowLeft);
      this.arrowRight = sprites(node.arrowRight);

      const cm = node.ContextMenu;
      this.ctx = {
        t: cm?.t?.nGetImage?.() ?? null,
        s: cm?.s?.nGetImage?.() ?? null,
        register: sprites(cm?.BtRegister),
        release: sprites(cm?.BtRelease),
      };

      const basic: any = await WZManager.get('UI.wz/Basic.img');
      for (let i = 0; i <= 9; i++) {
        const d = basic?.ItemNo?.nGet?.(`${i}`);
        if (d?.nGetImage) this.digits[i] = d.nGetImage();
      }
    } catch (e) {
      console.error('[MonsterBook] failed to load UIWindow.img/MonsterBook:', e);
    }

    // Catalogue and the three name tables the pages read from
    await ensureMonsterBookData();
    ensureMobNames().catch(() => {});
    ensureItemNames().catch(() => {});
    ensureMapNames().catch(() => {});
    preloadTabIcons(0);

    ClickManager.addDragableMenu(this);
  }

  /** Late binding: MapState builds the window before the character restore. */
  setBook(book: MonsterBook) {
    this.book = book;
  }

  getRect(_camera: CameraInterface) {
    return { x: this.x, y: this.y, width: W, height: H };
  }

  setIsHidden(isHidden: boolean) {
    if (isHidden === this.isHidden) return;
    this.isHidden = isHidden;
    if (isHidden) {
      this.closeContextMenu();
      this.removeSearchInput();
    } else {
      // Reopening lands on the card grid, and on a tab whose "new" marker is
      // now answered for
      this.book?.markSeen(this.tab);
      this.syncSearchInput();
    }
  }

  moveTo(position: Position) {
    this.x = position.x;
    this.y = position.y;
    this.closeContextMenu();
  }

  // ---- search field ------------------------------------------------------

  /**
   * The search field is a DOM input the way every other text entry in this
   * client is (login, script prompts): it is the one thing the canvas cannot
   * do, and MapleInput already maps canvas coordinates through the CSS scale.
   * Created and destroyed with the window so it can never float over the game.
   */
  private syncSearchInput() {
    if (this.isHidden || this.leftView === 'info') {
      this.removeSearchInput();
      return;
    }
    if (!this.canvas) return;
    if (!this.searchInput) {
      this.searchInput = new MapleInput(this.canvas, {
        x: this.x + SEARCH_X,
        y: this.y + SEARCH_Y,
        width: SEARCH_W,
        height: SEARCH_H,
        fontSize: 12,
        color: '#000000',
        cursor: 'text',
        submitListeners: [() => this.runSearch()],
      });
    }
    this.searchInput.setCanvasPos(this.x + SEARCH_X, this.y + SEARCH_Y);
  }

  private removeSearchInput() {
    if (!this.searchInput) return;
    if (this.canvas) this.canvas.focusInput = false;
    this.searchInput.remove();
    this.searchInput = null;
  }

  private runSearch() {
    const query = this.searchInput?.input?.value ?? '';
    const card = findCardByName(query);
    if (!card) return;
    this.gotoCard(card);
    this.canvas?.releaseFocusInput?.();
  }

  /** Bring a card into view and select it, wherever in the book it lives. */
  private gotoCard(card: MonsterBookCard) {
    const tab = tabOf(card.id);
    const list = getCardsForTab(tab);
    const index = list.findIndex((c) => c.id === card.id);
    if (index < 0) return;
    this.leftView = tab;
    this.tab = tab;
    this.page = Math.floor(index / CARDS_PER_PAGE);
    preloadTabIcons(tab);
    this.book?.markSeen(tab);
    this.selectCard(card.id);
    this.syncSearchInput();
  }

  private selectCard(cardId: number) {
    // Only a card in the book has a page to show
    if (!this.book?.has(cardId)) return;
    this.selected = cardId;
    this.scroll = 0;
    if (!this.isRightTabEnabled(this.rightTab)) this.rightTab = 0;
  }

  // ---- geometry ----------------------------------------------------------

  private cellRect(slot: number) {
    const col = slot % GRID_COLS;
    const row = Math.floor(slot / GRID_COLS);
    return {
      x: this.x + GRID_X + col * COL_PITCH,
      y: this.y + GRID_Y + row * ROW_PITCH,
      width: CELL_W,
      height: CELL_H,
    };
  }

  private pageCards(): (MonsterBookCard | undefined)[] {
    if (this.leftView === 'info') return [];
    const list = getCardsForTab(this.leftView as number);
    const start = this.page * CARDS_PER_PAGE;
    return Array.from({ length: CARDS_PER_PAGE }, (_, i) => list[start + i]);
  }

  private hit(mx: number, my: number, x: number, y: number, w: number, h: number) {
    return mx >= this.x + x && mx < this.x + x + w && my >= this.y + y && my < this.y + y + h;
  }

  private isRightTabEnabled(index: number): boolean {
    if (!this.selected) return false;
    return (this.book?.copiesOf(this.selected) ?? 0) >= RIGHT_TABS[index].need;
  }

  // ---- input -------------------------------------------------------------

  onMouseDown(mouseX: number, mouseY: number): boolean {
    if (this.isHidden || !this.ownsPoint(mouseX, mouseY)) return false;

    // The context menu is modal over the window while it is up
    if (this.contextCard) {
      const btn = this.contextButtonRect();
      if (
        mouseX >= btn.x && mouseX < btn.x + btn.width &&
        mouseY >= btn.y && mouseY < btn.y + btn.height
      ) {
        const isCover = this.book?.cover === this.contextCard;
        this.book?.setCover(isCover ? 0 : this.contextCard);
      }
      this.closeContextMenu();
      return true;
    }

    if (this.btClose && this.hit(mouseX, mouseY, CLOSE_X, CLOSE_Y, 18, 16)) {
      this.setIsHidden(true);
      return true;
    }

    // Bookmarks
    if (this.hit(mouseX, mouseY, TAB_X, INFO_TAB_Y, INFO_TAB_W, INFO_TAB_H)) {
      this.leftView = 'info';
      this.syncSearchInput();
      return true;
    }
    for (let i = 0; i < TAB_COUNT; i++) {
      if (!this.hit(mouseX, mouseY, TAB_X, TAB_TOP + i * TAB_PITCH, TAB_HIT_W, TAB_HIT_H)) continue;
      this.leftView = i;
      this.tab = i;
      this.page = 0;
      this.book?.markSeen(i);
      preloadTabIcons(i);
      this.syncSearchInput();
      return true;
    }

    if (this.leftView !== 'info') {
      if (this.hit(mouseX, mouseY, BTSEARCH_X, BTSEARCH_Y, 34, 17)) {
        this.runSearch();
        return true;
      }
      if (this.hit(mouseX, mouseY, ARROW_L_X, ARROW_Y, 24, 17)) {
        this.page = Math.max(0, this.page - 1);
        return true;
      }
      if (this.hit(mouseX, mouseY, ARROW_R_X, ARROW_Y, 23, 17)) {
        this.page = Math.min(pageCount(this.leftView as number) - 1, this.page + 1);
        return true;
      }

      const cards = this.pageCards();
      for (let slot = 0; slot < CARDS_PER_PAGE; slot++) {
        const card = cards[slot];
        if (!card) continue;
        const r = this.cellRect(slot);
        if (
          mouseX >= r.x && mouseX < r.x + r.width &&
          mouseY >= r.y && mouseY < r.y + r.height
        ) {
          this.selectCard(card.id);
          return true;
        }
      }
    }

    // Right-hand tabs — only while they are actually on screen, or their
    // rects would go on swallowing clicks over a blank page
    for (let i = 0; this.selected && i < RIGHT_TABS.length; i++) {
      if (!this.hit(mouseX, mouseY, RTAB_X0 + i * RTAB_SLOT_W, RTAB_Y, RTAB_SLOT_W, RTAB_H)) continue;
      if (this.isRightTabEnabled(i)) {
        this.rightTab = i;
        this.scroll = 0;
      }
      return true;
    }

    return false; // bare page — let the window drag
  }

  update(msPerTick: number, _camera?: any, canvas?: GameCanvas) {
    if (canvas) this.canvas = canvas;
    if (this.isHidden) return;

    this.blink += msPerTick;
    this.syncSearchInput();

    const c = this.canvas;
    if (!c) return;
    const mx = c.mouseX;
    const my = c.mouseY;
    const inside = this.ownsPoint(mx, my);

    // Right-click a card you own to register it as the book cover
    const rightNow = !!(c as any).rightClicked;
    if (rightNow && !this.prevRightClick) {
      (c as any).rightClicked = false;
      if (inside) this.handleRightClick(mx, my);
    }
    this.prevRightClick = rightNow;

    if (!inside) return;

    // The wheel pages the card grid and scrolls whichever list the right page
    // is showing, depending on which half the pointer is over
    const up = !!(c as any).scrolledUp;
    const down = !!(c as any).scrolledDown;
    if (!up && !down) return;
    const dir = down ? 1 : -1;
    if (mx < this.x + 240) {
      if (this.leftView !== 'info') {
        this.page = Math.max(0, Math.min(pageCount(this.leftView as number) - 1, this.page + dir));
      }
    } else {
      this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll + dir));
    }
  }

  private handleRightClick(mouseX: number, mouseY: number) {
    this.closeContextMenu();
    if (this.leftView === 'info') return;
    const cards = this.pageCards();
    for (let slot = 0; slot < CARDS_PER_PAGE; slot++) {
      const card = cards[slot];
      if (!card || !this.book?.has(card.id)) continue;
      const r = this.cellRect(slot);
      if (
        mouseX >= r.x && mouseX < r.x + r.width &&
        mouseY >= r.y && mouseY < r.y + r.height
      ) {
        this.contextCard = card.id;
        this.contextX = r.x + 12;
        this.contextY = r.y + 12;
        return;
      }
    }
  }

  private closeContextMenu() {
    this.contextCard = 0;
  }

  private contextButtonRect() {
    return { x: this.contextX - 2, y: this.contextY + 3, width: 85, height: 14 };
  }

  // ---- right page content model -----------------------------------------

  private contentLines(canvas: GameCanvas): { kind: 'text' | 'item'; text: string; id?: number }[] {
    if (!this.selected) return [];
    const card = getCardsForTab(tabOf(this.selected)).find((c) => c.id === this.selected);
    if (!card) return [];
    const info = getMobInfo(card.mob);

    if (this.rightTab === 1) {
      const out: { kind: 'text'; text: string }[] = [];
      if (info.trait) {
        for (const line of this.wrap(canvas, info.trait, CONTENT_W, 11)) {
          out.push({ kind: 'text', text: line });
        }
        out.push({ kind: 'text', text: '' });
      }
      for (const paragraph of info.lore.split('\n')) {
        if (!paragraph.trim()) {
          out.push({ kind: 'text', text: '' });
          continue;
        }
        for (const line of this.wrap(canvas, paragraph, CONTENT_W, 11)) {
          out.push({ kind: 'text', text: line });
        }
      }
      return out;
    }

    if (this.rightTab === 2) {
      return info.rewards.map((id) => ({
        kind: 'item' as const,
        text: getItemNameSync(id) || `Item ${id}`,
        id,
      }));
    }

    if (this.rightTab === 3) {
      return info.maps.map((id) => ({ kind: 'text' as const, text: getMapNameSync(id) }));
    }

    return [];
  }

  private lineHeight(): number {
    return this.rightTab === 2 ? 17 : 13;
  }

  private visibleLines(): number {
    return Math.floor(CONTENT_H / this.lineHeight());
  }

  private _lineCount = 0;

  private maxScroll(): number {
    return Math.max(0, this._lineCount - this.visibleLines());
  }

  private wrap(canvas: GameCanvas, text: string, maxWidth: number, fontSize: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (canvas.measureText({ text: candidate, fontSize }).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // ---- drawing ----------------------------------------------------------

  draw(canvas: GameCanvas, camera: CameraInterface, _lag: number, _ms: number, _t: number) {
    if (this.isHidden || !this.bg?.width) return;
    if (canvas) this.canvas = canvas;

    UIDevTools.track(
      'monsterBookWindow', this.x, this.y, W, H, 'screen',
      'UI.wz/UIWindow.img/MonsterBook'
    );

    canvas.drawImage({ img: this.bg, dx: this.x, dy: this.y });

    this.drawBookmarks(canvas);
    if (this.leftView === 'info') this.drawSummary(canvas);
    else this.drawCardPanel(canvas);
    this.drawRightPage(canvas);

    const mx = canvas.mouseX;
    const my = canvas.mouseY;
    const closeImg = this.hit(mx, my, CLOSE_X, CLOSE_Y, 18, 16)
      ? this.btClose?.mouseOver ?? this.btClose?.normal
      : this.btClose?.normal;
    if (closeImg?.width) {
      canvas.drawImage({ img: closeImg, dx: this.x + CLOSE_X, dy: this.y + CLOSE_Y });
    }

    if (this.contextCard) this.drawContextMenu(canvas);
  }

  private drawBookmarks(canvas: GameCanvas) {
    const mx = canvas.mouseX;
    const my = canvas.mouseY;

    const infoImg = this.leftView === 'info' ? this.infoTab.selected : this.infoTab.normal;
    if (infoImg?.width) {
      canvas.drawImage({ img: infoImg, dx: this.x + TAB_X, dy: this.y + INFO_TAB_Y });
    }

    // 400ms per frame, straight off the WZ delay on the new_n/new_s canvases
    const blinkFrame = Math.floor(this.blink / 400) % 2;

    for (let i = 0; i < TAB_COUNT; i++) {
      const t = this.leftTabs[i];
      if (!t) continue;
      const isActive = this.leftView === i;
      const isNew = this.book?.unseenTabs.has(i) ?? false;
      const hover = this.hit(mx, my, TAB_X, TAB_TOP + i * TAB_PITCH, TAB_HIT_W, TAB_HIT_H);

      let img: HTMLImageElement | null;
      if (isNew) {
        const frames = isActive ? t.newSelected : t.newNormal;
        img = frames[blinkFrame] ?? frames[0] ?? (isActive ? t.selected : t.normal);
      } else if (isActive) {
        img = t.selected;
      } else {
        img = hover ? t.mouseOver ?? t.normal : t.normal;
      }
      if (img?.width) {
        canvas.drawImage({ img, dx: this.x + TAB_X, dy: this.y + TAB_TOP + i * TAB_PITCH });
      }
    }
  }

  private drawCardPanel(canvas: GameCanvas) {
    if (this.cardSlot?.width) {
      canvas.drawImage({ img: this.cardSlot, dx: this.x + SLOT_X, dy: this.y + SLOT_Y });
    }

    const tab = this.leftView as number;
    const cards = this.pageCards();
    const mx = canvas.mouseX;
    const my = canvas.mouseY;

    for (let slot = 0; slot < CARDS_PER_PAGE; slot++) {
      const card = cards[slot];
      if (!card) continue;
      const r = this.cellRect(slot);
      const copies = this.book?.copiesOf(card.id) ?? 0;
      if (copies <= 0) continue;

      const icon = getCardIcon(card.id);
      if (icon?.width) {
        canvas.drawImage({ img: icon, dx: r.x, dy: r.y, dw: CELL_W, dh: CELL_H });
      }

      // fullMark once all five copies are in, otherwise the running count in
      // the inventory's own quantity digits
      if (copies >= MAX_COPIES) {
        if (this.fullMark?.width) {
          canvas.drawImage({ img: this.fullMark, dx: r.x + CELL_W - 7, dy: r.y + CELL_H - 11 });
        }
      } else {
        this.drawDigits(canvas, copies, r.x + CELL_W - 3, r.y + CELL_H - 13);
      }

      // The blue frame marks the registered book cover, the orange one the
      // selection. Both are 31x42 around a 27x38 hole, anchored bottom-left
      // via their WZ origin (2,40).
      if (this.book?.cover === card.id) this.drawFrame(canvas, this.coverFrame, r.x, r.y);
      if (this.selected === card.id) this.drawFrame(canvas, this.selectFrame, r.x, r.y);
      else if (
        mx >= r.x && mx < r.x + r.width && my >= r.y && my < r.y + r.height &&
        this.book?.cover !== card.id
      ) {
        this.drawFrame(canvas, this.coverFrame, r.x, r.y);
      }
    }

    // The magnifier sits in the gap the cardSlot art leaves to the right of
    // its baked search field
    const searchHover = this.hit(mx, my, BTSEARCH_X, BTSEARCH_Y, 34, 17);
    const searchImg = searchHover
      ? this.btSearch?.mouseOver ?? this.btSearch?.normal
      : this.btSearch?.normal;
    if (searchImg?.width) {
      canvas.drawImage({ img: searchImg, dx: this.x + BTSEARCH_X, dy: this.y + BTSEARCH_Y });
    }

    const pages = pageCount(tab);
    const held = this.book?.countInTab(tab) ?? 0;
    const total = getCardsForTab(tab).length;

    canvas.drawText({
      text: TAB_LABELS[tab],
      x: this.x + LABEL_X, y: this.y + FOOTER_TEXT_Y,
      color: COLOR_LABEL, fontSize: FOOTER_FONT,
    });

    const leftEnabled = this.page > 0;
    const rightEnabled = this.page < pages - 1;
    const lArrow = leftEnabled ? this.arrowLeft?.normal : this.arrowLeft?.disabled ?? this.arrowLeft?.normal;
    const rArrow = rightEnabled ? this.arrowRight?.normal : this.arrowRight?.disabled ?? this.arrowRight?.normal;
    if (lArrow?.width) canvas.drawImage({ img: lArrow, dx: this.x + ARROW_L_X, dy: this.y + ARROW_Y });
    if (rArrow?.width) canvas.drawImage({ img: rArrow, dx: this.x + ARROW_R_X, dy: this.y + ARROW_Y });

    canvas.drawText({
      text: `${this.page + 1} / ${pages}`,
      x: this.x + PAGE_TEXT_X, y: this.y + FOOTER_TEXT_Y,
      color: COLOR_VALUE, fontSize: FOOTER_FONT, align: 'center',
    });
    canvas.drawText({
      text: `${held} / ${total}`,
      x: this.x + COUNT_X, y: this.y + FOOTER_TEXT_Y,
      color: COLOR_LABEL, fontSize: FOOTER_FONT, align: 'right',
    });
  }

  private drawFrame(canvas: GameCanvas, frame: any, cellX: number, cellY: number) {
    const img = frame?.nGetImage?.();
    if (!img?.width) return;
    const ox = frame.origin?.nX ?? 2;
    const oy = frame.origin?.nY ?? 40;
    // Anchor is the cell's bottom-left corner: pos = anchor - origin
    canvas.drawImage({ img, dx: cellX - ox, dy: cellY + CELL_H - oy });
  }

  /** Right-aligned WZ quantity digits, ending at `rightX`. */
  private drawDigits(canvas: GameCanvas, value: number, rightX: number, y: number) {
    const text = String(value);
    let width = 0;
    for (const ch of text) width += this.digits[Number(ch)]?.width ?? 0;
    let x = rightX - width;
    for (const ch of text) {
      const img = this.digits[Number(ch)];
      if (img?.width) {
        canvas.drawImage({ img, dx: x, dy: y });
        x += img.width;
      }
    }
  }

  private drawSummary(canvas: GameCanvas) {
    if (this.infoPage?.width) {
      canvas.drawImage({ img: this.infoPage, dx: this.x + INFO_X, dy: this.y + INFO_Y });
    }
    const book = this.book;
    const level = book?.level ?? 1;

    canvas.drawText({
      text: String(level),
      x: this.x + INFO_LEVEL_VALUE_X, y: this.y + INFO_LEVEL_Y,
      color: COLOR_VALUE, fontSize: 12, fontWeight: 'bold',
    });

    // The eight book covers are the eight book levels — icon 0 is level 1
    const cover = this.bookIcons[Math.max(0, Math.min(7, level - 1))];
    if (cover?.width) {
      canvas.drawImage({ img: cover, dx: this.x + INFO_X + 40, dy: this.y + INFO_Y + 20 });
    }

    const rows: [number, string][] = [
      [INFO_TOTAL_Y, String(book?.totalCards ?? 0)],
      [INFO_SPECIAL_Y, String(book?.specialCards ?? 0)],
      [INFO_BASIC_Y, String(book?.basicCards ?? 0)],
    ];
    for (const [ry, text] of rows) {
      canvas.drawText({
        text, x: this.x + INFO_VALUE_X, y: this.y + ry, color: COLOR_VALUE, fontSize: 11,
      });
    }

    const coverCard = book?.cover ?? 0;
    if (coverCard) {
      const icon = getCardIcon(coverCard);
      if (icon?.width) {
        canvas.drawImage({
          img: icon,
          dx: this.x + INFO_COVER_X, dy: this.y + INFO_COVER_Y,
          dw: CELL_W, dh: CELL_H,
        });
      }
      const card = getCardsForTab(tabOf(coverCard)).find((c) => c.id === coverCard);
      if (card) {
        canvas.drawText({
          text: getMobName(card.mob),
          x: this.x + INFO_COVER_X + 36, y: this.y + INFO_COVER_Y + 14,
          color: COLOR_VALUE, fontSize: 11,
        });
      }
    } else {
      canvas.drawText({
        text: '-',
        x: this.x + INFO_COVER_X, y: this.y + INFO_COVER_Y + 14,
        color: COLOR_UNKNOWN, fontSize: 11,
      });
    }

    // Kept short deliberately: at 10px the long form measures 201px against a
    // 174px page and ran off into the gutter
    canvas.drawText({
      text: 'Right-click a card to set the cover.',
      x: this.x + SLOT_X + 2, y: this.y + INFO_Y + 176,
      color: COLOR_LABEL, fontSize: 10,
    });
  }

  private drawRightPage(canvas: GameCanvas) {
    // With no card picked the right page stays bare. The tabs label a card's
    // sections, so without one there is nothing for them to open — the WZ's
    // `disabled` frame is for a section this card hasn't revealed yet, not for
    // "no card", and four greyed tabs floating on an empty page read as a
    // rendering fault.
    if (!this.selected) return;
    const card = getCardsForTab(tabOf(this.selected)).find((c) => c.id === this.selected);
    if (!card) return;

    const mx = canvas.mouseX;
    const my = canvas.mouseY;

    // The active tab goes last: its art is 11px wider than the rest and
    // overhangs its slot, so drawn in order it would be clipped by whichever
    // tab follows it.
    const order = RIGHT_TABS.map((_, i) => i)
      .filter((i) => i !== this.rightTab)
      .concat(this.rightTab);
    for (const i of order) {
      const s = this.rightTabs[i];
      if (!s) continue;
      const enabled = this.isRightTabEnabled(i);
      const active = enabled && this.rightTab === i;
      const hover = this.hit(mx, my, RTAB_X0 + i * RTAB_SLOT_W, RTAB_Y, RTAB_SLOT_W, RTAB_H);
      const img = !enabled
        ? s.disabled ?? s.normal
        : active
          ? s.selected ?? s.normal
          : hover
            ? s.mouseOver ?? s.normal
            : s.normal;
      if (!img?.width) continue;
      const slotX = RTAB_X0 + i * RTAB_SLOT_W + Math.round((RTAB_SLOT_W - img.width) / 2);
      canvas.drawImage({ img, dx: this.x + slotX, dy: this.y + RTAB_Y });
    }

    const info = getMobInfo(card.mob);
    const copies = this.book?.copiesOf(this.selected) ?? 0;

    // Portrait: the card's own face at 2x. The monster's animated sprite lives
    // in Mob.wz, which averages 620KB an entry and peaks at 31MB — pulling one
    // in per selection would stall the frame the click landed on.
    const icon = getCardIcon(this.selected);
    if (icon?.width) {
      const pw = CELL_W * PORTRAIT_SCALE;
      const ph = CELL_H * PORTRAIT_SCALE;
      canvas.drawImage({
        img: icon,
        dx: this.x + RP_CX - pw / 2, dy: this.y + PORTRAIT_Y,
        dw: pw, dh: ph,
      });
    }

    canvas.drawText({
      text: getMobName(card.mob),
      x: this.x + RP_CX, y: this.y + NAME_Y,
      color: COLOR_VALUE, fontSize: 13, fontWeight: 'bold', align: 'center',
    });
    canvas.drawText({
      text: `${copies} / ${MAX_COPIES} cards`,
      x: this.x + RP_CX, y: this.y + SUB_Y,
      color: COLOR_LABEL, fontSize: 10, align: 'center',
    });

    if (this.rightTab === 0) {
      this.drawBasicInfo(canvas, info, copies);
      return;
    }

    const lines = this.contentLines(canvas);
    this._lineCount = lines.length;
    if (this.scroll > this.maxScroll()) this.scroll = this.maxScroll();

    const lh = this.lineHeight();
    const visible = this.visibleLines();
    for (let i = 0; i < visible; i++) {
      const line = lines[this.scroll + i];
      if (!line) break;
      const ly = this.y + CONTENT_Y + i * lh;
      if (line.kind === 'item' && line.id !== undefined) {
        const iconImg = getRewardIcon(line.id);
        if (iconImg?.width) {
          canvas.drawImage({
            img: iconImg,
            dx: this.x + CONTENT_X, dy: ly,
            dw: 16, dh: 16,
          });
        }
        canvas.drawText({
          text: line.text,
          x: this.x + CONTENT_X + 20, y: ly + 3,
          color: COLOR_VALUE, fontSize: 11,
        });
      } else {
        canvas.drawText({
          text: line.text,
          x: this.x + CONTENT_X, y: ly,
          color: COLOR_VALUE, fontSize: 11,
        });
      }
    }

    if (this.maxScroll() > 0) {
      canvas.drawText({
        text: `${this.scroll + 1}-${Math.min(lines.length, this.scroll + visible)} / ${lines.length}`,
        x: this.x + CONTENT_X + CONTENT_W, y: this.y + CONTENT_Y + CONTENT_H + 2,
        color: COLOR_LABEL, fontSize: 10, align: 'right',
      });
    }
  }

  private drawBasicInfo(canvas: GameCanvas, info: any, copies: number) {
    // A card reveals itself a copy at a time: the level comes with the first,
    // HP/MP with the second, the rest of the block with the third.
    const hidden = '?';
    const rows: [string, string][] = [
      ['LEVEL', String(info.lv || hidden)],
      ['FORM', copies >= NEED_STATS ? info.form || '-' : hidden],
      ['HP', copies >= NEED_HPMP ? String(info.hp) : hidden],
      ['MP', copies >= NEED_HPMP ? String(info.mp) : hidden],
      ['EXP', copies >= NEED_STATS ? String(info.exp) : hidden],
      ['ATTACK', copies >= NEED_STATS ? String(info.pad) : hidden],
      ['DEFENSE', copies >= NEED_STATS ? String(info.pdd) : hidden],
      ['MAGIC ATTACK', copies >= NEED_STATS ? String(info.mad) : hidden],
      ['MAGIC DEFENSE', copies >= NEED_STATS ? String(info.mdd) : hidden],
      ['ACCURACY', copies >= NEED_STATS ? String(info.acc) : hidden],
      ['AVOIDABILITY', copies >= NEED_STATS ? String(info.eva) : hidden],
    ];

    let ly = this.y + CONTENT_Y;
    for (const [label, value] of rows) {
      canvas.drawText({
        text: label, x: this.x + CONTENT_X, y: ly, color: COLOR_LABEL, fontSize: 11,
      });
      canvas.drawText({
        text: value,
        x: this.x + CONTENT_X + CONTENT_W, y: ly,
        color: value === hidden ? COLOR_UNKNOWN : COLOR_VALUE,
        fontSize: 11, align: 'right',
      });
      ly += 12;
    }

    if (info.boss) {
      canvas.drawText({
        text: 'BOSS',
        x: this.x + CONTENT_X, y: ly, color: '#a02020', fontSize: 11, fontWeight: 'bold',
      });
    }
  }

  private drawContextMenu(canvas: GameCanvas) {
    const isCover = this.book?.cover === this.contextCard;
    const button = isCover ? this.ctx?.release : this.ctx?.register;
    const t = this.ctx?.t;
    const s = this.ctx?.s;
    if (t?.width) canvas.drawImage({ img: t, dx: this.contextX, dy: this.contextY });
    if (s?.width) canvas.drawImage({ img: s, dx: this.contextX + 1, dy: this.contextY + 19 });

    const r = this.contextButtonRect();
    const hover =
      canvas.mouseX >= r.x && canvas.mouseX < r.x + r.width &&
      canvas.mouseY >= r.y && canvas.mouseY < r.y + r.height;
    const img = hover ? button?.mouseOver ?? button?.normal : button?.normal;
    if (img?.width) canvas.drawImage({ img, dx: r.x, dy: r.y });
  }
}

export default MonsterBookMenuSprite;
