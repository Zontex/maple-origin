import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import MyCharacter from '../MyCharacter';
import SkillData, { SkillInfo } from '../Skills/SkillData';
import WZManager from '../wz-utils/WZManager';
import PLAY_AUDIO from '../Audio/PlayAudio';

// Hotkey slot definition
interface HotkeySlot {
  type: 'skill' | 'item' | 'none';
  actionId: number;
  key: string;       // GameCanvas key name (e.g., 'shift', 'z', 'f1')
  label: string;     // Display label
  icon: HTMLImageElement | null;
}

// Default quickslot layout — matches common v83 setup
const DEFAULT_SLOTS: { key: string; label: string }[] = [
  { key: 'shift', label: 'Shift' },
  { key: 'insert', label: 'Ins' },
  { key: 'delete', label: 'Del' },
  { key: 'home', label: 'Home' },
  { key: 'end', label: 'End' },
  { key: 'pageup', label: 'PgUp' },
  { key: 'pagedown', label: 'PgDn' },
  { key: 'f1', label: 'F1' },
  { key: 'f2', label: 'F2' },
  { key: 'f3', label: 'F3' },
  { key: 'f4', label: 'F4' },
  { key: 'f5', label: 'F5' },
];

// Layout
const SLOT_SIZE = 32;
const SLOT_PAD = 2;
const BAR_PAD = 4;
const SLOTS_PER_ROW = 12;
const BAR_H = SLOT_SIZE + BAR_PAD * 2;
const BAR_W = SLOTS_PER_ROW * (SLOT_SIZE + SLOT_PAD) + BAR_PAD * 2 - SLOT_PAD;

const UIHotkeyBar = {
  slots: [] as HotkeySlot[],
  isVisible: false,
  barX: 0,
  barY: 0,
  previousKeyState: {} as Record<string, boolean>,
  _initialized: false,

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
      console.log(`[HotkeyBar] Skill ${skillId} is on cooldown (${Math.ceil(sm.getCooldownRemaining(skillId) / 1000)}s)`);
      return;
    }

    // Check MP
    if (effect.mpCon > 0 && MyCharacter.mp < effect.mpCon) {
      console.log(`[HotkeyBar] Not enough MP for skill ${skillId} (need ${effect.mpCon}, have ${MyCharacter.mp})`);
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
      console.log(`[HotkeyBar] Activated buff: ${info.name} (${effect.time}s)`);
    }

    console.log(`[HotkeyBar] Used skill: ${info.name} (MP: -${effect.mpCon})`);
  },

  render(canvas: GameCanvas, camera: CameraInterface) {
    if (!this._initialized || !this.isVisible) return;

    // Position at bottom-center of screen, above status bar
    const canvasW = (canvas as any).game?.width || 1024;
    const canvasH = (canvas as any).game?.height || 768;
    this.barX = Math.floor((canvasW - BAR_W) / 2);
    this.barY = canvasH - BAR_H - 48; // Above status bar

    // Semi-transparent bar background
    const ctx = canvas.context;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(this.barX, this.barY, BAR_W, BAR_H);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#444466';
    ctx.strokeRect(this.barX, this.barY, BAR_W, BAR_H);
    ctx.restore();

    // Draw each slot
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const sx = this.barX + BAR_PAD + i * (SLOT_SIZE + SLOT_PAD);
      const sy = this.barY + BAR_PAD;

      // Slot background
      ctx.save();
      ctx.fillStyle = slot.type !== 'none' ? '#2a2a4a' : '#1a1a2e';
      ctx.fillRect(sx, sy, SLOT_SIZE, SLOT_SIZE);
      ctx.strokeStyle = '#555577';
      ctx.strokeRect(sx, sy, SLOT_SIZE, SLOT_SIZE);

      // Skill icon
      if (slot.icon && slot.icon.complete && slot.icon.width > 0) {
        ctx.drawImage(slot.icon, sx, sy, SLOT_SIZE, SLOT_SIZE);
      }

      // Cooldown overlay
      if (slot.type === 'skill' && MyCharacter.skillManager?.isOnCooldown(slot.actionId)) {
        const remaining = MyCharacter.skillManager.getCooldownRemaining(slot.actionId);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#000000';
        ctx.fillRect(sx, sy, SLOT_SIZE, SLOT_SIZE);
        ctx.globalAlpha = 1;
        // Cooldown seconds text
        const secs = Math.ceil(remaining / 1000);
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(String(secs), sx + SLOT_SIZE / 2, sy + SLOT_SIZE / 2 + 4);
      }

      // Key label
      ctx.fillStyle = '#aaaacc';
      ctx.font = '8px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(slot.label, sx + SLOT_SIZE / 2, sy + SLOT_SIZE - 2);
      ctx.restore();
    }
  },

  async playSkillSound(skillId: number) {
    try {
      // Pad skill ID to match WZ key format (e.g. 1002 → "0001002")
      const paddedSkillId = String(skillId).padStart(7, '0');
      const soundNode = await WZManager.get('Sound.wz/Skill.img');
      if (soundNode) {
        let skillSound = (soundNode as any).nGet?.(paddedSkillId);
        if (skillSound?.nChildren?.length > 0) {
          let useNode = skillSound.nChildren[0];
          // Resolve UOL references
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
      // Load effect animation from Skill.wz/{jobFile}.img/skill/{skillId}/effect
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
