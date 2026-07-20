import WZManager from '../../wz-utils/WZManager';
import ClickManager from '../ClickManager';
import DragableMenu from './DragableMenu';
import { CameraInterface } from '../../Camera';
import GameCanvas from '../../GameCanvas';
import Item from '../../Inventory/Item';
import getEquipTypeById from '../../Constants/EquipType';
import { ensureItemNames, getItemNameSync } from '../../Quest/QuestData';
import DebugDrag from '../DebugDrag';
import UIDevTools from '../UIDevTools';

// Equipment slot definitions with pixel positions on the 175x304 background
// Each slot is ~36x36 with 1px borders
const SLOT_SIZE = 33;

interface EquipSlot {
  slot: number;    // equips[] index
  x: number;       // pixel x on background
  y: number;       // pixel y on background
  label: string;   // for debug/tooltip
}

// Positions measured from the 175x304 WZ background
// Grid: 5 columns × 8 rows
// Col x:  0=3,  1=37,  2=70,  3=103,  4=136   (cell width ~33)
// Rows identified from label positions in the background image:
//   CAP row=27, MEDAL/FOREHEAD row=60, EYE/EAR row=93
//   MANTLE row=126, CLOTHES/WEAPON row=152, GLOVES/BELT row=178
//   PANTS/SHOES row=204, TAMING row=237
// Grid positions that were verified to align perfectly with the cell borders.
// 5 columns, rows spaced ~33px apart starting at y=27.
const C0 = 3, C1 = 37, C2 = 70, C3 = 103, C4 = 136;
const R0 = 32, R1 = 65, R2 = 98, R3 = 131, R4 = 164, R5 = 197, R6 = 230, R7 = 263;

// Map each grid cell to the correct equipment slot based on the background labels:
// Row 0: _,       CAP,     [sil],   RING,    RING
// Row 1: MEDAL,   FOREHEAD,[sil],   [sil],   [sil]
// Row 2: [sil],   [sil],   EYE ACC, EAR ACC, [sil]
// Row 3: MANTLE,  [sil],   PENDANT, [sil],   SHIELD
// Row 4: [sil],   CLOTHES, [sil],   WEAPON,  [sil]
// Row 5: GLOVES,  [sil],   BELT,    RING,    RING
// Row 6: [sil],   PANTS,   [sil],   SHOES,   PET MP
// Row 7: TAMING,  [sil],   MOB EQ,  PET ACC, PET HP
const EQUIP_SLOTS: EquipSlot[] = [
  { slot: 0,  x: C1, y: R0, label: 'Cap' },            // Row 0, Col 1
  { slot: 11, x: C3, y: R1, label: 'Ring 1' },          // Row 1, Col 3
  { slot: 12, x: C4, y: R0, label: 'Ring 2' },          // Row 0, Col 4
  { slot: 2,  x: C2, y: R2, label: 'Eye Accessory' },   // Row 2, Col 2
  { slot: 3,  x: C3, y: R2, label: 'Ear Accessory' },   // Row 2, Col 3
  { slot: 8,  x: C0, y: R3, label: 'Cape' },            // Row 3, Col 0 (MANTLE)
  { slot: 16, x: C2, y: R3, label: 'Pendant' },         // Row 3, Col 2
  { slot: 9,  x: C4, y: R3, label: 'Shield' },          // Row 3, Col 4
  { slot: 4,  x: C1, y: R3, label: 'Clothes' },         // Row 3, Col 1
  { slot: 10, x: C3, y: R3, label: 'Weapon' },          // Row 3, Col 3
  { slot: 7,  x: C0, y: R4, label: 'Gloves' },          // Row 4, Col 0
  { slot: 13, x: C3, y: R5, label: 'Ring 3' },          // Row 5, Col 3
  { slot: 14, x: C4, y: R5, label: 'Ring 4' },          // Row 5, Col 4
  { slot: 18, x: C2, y: R4, label: 'Belt' },             // Row 4, Col 2
  { slot: 5,  x: C1, y: R4, label: 'Pants' },           // Row 4, Col 1
  { slot: 6,  x: C2, y: R5, label: 'Shoes' },           // Row 5, Col 2
  { slot: 19, x: C0, y: R6, label: 'Taming Mob' },      // Row 6, Col 0
  { slot: 20, x: C1, y: R6, label: 'Saddle' },          // Row 6, Col 1
  { slot: 15, x: C0, y: R1, label: 'Medal' },           // Row 1, Col 0
];

// Maps item ID prefix (Math.floor(id/10000)) to equip slot index
const ITEM_TO_SLOT: Record<number, number> = {
  100: 0,   // Cap
  101: 1,   // Face Accessory
  102: 2,   // Eye Accessory
  103: 3,   // Earring
  104: 4,   // Coat
  105: 4,   // Longcoat (same slot as coat)
  106: 5,   // Pants
  107: 6,   // Shoes
  108: 7,   // Gloves
  109: 9,   // Shield
  110: 8,   // Cape
  111: 11,  // Ring (first ring slot)
  112: 16,  // Pendant
  113: 18,  // Belt
  114: 15,  // Medal
  190: 19,  // Taming Mob
  191: 20,  // Saddle
};

// Weapon prefixes all map to slot 10
for (let i = 130; i <= 170; i++) {
  ITEM_TO_SLOT[i] = 10;
}

function getEquipSlotForItem(itemId: number): number {
  const prefix = Math.floor(itemId / 10000);
  // Weapons use 3-digit prefix (e.g. 1302 → 130)
  if (prefix >= 130 && prefix <= 170) {
    return 10;
  }
  return ITEM_TO_SLOT[prefix] ?? -1;
}

class EquipMenuSprite extends DragableMenu {
  opts: any;
  charecter: any;
  backgroundImage: HTMLImageElement | null = null;
  GameCanvas: GameCanvas;
  // Tooltip state
  hoveredSlot: EquipSlot | null = null;
  hoveredItemId: number = 0;
  itemNamesReady: boolean = false;
  // Double-click tracking
  lastClickSlot: number = -1;
  lastClickTime: number = 0;
  // Debug registration flag
  _debugRegistered: boolean = false;

  static async fromOpts(opts: any) {
    const obj = new EquipMenuSprite(opts);
    await obj.load();
    return obj;
  }

  constructor(opts: any) {
    super(opts);
    this.opts = opts;
    this.GameCanvas = opts.canvas;
  }

  async load() {
    this.charecter = this.opts.charecter;
    this.x = this.opts.x;
    this.y = this.opts.y;
    this.isHidden = this.opts.isHidden;

    try {
      const equipNode = await WZManager.get('UI.wz/UIWindow.img/Equip');
      this.backgroundImage = equipNode.backgrnd.nGetImage();
    } catch (e) {
      console.error('[EquipMenu] Failed to load background:', e);
    }

    ensureItemNames().then(() => { this.itemNamesReady = true; });

    ClickManager.addDragableMenu(this);
  }

  getRect(_camera: CameraInterface) {
    return {
      x: this.x,
      y: this.y,
      width: this.backgroundImage?.width || 175,
      height: this.backgroundImage?.height || 304,
    };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
  }

  onMouseDown(mouseX: number, mouseY: number): boolean {
    if (this.isHidden) return false;

    // Check if a slot was clicked
    for (const slot of EQUIP_SLOTS) {
      const sx = this.x + slot.x;
      const sy = this.y + slot.y;
      if (mouseX >= sx && mouseX < sx + SLOT_SIZE && mouseY >= sy && mouseY < sy + SLOT_SIZE) {
        const itemId = this.charecter.equippedItemIds[slot.slot];
        if (!itemId) return true; // Empty slot, consume click

        const now = Date.now();
        // Double-click → unequip
        if (slot.slot === this.lastClickSlot && now - this.lastClickTime < 400) {
          this.lastClickSlot = -1;
          this.lastClickTime = 0;
          this.unequipItem(slot.slot);
          return true;
        }

        this.lastClickSlot = slot.slot;
        this.lastClickTime = now;
        return true;
      }
    }

    return false;
  }

  async unequipItem(slot: number) {
    const itemId = this.charecter.equippedItemIds[slot];
    if (!itemId) return;

    // Remove from character visuals
    this.charecter.detachEquip(slot);

    // Add to inventory equip array
    try {
      const item = await Item.fromOpts({ itemId, quantity: 1 });
      this.charecter.inventory.equip.push(item);
      console.log(`[EquipMenu] Unequipped item ${itemId} from slot ${slot}`);
    } catch (e) {
      console.error('[EquipMenu] Failed to create inventory item:', e);
    }
  }

  update(_msPerTick: number, _camera: any, _canvas: GameCanvas) {
    // Nothing to update
  }

  draw(canvas: GameCanvas, camera: CameraInterface, _lag: number, _msPerTick: number, _tdelta: number) {
    if (this.isHidden) return;

    const bgW = this.backgroundImage?.width || 175;
    const bgH = this.backgroundImage?.height || 304;
    UIDevTools.track('equipWindow', this.x, this.y, bgW, bgH, 'screen', 'UI.wz/UIWindow.img/Equip');

    // Draw background
    if (this.backgroundImage) {
      canvas.drawImage({
        img: this.backgroundImage,
        dx: this.x,
        dy: this.y,
      });
    }

    // Draw equipped item icons in their slots
    this.hoveredSlot = null;
    const mouseX = this.GameCanvas.mouseX;
    const mouseY = this.GameCanvas.mouseY;

    for (const slot of EQUIP_SLOTS) {
      const sx = this.x + slot.x;
      const sy = this.y + slot.y;

      const itemId = this.charecter.equippedItemIds[slot.slot];

      // Draw item icon if equipped
      if (itemId) {
        const icon = this.charecter.equippedItemIcons[slot.slot];
        if (icon) {
          canvas.drawImage({
            img: icon,
            dx: sx + (SLOT_SIZE - (icon.width || 32)) / 2,
            dy: sy + (SLOT_SIZE - (icon.height || 32)) / 2,
          });
        }
      }

      // Check hover
      if (mouseX >= sx && mouseX < sx + SLOT_SIZE && mouseY >= sy && mouseY < sy + SLOT_SIZE) {
        if (itemId) {
          this.hoveredSlot = slot;
          this.hoveredItemId = itemId;
        }
      }
    }

    // Debug mode: show slot outlines (F9 toggles via DebugDrag.enabled)
    if (DebugDrag.enabled) {
      for (const slot of EQUIP_SLOTS) {
        const dx = this.x + slot.x;
        const dy = this.y + slot.y;
        canvas.context.save();
        canvas.context.strokeStyle = '#00ff00';
        canvas.context.lineWidth = 1;
        canvas.context.strokeRect(dx, dy, SLOT_SIZE, SLOT_SIZE);
        canvas.context.fillStyle = '#00ff00';
        canvas.context.font = '9px monospace';
        canvas.context.fillText(`${slot.slot}:${slot.label}`, dx + 1, dy + 10);
        canvas.context.restore();
      }
    }

    // Draw tooltip for hovered item
    if (this.hoveredSlot && this.hoveredItemId) {
      this.drawTooltip(canvas);
    }
  }

  drawTooltip(canvas: GameCanvas) {
    if (!this.hoveredSlot || !this.hoveredItemId) return;

    const itemId = this.hoveredItemId;
    const itemName = this.itemNamesReady ? (getItemNameSync(itemId) || `Item ${itemId}`) : `Item ${itemId}`;

    const icon = this.charecter.equippedItemIcons[this.hoveredSlot.slot];
    const iconW = icon?.width || 0;
    const iconH = icon?.height || 0;

    const fontSize = 12;
    const padX = 8;
    const padY = 6;
    const iconPad = iconW > 0 ? iconW + 8 : 0;

    const nameMetrics = canvas.measureText({ text: itemName, fontSize, fontWeight: 'bold' });
    const nameW = nameMetrics.width;

    const tooltipW = Math.max(nameW + iconPad, 100) + padX * 2;
    const tooltipH = Math.max(iconH, 30) + padY * 2;

    // Position tooltip to the right of the slot
    const slotScreenX = this.x + this.hoveredSlot.x + SLOT_SIZE + 4;
    const slotScreenY = this.y + this.hoveredSlot.y;

    // Clamp to screen
    let tx = slotScreenX;
    let ty = slotScreenY;
    if (tx + tooltipW > 800) tx = this.x + this.hoveredSlot.x - tooltipW - 4;
    if (ty + tooltipH > 600) ty = 600 - tooltipH;

    const ctx = canvas.context;

    // Background
    ctx.save();
    ctx.fillStyle = 'rgba(20, 20, 60, 0.92)';
    ctx.fillRect(tx, ty, tooltipW, tooltipH);
    ctx.strokeStyle = '#6688cc';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx + 0.5, ty + 0.5, tooltipW - 1, tooltipH - 1);
    ctx.restore();

    // Icon
    if (icon && iconW > 0) {
      canvas.drawImage({
        img: icon,
        dx: tx + padX,
        dy: ty + (tooltipH - iconH) / 2,
      });
    }

    // Name
    canvas.drawText({
      text: itemName,
      x: tx + padX + iconPad,
      y: ty + padY + 2,
      color: '#ffffff',
      fontSize,
      fontWeight: 'bold',
    });

    // Slot label
    canvas.drawText({
      text: this.hoveredSlot.label,
      x: tx + padX + iconPad,
      y: ty + padY + 16,
      color: '#aaaacc',
      fontSize: 10,
    });
  }
}

export default EquipMenuSprite;
export { EQUIP_SLOTS, ITEM_TO_SLOT, getEquipSlotForItem };
