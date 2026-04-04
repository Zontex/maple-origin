import WZManager from '../../wz-utils/WZManager';
import ClickManager from '../ClickManager';
import { MapleStanceButton } from '../MapleStanceButton';
import DragableMenu from './DragableMenu';
import { CameraInterface } from '../../Camera';
import GameCanvas from '../../GameCanvas';
import SkillData, { SkillInfo } from '../../Skills/SkillData';
import type MapleCharacter from '../../MapleCharacter';
import { getJobBranch, getJobNameById } from '../../Constants/Jobs';
import DebugDrag from '../DebugDrag';

// Layout constants (from WZ background 175x289 + reference screenshot)
const WIN_W = 175;
const WIN_H = 289;

// Tab area: colored buttons on the dark header row
const TAB_Y = 20;          // Y offset for tab row
const TAB_H = 16;          // Tab button height
const TAB_W = 24;          // Tab button width
const TAB_X_START = 7;     // First tab X
const TAB_GAP = 2;         // Gap between tabs

// "Beginner's Basics" label bar
const LABEL_Y = 40;        // Y for the gold tab name bar
const LABEL_H = 18;

// Skill list
const SKILL_LIST_X = 17;
const SKILL_LIST_Y = 62;   // Below label bar
const SKILL_SLOT_W = 141;
const SKILL_SLOT_H = 35;
const SKILL_ICON_X = 2;
const SKILL_ICON_Y = 1;
const SKILL_NAME_X = 36;
const SKILL_NAME_Y = 5;
const SKILL_LEVEL_Y = 19;
const SP_BTN_X = 126;
const SP_BTN_Y = 10;
const SP_BTN_W = 13;
const SP_BTN_H = 13;
const MAX_VISIBLE_SKILLS = 5;

// SP number at bottom
const SP_NUM_X = 137;
const SP_NUM_Y = 270;

// Tab name labels per tier
const TAB_NAMES = ["Beginner's Basics", '1st Job', '2nd Job', '3rd Job', '4th Job'];
// Tab button colors
const TAB_COLORS_ACTIVE = ['#cc3333', '#cc3333', '#cc3333', '#cc3333', '#cc3333'];
const TAB_COLORS_INACTIVE = ['#666688', '#666688', '#666688', '#666688', '#666688'];
const TAB_LABELS = ['\u25CB', 'I', 'II', 'III', 'IV']; // ○, I, II, III, IV

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

  // WZ images
  private bgImage: HTMLImageElement | null = null;
  private skill0Image: HTMLImageElement | null = null;
  private skill1Image: HTMLImageElement | null = null;
  private lineImage: HTMLImageElement | null = null;
  private tabEnabled: HTMLImageElement[] = [];
  private tabDisabled: HTMLImageElement[] = [];
  private spBtnNormal: HTMLImageElement | null = null;
  private spBtnPressed: HTMLImageElement | null = null;
  private spBtnDisabled: HTMLImageElement | null = null;

  // State
  private tabSkills: SkillInfo[] = [];
  private scrollOffset: number = 0;
  private maxTabs: number = 1;
  private jobTierIds: number[] = [];
  private buttons: MapleStanceButton[] = [];
  private skillsLoaded: boolean = false;
  private _lastClickSkillId: number = -1;
  private _lastClickTime: number = 0;

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

    const skillNode = await WZManager.get('UI.wz/UIWindow.img/Skill');
    if (!skillNode) return;

    const bgCanvas = (skillNode as any).nGet('backgrnd');
    if (bgCanvas?.nGetImage) this.bgImage = bgCanvas.nGetImage() as HTMLImageElement;

    const s0 = (skillNode as any).nGet('skill0');
    if (s0?.nGetImage) this.skill0Image = s0.nGetImage() as HTMLImageElement;
    const s1 = (skillNode as any).nGet('skill1');
    if (s1?.nGetImage) this.skill1Image = s1.nGetImage() as HTMLImageElement;

    const ln = (skillNode as any).nGet('line');
    if (ln?.nGetImage) this.lineImage = ln.nGetImage() as HTMLImageElement;

    // Tab images (roman numeral labels)
    const tabNode = (skillNode as any).nGet('Tab');
    if (tabNode) {
      const enabledNode = (tabNode as any).nGet('enabled');
      const disabledNode = (tabNode as any).nGet('disabled');
      for (let i = 0; i < 5; i++) {
        const en = enabledNode?.nGet(String(i));
        if (en?.nGetImage) this.tabEnabled.push(en.nGetImage() as HTMLImageElement);
        const dis = disabledNode?.nGet(String(i));
        if (dis?.nGetImage) this.tabDisabled.push(dis.nGetImage() as HTMLImageElement);
      }
    }

    const spNode = (skillNode as any).nGet('BtSpUp');
    if (spNode) {
      const n = (spNode as any).nGet('normal')?.nGet('0');
      if (n?.nGetImage) this.spBtnNormal = n.nGetImage() as HTMLImageElement;
      const p = (spNode as any).nGet('pressed')?.nGet('0');
      if (p?.nGetImage) this.spBtnPressed = p.nGetImage() as HTMLImageElement;
      const d = (spNode as any).nGet('disabled')?.nGet('0');
      if (d?.nGetImage) this.spBtnDisabled = d.nGetImage() as HTMLImageElement;
    }

    ClickManager.addDragableMenu(this);
  }

  getRect(camera: CameraInterface) {
    return { x: this.x, y: this.y, width: WIN_W, height: WIN_H };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
    if (!isHidden && !this.skillsLoaded) {
      this.loadSkillsForCurrentJob();
    }
    if (!isHidden) {
      this.refreshTabSkills();
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
    const skills = await SkillData.getVisibleJobSkills(tabJobId);
    this.tabSkills = skills;
    this.scrollOffset = 0;
  }

  update(msPerTick: number) {
    if (this.isHidden) return;
    this.delay += msPerTick;
  }

  draw(canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) {
    if (this.isHidden) return;

    if (!this.isNotFirstDraw) {
      this.loadSkillsForCurrentJob();
      this.isNotFirstDraw = true;
    }

    const ctx = canvas.context;

    // Background
    if (this.bgImage) {
      canvas.drawImage({ img: this.bgImage, dx: this.x, dy: this.y });
    }

    // Tab buttons (colored rectangles with roman numerals)
    this.drawTabs(canvas);

    // Tab name label in the gold/brown bar area
    this.drawTabLabel(canvas);

    // Skill list
    this.drawSkillList(canvas);

    // SP number in the box at bottom
    if (this.charecter) {
      DebugDrag.register('sk_spNum', this.x + SP_NUM_X, this.y + SP_NUM_Y, 30, 14);
      const sp = DebugDrag.get('sk_spNum');
      canvas.drawText({
        text: String(this.charecter.stats.sp),
        color: '#000000',
        fontSize: 11,
        x: sp.x,
        y: sp.y,
        align: 'center',
      });
    }

    // Click handling (wasClicked = one-shot per mousedown)
    if ((canvas as any).wasClicked) {
      this.handleClick((canvas as any).mouseX || 0, (canvas as any).mouseY || 0);
    }
  }

  private drawTabs(canvas: GameCanvas) {
    const ctx = canvas.context;
    ctx.save();

    for (let i = 0; i < this.maxTabs && i < 5; i++) {
      const isActive = i === this.currentTab;
      const baseX = this.x + TAB_X_START + i * (TAB_W + TAB_GAP);
      const baseY = this.y + TAB_Y;
      DebugDrag.register(`sk_tab${i}`, baseX, baseY, TAB_W, TAB_H);
      const p = DebugDrag.get(`sk_tab${i}`);

      ctx.fillStyle = isActive ? TAB_COLORS_ACTIVE[i] : TAB_COLORS_INACTIVE[i];
      ctx.fillRect(p.x, p.y, TAB_W, TAB_H);
      ctx.strokeStyle = isActive ? '#ffffff' : '#444466';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x, p.y, TAB_W, TAB_H);

      const tabImg = isActive ? this.tabEnabled[i] : this.tabDisabled[i];
      if (tabImg && tabImg.complete && tabImg.width > 0) {
        const ix = p.x + Math.floor((TAB_W - tabImg.width) / 2);
        const iy = p.y + Math.floor((TAB_H - tabImg.height) / 2);
        ctx.drawImage(tabImg, ix, iy);
      }
    }

    ctx.restore();
  }

  private drawTabLabel(canvas: GameCanvas) {
    const tabName = TAB_NAMES[this.currentTab] || 'Skills';
    const ctx = canvas.context;
    ctx.save();

    const baseX = this.x + SKILL_LIST_X;
    const baseY = this.y + LABEL_Y;
    DebugDrag.register('sk_tabLabel', baseX, baseY, SKILL_SLOT_W, LABEL_H);
    const p = DebugDrag.get('sk_tabLabel');

    ctx.fillStyle = '#8B6914';
    ctx.fillRect(p.x, p.y, SKILL_SLOT_W, LABEL_H);
    ctx.strokeStyle = '#6B4F10';
    ctx.strokeRect(p.x, p.y, SKILL_SLOT_W, LABEL_H);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tabName, p.x + SKILL_SLOT_W / 2, p.y + LABEL_H / 2);

    ctx.restore();
  }

  private drawSkillList(canvas: GameCanvas) {
    const skills = this.tabSkills;
    const end = Math.min(this.scrollOffset + MAX_VISIBLE_SKILLS, skills.length);

    // Register the skill list origin (all slots are relative to this)
    const slotBaseX = this.x + SKILL_LIST_X;
    const slotBaseY = this.y + SKILL_LIST_Y;
    DebugDrag.register('sk_listOrigin', slotBaseX, slotBaseY, SKILL_SLOT_W, MAX_VISIBLE_SKILLS * SKILL_SLOT_H);
    const listPos = DebugDrag.get('sk_listOrigin');

    for (let i = this.scrollOffset; i < end; i++) {
      const skill = skills[i];
      const slotIdx = i - this.scrollOffset;
      const sx = listPos.x;
      const sy = listPos.y + slotIdx * SKILL_SLOT_H;

      const playerLevel = this.charecter?.skillManager?.getSkillLevel(skill.id) ?? 0;
      const isLearned = playerLevel > 0;

      // Slot background (WZ skill0/skill1)
      const slotBg = isLearned ? this.skill1Image : this.skill0Image;
      if (slotBg) {
        canvas.drawImage({ img: slotBg, dx: sx, dy: sy });
      }

      // Skill icon (32x32)
      const icon = isLearned ? skill.icon : (skill.iconDisabled || skill.icon);
      if (icon) {
        DebugDrag.register(`sk_icon${slotIdx}`, sx + SKILL_ICON_X, sy + SKILL_ICON_Y, 32, 32);
        const ip = DebugDrag.get(`sk_icon${slotIdx}`);
        canvas.drawImage({ img: icon, dx: ip.x, dy: ip.y });
      }

      // Skill name
      DebugDrag.register(`sk_name${slotIdx}`, sx + SKILL_NAME_X, sy + SKILL_NAME_Y, 80, 12);
      const np = DebugDrag.get(`sk_name${slotIdx}`);
      canvas.drawText({
        text: skill.name,
        color: '#000000',
        fontSize: 11,
        x: np.x,
        y: np.y,
      });

      // Skill level
      DebugDrag.register(`sk_level${slotIdx}`, sx + SKILL_NAME_X, sy + SKILL_LEVEL_Y, 30, 12);
      const lp = DebugDrag.get(`sk_level${slotIdx}`);
      canvas.drawText({
        text: String(playerLevel),
        color: '#000000',
        fontSize: 11,
        x: lp.x,
        y: lp.y,
      });

      // SP+ button
      const sp = this.charecter?.stats.sp ?? 0;
      const btnImg = (sp > 0 && playerLevel < skill.maxLevel) ? this.spBtnNormal : this.spBtnDisabled;
      if (btnImg) {
        DebugDrag.register(`sk_spBtn${slotIdx}`, sx + SP_BTN_X, sy + SP_BTN_Y, SP_BTN_W, SP_BTN_H);
        const bp = DebugDrag.get(`sk_spBtn${slotIdx}`);
        canvas.drawImage({ img: btnImg, dx: bp.x, dy: bp.y });
      }
    }

    // Scroll indicators
    if (skills.length > MAX_VISIBLE_SKILLS) {
      if (this.scrollOffset > 0) {
        canvas.drawText({
          text: '\u25B2', color: '#666666', fontSize: 10,
          x: this.x + WIN_W - 15, y: this.y + SKILL_LIST_Y - 5,
        });
      }
      if (this.scrollOffset + MAX_VISIBLE_SKILLS < skills.length) {
        canvas.drawText({
          text: '\u25BC', color: '#666666', fontSize: 10,
          x: this.x + WIN_W - 15, y: this.y + SKILL_LIST_Y + MAX_VISIBLE_SKILLS * SKILL_SLOT_H + 2,
        });
      }
    }
  }

  private handleClick(mx: number, my: number) {
    // Tab button clicks
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

    // Scroll arrows
    if (this.scrollOffset > 0) {
      const ax = this.x + WIN_W - 20;
      const ay = this.y + SKILL_LIST_Y - 12;
      if (mx >= ax && mx <= ax + 15 && my >= ay && my <= ay + 12) {
        this.scrollOffset = Math.max(0, this.scrollOffset - 1);
        return;
      }
    }
    if (this.scrollOffset + MAX_VISIBLE_SKILLS < this.tabSkills.length) {
      const ax = this.x + WIN_W - 20;
      const ay = this.y + SKILL_LIST_Y + MAX_VISIBLE_SKILLS * SKILL_SLOT_H;
      if (mx >= ax && mx <= ax + 15 && my >= ay && my <= ay + 12) {
        this.scrollOffset++;
        return;
      }
    }

    // Skill row interactions
    const now = Date.now();
    const sp = this.charecter?.stats.sp ?? 0;
    const end = Math.min(this.scrollOffset + MAX_VISIBLE_SKILLS, this.tabSkills.length);
    for (let i = this.scrollOffset; i < end; i++) {
      const skill = this.tabSkills[i];
      const slotIdx = i - this.scrollOffset;
      const sx = this.x + SKILL_LIST_X;
      const sy = this.y + SKILL_LIST_Y + slotIdx * SKILL_SLOT_H;

      // SP+ button click
      const btnX = sx + SP_BTN_X;
      const btnY = sy + SP_BTN_Y;
      if (sp > 0 && mx >= btnX && mx <= btnX + SP_BTN_W && my >= btnY && my <= btnY + SP_BTN_H) {
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

      // Skill row click (double-click to use skill)
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
    if (delta > 0) {
      this.scrollOffset = Math.min(
        Math.max(0, this.tabSkills.length - MAX_VISIBLE_SKILLS),
        this.scrollOffset + 1
      );
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
