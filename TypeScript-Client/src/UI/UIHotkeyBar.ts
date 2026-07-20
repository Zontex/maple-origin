import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import MyCharacter from '../MyCharacter';
import SkillData, { SkillInfo } from '../Skills/SkillData';
import WZManager from '../wz-utils/WZManager';
import PLAY_AUDIO from '../Audio/PlayAudio';
import config from '../Config';
import DragManager, { DragType } from './DragManager';

// Hotkey slot definition
interface HotkeySlot {
  type: 'skill' | 'item' | 'none';
  actionId: number;
  key: string;       // GameCanvas key name (e.g., 'shift', 'z', 'f1')
  label: string;     // Display label
  icon: HTMLImageElement | null;
}

// Default quickslot layout — matches common v83 setup
// 8 slots in a 4×2 grid inside the quickSlot background (151×80)
const DEFAULT_SLOTS: { key: string; label: string }[] = [
  // Top row (left to right)
  { key: 'shift', label: 'Shift' },
  { key: 'insert', label: 'Ins' },
  { key: 'delete', label: 'Del' },
  { key: 'home', label: 'Home' },
  // Bottom row (left to right)
  { key: 'end', label: 'End' },
  { key: 'pageup', label: 'PgUp' },
  { key: 'pagedown', label: 'PgDn' },
  { key: 'f1', label: 'F1' },
];

// QuickSlot background layout constants (derived from 151×80 WZ image analysis)
const QS_W = 151;
const QS_H = 80;
const COLS = 4;
const ROWS = 2;
// Slot positions inside the quickSlot background (from pixel analysis)
// Grid borders: x = 7/39-41/74-76/109-111/144, y = 3/38-42/77
const SLOT_X = [8, 42, 77, 112];        // interior left edge per column
const SLOT_Y = [4, 43];                  // interior top edge per row
const SLOT_W = 31;                       // slot interior width
const SLOT_H = 34;                       // slot interior height

const UIHotkeyBar = {
  slots: [] as HotkeySlot[],
  isVisible: false,
  barX: 0,
  barY: 0,
  previousKeyState: {} as Record<string, boolean>,
  _initialized: false,

  // WZ assets
  _bgImage: null as HTMLImageElement | null,
  _coolTimeFrames: [] as HTMLImageElement[],
  _assetsLoaded: false,
  // Track which slot a drag originated from (for removing on drop-outside)
  _dragSourceSlot: -1,

  initialize() {
    // Create empty slots with default key bindings
    this.slots = DEFAULT_SLOTS.map(s => ({
      type: 'none' as const,
      actionId: 0,
      key: s.key,
      label: s.label,
      icon: null,
    }));
    this._initialized = true;
    // Initialize previous key state
    for (const slot of this.slots) {
      this.previousKeyState[slot.key] = false;
    }
    // Load WZ assets
    this.loadAssets();
  },

  async loadAssets() {
    if (this._assetsLoaded) return;
    this._assetsLoaded = true;

    try {
      // QuickSlot background from StatusBar.img
      const statusBar: any = await WZManager.get('UI.wz/StatusBar.img');
      if (statusBar) {
        const qsNode = statusBar.nGet('base')?.nGet('quickSlot');
        if (qsNode?.nGetImage) {
          this._bgImage = qsNode.nGetImage() as HTMLImageElement;
        }
      }

      // CoolTime overlay frames from UIWindow.img/Skill/CoolTime
      const skillUI: any = await WZManager.get('UI.wz/UIWindow.img/Skill');
      if (skillUI) {
        const ctNode = skillUI.nGet('CoolTime');
        if (ctNode?.nChildren) {
          for (let i = 0; i < 16; i++) {
            const frame = ctNode.nGet(String(i));
            if (frame?.nGetImage) {
              this._coolTimeFrames.push(frame.nGetImage() as HTMLImageElement);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[HotkeyBar] Failed to load WZ assets:', e);
    }
  },

  // Assign a skill to a slot
  async assignSkill(slotIndex: number, skillId: number) {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;
    const info = await SkillData.getSkill(skillId);
    this.slots[slotIndex] = {
      ...this.slots[slotIndex],
      type: 'skill',
      actionId: skillId,
      icon: info?.icon || null,
    };
    console.log(`[HotkeyBar] Assigned skill ${info?.name || skillId} to slot ${slotIndex} (${this.slots[slotIndex].label})`);
  },

  // Clear a slot
  clearSlot(slotIndex: number) {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;
    this.slots[slotIndex].type = 'none';
    this.slots[slotIndex].actionId = 0;
    this.slots[slotIndex].icon = null;
  },

  // Check key activations and execute bound skills
  checkKeyActivations(canvas: GameCanvas) {
    if (!this._initialized) return;

    for (const slot of this.slots) {
      if (slot.type === 'none') continue;

      const isDown = canvas.isKeyDown(slot.key);
      const wasDown = this.previousKeyState[slot.key] ?? false;

      // Edge detection — trigger on press, not hold
      if (isDown && !wasDown) {
        if (slot.type === 'skill') {
          this.activateSkill(slot.actionId);
        }
      }

      this.previousKeyState[slot.key] = isDown;
    }
  },

  activateSkill(skillId: number) {
    const sm = MyCharacter.skillManager;
    if (!sm || !sm.hasSkill(skillId)) return;

    const effect = sm.getSkillEffectSync(skillId);
    if (!effect) return;

    // Check cooldown
    if (sm.isOnCooldown(skillId)) {
      return;
    }

    // Check MP
    if (effect.mpCon > 0 && MyCharacter.mp < effect.mpCon) {
      return;
    }

    // Check HP cost
    if (effect.hpCon > 0 && MyCharacter.hp <= effect.hpCon) {
      return;
    }

    // Consume resources
    if (effect.mpCon > 0) MyCharacter.mp -= effect.mpCon;
    if (effect.hpCon > 0) MyCharacter.hp -= effect.hpCon;

    // Start cooldown
    if (effect.cooltime > 0) {
      sm.startCooldown(skillId, effect.cooltime);
    }

    // Get skill info for type
    const info = SkillData.getSkillSync(skillId);
    if (!info) return;

    if (info.isAttack) {
      // Attack skill — use the skill attack system
      MyCharacter.useSkill?.(skillId, effect);
    } else if (info.isBuff) {
      // Buff skill — apply buff
      if (MyCharacter.buffManager) {
        MyCharacter.buffManager.applyBuff(skillId, effect);
      }
      // Play skill-specific sound and effect animation
      this.playSkillSound(skillId);
      this.playSkillEffect(skillId);
    }
  },

  render(canvas: GameCanvas, _camera: CameraInterface) {
    if (!this._initialized || !this.isVisible) return;

    // Position at bottom-right, vertically aligned with status bar top
    // Status bar starts at config.height - 71
    this.barX = config.width - QS_W;
    this.barY = config.height - 71 - QS_H + 9; // overlap slightly into status bar like GMS

    const ctx = canvas.context;

    // Draw WZ quickSlot background
    if (this._bgImage && this._bgImage.complete && this._bgImage.width > 0) {
      ctx.drawImage(this._bgImage, this.barX, this.barY);
    }

    // Draw each slot in the 4×2 grid
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const sx = this.barX + SLOT_X[col];
      const sy = this.barY + SLOT_Y[row];

      // Skill icon — centered within the slot
      if (slot.icon && slot.icon.complete && slot.icon.width > 0) {
        const iconSize = 32;
        const ix = sx + Math.floor((SLOT_W - iconSize) / 2);
        const iy = sy + Math.floor((SLOT_H - iconSize) / 2);
        ctx.drawImage(slot.icon, ix, iy, iconSize, iconSize);
      }

      // Cooldown overlay using CoolTime frames
      if (slot.type === 'skill' && MyCharacter.skillManager?.isOnCooldown(slot.actionId)) {
        const remaining = MyCharacter.skillManager.getCooldownRemaining(slot.actionId);
        const effect = MyCharacter.skillManager.getSkillEffectSync(slot.actionId);
        const totalMs = ((effect?.cooltime || 1)) * 1000;
        const ratio = Math.min(1, remaining / totalMs);

        if (this._coolTimeFrames.length > 0) {
          const frameIdx = Math.min(this._coolTimeFrames.length - 1, Math.floor(ratio * this._coolTimeFrames.length));
          const cdImg = this._coolTimeFrames[frameIdx];
          if (cdImg && cdImg.complete && cdImg.width > 0) {
            ctx.drawImage(cdImg, sx, sy, SLOT_W, SLOT_H);
          }
        }

        // Cooldown seconds
        const secs = Math.ceil(remaining / 1000);
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(secs), sx + SLOT_W / 2, sy + SLOT_H / 2);
        ctx.restore();
      }

      // Key label — small white text in upper-left corner of slot (like GMS)
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = '9px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(slot.label, sx + 1, sy + 1);
      ctx.restore();
    }

    // Initiate drag FROM a hotkey bar slot (to remove it)
    if (canvas.wasClicked && !DragManager.isDragging) {
      const clickedSlot = this.getSlotAtMouse(canvas.mouseX, canvas.mouseY);
      if (clickedSlot >= 0 && this.slots[clickedSlot].type !== 'none' && this.slots[clickedSlot].icon) {
        this._dragSourceSlot = clickedSlot;
        DragManager.beginPending(
          this.slots[clickedSlot].type as DragType,
          this.slots[clickedSlot].actionId,
          this.slots[clickedSlot].icon,
          canvas.mouseX,
          canvas.mouseY,
        );
      }
    }

  },

  // Find which slot index the mouse is over (-1 if none)
  getSlotAtMouse(mx: number, my: number): number {
    for (let i = 0; i < this.slots.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const sx = this.barX + SLOT_X[col];
      const sy = this.barY + SLOT_Y[row];
      if (mx >= sx && mx < sx + SLOT_W && my >= sy && my < sy + SLOT_H) {
        return i;
      }
    }
    return -1;
  },

  // Handle a drop from DragManager
  async handleDrop(drop: { type: DragType; id: number; icon: HTMLImageElement | null; mouseX: number; mouseY: number }) {
    const slotIdx = this.getSlotAtMouse(drop.mouseX, drop.mouseY);

    // If this drag originated from the hotkey bar...
    const srcSlot = this._dragSourceSlot;
    this._dragSourceSlot = -1;
    if (srcSlot >= 0) {
      if (slotIdx >= 0 && slotIdx !== srcSlot) {
        // Dropped on another slot — move source to target, swap if target occupied
        const srcData = { type: this.slots[srcSlot].type, actionId: this.slots[srcSlot].actionId, icon: this.slots[srcSlot].icon };
        const dstData = { type: this.slots[slotIdx].type, actionId: this.slots[slotIdx].actionId, icon: this.slots[slotIdx].icon };
        // Put source skill into target slot
        this.slots[slotIdx].type = srcData.type;
        this.slots[slotIdx].actionId = srcData.actionId;
        this.slots[slotIdx].icon = srcData.icon;
        // Put target's old content (or empty) into source slot
        this.slots[srcSlot].type = dstData.type;
        this.slots[srcSlot].actionId = dstData.actionId;
        this.slots[srcSlot].icon = dstData.icon;
      } else if (slotIdx < 0) {
        // Dropped outside the bar — remove from slot
        this.clearSlot(srcSlot);
      }
      return;
    }

    // External drop (from skill menu or inventory)
    if (slotIdx < 0) return;
    if (drop.type === 'skill') {
      await this.assignSkill(slotIdx, drop.id);
    } else if (drop.type === 'item') {
      // Only allow Use items (potions, food — category 2: IDs 2000000-2999999)
      const category = Math.floor(drop.id / 1000000);
      if (category === 2) {
        this.assignItem(slotIdx, drop.id, drop.icon);
      }
    }
  },

  // Assign an item to a hotkey slot
  assignItem(slotIndex: number, itemId: number, icon: HTMLImageElement | null) {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;
    this.slots[slotIndex] = {
      ...this.slots[slotIndex],
      type: 'item',
      actionId: itemId,
      icon: icon,
    };
  },

  async playSkillSound(skillId: number) {
    try {
      const paddedSkillId = String(skillId).padStart(7, '0');
      const soundNode = await WZManager.get('Sound.wz/Skill.img');
      if (soundNode) {
        let skillSound = (soundNode as any).nGet?.(paddedSkillId);
        if (skillSound?.nChildren?.length > 0) {
          let useNode = skillSound.nChildren[0];
          if (useNode.nTagName === 'uol') {
            useNode = useNode.nResolveUOL();
          }
          if (useNode?.nGetAudio) {
            PLAY_AUDIO(useNode.nGetAudio());
            return;
          }
        }
      }
    } catch (e) { /* ignore sound errors */ }
  },

  async playSkillEffect(skillId: number) {
    try {
      const jobFileId = Math.floor(skillId / 10000);
      const paddedJobId = String(jobFileId).padStart(3, '0');
      const skillNode = await WZManager.get(`Skill.wz/${paddedJobId}.img`);
      if (!skillNode) return;

      const effectNode = (skillNode as any).nGet?.('skill')?.nGet?.(String(skillId))?.nGet?.('effect');
      if (!effectNode?.nChildren || effectNode.nChildren.length === 0) return;

      // Set up animation frames on the character
      MyCharacter.skillEffectFrames = effectNode.nChildren;
      MyCharacter.skillEffectFrame = 0;
      MyCharacter.skillEffectDelay = 0;
      MyCharacter.skillEffectActive = true;
    } catch (e) { /* ignore */ }
  },

  // Serialize for DB save
  serialize(): { keyCode: string; bindType: number; actionId: number }[] {
    return this.slots
      .filter(s => s.type !== 'none')
      .map(s => ({
        keyCode: s.key,
        bindType: s.type === 'skill' ? 1 : 2,
        actionId: s.actionId,
      }));
  },

  // Deserialize from DB load
  async deserialize(data: { keyCode: string; bindType: number; actionId: number }[]) {
    if (!this._initialized) this.initialize();

    for (const entry of data) {
      const slotIdx = this.slots.findIndex(s => s.key === entry.keyCode);
      if (slotIdx >= 0) {
        if (entry.bindType === 1) {
          await this.assignSkill(slotIdx, entry.actionId);
        }
      }
    }
  },
};

export default UIHotkeyBar;
