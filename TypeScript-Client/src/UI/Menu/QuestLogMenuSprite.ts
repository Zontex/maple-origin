import WZManager from '../../wz-utils/WZManager';
import ClickManager from '../ClickManager';
import { MapleStanceButton } from '../MapleStanceButton';
import DragableMenu from './DragableMenu';
import { CameraInterface } from '../../Camera';
import { Position } from '../../Effects/DamageIndicator';
import GameCanvas from '../../GameCanvas';
import QuestData, { mobNames, resolveItemCodes, getItemNameSync, ensureMapNames } from '../../Quest/QuestData';
import type MapleCharacter from '../../MapleCharacter';
import { drawSelectionBar } from '../UISelectionBar';

enum QuestTab {
  AVAILABLE = 0,
  IN_PROGRESS = 1,
  COMPLETED = 2,
}

// Layout constants from WZ asset dimensions
const LEFT_W = 245;
const RIGHT_W = 305;
const TOTAL_W = LEFT_W + RIGHT_W;
const TOTAL_H = 396;

const TAB_X = 7;
const TAB_Y = 22;
const LIST_X = 12;
const LIST_Y = 42;
const LIST_W = LEFT_W - 24;
const ENTRY_H = 18;
const MAX_VISIBLE = 18;
const DETAIL_PAD = 14;

// VScr4 scrollbar piece sizes
const SB_ARROW_H = 13;
const SB_THUMB_H = 25;
const SB_W = 15;

// Detail panel text area
const BLUE_AREA_H = 120;
const DETAIL_LINE_H = 14;
const DETAIL_MAX_LINES = 14;

// Area ID to region name mapping (from WZ data)
const AREA_NAMES: Record<number, string> = {
  0: 'Maple Island',
  1: 'Victoria Island',
  2: 'El Nath Mts.',
  3: 'Ludus Lake',
  4: 'Underwater',
  5: 'Mu Lung Garden',
  6: 'Nihal Desert',
  7: 'Temple of Time',
  8: 'Masteria',
  9: 'Amoria',
  10: 'Happyville',
  11: 'Mushroom Shrine',
  12: 'Showa Town',
  13: 'Singapore',
  14: 'Malaysia',
  15: 'Ellin Forest',
  16: 'Korean Folk Town',
  17: 'Nautilus',
  18: 'Ereve',
  19: 'Rien',
  100: 'Party Quest',
  200: 'Etc',
};

interface CategoryEntry {
  type: 'category';
  name: string;
  count: number;
  collapsed: boolean;
}

interface QuestEntry {
  type: 'quest';
  questId: number;
  category: string;
}

type ListEntry = CategoryEntry | QuestEntry;

class QuestLogMenuSprite extends DragableMenu {
  opts: any;
  charecter: MapleCharacter | null = null;
  currentTab: QuestTab = QuestTab.IN_PROGRESS;
  isNotFirstDraw: boolean = false;
  destroyed: boolean = false;
  delay: number = 0;
  id: number = 0;
  originalX: number = 0;
  originalY: number = 0;

  // WZ images
  private questUINode: any = null;
  private bgLeft: any = null;
  private bgRight: any = null;
  private rowIcons: any[] = [];
  private summaryLbl: any = null;
  private tabLblEnabled: any[] = [];
  private tabLblDisabled: any[] = [];
  /** Basic.img/CheckBox 0 (empty) / 1 (red check) — category fold toggles */
  private checkBoxOff: HTMLImageElement | null = null;
  private checkBoxOn: HTMLImageElement | null = null;
  private buttons: MapleStanceButton[] = [];

  // Progress gauge
  private gaugeFrame: any = null;  // Gauge/frame 163x14
  private gaugeBar: any = null;    // Gauge/gauge 1x11 (tile to fill)

  // Scrollbar (VScr4 enabled + disabled pieces)
  private scrollPrev: any = null;
  private scrollNext: any = null;
  private scrollThumb: any = null;
  private scrollBase: any = null;
  private scrollPrevDis: any = null;
  private scrollNextDis: any = null;

  // Scrollbar runtime geometry + thumb dragging
  private scrollbars: Record<string, {
    x: number; topY: number; bottomY: number; max: number;
    thumbRect: { x: number; y: number; w: number; h: number } | null;
  }> = {};
  private draggingThumb: string | null = null;
  private dragStartY: number = 0;
  private dragStartOffset: number = 0;

  // Detail (right panel) text scrolling
  private detailScrollOffset: number = 0;

  // NPC sprite cache for detail panel
  private cachedNpcId: number = -1;
  private cachedNpcSprite: any = null;
  private npcSpriteLoading: boolean = false;

  // State
  private questList: number[] = [];
  private displayList: ListEntry[] = [];
  private collapsedCategories: Set<string> = new Set();
  private selectedQuestId: number = -1;
  private scrollOffset: number = 0;
  private lastClickTime: number = 0;

  static async fromOpts(opts: any) {
    const object = new QuestLogMenuSprite(opts);
    await object.load();
    return object;
  }

  constructor(opts: any) {
    super(opts);
    this.opts = opts;
  }

  async load() {
    ensureMapNames();
    const opts = this.opts;
    this.id = opts.id;
    this.charecter = opts.charecter;
    this.x = opts.x;
    this.y = opts.y;
    this.originalX = opts.x;
    this.originalY = opts.y;
    this.isHidden = opts.isHidden;

    try {
      this.questUINode = await WZManager.get('UI.wz/UIWindow.img/Quest');
      this.bgLeft = this.questUINode?.backgrnd?.nGetImage?.() || null;
      this.bgRight = this.questUINode?.backgrnd2?.nGetImage?.() || null;

      // Tab text labels from Quest/Tab — v83 tabs are label sprites only,
      // drawn straight on the backgrnd header strip (no pill backgrounds)
      for (let i = 0; i < 3; i++) {
        this.tabLblEnabled[i] = this.questUINode?.Tab?.enabled?.[i]?.nGetImage?.() || null;
        this.tabLblDisabled[i] = this.questUINode?.Tab?.disabled?.[i]?.nGetImage?.() || null;
      }
      // Quest row icons (available / in progress / completed)
      this.rowIcons = [
        this.questUINode?.icon0?.nGetImage?.() || null,
        this.questUINode?.icon1?.nGetImage?.() || null,
        this.questUINode?.icon4?.nGetImage?.() || null,
      ];
      this.summaryLbl = this.questUINode?.summary?.nGetImage?.() || null;

      // Progress gauge
      const gauge = this.questUINode?.Gauge;
      if (gauge) {
        this.gaugeFrame = gauge.frame?.nGetImage?.() || null;
        this.gaugeBar = gauge.gauge?.nGetImage?.() || null;
      }

      // Scrollbar (VScr4)
      const basicNode = await WZManager.get('UI.wz/Basic.img');
      this.checkBoxOff = (basicNode as any)?.CheckBox?.nGet?.('0')?.nGetImage?.() || null;
      this.checkBoxOn = (basicNode as any)?.CheckBox?.nGet?.('1')?.nGetImage?.() || null;
      const vscr = (basicNode as any)?.VScr4;
      if (vscr?.enabled) {
        this.scrollPrev = vscr.enabled.prev0?.nGetImage?.() || null;
        this.scrollNext = vscr.enabled.next0?.nGetImage?.() || null;
        this.scrollThumb = vscr.enabled.thumb0?.nGetImage?.() || null;
        this.scrollBase = vscr.enabled.base?.nGetImage?.() || null;
      }
      if (vscr?.disabled) {
        this.scrollPrevDis = vscr.disabled.prev?.nGetImage?.() || null;
        this.scrollNextDis = vscr.disabled.next?.nGetImage?.() || null;
      }
    } catch (e) {
      console.error('Error loading quest UI:', e);
    }

    ClickManager.addDragableMenu(this);
  }

  getRect(camera: CameraInterface) {
    const w = this.selectedQuestId >= 0 ? TOTAL_W : LEFT_W;
    return { x: this.x, y: this.y, width: w, height: TOTAL_H };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
    this.buttons.forEach(btn => btn.isHidden = isHidden);
    if (isHidden && this.draggingThumb) {
      this.draggingThumb = null;
      ClickManager.isDraggingItem = false;
    }
    if (!isHidden) this.refreshQuestList();
  }

  private getCategoryName(questId: number): string | null {
    const info = QuestData.quests.get(questId);
    if (info?.parent) return info.parent;
    // Use area name if available, otherwise no category
    if (info?.area !== undefined && info.area > 0 && AREA_NAMES[info.area]) return AREA_NAMES[info.area];
    return null;
  }

  private buildDisplayList() {
    // Group quests by category - quests without category show directly
    const categories = new Map<string, number[]>();
    const uncategorized: number[] = [];
    for (const qid of this.questList) {
      const cat = this.getCategoryName(qid);
      if (cat) {
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat)!.push(qid);
      } else {
        uncategorized.push(qid);
      }
    }

    this.displayList = [];
    for (const [catName, quests] of categories) {
      const collapsed = this.collapsedCategories.has(catName);
      this.displayList.push({
        type: 'category',
        name: catName,
        count: quests.length,
        collapsed,
      });
      if (!collapsed) {
        for (const qid of quests) {
          this.displayList.push({ type: 'quest', questId: qid, category: catName });
        }
      }
    }
    // Uncategorized quests listed directly
    for (const qid of uncategorized) {
      this.displayList.push({ type: 'quest', questId: qid, category: '' });
    }
  }

  private refreshQuestList() {
    const qm = this.charecter?.questManager;
    if (!qm) { this.questList = []; this.displayList = []; return; }

    switch (this.currentTab) {
      case QuestTab.AVAILABLE: {
        this.questList = [];
        const level = this.charecter?.stats?.level || 1;
        for (const [questId] of QuestData.quests) {
          if (qm.canStartQuest(questId)) {
            const questInfo = QuestData.quests.get(questId);
            // Filter out non-Latin quest names (Korean, Chinese, etc.)
            if (questInfo?.name && /[^\x00-\xFF]/.test(questInfo.name)) continue;
            const reqs = QuestData.requirements.get(questId);
            const minLv = reqs?.start?.lvmin || 0;
            // Only show quests within player's level range
            if (minLv <= level) this.questList.push(questId);
          }
          if (this.questList.length >= 200) break;
        }
        break;
      }
      case QuestTab.IN_PROGRESS:
        this.questList = Array.from(qm.activeQuests.keys());
        break;
      case QuestTab.COMPLETED:
        this.questList = Array.from(qm.completedQuests.keys());
        break;
    }

    this.buildDisplayList();

    // Select first quest if any
    this.selectedQuestId = -1;
    for (const entry of this.displayList) {
      if (entry.type === 'quest') {
        this.selectedQuestId = entry.questId;
        break;
      }
    }
    this.scrollOffset = 0;
    this.detailScrollOffset = 0;
    this.cachedNpcId = -1;
    this.cachedNpcSprite = null;
  }

  private async loadNpcSprite(npcId: number) {
    if (this.npcSpriteLoading || npcId === this.cachedNpcId) return;
    this.npcSpriteLoading = true;
    this.cachedNpcId = npcId;
    this.cachedNpcSprite = null;

    try {
      const strId = `${npcId}`.padStart(7, '0');
      let npcFile: any = await WZManager.get(`Npc.wz/${strId}.img`);
      if (npcFile?.info?.link) {
        const linkId = npcFile.info.link.nValue;
        npcFile = await WZManager.get(`Npc.wz/${`${linkId}`.padStart(7, '0')}.img`);
      }
      this.cachedNpcSprite = npcFile?.stand?.[0]?.nGetImage?.() || null;
    } catch (e) {
      // Ignore NPC sprite load failures
    }
    this.npcSpriteLoading = false;
  }

  private rebuildButtons(canvas: GameCanvas) {
    this.buttons.forEach(btn => ClickManager.removeButton(btn));
    this.buttons = [];

    // Only show buttons when right panel is visible (quest selected)
    if (this.selectedQuestId < 0) return;

    // FORFEIT button (In Progress tab only)
    if (this.currentTab === QuestTab.IN_PROGRESS && this.questUINode?.BtGiveup) {
      const btn = new MapleStanceButton(canvas, {
        x: this.x + LEFT_W + RIGHT_W - 65,
        y: this.y + TOTAL_H - 25,
        img: this.questUINode.BtGiveup.nChildren,
        isRelativeToCamera: true,
        isPartOfUI: true,
        onClick: () => {
          if (this.selectedQuestId >= 0) {
            this.charecter?.questManager?.forfeitQuest(this.selectedQuestId);
            // The quest is gone from the list, so the detail panel closes —
            // clear the selection and rebuild so FORFEIT/QUEST HELPER vanish
            // with it instead of floating over the map
            this.selectedQuestId = -1;
            this.refreshQuestList();
            this.rebuildButtons(canvas);
          }
        },
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }

    // QUEST HELPER button (BtAlert — shown on all tabs when quest selected)
    if (this.questUINode?.BtAlert) {
      const btn = new MapleStanceButton(canvas, {
        x: this.x + LEFT_W + RIGHT_W - 155,
        y: this.y + TOTAL_H - 25,
        img: this.questUINode.BtAlert.nChildren,
        isRelativeToCamera: true,
        isPartOfUI: true,
        onClick: () => {
          // Toggle tracking of the selected quest in the QuestAlarm widget
          const qm = this.charecter?.questManager;
          if (!qm || this.selectedQuestId < 0) return;
          if (qm.isTracked(this.selectedQuestId)) {
            qm.untrackQuest(this.selectedQuestId);
          } else {
            qm.trackQuest(this.selectedQuestId);
          }
        },
      });
      this.buttons.push(btn);
      ClickManager.addButton(btn);
    }
  }

  moveTo(position: Position) {
    const dx = position.x - this.originalX;
    const dy = position.y - this.originalY;
    this.x = position.x;
    this.y = position.y;
    this.buttons.forEach(btn => { btn.x += dx; btn.y += dy; });
    this.originalX = position.x;
    this.originalY = position.y;
  }

  destroy() {
    this.destroyed = true;
    // Unregister from ClickManager — a destroyed menu's buttons otherwise
    // stay clickable (and drawable) as ghosts after re-initialization
    this.buttons.forEach(btn => ClickManager.removeButton(btn));
    this.buttons = [];
  }

  update(msPerTick: number) {
    if (this.isHidden) return;
    this.delay += msPerTick;
  }

  draw(canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) {
    if (this.isHidden) return;

    if (!this.isNotFirstDraw) {
      this.refreshQuestList();
      this.rebuildButtons(canvas);
      this.isNotFirstDraw = true;
    }

    // Left panel background
    if (this.bgLeft) {
      canvas.drawImage({ img: this.bgLeft, dx: this.x, dy: this.y });
    }

    // Tabs
    this.drawTabs(canvas);

    // Quest list (left panel)
    this.drawQuestList(canvas);

    // Left panel scrollbar
    this.drawScrollbar(canvas, 'list', this.x + LEFT_W - 18, this.y + LIST_Y, this.y + TOTAL_H - 10,
      this.scrollOffset, this.displayList.length, MAX_VISIBLE);

    // Right panel + detail only when a quest is selected
    if (this.selectedQuestId >= 0) {
      if (this.bgRight) {
        canvas.drawImage({ img: this.bgRight, dx: this.x + LEFT_W, dy: this.y });
      }
      const detailLines = this.drawQuestDetail(canvas);

      // Right panel scrollbar (scrolls the description text)
      this.drawScrollbar(canvas, 'detail', this.x + LEFT_W + RIGHT_W - 18, this.y + 10, this.y + TOTAL_H - 35,
        this.detailScrollOffset, detailLines, DETAIL_MAX_LINES);
    } else {
      delete this.scrollbars['detail'];
    }

    // Buttons
    this.buttons.forEach(btn => btn.draw(canvas, camera, lag, msPerTick, tdelta));

    // Mouse wheel + scrollbar thumb dragging
    this.handleScrollInput(canvas);

    // Click handling
    if ((canvas as any).clicked && !this.draggingThumb) {
      this.handleClick((canvas as any).mouseX || 0, (canvas as any).mouseY || 0, canvas);
    }
  }

  private listMaxOffset() {
    return Math.max(0, this.displayList.length - MAX_VISIBLE);
  }

  private handleScrollInput(canvas: GameCanvas) {
    const c = canvas as any;
    const mx = c.mouseX || 0;
    const my = c.mouseY || 0;

    // Mouse wheel — scroll whichever panel the cursor is over
    if (c.scrolledUp || c.scrolledDown) {
      const dir = c.scrolledDown ? 1 : -1;
      const inLeft = mx >= this.x && mx < this.x + LEFT_W && my >= this.y && my <= this.y + TOTAL_H;
      const inRight = this.selectedQuestId >= 0 &&
        mx >= this.x + LEFT_W && mx <= this.x + TOTAL_W && my >= this.y && my <= this.y + TOTAL_H;
      if (inLeft) {
        this.scrollOffset = Math.max(0, Math.min(this.listMaxOffset(), this.scrollOffset + dir));
      } else if (inRight) {
        const max = this.scrollbars['detail']?.max ?? 0;
        this.detailScrollOffset = Math.max(0, Math.min(max, this.detailScrollOffset + dir));
      }
    }

    // Thumb dragging
    if (this.draggingThumb) {
      const sb = this.scrollbars[this.draggingThumb];
      if (!c.clicked || !sb) {
        this.draggingThumb = null;
        ClickManager.isDraggingItem = false;
      } else {
        const usable = (sb.bottomY - sb.topY) - SB_ARROW_H * 2 - SB_THUMB_H;
        if (usable > 0 && sb.max > 0) {
          const delta = Math.round((my - this.dragStartY) / usable * sb.max);
          const next = Math.max(0, Math.min(sb.max, this.dragStartOffset + delta));
          if (this.draggingThumb === 'list') this.scrollOffset = next;
          else this.detailScrollOffset = next;
        }
      }
    } else if (c.clicked && !ClickManager.isDraggingItem) {
      for (const [id, sb] of Object.entries(this.scrollbars)) {
        const t = sb.thumbRect;
        if (t && mx >= t.x && mx <= t.x + t.w && my >= t.y && my <= t.y + t.h) {
          this.draggingThumb = id;
          this.dragStartY = my;
          this.dragStartOffset = id === 'list' ? this.scrollOffset : this.detailScrollOffset;
          ClickManager.isDraggingItem = true; // suppress window dragging while on the thumb
          break;
        }
      }
    }
  }

  private drawTabs(canvas: GameCanvas) {
    // v83 ships byte-identical Tab/enabled and Tab/disabled label sprites,
    // so the active tab is the full-strength label and inactive ones are dimmed
    let tx = this.x + TAB_X + 6;
    this._tabRects = [];
    for (let i = 0; i < 3; i++) {
      const active = i === this.currentTab;
      const lblImg = this.tabLblEnabled[i] || this.tabLblDisabled[i];
      if (!lblImg) continue;
      const ly = this.y + TAB_Y + 3;
      canvas.drawImage({ img: lblImg, dx: tx, dy: ly, alpha: active ? 1 : 0.4 });
      this._tabRects.push({ x: tx, y: ly, w: lblImg.width, h: lblImg.height, tab: i });
      tx += lblImg.width + 14;
    }
  }
  private _tabRects: { x: number; y: number; w: number; h: number; tab: number }[] = [];

  private drawQuestList(canvas: GameCanvas) {
    const lx = this.x + LIST_X;
    let ly = this.y + LIST_Y;
    const end = Math.min(this.scrollOffset + MAX_VISIBLE, this.displayList.length);

    for (let i = this.scrollOffset; i < end; i++) {
      const entry = this.displayList[i];

      if (entry.type === 'category') {
        // Category row: a faint band, then the fold toggle as Basic.img/CheckBox
        // (1 = red check while the group is open, 0 = empty box when folded)
        drawSelectionBar(canvas.context, lx - 2, ly, LIST_W, ENTRY_H, 0.12);
        const box = entry.collapsed ? this.checkBoxOff : this.checkBoxOn;
        if (box && box.width > 0) canvas.drawImage({ img: box, dx: lx, dy: ly + 2 });

        // Category name with count
        canvas.drawText({
          text: `${entry.name} (${entry.count})`,
          color: '#222244',
          x: lx + 16, y: ly + 3, fontSize: 11, fontWeight: 'bold',
        });

      } else {
        // Quest entry
        const questInfo = QuestData.quests.get(entry.questId);
        if (!questInfo) { ly += ENTRY_H; continue; }
        const selected = entry.questId === this.selectedQuestId;

        if (selected) {
          drawSelectionBar(canvas.context, lx - 2, ly, LIST_W, ENTRY_H);
        }

        // Quest status icon (icon0 available / icon1 in progress / icon4 done)
        const rowIcon = this.rowIcons[this.currentTab];
        if (rowIcon) {
          canvas.drawImage({ img: rowIcon, dx: lx, dy: ly + 1 });
        }

        let name = questInfo.name;
        if (name.length > 24) name = name.substring(0, 22) + '..';
        canvas.drawText({
          text: name,
          color: selected ? '#003388' : '#333333',
          x: lx + 16, y: ly + 3, fontSize: 11,
        });
      }

      ly += ENTRY_H;
    }

    if (this.questList.length === 0) {
      const msg = this.currentTab === QuestTab.AVAILABLE ? 'No available quests'
        : this.currentTab === QuestTab.IN_PROGRESS ? 'No active quests'
        : 'No completed quests';
      canvas.drawText({
        text: msg, color: '#888888',
        x: this.x + LEFT_W / 2, y: this.y + LIST_Y + 60,
        fontSize: 11, align: 'center',
      });
    }
  }

  private drawScrollbar(canvas: GameCanvas, id: string, sbX: number, sbTopY: number, sbBottomY: number,
    offset: number, totalItems: number, visibleItems: number) {
    const max = Math.max(0, totalItems - visibleItems);
    const scrollable = max > 0;

    // Track base tiled between the arrows
    if (this.scrollBase) {
      const baseH = this.scrollBase.height || 13;
      const ctx = canvas.context;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sbX, sbTopY + SB_ARROW_H, SB_W, sbBottomY - sbTopY - SB_ARROW_H * 2);
      ctx.clip();
      for (let by = sbTopY + SB_ARROW_H; by < sbBottomY - SB_ARROW_H; by += baseH) {
        canvas.drawImage({ img: this.scrollBase, dx: sbX, dy: by });
      }
      ctx.restore();
    }

    const prevImg = scrollable ? this.scrollPrev : (this.scrollPrevDis || this.scrollPrev);
    const nextImg = scrollable ? this.scrollNext : (this.scrollNextDis || this.scrollNext);
    if (prevImg) canvas.drawImage({ img: prevImg, dx: sbX, dy: sbTopY });
    if (nextImg) canvas.drawImage({ img: nextImg, dx: sbX, dy: sbBottomY - SB_ARROW_H });

    let thumbRect: { x: number; y: number; w: number; h: number } | null = null;
    if (this.scrollThumb && scrollable) {
      const trackH = sbBottomY - sbTopY - SB_ARROW_H * 2 - SB_THUMB_H;
      const thumbY = sbTopY + SB_ARROW_H + Math.round((offset / max) * Math.max(0, trackH));
      canvas.drawImage({ img: this.scrollThumb, dx: sbX, dy: thumbY });
      thumbRect = { x: sbX, y: thumbY, w: SB_W, h: SB_THUMB_H };
    }

    this.scrollbars[id] = { x: sbX, topY: sbTopY, bottomY: sbBottomY, max, thumbRect };
  }

  private drawQuestDetail(canvas: GameCanvas): number {
    if (this.selectedQuestId < 0) return 0;

    const questId = this.selectedQuestId;
    const questInfo = QuestData.quests.get(questId);
    if (!questInfo) return 0;

    const rx = this.x + LEFT_W;
    const reqs = QuestData.requirements.get(questId);

    // --- Blue header area (starts ~y+30 in bgRight) ---
    // The green dot is baked into bgRight — just draw the title next to it
    const blueY = this.y + 43;

    // Quest name (bold, positioned next to the baked-in green dot)
    canvas.drawText({
      text: questInfo.name.length > 20 ? questInfo.name.substring(0, 18) + '..' : questInfo.name,
      color: '#FFFFFF', fontWeight: 'bold',
      x: rx + DETAIL_PAD + 20, y: blueY,
      fontSize: 12,
    });

    // Level requirement
    if (reqs?.start?.lvmin) {
      canvas.drawText({
        text: `Over Level ${reqs.start.lvmin}`,
        color: '#DDDDEE',
        x: rx + DETAIL_PAD + 12, y: blueY + 20,
        fontSize: 10,
      });
    }

    // Progress gauge in blue header area
    if (this.gaugeFrame && this.currentTab === QuestTab.IN_PROGRESS) {
      const gaugeX = rx + DETAIL_PAD + 4;
      const gaugeY = blueY + 42;
      canvas.drawImage({ img: this.gaugeFrame, dx: gaugeX, dy: gaugeY });

      // Calculate progress
      if (this.gaugeBar) {
        const qm = this.charecter?.questManager;
        const progress = qm?.getMobProgress(questId);
        let ratio = 0;
        if (progress?.length) {
          let done = 0, total = 0;
          for (const p of progress) {
            done += Math.min(p.current, p.required);
            total += p.required;
          }
          if (total > 0) ratio = done / total;
        }
        // Fill gauge bar (gauge is 1px wide, tile it)
        const fillW = Math.round(ratio * 155); // 163 - some padding
        if (fillW > 0) {
          const ctx = canvas.context;
          ctx.save();
          ctx.beginPath();
          ctx.rect(gaugeX + 4, gaugeY + 2, fillW, 11);
          ctx.clip();
          for (let gx = 0; gx < fillW; gx++) {
            canvas.drawImage({ img: this.gaugeBar, dx: gaugeX + 4 + gx, dy: gaugeY + 2 });
          }
          ctx.restore();
        }
      }
    }

    // NPC sprite in top-right of blue header area
    const npcId = reqs?.start?.npc || reqs?.complete?.npc;
    if (npcId && npcId !== this.cachedNpcId) {
      this.loadNpcSprite(npcId);
    }
    if (this.cachedNpcSprite && this.cachedNpcSprite.complete && this.cachedNpcSprite.naturalWidth > 0) {
      const spriteImg = this.cachedNpcSprite;
      const spriteX = rx + RIGHT_W - spriteImg.width - 30;
      const spriteY = this.y + BLUE_AREA_H - spriteImg.height - 5;
      canvas.drawImage({ img: spriteImg, dx: spriteX, dy: spriteY });
    }

    // --- Description text below blue area ---
    let dy = this.y + BLUE_AREA_H + 10;
    const maxW = RIGHT_W - DETAIL_PAD * 2 - 20;

    // "Quest Summary" section label (WZ sprite), like the original client
    if (this.summaryLbl) {
      canvas.drawImage({ img: this.summaryLbl, dx: rx + DETAIL_PAD, dy });
      dy += this.summaryLbl.height + 6;
    }

    let description = '';
    if (this.currentTab === QuestTab.AVAILABLE) {
      description = questInfo.startText || 'Talk to the NPC to start this quest.';
    } else if (this.currentTab === QuestTab.IN_PROGRESS) {
      description = questInfo.inProgressText || 'Quest in progress.';
    } else {
      description = questInfo.completionText || 'Quest completed.';
    }
    const qmGlobal = (window as any).charecter?.questManager;
    description = resolveItemCodes(description, qmGlobal, this.selectedQuestId);
    // Replace inline ITEM markers with item names (icons not supported in text-only renderer)
    description = description.replace(/\x01ITEM:(\d+)\x02/g, (_, id) => getItemNameSync(parseInt(id)) || `Item #${id}`);

    // Build the full line list (word-wrapped description + progress), then
    // render the slice selected by the right-panel scrollbar
    const lines: { text: string; color: string }[] = [];
    let line = '';
    for (const word of description.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (test.length * 6.2 > maxW && line) {
        lines.push({ text: line, color: '#000000' });
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push({ text: line, color: '#000000' });

    // Mob and item progress for in-progress tab
    if (this.currentTab === QuestTab.IN_PROGRESS) {
      const qm = this.charecter?.questManager;
      const progress = qm?.getMobProgress(questId);
      const hasProgress = (progress?.length) || (reqs?.complete.items?.length);
      if (hasProgress) lines.push({ text: '', color: '#000000' });

      if (progress?.length) {
        for (const p of progress) {
          const done = p.current >= p.required;
          lines.push({
            text: `${mobNames.get(p.mobId) || `Mob #${p.mobId}`}: ${p.current}/${p.required}`,
            color: done ? '#00AA00' : '#CC0000',
          });
        }
      }

      if (reqs?.complete.items?.length) {
        for (const item of reqs.complete.items) {
          if (item.count <= 0) continue;
          const have = qm?.getItemCount(item.id) ?? 0;
          const done = have >= item.count;
          const name = getItemNameSync(item.id) || `Item #${item.id}`;
          lines.push({
            text: `${name}: ${have}/${item.count}`,
            color: done ? '#00AA00' : '#CC0000',
          });
        }
      }
    }

    this.detailScrollOffset = Math.max(0, Math.min(this.detailScrollOffset, lines.length - DETAIL_MAX_LINES));
    const end = Math.min(this.detailScrollOffset + DETAIL_MAX_LINES, lines.length);
    for (let i = this.detailScrollOffset; i < end; i++) {
      if (lines[i].text) {
        canvas.drawText({ text: lines[i].text, color: lines[i].color, x: rx + DETAIL_PAD, y: dy, fontSize: 11 });
      }
      dy += DETAIL_LINE_H;
    }

    return lines.length;
  }

  private handleClick(mx: number, my: number, canvas: GameCanvas) {
    if (this.isHidden) return;
    const now = Date.now();
    if (now - this.lastClickTime < 100) return;
    this.lastClickTime = now;

    // Tab clicks (label sprite rects, padded)
    for (const r of this._tabRects) {
      if (mx >= r.x - 4 && mx <= r.x + r.w + 4 && my >= r.y - 4 && my <= r.y + r.h + 4) {
        this.currentTab = r.tab as QuestTab;
        this.refreshQuestList();
        this.rebuildButtons(canvas);
        return;
      }
    }

    // Scrollbar arrow clicks (left list + right detail)
    for (const [id, sb] of Object.entries(this.scrollbars)) {
      if (mx < sb.x || mx > sb.x + SB_W) continue;
      let dir = 0;
      if (my >= sb.topY && my <= sb.topY + SB_ARROW_H) dir = -1;
      else if (my >= sb.bottomY - SB_ARROW_H && my <= sb.bottomY) dir = 1;
      if (!dir) continue;
      if (id === 'list') {
        this.scrollOffset = Math.max(0, Math.min(this.listMaxOffset(), this.scrollOffset + dir));
      } else {
        this.detailScrollOffset = Math.max(0, Math.min(sb.max, this.detailScrollOffset + dir));
      }
      return;
    }

    // Quest list clicks
    const lx = this.x + LIST_X;
    const ly = this.y + LIST_Y;
    if (mx >= lx && mx <= this.x + LEFT_W - 20 && my >= ly && my < ly + MAX_VISIBLE * ENTRY_H) {
      const visIdx = Math.floor((my - ly) / ENTRY_H);
      const idx = visIdx + this.scrollOffset;
      if (idx >= 0 && idx < this.displayList.length) {
        const entry = this.displayList[idx];
        if (entry.type === 'category') {
          // Toggle collapse/expand
          if (this.collapsedCategories.has(entry.name)) {
            this.collapsedCategories.delete(entry.name);
          } else {
            this.collapsedCategories.add(entry.name);
          }
          this.buildDisplayList();
        } else {
          this.selectedQuestId = entry.questId;
          this.detailScrollOffset = 0;
          this.cachedNpcId = -1;
          this.cachedNpcSprite = null;
          // Rebuild buttons since selection changed
          this.rebuildButtons(canvas);
        }
      }
    }
  }
}

export default QuestLogMenuSprite;
