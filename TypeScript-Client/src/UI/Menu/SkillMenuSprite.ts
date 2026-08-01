import WZManager from '../../wz-utils/WZManager';
import ClickManager from '../ClickManager';
import { MapleStanceButton } from '../MapleStanceButton';
import DragableMenu from './DragableMenu';
import { CameraInterface } from '../../Camera';
import GameCanvas from '../../GameCanvas';
import SkillData, { SkillInfo } from '../../Skills/SkillData';
import type MapleCharacter from '../../MapleCharacter';
import { getJobNameById } from '../../Constants/Jobs';
import UIDevTools from '../UIDevTools';
import DragManager from '../DragManager';

// ─── Layout constants derived from WZ assets ────────────────────────
// backgrnd = 175x289, but we extend it vertically to fit more skills (like GMS)
const WIN_W = 175;
const BG_H = 289;            // original background height

// We split the background into 3 slices to extend the content area:
// Top:    y=0  to y=89   (title, tabs, gold bar)
// Content: extended white area for skill rows
// Bottom: y=257 to y=289  (SKILL POINT section)
const BG_TOP_H = 90;         // top slice height
const BG_BOTTOM_Y = 257;     // where bottom slice starts in original bg
const BG_BOTTOM_H = BG_H - BG_BOTTOM_Y; // 32px bottom slice

// ─── All positions from wzLayout('UI.wz/UIWindow.img/Skill/backgrnd') ───

// Tab strip — the backgrnd asset has the strip built in (red underline at
// y=43-44); tabs are just the WZ Tab/enabled|disabled numeral images on it
// Measured off the decoded backgrnd PNG: the red underline occupies y=42-44
// and the strip band above it runs y=24..41. Tabs hang from that line rather
// than being positioned from the top, so the 34x18 unselected and 34x19
// selected plates share a bottom edge and the taller one rises a pixel over
// the strip, which is what makes it read as "in front".
const TAB_STRIP_BOTTOM = 42;
const TAB_PLATE_H = 19;
const TAB_Y = TAB_STRIP_BOTTOM - TAB_PLATE_H; // 23
const TAB_H = TAB_PLATE_H;
const TAB_W = 34;
const TAB_X_START = 6;
const TAB_GAP = 0;

// Job name text on dark center of gold bar (y=62-80)
// Text shifted right to account for skill book icon on the left
const LABEL_TEXT_X = 110;
const LABEL_TEXT_Y = 68;

// Skill book icon, centred in the placeholder plate the background reserves
// for it. Measured off the decoded backgrnd PNG: the plate is x=6..41,
// y=54..86 (36x33) and the icon is 26x30, so it insets by 5 and 2.
const BOOK_ICON_X = 11;
const BOOK_ICON_Y = 56;

// Skill list — tight to left edge per GMS ref
const SKILL_LIST_X = 4;
const SKILL_LIST_Y = 90;
const SKILL_SLOT_W = 141;
const SKILL_SLOT_H = 35;
const SKILL_ROW_H = 36;
const MAX_VISIBLE_SKILLS = 5; // slightly shorter than 6

// Extended window height: top chrome + skill rows + bottom chrome
const CONTENT_H = MAX_VISIBLE_SKILLS * SKILL_ROW_H; // 180px
const WIN_H = BG_TOP_H + CONTENT_H + BG_BOTTOM_H;   // 90 + 180 + 32 = 302px

// Skill slot sub-positions (relative to slot top-left)
const ICON_X = 2;
const ICON_Y = 1;
const NAME_X = 36;
const NAME_Y = 4;
const LEVEL_X = 36;
const LEVEL_Y = 18;
const SP_BTN_X = 124;
const SP_BTN_Y = 11;

// Everything between the icon and the SP button belongs to the name — 88px,
// which most skill names overrun at any readable size, so they get cut.
const NAME_MAX_W = SP_BTN_X - NAME_X - 2;
const NAME_FONT_SIZE = 11;

/** Truncate to `maxW` px, ending in ".." the way the original client does. */
function fitText(canvas: any, text: string, maxW: number, fontSize: number): string {
  const ctx = canvas?.context;
  if (!ctx) return text;
  const prev = ctx.font;
  ctx.font = `bold ${fontSize}px Arial`;
  let out = text;
  if (ctx.measureText(out).width > maxW) {
    while (out.length > 1 && ctx.measureText(out + '..').width > maxW) {
      out = out.slice(0, -1);
    }
    out += '..';
  }
  ctx.font = prev;
  return out;
}

// SP number — inside the white box in the bottom slice.
// Measured from the decoded backgrnd PNG: box interior x=83-111, y=266-280;
// bottom slice starts at y=257, so box center is x=97, slice offset 12
const SP_NUM_X = 97;
const SP_NUM_BOTTOM_OFFSET = 12; // from start of bottom slice to text top

class SkillMenuSprite extends DragableMenu {
  opts: any;
  charecter: MapleCharacter | null = null;
  currentTab: number = 0;
  isNotFirstDraw: boolean = false;
  destroyed: boolean = false;
  delay: number = 0;
  id: number = 0;
  originalX: number = 0;
  originalY: number = 0;

  // Close button
  private closeButton: MapleStanceButton | null = null;

  // WZ images
  private bgImage: HTMLImageElement | null = null;
  private skill0Image: HTMLImageElement | null = null;
  private skill1Image: HTMLImageElement | null = null;
  /** jobId -> skill book name from String.wz (e.g. 100 -> "Warrior Basics") */
  private bookNames: Record<number, string> = {};
  /** jobId -> skill book icon from Skill.wz/<tier>.img/info/icon (26x30) */
  private bookIcons: Record<number, HTMLImageElement> = {};
  private lineImage: HTMLImageElement | null = null;
  private tabEnabled: (HTMLImageElement | null)[] = [];
  private tabDisabled: (HTMLImageElement | null)[] = [];
  /** Pink selected / grey unselected tab plates (Item/New/Tab1|Tab0) */
  private tabPlateOn: (HTMLImageElement | null)[] = [];
  private tabPlateOff: (HTMLImageElement | null)[] = [];
  private spBtnNormal: HTMLImageElement | null = null;
  private spBtnPressed: HTMLImageElement | null = null;
  private spBtnDisabled: HTMLImageElement | null = null;
  private spBtnMouseOver: HTMLImageElement | null = null;

  // Scrollbar images
  private scrollPrev: HTMLImageElement | null = null;
  private scrollNext: HTMLImageElement | null = null;
  private scrollThumb: HTMLImageElement | null = null;
  private scrollBg: HTMLImageElement | null = null;

  // tip0-2 are pre-rendered placeholder images ("Place cursor on skill..."), not used as tooltip frames

  // State
  private tabSkills: SkillInfo[] = [];
  private scrollOffset: number = 0;
  private maxTabs: number = 1;
  private jobTierIds: number[] = [];
  private buttons: MapleStanceButton[] = [];
  private skillsLoaded: boolean = false;
  private _lastClickSkillId: number = -1;
  private _lastClickTime: number = 0;
  private _GameCanvas: GameCanvas | null = null;

  // Tooltip hover state
  private _hoveredSkill: SkillInfo | null = null;

  static async fromOpts(opts: any) {
    const object = new SkillMenuSprite(opts);
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

    const skillNode: any = await WZManager.get('UI.wz/UIWindow.img/Skill');
    if (!skillNode) return;

    // The header names the skill BOOK, not the job — "Warrior Basics", not
    // "Warrior". It is Nexon's own string, one per job tier, so read it rather
    // than composing one ("1st Job" etc.) that GMS never showed.
    try {
      const names: any = await WZManager.get('String.wz/Skill.img');
      for (const tier of names?.nChildren || []) {
        const book = tier.nGet?.('bookName')?.nValue;
        if (book) this.bookNames[Number(tier.nName)] = String(book);
      }
    } catch { /* header falls back to the job name */ }

    // Background
    const bg = skillNode.nGet('backgrnd');
    if (bg?.nGetImage) this.bgImage = bg.nGetImage() as HTMLImageElement;

    // Skill slot backgrounds
    const s0 = skillNode.nGet('skill0');
    if (s0?.nGetImage) this.skill0Image = s0.nGetImage() as HTMLImageElement;
    const s1 = skillNode.nGet('skill1');
    if (s1?.nGetImage) this.skill1Image = s1.nGetImage() as HTMLImageElement;

    // Separator line
    const ln = skillNode.nGet('line');
    if (ln?.nGetImage) this.lineImage = ln.nGetImage() as HTMLImageElement;

    // Tab label images (roman numerals / circle for beginner)
    const tabNode = skillNode.nGet('Tab');
    if (tabNode) {
      const enabledNode = tabNode.nGet('enabled');
      const disabledNode = tabNode.nGet('disabled');
      for (let i = 0; i < 5; i++) {
        const en = enabledNode?.nGet(String(i));
        this.tabEnabled.push(en?.nGetImage ? en.nGetImage() as HTMLImageElement : null);
        const dis = disabledNode?.nGet(String(i));
        this.tabDisabled.push(dis?.nGetImage ? dis.nGetImage() as HTMLImageElement : null);
      }
    }

    // Tab plates. The Skill window ships only the numerals, so the plates come
    // from the inventory's set — Tab1 is the pink selected one, Tab0 the grey
    // unselected, five of each and shared by both windows in the original.
    try {
      const newNode: any = await WZManager.get('UI.wz/UIWindow.img/Item/New');
      const on = newNode?.nGet('Tab1');
      const off = newNode?.nGet('Tab0');
      for (let i = 0; i < 5; i++) {
        const a = on?.nGet(String(i));
        this.tabPlateOn.push(a?.nGetImage ? a.nGetImage() as HTMLImageElement : null);
        const b = off?.nGet(String(i));
        this.tabPlateOff.push(b?.nGetImage ? b.nGetImage() as HTMLImageElement : null);
      }
    } catch { /* numerals still draw on the background's bare strip */ }

    // SP+ button
    const spNode = skillNode.nGet('BtSpUp');
    if (spNode) {
      const n = spNode.nGet('normal')?.nGet('0');
      if (n?.nGetImage) this.spBtnNormal = n.nGetImage() as HTMLImageElement;
      const p = spNode.nGet('pressed')?.nGet('0');
      if (p?.nGetImage) this.spBtnPressed = p.nGetImage() as HTMLImageElement;
      const d = spNode.nGet('disabled')?.nGet('0');
      if (d?.nGetImage) this.spBtnDisabled = d.nGetImage() as HTMLImageElement;
      const m = spNode.nGet('mouseOver')?.nGet('0');
      if (m?.nGetImage) this.spBtnMouseOver = m.nGetImage() as HTMLImageElement;
    }

    // Load Basic.img assets (close button + scrollbar)
    try {
      const basicNode: any = await WZManager.get('UI.wz/Basic.img');

      // Scrollbar
      const vscr = basicNode?.VScr4;
      if (vscr?.enabled) {
        this.scrollPrev = vscr.enabled.prev0?.nGetImage() as HTMLImageElement;
        this.scrollNext = vscr.enabled.next0?.nGetImage() as HTMLImageElement;
        this.scrollThumb = vscr.enabled.thumb0?.nGetImage() as HTMLImageElement;
      }
      const vscrBase = basicNode?.VScr;
      if (vscrBase?.enabled) {
        this.scrollBg = vscrBase.enabled.base0?.nGetImage() as HTMLImageElement;
      }
    } catch (e) { /* optional */ }

    // Close button (blue X) — top-right corner
    try {
      const basicNode: any = await WZManager.get('UI.wz/Basic.img');
      const btCloseNode = basicNode?.BtClose;
      if (btCloseNode?.nChildren) {
        this.closeButton = new MapleStanceButton(null, {
          x: this.x + WIN_W - 19,
          y: this.y + 8,
          img: btCloseNode.nChildren,
          isRelativeToCamera: true,
          isPartOfUI: true,
          onClick: () => { this.setIsHidden(true); },
        });
        this.closeButton.isHidden = true; // starts hidden with the menu
        ClickManager.addButton(this.closeButton);
      }
    } catch (e) { /* close button optional */ }

    ClickManager.addDragableMenu(this);
  }

  getRect(_camera: CameraInterface) {
    return { x: this.x, y: this.y, width: WIN_W, height: WIN_H };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
    if (this.closeButton) this.closeButton.isHidden = isHidden;
    if (!isHidden && !this.skillsLoaded) {
      this.loadSkillsForCurrentJob();
    }
    if (!isHidden) {
      this.refreshTabSkills();
    }
  }

  moveTo(position: { x: number; y: number }) {
    const dx = position.x - this.x;
    const dy = position.y - this.y;
    this.x = position.x;
    this.y = position.y;
    if (this.closeButton) {
      this.closeButton.x += dx;
      this.closeButton.y += dy;
    }
  }

  private async loadSkillsForCurrentJob() {
    if (!this.charecter) return;
    const jobId = this.charecter.stats.jobId;
    this.jobTierIds = SkillData.getJobTierFileIds(jobId);
    this.maxTabs = this.jobTierIds.length;
    await SkillData.preloadForJob(jobId);
    this.skillsLoaded = true;
    this.currentTab = 0;
    this.refreshTabSkills();
    for (const tierId of this.jobTierIds) void this.loadBookIcon(tierId);
  }

  /**
   * The book sitting in the header is the job tier's own skill-book icon,
   * `Skill.wz/<tier>.img/info/icon` (26x30) — green for Warrior, blue for
   * Magician, and so on. The window background ships a generic "SKILL BOOK"
   * placeholder drawn in its place, which is what we were leaving on screen.
   */
  private async loadBookIcon(jobFileId: number) {
    if (this.bookIcons[jobFileId]) return;
    try {
      const file = String(jobFileId).padStart(3, '0');
      const node: any = await WZManager.get(`Skill.wz/${file}.img/info/icon`);
      if (node?.nTagName === 'canvas' && node.nGetImage) {
        this.bookIcons[jobFileId] = node.nGetImage() as HTMLImageElement;
      }
    } catch { /* placeholder in the background stays visible */ }
  }

  private async refreshTabSkills() {
    if (!this.charecter || this.jobTierIds.length === 0) return;
    const tabJobId = this.jobTierIds[this.currentTab];
    if (tabJobId === undefined) return;
    try {
      const skills = await SkillData.getVisibleJobSkills(tabJobId);
      console.log(`[SkillMenu] Tab ${this.currentTab} (job ${tabJobId}): ${skills.length} visible skills`);
      this.tabSkills = skills;
      this.scrollOffset = 0;
    } catch (e) {
      console.error('[SkillMenu] Failed to load skills:', e);
    }
  }

  update(msPerTick: number) {
    if (this.isHidden) return;
    this.delay += msPerTick;
  }

  draw(canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) {
    if (this.isHidden) return;

    this._GameCanvas = canvas;

    if (!this.isNotFirstDraw) {
      this.loadSkillsForCurrentJob();
      this.isNotFirstDraw = true;
    }

    UIDevTools.track('skillWindow', this.x, this.y, WIN_W, WIN_H, 'screen', 'UI.wz/UIWindow.img/Skill');

    // 1. Background — drawn in 3 slices to extend the content area
    if (this.bgImage) {
      // Top slice (title, tabs, gold bar)
      canvas.drawImage({
        img: this.bgImage, dx: this.x, dy: this.y,
        sx: 0, sy: 0, sw: WIN_W, sh: BG_TOP_H,
      });
      // Extended content area (white fill)
      canvas.drawRect({
        x: this.x, y: this.y + BG_TOP_H,
        width: WIN_W, height: CONTENT_H,
        color: '#fafbfb',  // rgb(250,251,251) from wzLayout
      });
      // Left/right borders in content area
      const ctx = canvas.context;
      ctx.save();
      ctx.strokeStyle = '#c0c0c0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(this.x + 1, this.y + BG_TOP_H);
      ctx.lineTo(this.x + 1, this.y + BG_TOP_H + CONTENT_H);
      ctx.moveTo(this.x + WIN_W - 2, this.y + BG_TOP_H);
      ctx.lineTo(this.x + WIN_W - 2, this.y + BG_TOP_H + CONTENT_H);
      ctx.stroke();
      ctx.restore();
      // Bottom slice (SKILL POINT section)
      canvas.drawImage({
        img: this.bgImage, dx: this.x, dy: this.y + BG_TOP_H + CONTENT_H,
        sx: 0, sy: BG_BOTTOM_Y, sw: WIN_W, sh: BG_BOTTOM_H,
      });
    }

    // 2. Tab buttons (pink for active, gray for inactive)
    this.drawTabs(canvas);

    // 3. Job name text on gold bar
    this.drawTabLabel(canvas);

    // 4. Skill list
    this.drawSkillList(canvas);

    // 5. SP count at bottom
    this.drawSPCount(canvas);

    // 6. Close button (must draw explicitly!)
    if (this.closeButton && !this.closeButton.isHidden) {
      this.closeButton.draw(canvas, camera, lag, msPerTick, tdelta);
    }

    // 7. Hover detection + tooltip
    this.updateHover(canvas);
    if (this._hoveredSkill) {
      this.drawTooltip(canvas);
    }

    // 8. Handle clicks + drag initiation
    if ((canvas as any).wasClicked && !DragManager.isDragging) {
      this.handleClick((canvas as any).mouseX || 0, (canvas as any).mouseY || 0);
      // Also start pending drag on the hovered skill
      this.tryBeginDrag(canvas);
    }

    // 9. Handle scroll
    if ((canvas as any).scrolledUp) this.handleScroll(-1);
    if ((canvas as any).scrolledDown) this.handleScroll(1);
  }

  // ─── Tabs: WZ numeral images on the built-in strip (no custom chrome) ───
  private drawTabs(canvas: GameCanvas) {
    for (let i = 0; i < this.maxTabs && i < 5; i++) {
      const isActive = i === this.currentTab;
      const tabX = this.x + TAB_X_START + i * (TAB_W + TAB_GAP);
      const tabY = this.y + TAB_Y;

      // Plate first: Tab1 is the pink selected one, Tab0 the grey rest. The
      // selected plate is a pixel taller (19 vs 18) because it rises over the
      // strip's red underline, so both are bottom-aligned to keep that edge
      // where the background draws it.
      // Always variant 0. These five plates are the *inventory's* per-tab
      // tinting, not shapes — Tab1/0 is (238,102,136) while Tab1/1 is
      // (255,170,187), a visibly lighter pink, and the greys drift the same
      // way. Indexing them by tab number gave every tab its own shade; the
      // skill window uses one colour for all of them.
      const plate = isActive ? this.tabPlateOn[0] : this.tabPlateOff[0];
      const plateH = plate?.height || TAB_PLATE_H;
      const plateW = plate?.width || TAB_W;
      // Hang from the underline: an unselected plate is a pixel shorter, so
      // aligning tops instead would leave it floating and break the line.
      const plateY = this.y + TAB_STRIP_BOTTOM - plateH;
      if (plate) canvas.drawImage({ img: plate, dx: tabX, dy: plateY });

      // Numeral centred in the plate it sits on — not in a fixed box, since
      // the two plates differ in height and the glyphs differ in both.
      // `enabled` is the dark glyph for the lit tab, `disabled` the light one,
      // so they pair with the pink and grey plates respectively.
      const tabImg = isActive ? this.tabEnabled[i] : this.tabDisabled[i];
      if (tabImg && tabImg.complete && tabImg.width > 0) {
        const ix = tabX + Math.round((plateW - tabImg.width) / 2);
        const iy = plateY + Math.round((plateH - tabImg.height) / 2);
        canvas.drawImage({ img: tabImg, dx: ix, dy: iy });
      }
    }
  }

  // ─── Job tier name on gold bar ─────────────────────────────────
  private drawTabLabel(canvas: GameCanvas) {
    const tabJobId = this.jobTierIds[this.currentTab];
    let tabName =
      this.bookNames[tabJobId] ||
      (this.currentTab === 0 ? "Beginner's Basics" : '') ||
      getJobNameById(tabJobId) ||
      `${this.currentTab}${this.currentTab === 1 ? 'st' : this.currentTab === 2 ? 'nd' : this.currentTab === 3 ? 'rd' : 'th'} Job`;

    const book = this.bookIcons[tabJobId];
    if (book) {
      canvas.drawImage({ img: book, dx: this.x + BOOK_ICON_X, dy: this.y + BOOK_ICON_Y });
    } else {
      void this.loadBookIcon(tabJobId);
    }

    canvas.drawText({
      text: tabName,
      color: '#ffffff',
      fontSize: 11,
      fontWeight: 'bold',
      x: this.x + LABEL_TEXT_X,
      y: this.y + LABEL_TEXT_Y,
      align: 'center',
    });
  }

  // ─── Skill list ────────────────────────────────────────────────
  private drawSkillList(canvas: GameCanvas) {
    const skills = this.tabSkills;
    const end = Math.min(this.scrollOffset + MAX_VISIBLE_SKILLS, skills.length);

    const listX = this.x + SKILL_LIST_X;
    const listY = this.y + SKILL_LIST_Y;

    for (let i = this.scrollOffset; i < end; i++) {
      const skill = skills[i];
      const slotIdx = i - this.scrollOffset;
      const sx = listX;
      const sy = listY + slotIdx * SKILL_ROW_H;

      const playerLevel = this.charecter?.skillManager?.getSkillLevel(skill.id) ?? 0;
      const isLearned = playerLevel > 0;

      // Slot background from WZ
      const slotBg = isLearned ? this.skill1Image : this.skill0Image;
      if (slotBg) {
        canvas.drawImage({ img: slotBg, dx: sx, dy: sy });
      }

      // Separator line
      if (this.lineImage && slotIdx < end - this.scrollOffset - 1) {
        canvas.drawImage({ img: this.lineImage, dx: sx, dy: sy + SKILL_SLOT_H });
      }

      // Skill icon (32x32)
      const icon = isLearned ? skill.icon : (skill.iconDisabled || skill.icon);
      if (icon) {
        canvas.drawImage({ img: icon, dx: sx + ICON_X, dy: sy + ICON_Y });
      }

      // Skill name, clipped to the room between the icon and the SP button.
      // The row plate is only 141px wide and names like "Improved MaxHP
      // Increase" are far wider than the 88px available, so drawn in full they
      // ran out of the window and across the scrollbar. GMS cuts them off.
      canvas.drawText({
        text: fitText(canvas, skill.name, NAME_MAX_W, NAME_FONT_SIZE),
        color: '#000000',
        fontSize: NAME_FONT_SIZE,
        fontWeight: 'bold',
        x: sx + NAME_X,
        y: sy + NAME_Y,
      });

      // Skill level (just the number, matching GMS)
      canvas.drawText({
        text: String(playerLevel),
        color: '#000000',
        fontSize: 11,
        fontWeight: 'bold',
        x: sx + LEVEL_X,
        y: sy + LEVEL_Y,
      });

      // SP+ button
      const sp = this.charecter?.stats.sp ?? 0;
      const canLevel = sp > 0 && playerLevel < skill.maxLevel;
      const btnImg = canLevel ? this.spBtnNormal : this.spBtnDisabled;
      if (btnImg) {
        canvas.drawImage({ img: btnImg, dx: sx + SP_BTN_X, dy: sy + SP_BTN_Y });
      }
    }

    // Scrollbar on the right side
    this.drawScrollbar(canvas, skills.length);
  }

  // ─── Scrollbar (always visible, like GMS) ──────────────────────
  private drawScrollbar(canvas: GameCanvas, totalSkills: number) {
    // Scrollbar sits to the right of the skill list
    const sbX = this.x + SKILL_LIST_X + SKILL_SLOT_W + 3;
    const sbTopY = this.y + SKILL_LIST_Y;
    const sbH = MAX_VISIBLE_SKILLS * SKILL_ROW_H;
    const arrowH = this.scrollPrev?.height || 15;
    const sbW = this.scrollPrev?.width || 13;
    const canScroll = totalSkills > MAX_VISIBLE_SKILLS;

    // Track background (always drawn)
    const ctx = canvas.context;
    ctx.save();
    ctx.fillStyle = '#dde0e4';
    ctx.fillRect(sbX + 1, sbTopY, sbW - 2, sbH);
    ctx.strokeStyle = '#aab0b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(sbX, sbTopY, sbW, sbH);
    ctx.restore();

    // Up arrow
    if (this.scrollPrev) {
      canvas.drawImage({ img: this.scrollPrev, dx: sbX, dy: sbTopY });
    }

    // Down arrow
    if (this.scrollNext) {
      canvas.drawImage({ img: this.scrollNext, dx: sbX, dy: sbTopY + sbH - arrowH });
    }

    // Thumb (only if scrollable)
    if (canScroll && this.scrollThumb) {
      const trackY = sbTopY + arrowH;
      const trackH = sbH - arrowH * 2;
      const maxOffset = Math.max(1, totalSkills - MAX_VISIBLE_SKILLS);
      const thumbRange = trackH - (this.scrollThumb.height || 10);
      const thumbY = trackY + Math.round((this.scrollOffset / maxOffset) * thumbRange);
      canvas.drawImage({ img: this.scrollThumb, dx: sbX, dy: thumbY });
    }
  }

  // ─── SP count ──────────────────────────────────────────────────
  private drawSPCount(canvas: GameCanvas) {
    if (!this.charecter) return;
    canvas.drawText({
      text: String(this.charecter.stats.sp),
      color: '#000000',
      fontSize: 11,
      x: this.x + SP_NUM_X,
      y: this.y + BG_TOP_H + CONTENT_H + SP_NUM_BOTTOM_OFFSET,
      align: 'center',
    });
  }

  // ─── Drag initiation ────────────────────────────────────────────
  private tryBeginDrag(canvas: GameCanvas) {
    const skill = this._hoveredSkill;
    if (!skill) return;
    const playerLevel = this.charecter?.skillManager?.getSkillLevel(skill.id) ?? 0;
    if (playerLevel <= 0) return; // can't drag unlearned skills
    if (!skill.icon) return;
    // Only if this window is the one actually under the cursor — otherwise a
    // drag started in the inventory on top of it also started a skill drag,
    // and this one, being drawn last, overwrote it.
    if (!this.ownsPoint(canvas.mouseX, canvas.mouseY)) return;

    DragManager.beginPending('skill', skill.id, skill.icon, canvas.mouseX, canvas.mouseY);
  }

  // ─── Hover detection ────────────────────────────────────────────
  private updateHover(canvas: GameCanvas) {
    const mx = (canvas as any).mouseX || 0;
    const my = (canvas as any).mouseY || 0;

    const listX = this.x + SKILL_LIST_X;
    const listY = this.y + SKILL_LIST_Y;
    const end = Math.min(this.scrollOffset + MAX_VISIBLE_SKILLS, this.tabSkills.length);

    this._hoveredSkill = null;
    for (let i = this.scrollOffset; i < end; i++) {
      const slotIdx = i - this.scrollOffset;
      const sx = listX;
      const sy = listY + slotIdx * SKILL_ROW_H;
      if (mx >= sx && mx <= sx + SKILL_SLOT_W && my >= sy && my <= sy + SKILL_SLOT_H) {
        this._hoveredSkill = this.tabSkills[i];
        break;
      }
    }
  }

  // ─── Skill tooltip ─────────────────────────────────────────────
  /**
   * Skill tooltip, laid out the way the original client does it:
   *
   *   • Skill Name                     <- header band
   *   [icon]  [Master Level : N]
   *           description text, wrapped
   *           Required Skill : ...     <- #c..# renders orange
   *   ------------------------------   <- divider
   *   [Current Level N]
   *   effect line for that level
   *   [Required]
   *   [icon] Prerequisite name
   *          Level : 5
   *
   * The body text is NOT reconstructed — `desc` and `h<level>` come straight
   * out of String.wz, including Nexon's own quirks (2000001's desc is missing
   * its opening bracket). Only the [Current Level] / [Required] labels are
   * ours, and they are the client's chrome rather than content.
   */
  private drawTooltip(canvas: GameCanvas) {
    const skill = this._hoveredSkill;
    if (!skill) return;

    const ctx = canvas.context;
    const playerLevel = this.charecter?.skillManager?.getSkillLevel(skill.id) ?? 0;

    const TT_W = 232;
    const PAD = 8;
    const LINE_H = 13;
    const ICON_BOX = 44;                  // icon plus its inset
    const DESC_X = PAD + ICON_BOX + 6;    // text column beside the icon
    const DESC_W = TT_W - DESC_X - PAD;
    const FULL_W = TT_W - PAD * 2;

    ctx.save();
    ctx.font = '11px Arial';

    // ── measure ───────────────────────────────────────────────────────────
    const descSegs = this.parseSkillDesc(skill.description);
    const descLines = this.wrapSegments(ctx, descSegs, DESC_W);
    const headH = 20;
    const bodyH = Math.max(ICON_BOX, descLines.length * LINE_H) + 6;

    const curKey = `h${playerLevel}`;
    const curStr = playerLevel > 0 ? skill.helpStrings.get(curKey) : undefined;
    const curLines = curStr ? this.wrapTextPixel(ctx, curStr, 11, FULL_W) : [];
    const curH = curStr ? LINE_H * (1 + curLines.length) + 4 : 0;

    const reqs = (skill.req || []).filter((r) => r.level > 0);
    const reqH = reqs.length ? LINE_H + reqs.length * 34 + 2 : 0;

    const TT_H = headH + bodyH + (curH || reqH ? 8 : 0) + curH + reqH + PAD;

    // ── position ──────────────────────────────────────────────────────────
    const my = (canvas as any).mouseY || 0;
    let tx = this.x + WIN_W + 4;
    let ty = my - 10;
    if (tx + TT_W > canvas.game.width) tx = this.x - TT_W - 4;
    if (ty + TT_H > canvas.game.height) ty = canvas.game.height - TT_H - 4;
    if (ty < 0) ty = 0;

    // ── panel ─────────────────────────────────────────────────────────────
    // Sampled straight off reference captures: the body is (68,74,125) and the
    // header band (85,85,130), and those two values dominate both screenshots
    // despite completely different scenes behind them. That small spread — ~17
    // across the whole image — is what fixes the alpha near 0.9; a genuinely
    // see-through panel would swing far more with its background. So the fill
    // is essentially the colour you see, barely translucent.
    ctx.fillStyle = 'rgba(68, 74, 125, 0.9)';
    ctx.fillRect(tx, ty, TT_W, TT_H);
    ctx.fillStyle = 'rgba(85, 85, 130, 0.9)';
    ctx.fillRect(tx, ty, TT_W, headH);
    ctx.strokeStyle = 'rgba(150, 158, 200, 0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx + 0.5, ty + 0.5, TT_W - 1, TT_H - 1);

    // ── header: bullet + name ─────────────────────────────────────────────
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Arial';
    ctx.fillText('\u2022', tx + PAD, ty + 14);
    ctx.fillText(skill.name, tx + PAD + 9, ty + 14);

    // ── icon ──────────────────────────────────────────────────────────────
    let y = ty + headH + 4;
    const icon = skill.icon;
    if (icon && icon.complete && icon.width > 0) {
      const ix = tx + PAD + Math.floor((ICON_BOX - icon.width) / 2);
      canvas.drawImage({ img: icon, dx: ix, dy: y + 2 });
    }

    // ── description beside the icon ───────────────────────────────────────
    ctx.font = '11px Arial';
    let dy = y + 11;
    for (const line of descLines) {
      let dx = tx + DESC_X;
      for (const seg of line) {
        ctx.fillStyle = seg.color;
        ctx.fillText(seg.text, dx, dy);
        dx += ctx.measureText(seg.text).width;
      }
      dy += LINE_H;
    }
    y += bodyH;

    // ── divider ───────────────────────────────────────────────────────────
    if (curStr || reqs.length) {
      ctx.strokeStyle = 'rgba(150, 158, 200, 0.85)';
      ctx.beginPath();
      ctx.moveTo(tx + PAD, y + 0.5);
      ctx.lineTo(tx + TT_W - PAD, y + 0.5);
      ctx.stroke();
      y += 8;
    }

    // ── current level ─────────────────────────────────────────────────────
    if (curStr) {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`[Current Level ${playerLevel}]`, tx + PAD, y + 10);
      y += LINE_H;
      for (const l of curLines) {
        ctx.fillText(l, tx + PAD, y + 10);
        y += LINE_H;
      }
      y += 4;
    }

    // ── required skills ───────────────────────────────────────────────────
    if (reqs.length) {
      ctx.fillStyle = '#ffffff';
      ctx.fillText('[Required]', tx + PAD, y + 10);
      y += LINE_H;
      for (const r of reqs) {
        const info = SkillData.getSkillSync(r.id);
        if (info?.icon && info.icon.complete && info.icon.width > 0) {
          canvas.drawImage({ img: info.icon, dx: tx + PAD, dy: y });
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillText(info?.name || `Skill ${r.id}`, tx + PAD + 36, y + 12);
        ctx.fillText(`Level : ${r.level}`, tx + PAD + 36, y + 12 + LINE_H);
        y += 34;
      }
    }

    ctx.restore();
  }

  /**
   * Split a WZ description into coloured runs. `#c...#` is the orange
   * highlight the original uses for prerequisites and passive markers; the
   * rest renders white. Newlines survive as their own break.
   */
  private parseSkillDesc(text: string): { text: string; color: string }[] {
    const out: { text: string; color: string }[] = [];
    if (!text) return out;
    const src = text.replace(/\\n/g, '\n');
    const re = /#c(.*?)#/gs;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) out.push({ text: src.slice(last, m.index), color: '#ffffff' });
      out.push({ text: m[1], color: '#ffa023' });
      last = re.lastIndex;
    }
    if (last < src.length) out.push({ text: src.slice(last), color: '#ffffff' });
    return out;
  }

  /** Wrap coloured runs to `maxW`, keeping each run's colour across breaks. */
  private wrapSegments(
    ctx: CanvasRenderingContext2D,
    segs: { text: string; color: string }[],
    maxW: number
  ): { text: string; color: string }[][] {
    const lines: { text: string; color: string }[][] = [];
    let line: { text: string; color: string }[] = [];
    let w = 0;
    const push = () => { lines.push(line); line = []; w = 0; };
    for (const seg of segs) {
      for (const part of seg.text.split('\n')) {
        if (part !== seg.text.split('\n')[0]) push();
        for (const word of part.split(/(\s+)/)) {
          if (!word) continue;
          const ww = ctx.measureText(word).width;
          if (w + ww > maxW && w > 0) push();
          if (!/^\s+$/.test(word) || w > 0) {
            line.push({ text: word, color: seg.color });
            w += ww;
          }
        }
      }
    }
    if (line.length) lines.push(line);
    return lines;
  }

  // Strip MapleStory format codes from skill descriptions
  // #c...# = orange text, #b...# = blue, #r...# = red, etc.
  private stripSkillFormatCodes(text: string): string {
    // Remove #X...# pairs (color codes wrapping text — keep the inner text)
    let result = text.replace(/#([cbrdegk])(.*?)#/gi, '$2');
    // Remove any remaining standalone # format markers
    result = result.replace(/#[cbrdegk]/gi, '');
    // Remove trailing # that closed a format code
    result = result.replace(/#$/g, '');
    return result;
  }

  // Pixel-based word wrap using canvas measureText for accurate line breaks
  private wrapTextPixel(ctx: CanvasRenderingContext2D, text: string, fontSize: number, maxWidth: number): string[] {
    const result: string[] = [];
    ctx.save();
    ctx.font = `${fontSize}px Arial`;

    // Handle both literal \n in WZ strings and real newlines
    const rawLines = text.includes('\\n') ? text.split('\\n') : text.split('\n');
    for (const raw of rawLines) {
      const words = raw.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line.length > 0) {
          result.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) result.push(line);
    }

    ctx.restore();
    return result;
  }

  // ─── Click handling ────────────────────────────────────────────
  private handleClick(mx: number, my: number) {
    // Tab clicks
    for (let i = 0; i < this.maxTabs && i < 5; i++) {
      const tx = this.x + TAB_X_START + i * (TAB_W + TAB_GAP);
      const ty = this.y + TAB_Y;
      if (mx >= tx && mx <= tx + TAB_W && my >= ty && my <= ty + TAB_H) {
        if (i !== this.currentTab) {
          this.currentTab = i;
          this.refreshTabSkills();
        }
        return;
      }
    }

    // Skill row interactions
    const now = Date.now();
    const sp = this.charecter?.stats.sp ?? 0;
    const listX = this.x + SKILL_LIST_X;
    const listY = this.y + SKILL_LIST_Y;
    const end = Math.min(this.scrollOffset + MAX_VISIBLE_SKILLS, this.tabSkills.length);

    for (let i = this.scrollOffset; i < end; i++) {
      const skill = this.tabSkills[i];
      const slotIdx = i - this.scrollOffset;
      const sx = listX;
      const sy = listY + slotIdx * SKILL_ROW_H;

      // SP+ button click
      const btnX = sx + SP_BTN_X;
      const btnY = sy + SP_BTN_Y;
      const btnW = this.spBtnNormal?.width || 12;
      const btnH = this.spBtnNormal?.height || 12;
      if (sp > 0 && mx >= btnX && mx <= btnX + btnW && my >= btnY && my <= btnY + btnH) {
        const currentLevel = this.charecter?.skillManager?.getSkillLevel(skill.id) ?? 0;
        if (currentLevel < skill.maxLevel) {
          const newLevel = currentLevel + 1;
          const masterLevel = this.charecter?.skillManager?.getMasterLevel(skill.id) || skill.maxLevel;
          this.charecter?.skillManager?.changeSkillLevel(skill.id, newLevel, masterLevel);
          this.charecter!.stats.sp--;
          console.log(`[SkillMenu] Leveled up ${skill.name} to ${newLevel}, SP remaining: ${this.charecter!.stats.sp}`);
        }
        return;
      }

      // Skill row double-click (assign to hotkey bar)
      if (mx >= sx && mx <= sx + SKILL_SLOT_W && my >= sy && my <= sy + SKILL_SLOT_H) {
        if (this._lastClickSkillId === skill.id && now - this._lastClickTime < 500) {
          this._lastClickSkillId = -1;
          this._lastClickTime = 0;
          const playerLevel = this.charecter?.skillManager?.getSkillLevel(skill.id) ?? 0;
          if (playerLevel > 0) {
            const hotkeyBar = (window as any).__uiHotkeyBar;
            if (hotkeyBar) {
              hotkeyBar.activateSkill(skill.id);
            }
          }
        } else {
          this._lastClickSkillId = skill.id;
          this._lastClickTime = now;
        }
        return;
      }
    }
  }

  handleScroll(delta: number) {
    if (this.isHidden) return;
    const maxOffset = Math.max(0, this.tabSkills.length - MAX_VISIBLE_SKILLS);
    if (delta > 0) {
      this.scrollOffset = Math.min(maxOffset, this.scrollOffset + 1);
    } else if (delta < 0) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
    }
  }

  onJobChange() {
    this.skillsLoaded = false;
    if (!this.isHidden) {
      this.loadSkillsForCurrentJob();
    }
  }
}

export default SkillMenuSprite;
