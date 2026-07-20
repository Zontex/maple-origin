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

// Tab buttons — GMS ref shows them higher and more left
const TAB_Y = 25;
const TAB_H = 16;
const TAB_W = 26;
const TAB_X_START = 4;
const TAB_GAP = 0;

// Job name text on dark center of gold bar (y=62-80)
// Text shifted right to account for skill book icon on the left
const LABEL_TEXT_X = 110;
const LABEL_TEXT_Y = 68;

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

// SP number — inside the white box in the bottom slice
// Bottom slice starts at BG_BOTTOM_Y=257 in original. SP box center is at y=275 in original.
// So offset within bottom slice = 275 - 257 = 18
const SP_NUM_X = 126;
const SP_NUM_BOTTOM_OFFSET = 14; // from start of bottom slice to text baseline

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
  private lineImage: HTMLImageElement | null = null;
  private tabEnabled: (HTMLImageElement | null)[] = [];
  private tabDisabled: (HTMLImageElement | null)[] = [];
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

  // ─── Tab buttons with pink/gray backgrounds (same style as inventory) ───
  private drawTabs(canvas: GameCanvas) {
    const ctx = canvas.context;

    for (let i = 0; i < this.maxTabs && i < 5; i++) {
      const isActive = i === this.currentTab;
      const tabX = this.x + TAB_X_START + i * (TAB_W + TAB_GAP);
      const tabY = this.y + TAB_Y;

      // Draw rounded tab background
      ctx.save();
      const r = 3;
      ctx.beginPath();
      ctx.moveTo(tabX + r, tabY);
      ctx.lineTo(tabX + TAB_W - r, tabY);
      ctx.arcTo(tabX + TAB_W, tabY, tabX + TAB_W, tabY + r, r);
      ctx.lineTo(tabX + TAB_W, tabY + TAB_H);
      ctx.lineTo(tabX, tabY + TAB_H);
      ctx.lineTo(tabX, tabY + r);
      ctx.arcTo(tabX, tabY, tabX + r, tabY, r);
      ctx.closePath();

      if (isActive) {
        ctx.fillStyle = '#dd4466'; // pink
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = '#ee6688'; // lighter top highlight
        ctx.fillRect(tabX, tabY, TAB_W, 2);
        ctx.restore();
      } else {
        ctx.fillStyle = '#b8c4d8'; // light gray-blue
        ctx.fill();
      }
      ctx.strokeStyle = '#8899bb';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Draw tab label image (roman numeral) centered on the tab
      const tabImg = isActive ? this.tabEnabled[i] : this.tabDisabled[i];
      if (tabImg && tabImg.complete && tabImg.width > 0) {
        const ix = tabX + Math.floor((TAB_W - tabImg.width) / 2);
        const iy = tabY + Math.floor((TAB_H - tabImg.height) / 2);
        canvas.drawImage({ img: tabImg, dx: ix, dy: iy });
      }
    }
  }

  // ─── Job tier name on gold bar ─────────────────────────────────
  private drawTabLabel(canvas: GameCanvas) {
    const tabJobId = this.jobTierIds[this.currentTab];
    let tabName: string;
    if (this.currentTab === 0) {
      tabName = "Beginner's Basics";
    } else {
      tabName = getJobNameById(tabJobId) || `${this.currentTab}${this.currentTab === 1 ? 'st' : this.currentTab === 2 ? 'nd' : this.currentTab === 3 ? 'rd' : 'th'} Job`;
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

      // Skill name
      canvas.drawText({
        text: skill.name,
        color: '#000000',
        fontSize: 12,
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
  private drawTooltip(canvas: GameCanvas) {
    const skill = this._hoveredSkill;
    if (!skill) return;

    const ctx = canvas.context;
    const playerLevel = this.charecter?.skillManager?.getSkillLevel(skill.id) ?? 0;

    // Build text lines
    const lines: { text: string; color: string; bold?: boolean }[] = [];

    // Skill name
    lines.push({ text: skill.name, color: '#ffffff', bold: true });

    // Description — pixel-based wrapping using measureText
    if (skill.description) {
      // Strip format codes: #c...# (orange text), #b...# (blue), etc.
      const cleaned = this.stripSkillFormatCodes(skill.description);
      lines.push({ text: '', color: '' }); // spacer
      const descLines = this.wrapTextPixel(ctx, cleaned, 11, 178);
      for (const dl of descLines) {
        lines.push({ text: dl, color: '#cccccc' });
      }
    }

    // Current level effect
    if (playerLevel > 0) {
      const hKey = `h${playerLevel}`;
      const helpStr = skill.helpStrings.get(hKey);
      if (helpStr) {
        lines.push({ text: '', color: '' });
        lines.push({ text: `[Lv.${playerLevel}]`, color: '#44bbff', bold: true });
        const wrapped = this.wrapTextPixel(ctx, helpStr, 11, 178);
        for (const w of wrapped) {
          lines.push({ text: w, color: '#44bbff' });
        }
      }
    }

    // Next level preview
    if (playerLevel < skill.maxLevel) {
      const nextLevel = playerLevel + 1;
      const hKey = `h${nextLevel}`;
      const helpStr = skill.helpStrings.get(hKey);
      if (helpStr) {
        lines.push({ text: '', color: '' });
        lines.push({ text: `[Next Lv.${nextLevel}]`, color: '#ffaa44', bold: true });
        const wrapped = this.wrapTextPixel(ctx, helpStr, 11, 178);
        for (const w of wrapped) {
          lines.push({ text: w, color: '#ffaa44' });
        }
      }
    }

    // Calculate tooltip dimensions
    const TOOLTIP_W = 196;
    const lineH = 14;
    const padX = 9;
    const padY = 7;
    const contentH = lines.reduce((h, l) => h + (l.text ? lineH : 5), 0) + padY * 2;
    const tooltipH = contentH;

    // Position: to the right of the skill menu
    const my = (canvas as any).mouseY || 0;
    let tx = this.x + WIN_W + 4;
    let ty = my - 10;

    // Keep on screen
    if (tx + TOOLTIP_W > canvas.game.width) tx = this.x - TOOLTIP_W - 4;
    if (ty + tooltipH > canvas.game.height) ty = canvas.game.height - tooltipH - 4;
    if (ty < 0) ty = 0;

    ctx.save();

    // Dark tooltip background (matches item tooltip style)
    ctx.fillStyle = '#1c1b3a';
    ctx.globalAlpha = 0.92;
    ctx.fillRect(tx, ty, TOOLTIP_W, tooltipH);
    ctx.globalAlpha = 1;
    // Border
    ctx.strokeStyle = '#6655aa';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx + 0.5, ty + 0.5, TOOLTIP_W - 1, tooltipH - 1);

    // Draw text lines
    let textY = ty + padY + 11;
    for (const line of lines) {
      if (!line.text) { textY += 5; continue; }
      ctx.font = `${line.bold ? 'bold ' : ''}11px Arial`;
      ctx.fillStyle = line.color;
      ctx.textAlign = 'left';
      ctx.fillText(line.text, tx + padX, textY);
      textY += lineH;
    }

    ctx.restore();
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
