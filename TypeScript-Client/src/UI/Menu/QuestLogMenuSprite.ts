import WZManager from '../../wz-utils/WZManager';
import ClickManager from '../ClickManager';
import { MapleStanceButton } from '../MapleStanceButton';
import DragableMenu from './DragableMenu';
import { CameraInterface } from '../../Camera';
import { Position } from '../../Effects/DamageIndicator';
import GameCanvas from '../../GameCanvas';
import QuestData, { mobNames, resolveItemCodes } from '../../Quest/QuestData';
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
const TAB_Y = 18;
const LIST_X = 12;
const LIST_Y = 42;
const LIST_W = LEFT_W - 24;
const ENTRY_H = 18;
const MAX_VISIBLE = 18;
const DETAIL_PAD = 14;

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
  private bgLeft: any = null;       // backgrnd 245x396
  private bgRight: any = null;      // backgrnd2 305x396 (only shown when quest selected)
  private tabBtnEnabled: any[] = [];  // Item/New/Tab1 — button background (active)
  private tabBtnDisabled: any[] = []; // Item/New/Tab0 — button background (inactive)
  private tabLblEnabled: any[] = [];  // Quest/Tab/enabled — text label (active)
  private tabLblDisabled: any[] = []; // Quest/Tab/disabled — text label (inactive)
  private buttons: MapleStanceButton[] = [];

  // NPC sprite cache for detail panel
  private cachedNpcId: number = -1;
  private cachedNpcSprite: any = null;
  private npcSpriteLoading: boolean = false;

  // State
  private questList: number[] = [];
  private selectedIndex: number = -1;
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
    } catch (e) {
      console.error('Error loading quest UI:', e);
    }

    ClickManager.addDragableMenu(this);
  }

  getRect(camera: CameraInterface) {
    const w = this.selectedIndex >= 0 ? TOTAL_W : LEFT_W;
    return { x: this.x, y: this.y, width: w, height: TOTAL_H };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
    this.buttons.forEach(btn => btn.isHidden = isHidden);
    if (!isHidden) this.refreshQuestList();
  }

  private refreshQuestList() {
    const qm = this.charecter?.questManager;
    if (!qm) { this.questList = []; return; }

    switch (this.currentTab) {
      case QuestTab.AVAILABLE: {
        this.questList = [];
        const level = this.charecter?.stats?.level || 1;
        for (const [questId] of QuestData.quests) {
          if (qm.canStartQuest(questId)) {
            const reqs = QuestData.requirements.get(questId);
            const minLv = reqs?.start?.lvmin || 0;
            if (minLv <= level + 10) this.questList.push(questId);
          }
          if (this.questList.length >= 50) break;
        }
        break;
      }
      case QuestTab.IN_PROGRESS:
        this.questList = Array.from(qm.activeQuests.keys());
        break;
      case QuestTab.COMPLETED:
        this.questList = Array.from(qm.completedQuests);
        break;
    }
    this.selectedIndex = this.questList.length > 0 ? 0 : -1;
    this.scrollOffset = 0;
    // Reset NPC sprite cache when list changes
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

    if (this.currentTab === QuestTab.IN_PROGRESS && this.questUINode?.BtGiveup) {
      const btn = new MapleStanceButton(canvas, {
        x: this.x + LEFT_W + RIGHT_W - 65,
        y: this.y + TOTAL_H - 25,
        img: this.questUINode.BtGiveup.nChildren,
        isRelativeToCamera: true,
        isPartOfUI: true,
        onClick: () => {
          if (this.selectedIndex >= 0 && this.selectedIndex < this.questList.length) {
            this.charecter?.questManager?.forfeitQuest(this.questList[this.selectedIndex]);
            this.refreshQuestList();
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

    // Right panel + detail only when a quest is selected
    if (this.selectedIndex >= 0) {
      if (this.bgRight) {
        canvas.drawImage({ img: this.bgRight, dx: this.x + LEFT_W, dy: this.y });
      }
      this.drawQuestDetail(canvas);
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
    const end = Math.min(this.scrollOffset + MAX_VISIBLE, this.questList.length);

    for (let i = this.scrollOffset; i < end; i++) {
      const questInfo = QuestData.quests.get(this.questList[i]);
      if (!questInfo) continue;
      const selected = i === this.selectedIndex;

      if (selected) {
        canvas.drawRect({
          x: lx - 2, y: ly - 1,
          width: LIST_W, height: ENTRY_H,
          color: '#4477BB', alpha: 0.3,
        });
      }

      let name = questInfo.name;
      if (name.length > 26) name = name.substring(0, 24) + '..';
      canvas.drawText({
        text: name,
        color: selected ? '#003388' : '#333333',
        x: lx + 2, y: ly + 3, fontSize: 11,
      });

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

  private drawQuestDetail(canvas: GameCanvas) {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.questList.length) return;

    const questId = this.questList[this.selectedIndex];
    const questInfo = QuestData.quests.get(questId);
    if (!questInfo) return;

    const rx = this.x + LEFT_W;
    const reqs = QuestData.requirements.get(questId);
    const BLUE_AREA_H = 120; // approximate blue header area in backgrnd2

    // --- Blue header area (top of right panel) ---

    // Quest name
    canvas.drawText({
      text: questInfo.name.length > 22 ? questInfo.name.substring(0, 20) + '..' : questInfo.name,
      color: '#FFFFFF', fontWeight: 'bold',
      x: rx + DETAIL_PAD + 4, y: this.y + 20,
      fontSize: 12,
    });

    // Level requirement
    if (reqs?.start?.lvmin) {
      canvas.drawText({
        text: `Over Level ${reqs.start.lvmin}`,
        color: '#DDDDEE',
        x: rx + DETAIL_PAD + 4, y: this.y + 38,
        fontSize: 10,
      });
    }

    // NPC sprite in top-right of blue header area
    const npcId = reqs?.start?.npc || reqs?.complete?.npc;
    if (npcId && npcId !== this.cachedNpcId) {
      this.loadNpcSprite(npcId);
    }
    if (this.cachedNpcSprite) {
      const spriteImg = this.cachedNpcSprite;
      const spriteX = rx + RIGHT_W - spriteImg.width - 25;
      const spriteY = this.y + BLUE_AREA_H - spriteImg.height - 5;
      canvas.drawImage({ img: spriteImg, dx: spriteX, dy: spriteY });
    }

    // --- Description text below blue area ---
    let dy = this.y + BLUE_AREA_H + 14;
    const maxW = RIGHT_W - DETAIL_PAD * 2 - 10;
    const lineH = 14;

    let description = '';
    if (this.currentTab === QuestTab.AVAILABLE) {
      description = questInfo.startText || 'Talk to the NPC to start this quest.';
    } else if (this.currentTab === QuestTab.IN_PROGRESS) {
      description = questInfo.inProgressText || 'Quest in progress.';
    } else {
      description = questInfo.completionText || 'Quest completed.';
    }
    // Resolve deferred #t/#c item codes
    const qm = (window as any).charecter?.questManager;
    description = resolveItemCodes(description, qm);

    // Word wrap and draw
    const words = description.split(' ');
    let line = '';
    let count = 0;
    const maxLines = 14;
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

    // Mob progress for in-progress tab
    if (this.currentTab === QuestTab.IN_PROGRESS) {
      const qm = this.charecter?.questManager;
      const progress = qm?.getMobProgress(questId);
      if (progress?.length) {
        dy += 6;
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
    }

    // Rewards
    if (this.currentTab !== QuestTab.COMPLETED) {
      const rewards = QuestData.rewards.get(questId);
      if (rewards?.complete) {
        const parts: string[] = [];
        if (rewards.complete.exp) parts.push(`${rewards.complete.exp} EXP`);
        if (rewards.complete.meso) parts.push(`${rewards.complete.meso} Mesos`);
        if (parts.length) {
          dy += 8;
          canvas.drawText({
            text: `Reward: ${parts.join(', ')}`,
            color: '#886600',
            x: rx + DETAIL_PAD, y: dy, fontSize: 11,
          });
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

    // Quest list clicks
    const lx = this.x + LIST_X;
    const ly = this.y + LIST_Y;
    if (mx >= lx && mx <= this.x + LEFT_W - 10 && my >= ly && my < ly + MAX_VISIBLE * ENTRY_H) {
      const idx = Math.floor((my - ly) / ENTRY_H) + this.scrollOffset;
      if (idx >= 0 && idx < this.questList.length) {
        this.selectedIndex = idx;
        // Reset NPC sprite for new selection
        this.cachedNpcId = -1;
        this.cachedNpcSprite = null;
      }
    }
  }
}

export default QuestLogMenuSprite;
