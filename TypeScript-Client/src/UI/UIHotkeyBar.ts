import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import MyCharacter from '../MyCharacter';
import SkillData, { SkillInfo } from '../Skills/SkillData';
import WZManager from '../wz-utils/WZManager';
import PLAY_AUDIO from '../Audio/PlayAudio';
import { FACE_COUPON_EXPRESSIONS } from '../Shop/CashShopData';
import { isPetItemId, isPetFoodItemId } from '../Constants/Inventory/MapleInventory';
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

// v83 quickslot layout — 8 slots in a 4×2 grid inside the quickSlot
// background (151×80). Slot order matches StatusBar.img/key/<index> label
// sprites: Shift, Ins, Hm, Pup / Ctrl, Del, End, Pdn
const DEFAULT_SLOTS: { key: string; label: string }[] = [
  // Top row (left to right)
  { key: 'shift', label: 'Shift' },
  { key: 'insert', label: 'Ins' },
  { key: 'home', label: 'Home' },
  { key: 'pageup', label: 'PgUp' },
  // Bottom row (left to right)
  { key: 'ctrl', label: 'Ctrl' },
  { key: 'delete', label: 'Del' },
  { key: 'end', label: 'End' },
  { key: 'pagedown', label: 'PgDn' },
];

// QuickSlot background layout constants (151×80 WZ image, measured from the
// decoded PNG: white keycap interiors at x=10-36/45-71/80-106/115-141,
// y=9-33/43-67)
const QS_W = 151;
const QS_H = 80;
const COLS = 4;
const ROWS = 2;
const SLOT_X = [10, 45, 80, 115];        // keycap interior left edge per column
const SLOT_Y = [9, 43];                  // keycap interior top edge per row
const SLOT_W = 27;                       // keycap interior width
const SLOT_H = 25;                       // keycap interior height

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
  _keyLabels: [] as (HTMLImageElement | null)[],
  _itemNoDigits: [] as (HTMLImageElement | null)[],
  _assetsLoaded: false,
  // Track which slot a drag originated from (for removing on drop-outside)
  _dragSourceSlot: -1,

  initialize() {
    // Idempotent — a second call (MapState entry after the login flow already
    // restored saved bindings via deserialize) must not wipe the slots
    if (this._initialized) return;
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
        // Embossed key label sprites (Shift, Ins, Hm, Pup, Ctrl, Del, End, Pdn)
        const keyNode = statusBar.nGet('key');
        for (let i = 0; i < 8; i++) {
          this._keyLabels.push(keyNode?.nGet?.(String(i))?.nGetImage?.() || null);
        }
      }

      // Quantity digit sprites (same font the inventory grid uses)
      const basic: any = await WZManager.get('UI.wz/Basic.img');
      const itemNo = basic?.nGet?.('ItemNo');
      for (let i = 0; i <= 9; i++) {
        this._itemNoDigits.push(itemNo?.nGet?.(String(i))?.nGetImage?.() || null);
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
    // Bindings are part of the save payload — persist soon, like every
    // other gameplay change (they used to ride only the 30s backstop)
    (window as any).__mySocket?.requestSave?.();
  },

  // Clear a slot
  clearSlot(slotIndex: number) {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;
    this.slots[slotIndex].type = 'none';
    this.slots[slotIndex].actionId = 0;
    this.slots[slotIndex].icon = null;
    (window as any).__mySocket?.requestSave?.();
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
        } else if (slot.type === 'item') {
          this.activateItem(slot.actionId);
        }
      }

      this.previousKeyState[slot.key] = isDown;
    }
  },

  // Consume a bound Use item — same flow as double-clicking it in the
  // inventory (InventoryMenuSprite owns the spec parsing / sound / removal)
  activateItem(itemId: number) {
    // Cash face-expression coupons play their emote and are never consumed
    const expr = FACE_COUPON_EXPRESSIONS[itemId];
    if (expr) {
      MyCharacter.playEmote?.(expr);
      return;
    }

    // Pet food bound to a key: feed the hungriest eligible pet
    if (isPetFoodItemId(itemId)) {
      const cashTab = MyCharacter.inventory?.cash || [];
      const slot = cashTab.findIndex(
        (i: any) => i && i.itemId === itemId && (i.quantity ?? 1) > 0
      );
      if (slot >= 0) {
        import('../Pet/PetManager').then(({ default: PetManager }) => {
          PetManager.feedPet(cashTab[slot], slot, MyCharacter);
        }).catch(() => {});
      }
      return;
    }

    // Pet bound to a key: toggle summon (same as double-click in Cash tab)
    if (isPetItemId(itemId)) {
      const cashTab = MyCharacter.inventory?.cash || [];
      const petItem = cashTab.find(
        (i: any) => i && i.itemId === itemId && !i.equipData?.dead
      );
      if (petItem) {
        import('../Pet/PetManager').then(({ default: PetManager }) => {
          void PetManager.toggleSummon(petItem, MyCharacter);
        }).catch(() => {});
      }
      return;
    }

    const inventoryMenu = (window as any).MapStateInstance?.inventoryMenu;
    if (!inventoryMenu) return;

    // Setup tab first. Only the Use tab was ever searched, so a chair bound
    // to a key silently did nothing — it does not live in `use`, and the
    // lookup simply found no item and returned.
    const setupTab = MyCharacter.inventory?.setup || [];
    const setupItem = setupTab.find((i: any) => i && i.itemId === itemId);
    if (setupItem) {
      inventoryMenu.useSetupItem?.(setupItem);
      return;
    }

    if (!inventoryMenu.consumeItem) return;
    const useTab = MyCharacter.inventory?.use || [];
    const item = useTab.find((i: any) => i && i.itemId === itemId && (i.quantity ?? 1) > 0);
    if (!item) return; // ran out — key does nothing, like GMS
    inventoryMenu.consumeItem(item, -1);
  },

  // Total remaining quantity across all Use-tab stacks of an item
  getItemCount(itemId: number): number {
    const useTab = MyCharacter.inventory?.use || [];
    return useTab.reduce(
      (acc: number, i: any) => acc + (i && i.itemId === itemId ? (i.quantity ?? 1) : 0),
      0
    );
  },

  async activateSkill(skillId: number) {
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

    // Get skill info for type
    const info = SkillData.getSkillSync(skillId);
    if (!info) return;

    if (info.isAttack) {
      // Attack skill — cast may fail (attack delay, missing snail shells);
      // only consume MP/HP/cooldown when it actually fires
      const casted = await MyCharacter.useSkill?.(skillId, effect);
      if (!casted) return;
      this.playSkillSound(skillId);
      // Attack skills carry a caster animation too — Magic Claw's claw swipe
      // lives in its `effect` node, and only buffs were ever playing it
      this.playSkillEffect(skillId);
    } else if (info.isBuff) {
      // Buff skill — apply buff
      if (MyCharacter.buffManager) {
        MyCharacter.buffManager.applyBuff(skillId, effect);
      }
      // Play skill-specific sound and effect animation
      this.playSkillSound(skillId);
      this.playSkillEffect(skillId);
    } else {
      // Passive skills can't be activated
      return;
    }

    // Consume resources
    if (effect.mpCon > 0) MyCharacter.mp -= effect.mpCon;
    if (effect.hpCon > 0) MyCharacter.hp -= effect.hpCon;

    // Start cooldown
    if (effect.cooltime > 0) {
      sm.startCooldown(skillId, effect.cooltime);
    }
  },

  render(canvas: GameCanvas, _camera: CameraInterface) {
    if (!this._initialized || !this.isVisible) return;

    // Bottom-right of the 800-wide status bar island (centered on wider
    // screens) — attached to the bar like GMS, not to the screen corner
    // Status bar starts at config.height - 71
    this.barX = Math.floor((config.width - 800) / 2) + 800 - QS_W;
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

      // Skill/item icon — fills the keycap below the key label
      if (slot.icon && slot.icon.complete && slot.icon.width > 0) {
        const iconSize = 22;
        const ix = sx + Math.floor((SLOT_W - iconSize) / 2);
        const iy = sy + SLOT_H - iconSize - 1;
        const depleted = slot.type === 'item' && this.getItemCount(slot.actionId) === 0;
        if (depleted) ctx.save(), (ctx.globalAlpha = 0.35);
        ctx.drawImage(slot.icon, ix, iy, iconSize, iconSize);
        if (depleted) ctx.restore();
      }

      // Remaining quantity for bound items — WZ digit sprites at the
      // bottom-left of the keycap, like GMS
      if (slot.type === 'item') {
        const count = this.getItemCount(slot.actionId);
        let dx = sx;
        const digitH = this._itemNoDigits[0]?.height || 11;
        const dy = sy + SLOT_H - digitH + 2;
        for (const d of String(count)) {
          const digitImg = this._itemNoDigits[parseInt(d)];
          if (digitImg) {
            ctx.drawImage(digitImg, dx, dy);
            dx += digitImg.width;
          }
        }
      }

      // Cooldown overlay using CoolTime frames
      if (slot.type === 'skill' && MyCharacter.skillManager?.isOnCooldown(slot.actionId)) {
        const remaining = MyCharacter.skillManager.getCooldownRemaining(slot.actionId);
        const effect = MyCharacter.skillManager.getSkillEffectSync(slot.actionId);
        const totalMs = ((effect?.cooltime || 1)) * 1000;

        // Frame 0 covers the icon completely and frame 15 is nearly clear, so
        // the sweep is driven by time ELAPSED, not time remaining: grey at the
        // moment of casting, uncovering as it recharges. Keying it off
        // `remaining` ran the animation backwards. No countdown digits — the
        // original shows the sweep alone.
        if (this._coolTimeFrames.length > 0) {
          const elapsed = 1 - Math.max(0, Math.min(1, remaining / totalMs));
          const frameIdx = Math.min(
            this._coolTimeFrames.length - 1,
            Math.floor(elapsed * this._coolTimeFrames.length),
          );
          const cdImg = this._coolTimeFrames[frameIdx];
          if (cdImg && cdImg.complete && cdImg.width > 0) {
            ctx.drawImage(cdImg, sx, sy, SLOT_W, SLOT_H);
          }
        }
      }

      // Key label — embossed WZ sprite at the top-left of the keycap
      const labelImg = this._keyLabels[i];
      if (labelImg && labelImg.complete && labelImg.width > 0) {
        ctx.drawImage(labelImg, sx, sy);
      }
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
    (window as any).__mySocket?.requestSave?.();
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

      const effectNode = (skillNode as any).nGet?.('skill')?.nGet?.(String(skillId).padStart(7, '0'))?.nGet?.('effect');
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

  // Deserialize from DB load. The keymap table also carries the keyboard
  // bindings (bindType 3/4/5) — route those to KeyBindings; 1/2 are ours.
  // The saved keymap is the whole truth for its character, so the bar is
  // cleared first — the singleton survives a logout, and without the wipe a
  // freshly created character inherited the previous character's skill and
  // potion slots (which the next auto-save then wrote into the new save).
  async deserialize(data: { keyCode: string; bindType: number; actionId: number }[]) {
    if (!this._initialized) this.initialize();

    for (const slot of this.slots) {
      slot.type = 'none';
      slot.actionId = 0;
      slot.icon = null;
    }

    try {
      const { applyKeyboardBindings } = await import('../KeyBindings');
      applyKeyboardBindings(data);
    } catch (e) {
      console.warn('[UIHotkeyBar] keyboard binding restore failed', e);
    }

    for (const entry of data) {
      if (entry.bindType >= 3) continue;
      const slotIdx = this.slots.findIndex(s => s.key === entry.keyCode);
      if (slotIdx >= 0) {
        if (entry.bindType === 1) {
          await this.assignSkill(slotIdx, entry.actionId);
        } else if (entry.bindType === 2) {
          this.assignItem(slotIdx, entry.actionId, await this.loadItemIcon(entry.actionId));
        }
      }
    }
  },

  // Icon for a Use item from Item.wz (bound items restored from a save don't
  // carry an icon like drag-drop assignments do)
  async loadItemIcon(itemId: number): Promise<HTMLImageElement | null> {
    try {
      const padded = String(itemId).padStart(8, '0');
      const infoNode: any = await WZManager.get(
        `Item.wz/Consume/${padded.slice(0, 4)}.img/${padded}/info`
      );
      const iconNode = infoNode?.nGet?.('iconRaw') ?? infoNode?.nGet?.('icon');
      return iconNode?.nGetImage?.() || null;
    } catch {
      return null;
    }
  },
};

export default UIHotkeyBar;
