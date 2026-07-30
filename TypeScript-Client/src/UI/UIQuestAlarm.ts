import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import QuestData, { mobNames, getItemNameSync, ensureItemNames } from '../Quest/QuestData';

/**
 * GMS Quest Helper — the on-screen tracker panel at the top-right:
 *
 *   Quest Helper (2/5)                [-][x]
 *   Bold Quest Name                      (x)
 *   Requirement Name  cur/req   (red cur while unmet,
 *   ...                          struck through when met)
 *
 * plus the GMS quest alarm bubble (UIWindow.img/QuestAlarm) that pops above
 * the status bar — next to the quickslot, over the SHOP button — when a
 * quest's requirements are all fulfilled. It auto-hides after a few seconds;
 * clicking it opens the quest log.
 *
 * Window buttons come from Basic.img (BtMin/BtMax/BtClose/BtClose2); the
 * bubble is tiled from the QuestAlarm 9-slice pieces (backgrndmin for one
 * row, backgrndmax + backgrndcenter + backgrndbottom for stacks) with the
 * blinking green Q animation (BtQ/ani) on each row.
 */

const PANEL_W = 212;
const TITLE_H = 19;
const NAME_ROW_H = 17;
const REQ_ROW_H = 15;
const SECTION_GAP = 7;
const PAD_X = 10;
const MAX_TRACKED = 5;

// QuestAlarm bubble geometry (piece sizes from UIWindow.img/QuestAlarm)
const BUBBLE_W = 223;
const BUBBLE_MIN_H = 20;   // backgrndmin — single-row bubble
const BUBBLE_MAX_H = 25;   // backgrndmax — rounded top + first row
const BUBBLE_ROW_H = 18;   // backgrndcenter — one extra row
const BUBBLE_BOT_H = 5;    // backgrndbottom — bottom cap
// Anchored just left of the quickslot (x 649-800) and above the status bar
// (top edge y=529), i.e. on top of the SHOP button
const BUBBLE_RIGHT = 645;
const BUBBLE_BOTTOM = 527;
const BUBBLE_MS = 5000;    // auto-dismiss like GMS
const BUBBLE_MAX_ROWS = 3;
const BTQ_FRAME_MS = 150;

interface Rect { x: number; y: number; w: number; h: number }

const UIQuestAlarm = {
  initialized: false,
  character: null as any,

  // Basic.img window buttons
  btMin: null as HTMLImageElement | null,
  btMax: null as HTMLImageElement | null,
  btClose: null as HTMLImageElement | null,
  btRemove: null as HTMLImageElement | null, // BtClose2 round (x)

  // UIWindow.img/QuestAlarm bubble pieces
  bubbleMin: null as HTMLImageElement | null,
  bubbleMax: null as HTMLImageElement | null,
  bubbleCenter: null as HTMLImageElement | null,
  bubbleBottom: null as HTMLImageElement | null,
  btQFrames: [] as HTMLImageElement[],
  _btQTime: 0,

  // State
  x: 582, // 800 - PANEL_W - 6
  y: 40,  // below the buff icon row
  visible: true,
  collapsed: false,

  // Quest-complete alarm rows (oldest shown first); age drives auto-dismiss
  completeQueue: [] as { questId: number; name: string; age: number }[],

  // Hit rects rebuilt every frame
  _btMinRect: null as Rect | null,
  _btCloseRect: null as Rect | null,
  _removeRects: [] as { rect: Rect; questId: number }[],
  _bubbleRowRects: [] as { rect: Rect; questId: number }[],
  _bubbleBounds: null as Rect | null,
  _bounds: null as Rect | null,

  async initialize() {
    if (this.initialized) return;
    try {
      const basic: any = await WZManager.get('UI.wz/Basic.img');
      this.btMin = basic?.BtMin?.normal?.[0]?.nGetImage?.() || null;
      this.btMax = basic?.BtMax?.normal?.[0]?.nGetImage?.() || null;
      this.btClose = basic?.BtClose?.normal?.[0]?.nGetImage?.() || null;
      this.btRemove = basic?.BtClose2?.normal?.[0]?.nGetImage?.() || null;

      const alarm: any = await WZManager.get('UI.wz/UIWindow.img/QuestAlarm');
      this.bubbleMin = alarm?.backgrndmin?.nGetImage?.() || null;
      this.bubbleMax = alarm?.backgrndmax?.nGetImage?.() || null;
      this.bubbleCenter = alarm?.backgrndcenter?.nGetImage?.() || null;
      this.bubbleBottom = alarm?.backgrndbottom?.nGetImage?.() || null;
      this.btQFrames = (alarm?.BtQ?.ani?.nChildren || [])
        .map((f: any) => f?.nGetImage?.())
        .filter(Boolean);
      // Preload item names so requirement rows don't show "Item #id"
      ensureItemNames().catch(() => {});
      this.initialized = true;
    } catch (e) {
      console.error('UIQuestAlarm initialize error:', e);
    }
  },

  setCharacter(character: any) {
    this.character = character;
  },

  get questManager(): any {
    return this.character?.questManager || null;
  },

  /** True when the point is over the visible panel or bubble (swallows map clicks). */
  containsPoint(px: number, py: number): boolean {
    const hit = (b: Rect | null) =>
      !!b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
    return hit(this._bounds) || hit(this._bubbleBounds);
  },

  /** Queue the quest alarm bubble for a fulfilled quest. */
  showQuestComplete(questId: number, name: string) {
    if (!this.completeQueue.some(q => q.questId === questId)) {
      this.completeQueue.push({ questId, name, age: 0 });
    }
  },

  /** Drop any pending bubble for a quest (turned in / forfeited). */
  dismissQuestComplete(questId: number) {
    this.completeQueue = this.completeQueue.filter(q => q.questId !== questId);
  },

  _pollTimer: 0,

  update(msPerTick: number, canvas: GameCanvas) {
    if (!this.initialized) return;

    // Poll active quests so item-based fulfillment pops the bubble too
    this._pollTimer += msPerTick;
    if (this._pollTimer > 500) {
      this._pollTimer = 0;
      this.questManager?.pollFulfillment?.();
    }

    // Blinking Q animation + auto-dismiss timers
    this._btQTime += msPerTick;
    const visibleRows = Math.min(this.completeQueue.length, BUBBLE_MAX_ROWS);
    for (let i = 0; i < visibleRows; i++) this.completeQueue[i].age += msPerTick;
    this.completeQueue = this.completeQueue.filter(q => q.age < BUBBLE_MS);

    if ((canvas as any).wasClicked) {
      const mx = (canvas as any).mouseX || 0;
      const my = (canvas as any).mouseY || 0;
      const inRect = (r: Rect | null) =>
        !!r && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;

      let bubbleClicked = false;
      for (const { rect, questId } of this._bubbleRowRects) {
        if (inRect(rect)) {
          this.completeQueue = this.completeQueue.filter(q => q.questId !== questId);
          const questLog = (window as any).MapStateInstance?.questLog;
          if (questLog) questLog.setIsHidden(false);
          bubbleClicked = true;
          break;
        }
      }
      if (bubbleClicked) {
        // handled
      } else if (inRect(this._btMinRect)) {
        this.collapsed = !this.collapsed;
      } else if (inRect(this._btCloseRect)) {
        this.visible = false;
      } else {
        for (const { rect, questId } of this._removeRects) {
          if (inRect(rect)) {
            this.questManager?.untrackQuest(questId);
            break;
          }
        }
      }
    }
  },

  /** Requirement lines for one quest: mobs then items, each with cur/req. */
  getRequirementLines(questId: number): { name: string; cur: number; req: number }[] {
    const qm = this.questManager;
    const reqs = QuestData.requirements.get(questId);
    const lines: { name: string; cur: number; req: number }[] = [];
    if (!qm || !reqs) return lines;

    const active = qm.activeQuests.get(questId);
    for (const mob of reqs.complete?.mobs || []) {
      lines.push({
        name: mobNames.get(mob.id) || `Mob #${mob.id}`,
        cur: active?.mobProgress?.get(mob.id) || 0,
        req: mob.count,
      });
    }
    for (const item of reqs.complete?.items || []) {
      if (item.count <= 0) continue;
      lines.push({
        name: getItemNameSync(item.id) || `Item #${item.id}`,
        cur: qm.getItemCount(item.id),
        req: item.count,
      });
    }
    return lines;
  },

  render(canvas: GameCanvas) {
    if (!this.initialized) return;
    this._btMinRect = null;
    this._btCloseRect = null;
    this._removeRects = [];
    this._bubbleRowRects = [];
    this._bubbleBounds = null;
    this._bounds = null;

    const qm = this.questManager;
    const tracked: number[] = (qm?.trackedQuests || []).filter((id: number) => qm.activeQuests.has(id));

    if (this.completeQueue.length) {
      this.renderBubble(canvas);
    }

    if (this.visible && tracked.length) {
      const panelBottom = this.renderPanel(canvas, this.y, tracked);
      this._bounds = { x: this.x, y: this.y, w: PANEL_W, h: panelBottom - this.y };
    }
  },

  renderPanel(canvas: GameCanvas, py: number, tracked: number[]): number {
    const ctx = canvas.context;

    // Measure body height
    let bodyH = 0;
    if (!this.collapsed) {
      for (const questId of tracked) {
        bodyH += NAME_ROW_H + this.getRequirementLines(questId).length * REQ_ROW_H + SECTION_GAP;
      }
      bodyH += 3;
    }
    const totalH = TITLE_H + bodyH;

    // Translucent white panel with thin border, like the original helper
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.fillRect(this.x, py, PANEL_W, totalH);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(this.x, py, PANEL_W, TITLE_H);
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x + 0.5, py + 0.5, PANEL_W - 1, totalH - 1);
    ctx.beginPath();
    ctx.moveTo(this.x, py + TITLE_H - 0.5);
    ctx.lineTo(this.x + PANEL_W, py + TITLE_H - 0.5);
    ctx.stroke();
    ctx.restore();

    // Title + window buttons
    canvas.drawText({
      text: `Quest Helper (${tracked.length}/${MAX_TRACKED})`,
      color: '#333333', x: this.x + 8, y: py + 4, fontSize: 11,
    });
    const btY = py + 3;
    const minImg = this.collapsed ? (this.btMax || this.btMin) : this.btMin;
    if (minImg) {
      const bx = this.x + PANEL_W - 30;
      canvas.drawImage({ img: minImg, dx: bx, dy: btY });
      this._btMinRect = { x: bx, y: btY, w: 12, h: 12 };
    }
    if (this.btClose) {
      const bx = this.x + PANEL_W - 16;
      canvas.drawImage({ img: this.btClose, dx: bx, dy: btY });
      this._btCloseRect = { x: bx, y: btY, w: 12, h: 12 };
    }

    if (this.collapsed) return py + totalH;

    // Quest sections
    let ry = py + TITLE_H + 4;
    for (const questId of tracked) {
      const info = QuestData.quests.get(questId);
      let name = info?.name || `Quest #${questId}`;
      if (name.length > 26) name = name.substring(0, 24) + '..';
      canvas.drawText({
        text: name, color: '#000000', fontWeight: 'bold',
        x: this.x + PAD_X, y: ry + 2, fontSize: 12,
      });
      if (this.btRemove) {
        const bx = this.x + PANEL_W - 18;
        canvas.drawImage({ img: this.btRemove, dx: bx, dy: ry + 1 });
        this._removeRects.push({ rect: { x: bx, y: ry + 1, w: 14, h: 14 }, questId });
      }
      ry += NAME_ROW_H;

      for (const line of this.getRequirementLines(questId)) {
        const met = line.cur >= line.req;
        let lname = line.name;
        if (lname.length > 24) lname = lname.substring(0, 22) + '..';

        const ctx2 = canvas.context;
        ctx2.save();
        ctx2.textBaseline = 'top';
        ctx2.textAlign = 'left';
        ctx2.font = '11px Arial';
        const tx = this.x + PAD_X;
        const ty = ry + 2;
        ctx2.fillStyle = '#4A4A4A';
        ctx2.fillText(lname, tx, ty);
        const nameW = ctx2.measureText(lname).width;
        // current count red while unmet
        const curStr = `${line.cur}`;
        ctx2.fillStyle = met ? '#4A4A4A' : '#D03000';
        ctx2.fillText(curStr, tx + nameW + 6, ty);
        const curW = ctx2.measureText(curStr).width;
        ctx2.fillStyle = '#4A4A4A';
        ctx2.fillText(`/${line.req}`, tx + nameW + 6 + curW, ty);
        const totalW = nameW + 6 + curW + ctx2.measureText(`/${line.req}`).width;
        // strike through completed requirements
        if (met) {
          ctx2.strokeStyle = 'rgba(160, 40, 60, 0.9)';
          ctx2.lineWidth = 1;
          ctx2.beginPath();
          ctx2.moveTo(tx - 1, ty + 6);
          ctx2.lineTo(tx + totalW + 2, ty + 6);
          ctx2.stroke();
        }
        ctx2.restore();
        ry += REQ_ROW_H;
      }
      ry += SECTION_GAP;
    }
    return py + totalH;
  },

  /**
   * GMS quest alarm bubble above the status bar (UIWindow.img/QuestAlarm).
   * One row uses backgrndmin; stacks use backgrndmax + centers + bottom.
   * Each row: blinking green Q + quest name + "(Complete)".
   */
  renderBubble(canvas: GameCanvas) {
    const rows = this.completeQueue.slice(0, BUBBLE_MAX_ROWS);
    const single = rows.length === 1;
    if (single && !this.bubbleMin) return;
    if (!single && (!this.bubbleMax || !this.bubbleCenter || !this.bubbleBottom)) return;

    const bx = BUBBLE_RIGHT - BUBBLE_W;
    const totalH = single
      ? BUBBLE_MIN_H
      : BUBBLE_MAX_H + (rows.length - 1) * BUBBLE_ROW_H + BUBBLE_BOT_H;
    const by = BUBBLE_BOTTOM - totalH;

    // Background pieces
    if (single) {
      canvas.drawImage({ img: this.bubbleMin!, dx: bx, dy: by });
    } else {
      canvas.drawImage({ img: this.bubbleMax!, dx: bx, dy: by });
      for (let i = 1; i < rows.length; i++) {
        canvas.drawImage({ img: this.bubbleCenter!, dx: bx, dy: by + BUBBLE_MAX_H + (i - 1) * BUBBLE_ROW_H });
      }
      canvas.drawImage({ img: this.bubbleBottom!, dx: bx, dy: by + BUBBLE_MAX_H + (rows.length - 1) * BUBBLE_ROW_H });
    }

    // Rows: blinking Q + quest name (Complete)
    const qFrame = this.btQFrames.length
      ? this.btQFrames[Math.floor(this._btQTime / BTQ_FRAME_MS) % this.btQFrames.length]
      : null;
    const ctx = canvas.context;
    for (let i = 0; i < rows.length; i++) {
      // backgrndmax = a 20px row like backgrndmin plus a 5px fade into the stack
      const rowY = i === 0 ? by : by + BUBBLE_MAX_H + (i - 1) * BUBBLE_ROW_H;
      const rowH = i === 0 ? BUBBLE_MIN_H : BUBBLE_ROW_H;
      if (qFrame) canvas.drawImage({ img: qFrame, dx: bx + 6, dy: rowY + Math.floor((rowH - 12) / 2) });

      ctx.save();
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.font = '11px Arial';
      const suffix = ' (Complete)';
      const maxNameW = BUBBLE_W - 24 - 10 - ctx.measureText(suffix).width;
      let name = rows[i].name;
      while (name.length > 4 && ctx.measureText(name).width > maxNameW) {
        name = name.substring(0, name.length - 3) + '..';
      }
      const tx = bx + 24;
      const ty = rowY + Math.floor((rowH - 13) / 2) + 1;
      // 1px drop shadow for readability on the translucent panel
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillText(name, tx + 1, ty + 1);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(name, tx, ty);
      const nameW = ctx.measureText(name).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillText(suffix, tx + nameW + 1, ty + 1);
      ctx.fillStyle = '#FFDD33';
      ctx.fillText(suffix, tx + nameW, ty);
      ctx.restore();

      this._bubbleRowRects.push({
        rect: { x: bx, y: rowY, w: BUBBLE_W, h: rowH },
        questId: rows[i].questId,
      });
    }

    this._bubbleBounds = { x: bx, y: by, w: BUBBLE_W, h: totalH };
  },
};

export default UIQuestAlarm;
