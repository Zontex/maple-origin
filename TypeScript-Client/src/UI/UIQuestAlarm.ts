import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import ClickManager from './ClickManager';
import config from '../Config';
import QuestData, { mobNames, getItemNameSync, ensureItemNames } from '../Quest/QuestData';

/**
 * GMS Quest Helper — the on-screen tracker panel at the top-right:
 *
 *   Quest Helper (2/5)                [-][x]
 *   Bold Quest Name                      (x)
 *   cur / req  Requirement Name   (struck through when met)
 *   ...
 *
 * plus the GMS quest-complete balloon that pops above the status bar — next
 * to the quickslot, over the SHOP button — when a quest's requirements are
 * all fulfilled. It auto-hides after a few seconds; clicking it opens the
 * quest log.
 *
 * Window buttons come from Basic.img (BtMin/BtMax/BtClose/BtClose2). The
 * balloon is UIWindow.img/FadeYesNo/backgrnd4 (the red rounded pop-up with
 * a tail) and UIWindow.img/FadeYesNo/icon6 (the gold trophy), drawn with the
 * quest name on the first line and "Quest Complete!" on the second. The
 * matching sound is Sound.wz/Game.img/QuestClear, played from
 * MapleCharacter.playQuestClear() alongside the BasicEff QuestClear effect.
 */

// GMS renders its UI text in Arial, same as the rest of this codebase — do
// not "improve" this with a Korean gothic fallback chain. AppleGothic ships
// with macOS, so listing it ahead of Arial silently swapped the typeface on
// exactly the machine we were comparing against.
//
// The residual difference from the original client is rasterisation, not
// typeface: Windows draws Arial at 11px through GDI with almost no
// antialiasing, while a browser canvas antialiases heavily. Only a bitmap
// glyph atlas would close that gap; a bundled webfont would not.
const UI_FONT = "Arial";
// GMS uses one flat near-black throughout the helper — no red for unmet
// counts, no coloured strike-through. Anything lighter washes out against
// the panel's 33%-opaque body with the map showing through.
const TEXT_COLOR = '#000000';

// Piece sizes from UIWindow.img/QuestAlarm — the panel is exactly as wide as
// the sprite, and the title bar is backgrndmax's own height
const PANEL_W = 223;
const TITLE_H = 25;   // backgrndmax
const PANEL_FILL_H = 18; // backgrndcenter, tiled for the body
const PANEL_BOT_H = 5;   // backgrndbottom
const PANEL_MIN_H = 20;  // backgrndmin, collapsed
const NAME_ROW_H = 17;
const REQ_ROW_H = 15;
const SECTION_GAP = 7;
const PAD_X = 10;
const MAX_TRACKED = 5;

// Balloon sits above the status bar (top edge y=529 at 800x600). The status
// bar is a centered 800-wide island on wider screens (UIMap.startUIPosition),
// so both anchors are 800x600-space values shifted by the island offset at
// render time — hardcoding screen coordinates put the balloon mid-map at
// 1280x720 instead of over the alert button.
const BUBBLE_BOTTOM = 527;
const BUBBLE_MS = 5000;    // auto-dismiss like GMS

// Quest-complete balloon (UIWindow.img/FadeYesNo/backgrnd4, 154x44).
// Measured from the sprite: the rounded body occupies rows 0-38 and the
// tail tapers over rows 39-42 to a tip at x=141 — so to point the tail at a
// screen position, draw the balloon at (tipX - 141, tipY - 42).
const BALLOON_W = 154;
const BALLOON_H = 44;
const BALLOON_BODY_H = 39;
const BALLOON_TAIL_X = 141;
// The tail points at the status bar's alert button (StatusBar.img/BtClaim,
// 20x19 at x=583 in UIMap.addButtons), i.e. its centre — not at the equip
// button next to it
const BALLOON_TAIL_TARGET_X = 593;
const BALLOON_ICON_X = 11;   // trophy (icon6, 8x15), vertically centred in body
const BALLOON_TEXT_X = 30;
const BALLOON_LINE1_Y = 7;
const BALLOON_LINE2_Y = 20;
const BALLOON_TEXT_PAD_R = 8;

interface Rect { x: number; y: number; w: number; h: number }

const UIQuestAlarm = {
  initialized: false,
  character: null as any,

  // Basic.img window buttons
  btMin: null as HTMLImageElement | null,
  btMax: null as HTMLImageElement | null,
  btClose: null as HTMLImageElement | null,
  btRemove: null as HTMLImageElement | null, // BtClose2 round (x)

  // UIWindow.img/QuestAlarm — the Quest Helper frame. A 223-wide 9-slice:
  // backgrndmin is the collapsed (title-only) state, otherwise backgrndmax
  // (title bar) + tiled backgrndcenter (body) + backgrndbottom (cap).
  panelMin: null as HTMLImageElement | null,
  panelTop: null as HTMLImageElement | null,
  panelFill: null as HTMLImageElement | null,
  panelBottom: null as HTMLImageElement | null,
  btAuto: null as HTMLImageElement | null,
  btAutoPressed: null as HTMLImageElement | null,
  _btAutoRect: null as Rect | null,

  // UIWindow.img/FadeYesNo — quest-complete balloon + trophy icon
  balloonImg: null as HTMLImageElement | null,
  balloonIcon: null as HTMLImageElement | null,

  // State. x is an 800-wide-screen value; render() keeps the panel this far
  // off the true right edge until the player drags it somewhere themselves.
  x: 582,
  y: 40,  // below the buff icon row
  visible: true,
  collapsed: false,
  _userMoved: false,
  _anchorW: 800,

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
      this.panelMin = alarm?.backgrndmin?.nGetImage?.() || null;
      this.panelTop = alarm?.backgrndmax?.nGetImage?.() || null;
      this.panelFill = alarm?.backgrndcenter?.nGetImage?.() || null;
      this.panelBottom = alarm?.backgrndbottom?.nGetImage?.() || null;
      this.btAuto = alarm?.BtAuto?.normal?.[0]?.nGetImage?.() || null;
      this.btAutoPressed = alarm?.BtAuto?.pressed?.[0]?.nGetImage?.() || null;

      // Quest-complete balloon — the red pop-up with the gold trophy that
      // GMS shows above the status bar. Both pieces live under FadeYesNo.
      const fade: any = await WZManager.get('UI.wz/UIWindow.img/FadeYesNo');
      this.balloonImg = fade?.backgrnd4?.nGetImage?.() || null;
      this.balloonIcon = fade?.icon6?.nGetImage?.() || null;
      // Preload item names so requirement rows don't show "Item #id"
      ensureItemNames().catch(() => {});
      ClickManager.addDragableMenu(this);
      this.initialized = true;
    } catch (e) {
      console.error('UIQuestAlarm initialize error:', e);
    }
  },

  setCharacter(character: any) {
    this.character = character;
  },

  /**
   * Drag handle for ClickManager. Deliberately just the title bar — GMS
   * drags this window by its header, not by the quest list. Returns an empty
   * rect while hidden so a stale handle can't be grabbed off-screen.
   */
  getRect(_camera?: any) {
    // NOTE: ClickManager hit-tests via GUIUtil.pointInRectangle, which reads
    // .width/.height — not the .w/.h this file uses internally. Returning
    // w/h here silently disabled dragging entirely.
    if (!this.visible) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: this.x, y: this.y, width: PANEL_W, height: TITLE_H };
  },

  /** Called by ClickManager while dragging; keeps the panel on screen. */
  moveTo(pos: { x: number; y: number }) {
    const maxX = config.width - PANEL_W;
    const maxY = config.height - TITLE_H;
    this.x = Math.max(0, Math.min(maxX, Math.round(pos.x)));
    this.y = Math.max(0, Math.min(maxY, Math.round(pos.y)));
    this._userMoved = true;
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

  /** Queue the red "Quest Complete!" balloon for a just-completed quest. */
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

    // Auto-dismiss. Only the balloon actually on screen ages, so a backlog
    // of completions is shown one after another instead of several expiring
    // together while the player only ever saw the first.
    if (this.completeQueue.length) {
      this.completeQueue[0].age += msPerTick;
      if (this.completeQueue[0].age >= BUBBLE_MS) this.completeQueue.shift();
    }

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
      } else if (inRect(this._btAutoRect)) {
        const qm = this.questManager;
        if (qm) qm.autoTrack = !qm.autoTrack;
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
    // Follow the true right edge across resolution changes (initialize()
    // runs before the saved resolution is applied) — but never fight a
    // position the player chose by dragging.
    if (!this._userMoved && this._anchorW !== config.width) {
      this.x += config.width - this._anchorW;
      this._anchorW = config.width;
    }
    this._btMinRect = null;
    this._btCloseRect = null;
    this._btAutoRect = null;
    this._removeRects = [];
    this._bubbleRowRects = [];
    this._bubbleBounds = null;
    this._bounds = null;

    const qm = this.questManager;
    // Also drop quests with nothing to count — they may still be in a save
    // from before trackQuest started rejecting them
    const tracked: number[] = (qm?.trackedQuests || []).filter(
      (id: number) => qm.activeQuests.has(id) && this.getRequirementLines(id).length > 0
    );

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
    const totalH = this.collapsed
      ? PANEL_MIN_H
      : TITLE_H + bodyH + PANEL_BOT_H;

    // Frame from UIWindow.img/QuestAlarm. The sprites carry their own
    // translucency (title bar ~73%, body ~33%), which is what lets the map
    // show through the way it does in the original.
    if (this.collapsed) {
      canvas.drawImage({ img: this.panelMin, dx: this.x, dy: py });
    } else {
      canvas.drawImage({ img: this.panelTop, dx: this.x, dy: py });
      // Tile the 18px body strip, clipped so a partial row can't overhang
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.x, py + TITLE_H, PANEL_W, bodyH);
      ctx.clip();
      for (let fy = py + TITLE_H; fy < py + TITLE_H + bodyH; fy += PANEL_FILL_H) {
        canvas.drawImage({ img: this.panelFill, dx: this.x, dy: fy });
      }
      ctx.restore();
      canvas.drawImage({ img: this.panelBottom, dx: this.x, dy: py + TITLE_H + bodyH });
    }

    // Title + window buttons
    canvas.drawText({
      text: `Quest Helper (${tracked.length}/${MAX_TRACKED})`,
      color: TEXT_COLOR, x: this.x + 8, y: py + 6, fontSize: 11,
      fontFamily: UI_FONT,
    });
    const btY = py + 6;
    // AUTO toggles whether newly accepted quests are tracked automatically
    const autoImg = this.questManager?.autoTrack === false
      ? (this.btAuto || this.btAutoPressed)
      : (this.btAutoPressed || this.btAuto);
    if (autoImg) {
      const bx = this.x + PANEL_W - 58;
      canvas.drawImage({ img: autoImg, dx: bx, dy: btY });
      this._btAutoRect = { x: bx, y: btY, w: 21, h: 12 };
    }
    const minImg = this.collapsed ? (this.btMax || this.btMin) : this.btMin;
    if (minImg) {
      const bx = this.x + PANEL_W - 32;
      canvas.drawImage({ img: minImg, dx: bx, dy: btY });
      this._btMinRect = { x: bx, y: btY, w: 12, h: 12 };
    }
    if (this.btClose) {
      const bx = this.x + PANEL_W - 18;
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
        x: this.x + PAD_X, y: ry + 2, fontSize: 12, fontFamily: UI_FONT,
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
        ctx2.font = `11px ${UI_FONT}`;
        const tx = this.x + PAD_X;
        const ty = ry + 2;
        // GMS order is "10 / 10 Blue Snail Shell" — counts lead, name follows,
        // all in one colour
        const text = `${line.cur} / ${line.req} ${lname}`;
        ctx2.fillStyle = TEXT_COLOR;
        ctx2.fillText(text, tx, ty);
        const totalW = ctx2.measureText(text).width;
        // strike through completed requirements
        if (met) {
          ctx2.strokeStyle = TEXT_COLOR;
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
   * GMS quest-complete balloon (UIWindow.img/FadeYesNo/backgrnd4) — the red
   * pop-up with the gold trophy that appears above the status bar, its tail
   * pointing down at the quest notifier:
   *
   *   [trophy]  Biggs's Collectio..
   *             Quest Complete!
   *
   * One balloon at a time, newest first; the rest of the queue waits its
   * turn, matching the original rather than stacking rows.
   */
  renderBubble(canvas: GameCanvas) {
    const entry = this.completeQueue[0];
    if (!entry || !this.balloonImg) return;

    // Anchor by the tail tip, not the corner, so the balloon always points at
    // the alert button regardless of its own width. The tail target follows
    // the status bar, which sits as a centered 800-wide island bottom-aligned
    // on resolutions larger than 800x600.
    const uiX = Math.floor((config.width - 800) / 2);
    const uiY = config.height - 600;
    const bx = BALLOON_TAIL_TARGET_X + uiX - BALLOON_TAIL_X;
    const by = BUBBLE_BOTTOM + uiY - BALLOON_H;

    canvas.drawImage({ img: this.balloonImg, dx: bx, dy: by });
    if (this.balloonIcon) {
      canvas.drawImage({
        img: this.balloonIcon,
        dx: bx + BALLOON_ICON_X,
        dy: by + Math.floor((BALLOON_BODY_H - 15) / 2),
      });
    }

    const ctx = canvas.context;
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = `bold 12px ${UI_FONT}`;

    // Quest name, truncated with '..' exactly like GMS when it overflows
    const maxNameW = BALLOON_W - BALLOON_TEXT_X - BALLOON_TEXT_PAD_R;
    let name = entry.name;
    while (name.length > 4 && ctx.measureText(name).width > maxNameW) {
      name = name.substring(0, name.length - 3) + '..';
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(name, bx + BALLOON_TEXT_X, by + BALLOON_LINE1_Y);
    ctx.fillText('Quest Complete!', bx + BALLOON_TEXT_X, by + BALLOON_LINE2_Y);
    ctx.restore();

    // Clicking the balloon opens the quest log, as before
    this._bubbleBounds = { x: bx, y: by, w: BALLOON_W, h: BALLOON_BODY_H };
    this._bubbleRowRects = [
      { rect: { x: bx, y: by, w: BALLOON_W, h: BALLOON_BODY_H }, questId: entry.questId },
    ];
  },
};

export default UIQuestAlarm;
