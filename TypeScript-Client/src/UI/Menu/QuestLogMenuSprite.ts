import WZManager from '../../wz-utils/WZManager';
import ClickManager from '../ClickManager';
import { MapleStanceButton } from '../MapleStanceButton';
import DragableMenu from './DragableMenu';
import { CameraInterface } from '../../Camera';
import { Position } from '../../Effects/DamageIndicator';
import GameCanvas from '../../GameCanvas';
import QuestData, { mobNames, resolveItemCodes, getItemNameSync, ensureMapNames } from '../../Quest/QuestData';
import type MapleCharacter from '../../MapleCharacter';

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
  private tabBtnEnabled: any[] = [];
  private tabBtnDisabled: any[] = [];
  private tabLblEnabled: any[] = [];
  private tabLblDisabled: any[] = [];
  private buttons: MapleStanceButton[] = [];

  // Progress gauge
  private gaugeFrame: any = null;  // Gauge/frame 163x14
  private gaugeBar: any = null;    // Gauge/gauge 1x11 (tile to fill)

  // Scrollbar
  private scrollPrev: any = null;
  private scrollNext: any = null;
  private scrollThumb: any = null;

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

      // Tab button backgrounds from Item/New
      const itemNode: any = await WZManager.get('UI.wz/UIWindow.img/Item');
      for (let i = 0; i < 3; i++) {
        this.tabBtnEnabled[i] = itemNode?.New?.Tab1?.[i]?.nGetImage?.() || null;
        this.tabBtnDisabled[i] = itemNode?.New?.Tab0?.[i]?.nGetImage?.() || null;
      }
      // Tab text labels from Quest/Tab
      for (let i = 0; i < 3; i++) {
        this.tabLblEnabled[i] = this.questUINode?.Tab?.enabled?.[i]?.nGetImage?.() || null;
        this.tabLblDisabled[i] = this.questUINode?.Tab?.disabled?.[i]?.nGetImage?.() || null;
      }

      // Progress gauge
      const gauge = this.questUINode?.Gauge;
      if (gauge) {
        this.gaugeFrame = gauge.frame?.nGetImage?.() || null;
        this.gaugeBar = gauge.gauge?.nGetImage?.() || null;
      }

      // Scrollbar (VScr4)
      const basicNode = await WZManager.get('UI.wz/Basic.img');
      const vscr = (basicNode as any)?.VScr4;
      if (vscr?.enabled) {
        this.scrollPrev = vscr.enabled.prev0?.nGetImage?.() || null;
        this.scrollNext = vscr.enabled.next0?.nGetImage?.() || null;
        this.scrollThumb = vscr.enabled.thumb0?.nGetImage?.() || null;
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
            this.refreshQuestList();
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
          // Quest helper - not yet implemented
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

  destroy() { this.destroyed = true; }

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
    this.drawScrollbar(canvas, this.x + LEFT_W - 18, this.y + LIST_Y, this.y + TOTAL_H - 10,
      this.scrollOffset, this.displayList.length, MAX_VISIBLE);

    // Right panel + detail only when a quest is selected
    if (this.selectedQuestId >= 0) {
      if (this.bgRight) {
        canvas.drawImage({ img: this.bgRight, dx: this.x + LEFT_W, dy: this.y });
      }
      this.drawQuestDetail(canvas);

      // Right panel scrollbar
      this.drawScrollbar(canvas, this.x + LEFT_W + RIGHT_W - 18, this.y + 10, this.y + TOTAL_H - 35,
        0, 1, 1); // Static for now
    }

    // Buttons
    this.buttons.forEach(btn => btn.draw(canvas, camera, lag, msPerTick, tdelta));

    // Click handling
    if ((canvas as any).clicked) {
      this.handleClick((canvas as any).mouseX || 0, (canvas as any).mouseY || 0, canvas);
    }
  }

  private drawTabs(canvas: GameCanvas) {
    const tabW = Math.floor((LEFT_W - 14) / 3);
    for (let i = 0; i < 3; i++) {
      const tx = this.x + TAB_X + i * tabW;
      const active = i === this.currentTab;

      // Layer 1: Button background (stretched to fill)
      const btnImg = active ? this.tabBtnEnabled[i] : this.tabBtnDisabled[i];
      if (btnImg) {
        canvas.context.drawImage(btnImg, tx, this.y + TAB_Y, tabW - 2, btnImg.height);
      }

      // Layer 2: Text label sprite centered on button
      const lblImg = active ? this.tabLblEnabled[i] : this.tabLblDisabled[i];
      if (lblImg) {
        const lx = tx + Math.floor((tabW - 2 - lblImg.width) / 2);
        const ly = this.y + TAB_Y + Math.floor(((btnImg?.height || 16) - lblImg.height) / 2);
        canvas.drawImage({ img: lblImg, dx: lx, dy: ly });
      }
    }
  }

  private drawQuestList(canvas: GameCanvas) {
    const lx = this.x + LIST_X;
    let ly = this.y + LIST_Y;
    const end = Math.min(this.scrollOffset + MAX_VISIBLE, this.displayList.length);

    for (let i = this.scrollOffset; i < end; i++) {
      const entry = this.displayList[i];

      if (entry.type === 'category') {
        // Category header with collapse/expand icon
        // Blue square icon
        const ctx = canvas.context;
        ctx.save();
        ctx.fillStyle = '#5577AA';
        ctx.fillRect(lx, ly + 2, 12, 12);
        ctx.strokeStyle = '#334466';
        ctx.strokeRect(lx, ly + 2, 12, 12);
        // + or - sign
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 10px Arial';
        ctx.fillText(entry.collapsed ? '+' : '-', lx + 3, ly + 12);
        ctx.restore();

        // Category name with count
        canvas.drawText({
          text: `${entry.name} (${entry.count})`,
          color: '#222244',
          x: lx + 16, y: ly + 3, fontSize: 11, fontWeight: 'bold',
        });

        // Light blue background for category row
        const ctx2 = canvas.context;
        ctx2.save();
        ctx2.globalAlpha = 0.15;
        ctx2.fillStyle = '#6699CC';
        ctx2.fillRect(lx - 2, ly, LIST_W, ENTRY_H);
        ctx2.restore();

      } else {
        // Quest entry
        const questInfo = QuestData.quests.get(entry.questId);
        if (!questInfo) { ly += ENTRY_H; continue; }
        const selected = entry.questId === this.selectedQuestId;

        if (selected) {
          canvas.drawRect({
            x: lx - 2, y: ly,
            width: LIST_W, height: ENTRY_H,
            color: '#4477BB', alpha: 0.3,
          });
        }

        // Small quest status dot (like original game)
        const ctx = canvas.context;
        ctx.save();
        ctx.beginPath();
        ctx.arc(lx + 5, ly + 9, 3, 0, Math.PI * 2);
        if (this.currentTab === QuestTab.IN_PROGRESS) {
          ctx.fillStyle = '#8899BB'; // grey-blue for in-progress
        } else if (this.currentTab === QuestTab.COMPLETED) {
          ctx.fillStyle = '#88AA88'; // grey-green for complete
        } else {
          ctx.fillStyle = '#CCAA44'; // yellow for available
        }
        ctx.fill();
        ctx.strokeStyle = '#666688';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.restore();

        let name = questInfo.name;
        if (name.length > 24) name = name.substring(0, 22) + '..';
        canvas.drawText({
          text: name,
          color: selected ? '#003388' : '#333333',
          x: lx + 14, y: ly + 3, fontSize: 11,
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

  private drawScrollbar(canvas: GameCanvas, sbX: number, sbTopY: number, sbBottomY: number,
    offset: number, totalItems: number, visibleItems: number) {
    const arrowH = 13;

    if (this.scrollPrev) canvas.drawImage({ img: this.scrollPrev, dx: sbX, dy: sbTopY });
    if (this.scrollNext) canvas.drawImage({ img: this.scrollNext, dx: sbX, dy: sbBottomY - arrowH });

    if (this.scrollThumb && totalItems > visibleItems) {
      const trackH = sbBottomY - sbTopY - arrowH * 2 - (this.scrollThumb.height || 25);
      const ratio = offset / Math.max(1, totalItems - visibleItems);
      const thumbY = sbTopY + arrowH + Math.round(ratio * trackH);
      canvas.drawImage({ img: this.scrollThumb, dx: sbX, dy: thumbY });
    } else if (this.scrollThumb) {
      canvas.drawImage({ img: this.scrollThumb, dx: sbX, dy: sbTopY + arrowH });
    }
  }

  private drawQuestDetail(canvas: GameCanvas) {
    if (this.selectedQuestId < 0) return;

    const questId = this.selectedQuestId;
    const questInfo = QuestData.quests.get(questId);
    if (!questInfo) return;

    const rx = this.x + LEFT_W;
    const reqs = QuestData.requirements.get(questId);
    const BLUE_AREA_H = 120;

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
    const lineH = 14;

    let description = '';
    if (this.currentTab === QuestTab.AVAILABLE) {
      description = questInfo.startText || 'Talk to the NPC to start this quest.';
    } else if (this.currentTab === QuestTab.IN_PROGRESS) {
      description = questInfo.inProgressText || 'Quest in progress.';
    } else {
      description = questInfo.completionText || 'Quest completed.';
    }
    const qm = (window as any).charecter?.questManager;
    description = resolveItemCodes(description, qm);
    // Replace inline ITEM markers with item names (icons not supported in text-only renderer)
    description = description.replace(/\x01ITEM:(\d+)\x02/g, (_, id) => getItemNameSync(parseInt(id)) || `Item #${id}`);

    // Word wrap and draw
    const words = description.split(' ');
    let line = '';
    let count = 0;
    const maxLines = 12;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length * 6.2 > maxW && line) {
        canvas.drawText({ text: line, color: '#000000', x: rx + DETAIL_PAD, y: dy, fontSize: 11 });
        dy += lineH;
        line = word;
        count++;
        if (count >= maxLines) break;
      } else {
        line = test;
      }
    }
    if (line && count < maxLines) {
      canvas.drawText({ text: line, color: '#000000', x: rx + DETAIL_PAD, y: dy, fontSize: 11 });
      dy += lineH;
    }

    // Mob and item progress for in-progress tab
    if (this.currentTab === QuestTab.IN_PROGRESS) {
      const qm = this.charecter?.questManager;
      const progress = qm?.getMobProgress(questId);
      const reqs = QuestData.requirements.get(questId);
      const hasProgress = (progress?.length) || (reqs?.complete.items?.length);
      if (hasProgress) dy += 6;

      if (progress?.length) {
        for (const p of progress) {
          const done = p.current >= p.required;
          canvas.drawText({
            text: `${mobNames.get(p.mobId) || `Mob #${p.mobId}`}: ${p.current}/${p.required}`,
            color: done ? '#00AA00' : '#CC0000',
            x: rx + DETAIL_PAD, y: dy, fontSize: 11,
          });
          dy += lineH;
        }
      }

      if (reqs?.complete.items?.length) {
        for (const item of reqs.complete.items) {
          if (item.count <= 0) continue;
          const have = qm?.getItemCount(item.id) ?? 0;
          const done = have >= item.count;
          const name = getItemNameSync(item.id) || `Item #${item.id}`;
          canvas.drawText({
            text: `${name}: ${have}/${item.count}`,
            color: done ? '#00AA00' : '#CC0000',
            x: rx + DETAIL_PAD, y: dy, fontSize: 11,
          });
          dy += lineH;
        }
      }
    }

  }

  private handleClick(mx: number, my: number, canvas: GameCanvas) {
    if (this.isHidden) return;
    const now = Date.now();
    if (now - this.lastClickTime < 100) return;
    this.lastClickTime = now;

    // Tab clicks
    const tabW = Math.floor((LEFT_W - 14) / 3);
    for (let i = 0; i < 3; i++) {
      const tx = this.x + TAB_X + i * tabW;
      const btnImg = this.tabBtnEnabled[i] || this.tabBtnDisabled[i];
      const th = btnImg?.height || 16;
      if (mx >= tx && mx <= tx + tabW && my >= this.y + TAB_Y && my <= this.y + TAB_Y + th) {
        this.currentTab = i as QuestTab;
        this.refreshQuestList();
        this.rebuildButtons(canvas);
        return;
      }
    }

    // Left panel scrollbar arrow clicks
    const sbX = this.x + LEFT_W - 18;
    const sbTopY = this.y + LIST_Y;
    const sbBottomY = this.y + TOTAL_H - 10;
    if (mx >= sbX && mx <= sbX + 15) {
      // Up arrow
      if (my >= sbTopY && my <= sbTopY + 13) {
        if (this.scrollOffset > 0) this.scrollOffset--;
        return;
      }
      // Down arrow
      if (my >= sbBottomY - 13 && my <= sbBottomY) {
        if (this.scrollOffset < this.displayList.length - MAX_VISIBLE) this.scrollOffset++;
        return;
      }
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
