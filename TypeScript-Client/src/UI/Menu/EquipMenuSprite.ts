import WZManager from '../../wz-utils/WZManager';
import config from '../../Config';
import ClickManager from '../ClickManager';
import DragableMenu from './DragableMenu';
import { CameraInterface } from '../../Camera';
import GameCanvas from '../../GameCanvas';
import Item from '../../Inventory/Item';
import DragManager from '../DragManager';
import UIKeyConfig from '../UIKeyConfig';
import DropItemSprite from '../../DropItem/DropItemSprite';
import mySocket from '../../mysocket';
import UIEquipTooltip from '../UIEquipTooltip';
import getEquipTypeById from '../../Constants/EquipType';
import { ensureItemNames, getItemNameSync } from '../../Quest/QuestData';
import DebugDrag from '../DebugDrag';
import UIDevTools from '../UIDevTools';
import PetManager from '../../Pet/PetManager';
import { PET_EQUIP_CELLS } from '../../Pet/PetConstants';
import { formatRemaining } from '../../Shop/CashShopData';
import { drawPlate } from '../UIToolTipPlate';

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
  /** Slot the hovered icon actually lives at (base+100 for cash covers) */
  hoveredIconSlot: number | null = null;
  itemNamesReady: boolean = false;
  // Double-click tracking
  lastClickSlot: number = -1;
  lastClickTime: number = 0;
  // Debug registration flag
  _debugRegistered: boolean = false;

  // --- Pet equip extension panel (UIWindow.img/Equip/pet) ---
  petPanelOpen: boolean = false;
  petPanelImage: HTMLImageElement | null = null;
  btPetShow: HTMLImageElement | null = null;
  btPetHide: HTMLImageElement | null = null;
  btPet: { normal: HTMLImageElement | null; pressed: HTMLImageElement | null; disabled: HTMLImageElement | null; mouseOver: HTMLImageElement | null }[] = [];
  _petEquipIcons: Map<number, HTMLImageElement | null> = new Map();
  _petCellLastClickKey: string = '';
  _petCellLastClickTime: number = 0;
  hoveredPetCell: { key: string; x: number; y: number; label: string } | null = null;

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
      const equipNode: any = await WZManager.get('UI.wz/UIWindow.img/Equip');
      this.backgroundImage = equipNode.backgrnd.nGetImage();

      // Pet equip extension: panel art + PET EQUIP toggle + pet selectors
      const stateImg = (btn: any, state: string): HTMLImageElement | null => {
        const frames = btn?.[state]?.nChildren;
        const frame = frames?.find((f: any) => f.nTagName === 'canvas') ?? frames?.[0];
        try { return frame?.nGetImage?.() ?? null; } catch { return null; }
      };
      this.petPanelImage = equipNode.pet?.nGetImage?.() ?? null;
      this.btPetShow = stateImg(equipNode.BtPetEquipShow, 'normal');
      this.btPetHide = stateImg(equipNode.BtPetEquipHide, 'normal');
      this.btPet = [1, 2, 3].map((i) => ({
        normal: stateImg(equipNode[`BtPet${i}`], 'normal'),
        pressed: stateImg(equipNode[`BtPet${i}`], 'pressed'),
        disabled: stateImg(equipNode[`BtPet${i}`], 'disabled'),
        mouseOver: stateImg(equipNode[`BtPet${i}`], 'mouseOver'),
      }));
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
      // The pet panel hangs off the right edge and moves with the window
      width: (this.backgroundImage?.width || 175) + (this.petPanelOpen ? (this.petPanelImage?.width || 177) : 0),
      height: this.backgroundImage?.height || 304,
    };
  }

  // --- Pet panel geometry (attached right, bottom-aligned like v83) ---

  get petPanelX() { return this.x + (this.backgroundImage?.width || 175); }
  get petPanelY() {
    return this.y + (this.backgroundImage?.height || 304) - (this.petPanelImage?.height || 181);
  }
  /** PET EQUIP toggle button — sits right-of-center on the bottom rim (v83) */
  get petShowBtnRect() {
    const w = this.btPetShow?.width || 54;
    const h = this.btPetShow?.height || 18;
    return { x: this.x + 97, y: this.y + 281, w, h };
  }

  // Panel-relative placements for the bottom strip
  static readonly PET_CELL_SIZE = 31;
  static readonly BTPET_XS = [10, 44, 78];
  static readonly BTPET_Y = 150;
  static readonly BTHIDE_X = 154;
  static readonly BTHIDE_Y = 155;

  _getPetEquipIcon(itemId: number): HTMLImageElement | null {
    if (this._petEquipIcons.has(itemId)) return this._petEquipIcons.get(itemId) ?? null;
    this._petEquipIcons.set(itemId, null);
    void (async () => {
      try {
        const info: any = await WZManager.get(`Character.wz/PetEquip/0${itemId}.img/info`);
        const iconNode = info?.iconRaw ?? info?.icon;
        if (iconNode?.nGetImage) this._petEquipIcons.set(itemId, iconNode.nGetImage());
      } catch { /* keep null */ }
    })();
    return null;
  }

  /** Clicks inside the pet panel: selectors, hide arrow, unequip cells */
  handlePetPanelClick(mouseX: number, mouseY: number): boolean {
    const px = this.petPanelX;
    const py = this.petPanelY;
    const pw = this.petPanelImage?.width || 177;
    const ph = this.petPanelImage?.height || 181;
    if (mouseX < px || mouseX >= px + pw || mouseY < py || mouseY >= py + ph) return false;

    // Back arrow closes the panel
    const hideW = this.btPetHide?.width || 17;
    const hideH = this.btPetHide?.height || 16;
    if (mouseX >= px + EquipMenuSprite.BTHIDE_X && mouseX < px + EquipMenuSprite.BTHIDE_X + hideW &&
        mouseY >= py + EquipMenuSprite.BTHIDE_Y && mouseY < py + EquipMenuSprite.BTHIDE_Y + hideH) {
      this.petPanelOpen = false;
      return true;
    }

    // Pet selectors 1-3 (only summoned pets are selectable)
    for (let i = 0; i < 3; i++) {
      const bx = px + EquipMenuSprite.BTPET_XS[i];
      const by = py + EquipMenuSprite.BTPET_Y;
      const bw = this.btPet[i]?.normal?.width || 30;
      const bh = this.btPet[i]?.normal?.height || 27;
      if (mouseX >= bx && mouseX < bx + bw && mouseY >= by && mouseY < by + bh) {
        console.log(`[EquipMenu] pet selector ${i + 1} clicked, summoned=${!!PetManager.pets[i]}`);
        if (PetManager.pets[i]) PetManager.selectedPetIndex = i;
        return true;
      }
    }

    // Equip cells: double-click a worn item to take it off
    const pet = PetManager.selectedPet;
    if (pet) {
      const equips = PetManager.getPetEquips(pet);
      for (const cell of PET_EQUIP_CELLS) {
        const cx = px + cell.x;
        const cy = py + cell.y;
        const cs = EquipMenuSprite.PET_CELL_SIZE;
        if (mouseX >= cx && mouseX < cx + cs && mouseY >= cy && mouseY < cy + cs) {
          const entry = equips[cell.key];
          if (!entry?.id) return true;
          const now = Date.now();
          if (this._petCellLastClickKey === cell.key && now - this._petCellLastClickTime < 400) {
            this._petCellLastClickKey = '';
            this._petCellLastClickTime = 0;
            void PetManager.unequipPetSlot(pet, cell.key, this.charecter);
          } else {
            this._petCellLastClickKey = cell.key;
            this._petCellLastClickTime = now;
          }
          return true;
        }
      }
    }

    return true; // inside the panel — consume so the click can't reach the map
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
  }

  /** Equip slot index under the cursor, or null (used for scroll drag-drop) */
  getSlotAt(mouseX: number, mouseY: number): number | null {
    if (this.isHidden) return null;
    for (const slot of EQUIP_SLOTS) {
      const sx = this.x + slot.x;
      const sy = this.y + slot.y;
      if (mouseX >= sx && mouseX < sx + SLOT_SIZE && mouseY >= sy && mouseY < sy + SLOT_SIZE) {
        return slot.slot;
      }
    }
    return null;
  }

  onMouseDown(mouseX: number, mouseY: number): boolean {
    if (this.isHidden) return false;

    // PET EQUIP toggle on the bottom rim
    const showBtn = this.petShowBtnRect;
    if (mouseX >= showBtn.x && mouseX < showBtn.x + showBtn.w &&
        mouseY >= showBtn.y && mouseY < showBtn.y + showBtn.h) {
      this.petPanelOpen = !this.petPanelOpen;
      return true;
    }
    if (this.petPanelOpen && this.handlePetPanelClick(mouseX, mouseY)) return true;

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

        // Begin a drag — once the cursor moves past the threshold the item
        // can be dragged out: onto the inventory window to unequip, anywhere
        // else to drop it on the ground. A plain click never reaches the
        // threshold, so double-click unequip keeps working.
        this.beginEquipDrag(slot.slot, itemId, mouseX, mouseY);
        return true;
      }
    }

    return false;
  }

  // Slot currently being dragged out of the window (-1 = none)
  _dragSlot: number = -1;

  /** Start dragging a worn item — DragManager renders the cursor ghost */
  beginEquipDrag(slotIdx: number, itemId: number, mouseX: number, mouseY: number) {
    const icon = this.charecter.equippedItemIcons?.[slotIdx] ?? null;
    if (!this.ownsPoint(mouseX, mouseY)) return;
    DragManager.beginPending('item', itemId, icon, mouseX, mouseY);
    this._dragSlot = slotIdx;

    const onMouseUp = () => {
      window.removeEventListener('mouseup', onMouseUp);
      const slot = this._dragSlot;
      this._dragSlot = -1;
      if (slot < 0) return;
      // Threshold never reached — plain click, double-click handling owns it
      if (!DragManager.isDragging) return;
      // Dropping a worn item onto a key belongs to the key config window, so
      // leave the drag alive for the frame to pick up rather than cancelling.
      if (UIKeyConfig.isOverKey?.(this.GameCanvas.mouseX, this.GameCanvas.mouseY)) return;
      DragManager.cancel();

      const mx = this.GameCanvas.mouseX;
      const my = this.GameCanvas.mouseY;

      // Released back over the equip window → no action
      const rect = this.getRect({} as CameraInterface);
      if (mx >= rect.x && mx < rect.x + rect.width && my >= rect.y && my < rect.y + rect.height) {
        return;
      }

      // Over the open inventory window → unequip into the bag
      const invMenu = (window as any).MapStateInstance?.inventoryMenu;
      if (invMenu && !invMenu.isHidden) {
        const invRect = invMenu.getRect?.({} as CameraInterface);
        if (invRect && mx >= invRect.x && mx < invRect.x + invRect.width &&
            my >= invRect.y && my < invRect.y + invRect.height) {
          this.unequipItem(slot);
          return;
        }
      }

      // Anywhere else → drop on the ground
      this.dropEquippedItem(slot);
    };
    window.addEventListener('mouseup', onMouseUp);
  }

  /** Detach a worn item and drop it on the ground (keeps scroll data) */
  async dropEquippedItem(slot: number, confirmed: boolean = false) {
    const itemId = this.charecter.equippedItemIds[slot];
    if (!itemId) return;
    const equipData = this.charecter.equippedItemData?.[slot];

    // Same v83 rules as the inventory: quest items never drop; untradeable
    // ones drop after a warning and vanish where they land
    const { canDropItem, dropVanishes, UNTRADEABLE_DROP_WARNING } = await import('../../Inventory/ItemRestrictions');
    if (!(await canDropItem(itemId))) return;
    const vanish = await dropVanishes(itemId);
    if (vanish && !confirmed) {
      const dialog = (window as any).MapStateInstance?.inventoryMenu?.confirmDialog;
      if (!dialog || !dialog.isHidden) return;
      dialog.show(UNTRADEABLE_DROP_WARNING, (yes: boolean) => { if (yes) void this.dropEquippedItem(slot, true); });
      return;
    }

    try {
      // Create the ground drop first — only detach once the drop exists,
      // so a failed sprite load can't destroy the item
      const itemDrop = await DropItemSprite.fromOpts({
        id: itemId,
        amount: 1,
        equipData: equipData ?? undefined,
        monster: {
          pos: {
            x: this.charecter.pos.x,
            y: this.charecter.pos.y - 20,
            vx: 0,
            vy: 0,
          },
        },
      });
      if (!this.charecter.map || itemDrop.destroyed) {
        console.error(`[EquipMenu] Drop failed for equipped item ${itemId} — keeping it worn`);
        return;
      }

      this.charecter.detachEquip(slot);

      if (vanish) {
        itemDrop.vanishing = true;
        itemDrop.isAlreadyPickedUp = true;
        this.charecter.map.addItemDrop(itemDrop);
      } else {
        const dropId = Date.now() + Math.floor(Math.random() * 10000);
        (itemDrop as any)._netDropId = dropId;
        this.charecter.map.addItemDrop(itemDrop);
        mySocket.sendItemDrop(itemId, 1, this.charecter.pos.x, this.charecter.pos.y - 20, 0, 0, dropId);
      }
      console.log(`[EquipMenu] Dropped equipped item ${itemId} from slot ${slot}`);
    } catch (e) {
      console.error('[EquipMenu] Error dropping equipped item:', e);
    }
  }

  async unequipItem(slot: number): Promise<void> {
    // A worn costume cover (v83 cash layer, slot base+100) comes off first
    // and returns to the CASH tab; the next double-click reaches the real
    // gear underneath
    if (slot < 100 && this.charecter.equippedItemIds[slot + 100]) {
      return this.unequipItem(slot + 100);
    }
    const itemId = this.charecter.equippedItemIds[slot];
    if (!itemId) return;

    // Carry the worn instance's scroll data back to the inventory item
    const equipData = this.charecter.equippedItemData?.[slot];

    // Remove from character visuals
    this.charecter.detachEquip(slot);

    // Add to the owning tab at the first free slot (keep positions stable)
    try {
      const item = await Item.fromOpts({ itemId, quantity: 1, equipData });
      const equipArr = slot >= 100
        ? this.charecter.inventory.cash
        : this.charecter.inventory.equip;
      let freeSlot = equipArr.findIndex((it: any) => !it);
      if (freeSlot === -1) freeSlot = equipArr.length;
      equipArr[freeSlot] = item;
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

      // A worn cash cover (slot base+100) is what the character visibly
      // wears, so the window shows it on top; unequip peels it off first
      const coverId = this.charecter.equippedItemIds[slot.slot + 100];
      const itemId = coverId ?? this.charecter.equippedItemIds[slot.slot];
      const iconSlot = coverId ? slot.slot + 100 : slot.slot;

      // Draw item icon if equipped
      if (itemId) {
        const icon = this.charecter.equippedItemIcons[iconSlot];
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
          this.hoveredIconSlot = iconSlot;
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

    // PET EQUIP toggle + extension panel
    const showBtn = this.petShowBtnRect;
    if (this.btPetShow) {
      canvas.drawImage({ img: this.btPetShow, dx: showBtn.x, dy: showBtn.y });
    }
    if (this.petPanelOpen) this.drawPetPanel(canvas);

    // Draw tooltip for hovered item
    if (this.hoveredSlot && this.hoveredItemId) {
      this.drawTooltip(canvas);
    }
  }

  drawPetPanel(canvas: GameCanvas) {
    if (!this.petPanelImage) return;
    const px = this.petPanelX;
    const py = this.petPanelY;
    canvas.drawImage({ img: this.petPanelImage, dx: px, dy: py });
    UIDevTools.track('petEquipPanel', px, py, this.petPanelImage.width, this.petPanelImage.height, 'screen', 'UI.wz/UIWindow.img/Equip/pet');

    const mouseX = this.GameCanvas.mouseX;
    const mouseY = this.GameCanvas.mouseY;
    const cs = EquipMenuSprite.PET_CELL_SIZE;
    this.hoveredPetCell = null;

    // Selected pet's worn equips in their labeled cells
    const pet = PetManager.selectedPet;
    let hoveredEntry: { id: number; expireAt?: number } | null = null;
    if (pet) {
      const equips = PetManager.getPetEquips(pet);
      for (const cell of PET_EQUIP_CELLS) {
        const entry = equips[cell.key];
        const cx = px + cell.x;
        const cy = py + cell.y;
        if (entry?.id) {
          const icon = this._getPetEquipIcon(entry.id);
          if (icon) {
            canvas.drawImage({
              img: icon,
              dx: cx + Math.floor((cs - (icon.width || 32)) / 2),
              dy: cy + Math.floor((cs - (icon.height || 32)) / 2),
            });
          }
        }
        if (mouseX >= cx && mouseX < cx + cs && mouseY >= cy && mouseY < cy + cs && entry?.id) {
          this.hoveredPetCell = cell;
          hoveredEntry = entry;
        }
      }
    }

    // Pet selectors: pressed = selected, mouseOver on hover, disabled = no
    // pet in that train slot
    const selectedIdx = Math.min(PetManager.selectedPetIndex, PetManager.pets.length - 1);
    for (let i = 0; i < 3; i++) {
      const states = this.btPet[i];
      if (!states) continue;
      const bx = px + EquipMenuSprite.BTPET_XS[i];
      const by = py + EquipMenuSprite.BTPET_Y;
      const bw = states.normal?.width || 30;
      const bh = states.normal?.height || 27;
      const hovered = mouseX >= bx && mouseX < bx + bw && mouseY >= by && mouseY < by + bh;
      const img = !PetManager.pets[i]
        ? states.disabled ?? states.normal
        : i === selectedIdx
          ? states.pressed ?? states.normal
          : hovered
            ? states.mouseOver ?? states.normal
            : states.normal;
      if (img) canvas.drawImage({ img, dx: bx, dy: by });
    }
    if (this.btPetHide) {
      canvas.drawImage({ img: this.btPetHide, dx: px + EquipMenuSprite.BTHIDE_X, dy: py + EquipMenuSprite.BTHIDE_Y });
    }

    // Simple tooltip: item name + slot label + rental countdown
    if (this.hoveredPetCell && hoveredEntry) {
      const name = this.itemNamesReady
        ? (getItemNameSync(hoveredEntry.id) || `Item ${hoveredEntry.id}`)
        : `Item ${hoveredEntry.id}`;
      const lines = [name, this.hoveredPetCell.label];
      if (hoveredEntry.expireAt) lines.push(`Remaining: ${formatRemaining(hoveredEntry.expireAt)}`);
      const fontSize = 12;
      let w = 0;
      for (const l of lines) w = Math.max(w, canvas.measureText({ text: l, fontSize }).width);
      const tw = w + 16;
      const th = lines.length * 14 + 10;
      let tx = px + this.hoveredPetCell.x + cs + 4;
      let ty = py + this.hoveredPetCell.y;
      if (tx + tw > config.width) tx = px + this.hoveredPetCell.x - tw - 4;
      if (ty + th > config.height) ty = config.height - th;
      drawPlate(canvas.context, tx, ty, tw, th);
      lines.forEach((l, i) => {
        canvas.drawText({
          text: l,
          x: tx + 8,
          y: ty + 6 + i * 14,
          color: i === 0 ? '#ffffff' : i === 1 ? '#aaaacc' : '#FFaa00',
          fontSize: i === 0 ? 12 : 11,
          fontWeight: i === 0 ? 'bold' : 'normal',
        });
      });
    }

    if (DebugDrag.enabled) {
      for (const cell of PET_EQUIP_CELLS) {
        const dx = px + cell.x;
        const dy = py + cell.y;
        canvas.context.save();
        canvas.context.strokeStyle = '#00ffff';
        canvas.context.strokeRect(dx, dy, cs, cs);
        canvas.context.fillStyle = '#00ffff';
        canvas.context.font = '8px monospace';
        canvas.context.fillText(cell.key, dx + 1, dy + 9);
        canvas.context.restore();
      }
    }
  }

  drawTooltip(canvas: GameCanvas) {
    if (!this.hoveredSlot || !this.hoveredItemId) return;

    const itemId = this.hoveredItemId;

    // GMS-style detailed equip tooltip (REQ stats, job bar, category, stats)
    const anchorX = this.x + this.hoveredSlot.x + SLOT_SIZE + 4;
    const anchorY = this.y + this.hoveredSlot.y;
    const dataSlot = this.hoveredIconSlot ?? this.hoveredSlot.slot;
    if (UIEquipTooltip.draw(canvas, itemId, this.charecter.equippedItemData?.[dataSlot], anchorX, anchorY)) {
      return;
    }

    // Fallback: simple name tooltip (equip info failed to load)
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
    if (tx + tooltipW > config.width) tx = this.x + this.hoveredSlot.x - tooltipW - 4;
    if (ty + tooltipH > config.height) ty = config.height - tooltipH;

    // Background — the shared v83 tooltip plate
    drawPlate(canvas.context, tx, ty, tooltipW, tooltipH);

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
