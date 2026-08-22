import WZManager from "../../wz-utils/WZManager";
import { MobSkillId } from '../../Mob/MobSkillData';
import UIPetGuideDialog from '../UIPetGuideDialog';
import WZFiles from "../../Constants/enums/WZFiles";
import ClickManager from "../ClickManager";
import { MapleStanceButton } from "../MapleStanceButton";
import DragableMenu from "./DragableMenu";
import {
  MapleInventoryType,
  isPetItemId,
  isPetFoodItemId,
  isPetEquipItemId,
  EVOLUTION_ROCK_ID,
} from "../../Constants/Inventory/MapleInventory";
import PetManager from "../../Pet/PetManager";
import ExpTable from "../../Constants/ExpTable";
import { CameraInterface } from "../../Camera";
import { Position } from "../../Effects/DamageIndicator";
import GameCanvas from "../../GameCanvas";
import DropItemSprite from "../../DropItem/DropItemSprite";
import Item from "../../Inventory/Item";
import UIConfirmDialog from '../UIConfirmDialog';
import UIMesoDropDialog from "../UIMesoDropDialog";
import QuestData from "../../Quest/QuestData";
import PLAY_AUDIO from "../../Audio/PlayAudio";
import { ensureItemNames, getItemNameSync, getItemDescSync } from "../../Quest/QuestData";
import DragManager from '../DragManager';
import UIDevTools from "../UIDevTools";
import mySocket from "../../mysocket";
import UIHotkeyBar from "../UIHotkeyBar";
import UIEquipTooltip from "../UIEquipTooltip";
import { formatRemaining, FACE_COUPON_EXPRESSIONS } from "../../Shop/CashShopData";
import UIAvatarMegaphone, { isMegaphoneItem } from "../UIAvatarMegaphone";
import { getEquipSlotForItem } from "./EquipMenuSprite";
import { FieldLimit, FIELD_LIMIT_MESSAGE, currentMapForbids } from "../../Constants/FieldLimit";
import Weather, { isWeatherItem } from "../../Effects/Weather";
import UIChatLog from "../UIChatLog";
import UIKeyConfig from "../UIKeyConfig";
import { drawPlate } from "../UIToolTipPlate";

// Tab strip on the 175x289 backgrnd, measured off the decoded PNG: the pale
// band is y=23..41 and the red underline y=42..44 spanning x=3..171. The
// plates (Item/New/Tab1|Tab0, 34 wide) hang from that line exactly as the
// Skill window's do — five of them fill x=4..174.
const TAB_X0 = 4;
const TAB_W = 34;
const TAB_STRIP_BOTTOM = 42;
const TAB_PLATE_H = 19;   // selected plate; the grey one is 18

class InventoryMenuSprite extends DragableMenu {
  opts: any;
  inventoryNode: any;
  charecter: any;
  currentTab: MapleInventoryType = MapleInventoryType.EQUIP;
  buttons: MapleStanceButton[] = [];
  isNotFirstDraw: boolean = false;
  destroyed: boolean = false;
  delay: number = 0;
  map: any;
  id: number = 0;
  originalX: number = 0;
  originalY: number = 0;
  // Holds the full composite background image.
  fullBackgroundImage: any = null;
  // Reference to GameCanvas for mouse position tracking
  GameCanvas: GameCanvas;
  mesoDropDialog: UIMesoDropDialog | null = null;
  // "This item will disappear" prompt for untradeable drops (shared with the
  // equip window, which reaches it through MapStateInstance.inventoryMenu)
  confirmDialog: UIConfirmDialog | null = null;
  // Double-click tracking
  lastClickSlot: number = -1;
  lastClickTime: number = 0;
  consumeSound: any = null;
  // Scrollbar images
  _scrollbarImages: any = null;
  // First visible grid row. The window shows 24 slots (4x6); a tab that holds
  // items past them scrolls a row at a time — wheel, the VScr arrows, or a
  // click on the track. Reset on a tab switch.
  scrollRow: number = 0;
  static readonly VISIBLE_ROWS = 6;
  static readonly SLOT_COLS = 4;
  // Tab plates from UIWindow.img/Item/New: Tab1/0 pink (selected), Tab0/0 grey
  _tabPlateOn: HTMLImageElement | null = null;
  _tabPlateOff: HTMLImageElement | null = null;
  // Item quantity digit images from Basic.img/ItemNo
  _itemNoDigits: HTMLImageElement[] = [];
  // Tooltip state
  hoveredItem: any = null;
  hoveredSlotX: number = 0;
  hoveredSlotY: number = 0;
  itemNamesReady: boolean = false;

  static async fromOpts(opts: any) {
    const object = new InventoryMenuSprite(opts);
    await object.load();
    return object;
  }

  constructor(opts: any) {
    super(opts);
    this.opts = opts;
    this.GameCanvas = opts.canvas;
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
    this.charecter = opts.charecter;


    try {
      this.inventoryNode = await WZManager.get(`${WZFiles.UI}/UIWindow.img/Item`);
      console.log("Loaded inventory UI node:", this.inventoryNode);
      // Tab plates. Always variant 0: 1-4 under Tab0/Tab1 are the shades the
      // tab pulses through when a new item lands in it, not per-tab colours.
      const newNode = this.inventoryNode?.New;
      this._tabPlateOn = newNode?.Tab1?.nGet?.('0')?.nGetImage?.() || null;
      this._tabPlateOff = newNode?.Tab0?.nGet?.('0')?.nGetImage?.() || null;
    } catch (e) {
      console.error("Error loading inventory UI node:", e);
    }

    this.currentTab = MapleInventoryType.EQUIP;
    this.buttons = [];

    // Load the full composite background image.
    await this.loadBackground();

    // Load consume sound effect
    try {
      const itemSoundNode = await WZManager.get('Sound.wz/Item.img/02000000');
      const useNode = itemSoundNode?.nGet?.('Use') || (itemSoundNode as any)?.Use;
      if (useNode?.nGetAudio) this.consumeSound = useNode.nGetAudio();
    } catch (e) { /* sound optional */ }

    // Load the meso drop dialog (auto-centers on screen)
    this.confirmDialog = await UIConfirmDialog.fromOpts({ canvas: this.GameCanvas });
    this.mesoDropDialog = await UIMesoDropDialog.fromOpts({
      canvas: this.GameCanvas,
    });

    // Load scrollbar, tab frame, and item number images from Basic.img
    try {
      const basicNode = await WZManager.get('UI.wz/Basic.img');
      const vscr = basicNode.VScr4;
      if (vscr?.enabled) {
        this._scrollbarImages = {
          prev: vscr.enabled.prev0?.nGetImage(),
          next: vscr.enabled.next0?.nGetImage(),
          thumb: vscr.enabled.thumb0?.nGetImage(),
        };
      }
      // Item quantity digit sprites
      const itemNo = basicNode.ItemNo;
      if (itemNo) {
        for (let i = 0; i <= 9; i++) {
          const digit = itemNo.nGet(`${i}`);
          if (digit?.nGetImage) {
            this._itemNoDigits[i] = digit.nGetImage();
          }
        }
      }
    } catch (e) { /* optional UI assets */ }

    // Load item name/description cache for tooltips
    ensureItemNames().then(() => { this.itemNamesReady = true; });

    ClickManager.addDragableMenu(this);
  }

  async dropMesos(amount: number = 10) {
    console.log(this.charecter);
    if (this.charecter.inventory.mesos < amount) {
      console.warn("Not enough mesos to drop.");
      return;
    }
  
    const dropPosition = {
      x: this.charecter.pos.x,
      y: this.charecter.pos.y,
      vx: 0,
      vy: 0,
    };
  
    try {
      // Reduce mesos from inventory
      this.charecter.inventory.gainMesos(-amount);
      
      // Create a DropItemSprite for the mesos
      const mesosDrop = await DropItemSprite.fromOpts({
        id: 0, // 0 is used for mesos in the DropItemSprite class
        amount: amount,
        monster: {
          pos: {
            x: this.charecter.pos.x,
            y: this.charecter.pos.y - 20, // Drop slightly above character
            vx: 0,
            vy: 0
          }
        }
      });
      
      // Add the drop to the map
      if (this.charecter.map && !mesosDrop.destroyed) {
        const dropId = Date.now() + Math.floor(Math.random() * 10000);
        (mesosDrop as any)._netDropId = dropId;
        this.charecter.map.addItemDrop(mesosDrop);
        mySocket.sendItemDrop(0, amount, this.charecter.pos.x, this.charecter.pos.y - 20, 0, 0, dropId);
        console.log(`Dropped ${amount} mesos`);
      }
    } catch (err) {
      console.error("Error dropping mesos:", err);
    }
  }

  // Drop an item from the inventory
  async dropItem(item: any, quantity: number, slotIndex: number, vanish: boolean = false) {
    if (!item || quantity <= 0) {
      console.warn("Invalid item or quantity");
      return;
    }
    
    // Get the appropriate inventory array based on the current tab
    let inventoryArray: any[] = [];
    switch (this.currentTab) {
      case MapleInventoryType.EQUIP:
        inventoryArray = this.charecter.inventory.equip;
        break;
      case MapleInventoryType.USE:
        inventoryArray = this.charecter.inventory.use;
        break;
      case MapleInventoryType.SETUP:
        inventoryArray = this.charecter.inventory.setup;
        break;
      case MapleInventoryType.ETC:
        inventoryArray = this.charecter.inventory.etc;
        break;
      case MapleInventoryType.CASH:
        inventoryArray = this.charecter.inventory.cash;
        break;
    }
    
    // Find the actual item in the inventory
    let actualItem = inventoryArray[slotIndex];
    if (!actualItem || actualItem.itemId !== item.itemId) {
      // If we can't find the exact item, try to find by itemId
      actualItem = inventoryArray.find(i => i?.itemId === item.itemId);
      
      if (!actualItem) {
        console.warn("Item not found in inventory");
        return;
      }
    }
    
    try {
      // Create the ground drop FIRST — the item only leaves the inventory
      // once the drop actually exists, otherwise a failed sprite load would
      // silently destroy the item (this vanished dropped equips before)
      const itemDrop = await DropItemSprite.fromOpts({
        id: item.itemId,
        amount: quantity,
        equipData: actualItem.equipData ?? undefined,
        monster: {
          pos: {
            x: this.charecter.pos.x,
            y: this.charecter.pos.y - 20, // Drop slightly above character
            vx: 0,
            vy: 0
          }
        }
      });

      if (!this.charecter.map || itemDrop.destroyed) {
        console.error(`Drop failed for item ${item.itemId} — keeping it in inventory`);
        return;
      }

      // Handle quantity for stackable items
      const originalQuantity = actualItem.quantity || 1;
      if (quantity >= originalQuantity) {
        // Remove the entire item if dropping all (null the slot to keep positions)
        const itemIndex = inventoryArray.indexOf(actualItem);
        if (itemIndex !== -1) {
          inventoryArray[itemIndex] = null;
        }
      } else {
        // Reduce the quantity
        actualItem.quantity -= quantity;
      }

      // Add the drop to the map. An untradeable item's drop is local and
      // short-lived — nobody can pick it up, so the room never hears of it
      if (vanish) {
        itemDrop.vanishing = true;
        itemDrop.isAlreadyPickedUp = true;
        this.charecter.map.addItemDrop(itemDrop);
      } else {
        const dropId = Date.now() + Math.floor(Math.random() * 10000);
        (itemDrop as any)._netDropId = dropId;
        this.charecter.map.addItemDrop(itemDrop);
        mySocket.sendItemDrop(item.itemId, quantity, this.charecter.pos.x, this.charecter.pos.y - 20, 0, 0, dropId);
      }
      const { default: UIChatLog } = await import('../UIChatLog');
      const itemName = getItemNameSync(item.itemId) || `Item #${item.itemId}`;
      UIChatLog.system(`You have lost an item (${itemName})`);
    } catch (err) {
      console.error("Error dropping item:", err);
    }
  }

  async loadBackground() {
    if (!this.inventoryNode || !this.inventoryNode.backgrnd) {
      console.error("Missing inventory background node");
      return;
    }
    try {
      this.fullBackgroundImage = this.inventoryNode.backgrnd.nGetImage();
    } catch (e) {
      console.error("Error loading inventory background:", e);
    }
  }

  getRect(camera: CameraInterface) {
    if (!this.fullBackgroundImage) {
      return { x: this.x, y: this.y, width: 300, height: 400 };
    }
    return { x: this.x, y: this.y, width: this.fullBackgroundImage.width, height: this.fullBackgroundImage.height };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
    this.buttons.forEach(button => (button.isHidden = isHidden));
  }

  // Draw only the leftmost portion of the composite background (cutting off the right side)
  drawBackground(canvas: GameCanvas) {
    if (!this.fullBackgroundImage) return;
    canvas.drawImage({
      img: this.fullBackgroundImage,
      dx: this.x,
      dy: this.y,
    });
  }

  // The raw inventory array backing the currently shown tab — slot index in
  // the grid maps 1:1 to the array index (empty slots are null holes)
  getCurrentTabArray(): any[] {
    switch (this.currentTab) {
      case MapleInventoryType.EQUIP: return this.charecter.inventory.equip;
      case MapleInventoryType.USE: return this.charecter.inventory.use;
      case MapleInventoryType.SETUP: return this.charecter.inventory.setup;
      case MapleInventoryType.ETC: return this.charecter.inventory.etc;
      case MapleInventoryType.CASH: return this.charecter.inventory.cash;
      default: return this.charecter.inventory.equip;
    }
  }

  /**
   * Rows the shown tab occupies: the 24-slot page at least, more when an item
   * sits past it (v83 tabs expand in rows of four).
   */
  tabRowCount(): number {
    const items = this.getCurrentTabArray() || [];
    let last = -1;
    for (let i = 0; i < items.length; i++) if (items[i]) last = i;
    return Math.max(InventoryMenuSprite.VISIBLE_ROWS, Math.ceil((last + 1) / InventoryMenuSprite.SLOT_COLS));
  }

  maxScrollRow(): number {
    return Math.max(0, this.tabRowCount() - InventoryMenuSprite.VISIBLE_ROWS);
  }

  scrollBy(rows: number) {
    this.scrollRow = Math.max(0, Math.min(this.maxScrollRow(), this.scrollRow + rows));
  }

  /** Scrollbar geometry on the 175x289 background: column x=155, track y=51..252, 15x13 arrows. */
  scrollbarRects() {
    const arrowW = 15, arrowH = 13;
    const sbX = this.x + 155;
    const top = this.y + 51;
    const bottom = this.y + 252;
    return {
      up: { x: sbX, y: top, w: arrowW, h: arrowH },
      down: { x: sbX, y: bottom - arrowH, w: arrowW, h: arrowH },
      track: { x: sbX, y: top + arrowH, w: arrowW, h: bottom - arrowH - (top + arrowH) },
    };
  }

  /** Clicks on the arrows and the track; true when the click was the scrollbar's. */
  handleScrollbarClick(mouseX: number, mouseY: number): boolean {
    const r = this.scrollbarRects();
    const inside = (b: { x: number; y: number; w: number; h: number }) =>
      mouseX >= b.x && mouseX < b.x + b.w && mouseY >= b.y && mouseY < b.y + b.h;
    if (inside(r.up)) { this.scrollBy(-1); return true; }
    if (inside(r.down)) { this.scrollBy(1); return true; }
    if (inside(r.track)) {
      // Above the thumb pages up, below it pages down
      const thumbH = this._scrollbarImages?.thumb?.height || 0;
      const travel = r.track.h - thumbH;
      const max = this.maxScrollRow();
      const thumbY = r.track.y + (max > 0 ? Math.round(travel * (this.scrollRow / max)) : 0);
      if (mouseY < thumbY) this.scrollBy(-InventoryMenuSprite.VISIBLE_ROWS);
      else if (mouseY >= thumbY + thumbH) this.scrollBy(InventoryMenuSprite.VISIBLE_ROWS);
      return true;
    }
    return false;
  }

  // Grid slot index under the mouse, or -1 if not over a slot
  getSlotAtMouse(mouseX: number, mouseY: number): number {
    const colXs = [9, 45, 81, 117];
    const rowYs = [51, 85, 119, 153, 187, 221];
    const slotSize = 32;
    for (let row = 0; row < rowYs.length; row++) {
      for (let col = 0; col < colXs.length; col++) {
        const slotX = this.x + colXs[col];
        const slotY = this.y + rowYs[row];
        if (
          mouseX >= slotX && mouseX < slotX + slotSize &&
          mouseY >= slotY && mouseY < slotY + slotSize
        ) {
          return (row + this.scrollRow) * colXs.length + col;
        }
      }
    }
    return -1;
  }

  // Drag-move within the tab: place into empty slot, swap with occupant, or
  // merge same-item stacks up to slotMax (GMS behavior)
  moveItemToSlot(fromSlot: number, toSlot: number) {
    if (fromSlot === toSlot || fromSlot < 0 || toSlot < 0) return;
    const arr = this.getCurrentTabArray();
    const item = arr[fromSlot];
    if (!item) return;
    const target = arr[toSlot] ?? null;

    if (target && target.itemId === item.itemId && this.currentTab !== MapleInventoryType.EQUIP) {
      const slotMax = target.getSlotMax?.() ?? 100;
      const room = slotMax - (target.quantity || 1);
      const moving = Math.min(room, item.quantity || 1);
      if (moving > 0) {
        target.quantity = (target.quantity || 1) + moving;
        item.quantity = (item.quantity || 1) - moving;
        if (item.quantity <= 0) arr[fromSlot] = null;
        return;
      }
      // Target stack is full — fall through to a swap
    }

    arr[toSlot] = item;
    arr[fromSlot] = target;
  }

  drawItems(canvas: GameCanvas) {
    if (!this.charecter || !this.charecter.inventory) {
      console.warn("Character or inventory not available");
      return;
    }

    let items = [];
    switch (this.currentTab) {
      case MapleInventoryType.EQUIP:
        items = this.charecter.inventory.equip || [];
        break;
      case MapleInventoryType.USE:
        items = this.charecter.inventory.use || [];
        break;
      case MapleInventoryType.SETUP:
        items = this.charecter.inventory.setup || [];
        break;
      case MapleInventoryType.ETC:
        items = this.charecter.inventory.etc || [];
        break;
      case MapleInventoryType.CASH:
        items = this.charecter.inventory.cash || [];
        break;
    }

    // Grid positions measured from the 175x289 WZ background
    // Columns at x=9,45,81,117; Rows at y=51,85,119,153,187,221; cell ~32x32
    const colXs = [9, 45, 81, 117];
    const rowYs = [51, 85, 119, 153, 187, 221];
    const slotColumns = 4;
    const slotRows = 6;
    const slotSize = 32;

    for (let row = 0; row < slotRows; row++) {
      for (let col = 0; col < slotColumns; col++) {
        const slotIndex = (row + this.scrollRow) * slotColumns + col;
        const slotX = this.x + colXs[col];
        const slotY = this.y + rowYs[row];

        // Draw slot background (using .wz file image if available)
        if (this.inventoryNode && this.inventoryNode.SlotBackgrnd) {
          try {
            const slotImg = this.inventoryNode.SlotBackgrnd.nGetImage();
            canvas.drawImage({
              img: slotImg,
              dx: slotX,
              dy: slotY,
            });
          } catch (e) {
            canvas.drawRect({
              x: slotX,
              y: slotY,
              width: slotSize,
              height: slotSize,
              color: "transparent",
              alpha: 0.5,
            });
          }
        } else {
          canvas.drawRect({
            x: slotX,
            y: slotY,
            width: slotSize,
            height: slotSize,
            color: "transparent",
            alpha: 0.5,
          });
        }

        // Draw the item in this slot if present.
        if (slotIndex < items.length && items[slotIndex]) {
          const item = items[slotIndex];
          let icon = null;
          // The slot art is `info/icon` — iconRaw plus the baked drop shadow,
          // what the original's inventory shows — placed by its origin so it
          // sits on the cell's floor like the original. iconRaw is only the
          // fallback: some items author it oversized (Piece of Cracked
          // Dimension's raw is 52x48 against a 32x32 icon) and it covered
          // the neighbouring cells. Expired pets show their doll (iconD).
          const info = item.node?.info;
          const dead = !!item.equipData?.dead;
          const candidates = dead
            ? [info?.iconD, info?.iconRawD, info?.icon, info?.iconRaw]
            : [info?.icon, item.node?.icon, info?.iconRaw, item.node?.iconRaw];
          let iconNode: any = null;
          for (const c of candidates) {
            if (c?.nTagName === 'canvas' && c.nGetImage) { iconNode = c; break; }
          }
          try { icon = iconNode?.nGetImage?.() ?? null; } catch { icon = null; }

          if (icon && iconNode) {
            try {
              const w = Number(iconNode.nWidth) || icon.width || slotSize;
              const h = Number(iconNode.nHeight) || icon.height || slotSize;
              const ox = Number(iconNode.nGet?.('origin')?.nX ?? 0) || 0;
              const oy = Number(iconNode.nGet?.('origin')?.nY ?? h) || h;
              // Anything well over the cell (a few chairs, oversized raws
              // with no icon) is scaled to fit rather than spilling over
              const limit = slotSize + 4;
              const scale = w > limit || h > limit ? Math.min(limit / w, limit / h) : 1;
              const dw = Math.round(w * scale), dh = Math.round(h * scale);
              const dx = scale === 1 ? slotX - ox : slotX + Math.round((slotSize - dw) / 2);
              const dy = scale === 1 ? slotY + slotSize - oy : slotY + slotSize - dh;
              canvas.drawImage({ img: icon, dx, dy, dw, dh });
            } catch (e) {
              console.warn(`Failed to draw icon for item ${item.itemId}`);
            }
          } else {
            canvas.drawText({
              text: `${item.itemId}`,
              x: slotX + slotSize / 2,
              y: slotY + slotSize / 2,
              color: "#FFFFFF",
              align: "center",
              fontSize: 8,
            });
          }

          // Draw quantity in the lower-right if greater than 1 using WZ digit sprites
          const quantity = item.quantity || 1;
          if (quantity > 1) {
            const digits = quantity.toString();
            // Calculate total width of digit sprites
            let totalW = 0;
            for (const d of digits) {
              const digitImg = this._itemNoDigits[parseInt(d)];
              totalW += digitImg?.width || 8;
            }
            // Draw right-aligned at bottom-right of slot
            let dx = slotX + slotSize - totalW - 2;
            const dy = slotY + slotSize - (this._itemNoDigits[0]?.height || 11) - 2;
            for (const d of digits) {
              const digitImg = this._itemNoDigits[parseInt(d)];
              if (digitImg) {
                canvas.drawImage({ img: digitImg, dx, dy });
                dx += digitImg.width;
              } else {
                // Fallback to text
                canvas.drawText({ text: d, x: dx, y: dy, color: '#ffffff', fontSize: 10 });
                dx += 8;
              }
            }
          }
        }
      }
    }

    // Detect hovered item slot
    this.hoveredItem = null;
    const mouseX = this.GameCanvas.mouseX;
    const mouseY = this.GameCanvas.mouseY;
    for (let row = 0; row < slotRows; row++) {
      for (let col = 0; col < slotColumns; col++) {
        const slotIndex = (row + this.scrollRow) * slotColumns + col;
        const slotX = this.x + colXs[col];
        const slotY = this.y + rowYs[row];
        if (
          mouseX >= slotX && mouseX < slotX + slotSize &&
          mouseY >= slotY && mouseY < slotY + slotSize &&
          slotIndex < items.length && items[slotIndex]
        ) {
          this.hoveredItem = items[slotIndex];
          this.hoveredSlotX = slotX;
          this.hoveredSlotY = slotY;
        }
      }
    }

    // Draw the tabs over the items.
    this.drawTabs(canvas);
  }

  drawTabs(canvas: GameCanvas) {
    const tabNode = this.inventoryNode?.Tab;
    const tabTypes = [
      MapleInventoryType.EQUIP,
      MapleInventoryType.USE,
      MapleInventoryType.SETUP,
      MapleInventoryType.ETC,
      MapleInventoryType.CASH,
    ];

    for (let i = 0; i < tabTypes.length; i++) {
      const isActive = this.currentTab === tabTypes[i];
      const tabX = this.x + TAB_X0 + i * TAB_W;

      // Plate first — Tab1/0 (pink) under the lit tab, Tab0/0 (grey) under the
      // rest. The selected plate is a pixel taller (19 vs 18), so both are
      // bottom-aligned on the strip's red underline and the lit one rises a
      // pixel over it, which is what makes it read as "in front".
      const plate = isActive ? this._tabPlateOn : this._tabPlateOff;
      const plateH = plate?.height || (isActive ? TAB_PLATE_H : TAB_PLATE_H - 1);
      const plateW = plate?.width || TAB_W;
      const plateY = this.y + TAB_STRIP_BOTTOM - plateH;
      if (plate && plate.width > 0) canvas.drawImage({ img: plate, dx: tabX, dy: plateY });

      // Label sprite centred on the plate it sits on: `enabled` is the dark
      // glyph for the pink plate, `disabled` the light one for the grey
      let labelImg: HTMLImageElement | null = null;
      try {
        if (tabNode) {
          const stateNode = isActive ? tabNode.enabled : tabNode.disabled;
          labelImg = stateNode.nGet(`${i}`).nGetImage();
        }
      } catch (e) { /* plate alone still reads */ }
      if (labelImg && labelImg.width > 0) {
        canvas.drawImage({
          img: labelImg,
          dx: tabX + Math.round((plateW - labelImg.width) / 2),
          dy: plateY + Math.round((plateH - labelImg.height) / 2),
        });
      }
    }
  }

  drawScrollbar(canvas: GameCanvas) {
    // Draw a simple scrollbar on the right side of the inventory
    // Scrollbar area: x=152-170, y=51 to y=252 on the background
    if (!this._scrollbarImages) return;

    const sbX = this.x + 155;
    const sbTopY = this.y + 51;
    const sbBottomY = this.y + 252;
    const sbHeight = sbBottomY - sbTopY;

    const { prev, next, thumb } = this._scrollbarImages;
    const arrowH = 13; // VScr4 arrows are 15x13

    // Up arrow
    if (prev) canvas.drawImage({ img: prev, dx: sbX, dy: sbTopY });

    // Down arrow
    if (next) canvas.drawImage({ img: next, dx: sbX, dy: sbBottomY - arrowH });

    // Thumb at the proportional position (top when the tab fits the page)
    if (thumb) {
      const trackY = sbTopY + arrowH;
      const travel = sbHeight - 2 * arrowH - (thumb.height || 0);
      const max = this.maxScrollRow();
      if (this.scrollRow > max) this.scrollRow = max;
      const ty = trackY + (max > 0 ? Math.round(travel * (this.scrollRow / max)) : 0);
      canvas.drawImage({ img: thumb, dx: sbX, dy: ty });
    }
  }

  handleTabClick(mouseX: number, mouseY: number) {
    // Same geometry drawTabs paints: five 34px plates hanging from the strip
    const tabY = this.y + TAB_STRIP_BOTTOM - TAB_PLATE_H;
    if (mouseY < tabY || mouseY > tabY + TAB_PLATE_H) return false;

    const tabs = [
      MapleInventoryType.EQUIP,
      MapleInventoryType.USE,
      MapleInventoryType.SETUP,
      MapleInventoryType.ETC,
      MapleInventoryType.CASH
    ];

    for (let i = 0; i < tabs.length; i++) {
      const tabX = this.x + TAB_X0 + i * TAB_W;
      if (mouseX >= tabX && mouseX < tabX + TAB_W) {
        if (this.currentTab !== tabs[i]) this.scrollRow = 0;
        this.currentTab = tabs[i];
        return true;
      }
    }
    return false;
  }

  onMouseDown(mouseX: number, mouseY: number) {
    if (this.isHidden) return false;
    
    // First check if a tab was clicked
    if (this.handleTabClick(mouseX, mouseY)) {
      return true;
    }
    if (this.handleScrollbarClick(mouseX, mouseY)) {
      return true;
    }
    
    // Check if an item slot was clicked
    const colXs = [9, 45, 81, 117];
    const rowYs = [51, 85, 119, 153, 187, 221];
    const slotColumns = 4;
    const slotRows = 6;
    const slotSize = 32;
    
    let items = [];
    switch (this.currentTab) {
      case MapleInventoryType.EQUIP:
        items = this.charecter.inventory.equip || [];
        break;
      case MapleInventoryType.USE:
        items = this.charecter.inventory.use || [];
        break;
      case MapleInventoryType.SETUP:
        items = this.charecter.inventory.setup || [];
        break;
      case MapleInventoryType.ETC:
        items = this.charecter.inventory.etc || [];
        break;
      case MapleInventoryType.CASH:
        items = this.charecter.inventory.cash || [];
        break;
    }
    
    for (let row = 0; row < slotRows; row++) {
      for (let col = 0; col < slotColumns; col++) {
        const slotIndex = (row + this.scrollRow) * slotColumns + col;
        const slotX = this.x + colXs[col];
        const slotY = this.y + rowYs[row];

        if (
          mouseX >= slotX &&
          mouseX < slotX + slotSize &&
          mouseY >= slotY &&
          mouseY < slotY + slotSize
        ) {
          // Check if there's an item in this slot
          if (slotIndex < items.length && items[slotIndex]) {
            const item = items[slotIndex];
            const now = Date.now();

            // Double-click detection — consume or equip item
            if (slotIndex === this.lastClickSlot && now - this.lastClickTime < 400) {
              this.lastClickSlot = -1;
              this.lastClickTime = 0;
              if (this.currentTab === MapleInventoryType.USE) {
                this.consumeItem(item, slotIndex);
              } else if (this.currentTab === MapleInventoryType.EQUIP) {
                this.equipItem(item, slotIndex);
              } else if (this.currentTab === MapleInventoryType.SETUP) {
                this.useSetupItem(item);
              } else if (this.currentTab === MapleInventoryType.ETC) {
                // Pet Command Guides (and any other WZ `book`) open their reader
                if (item.node?.book) void UIPetGuideDialog.show(item);
              } else if (this.currentTab === MapleInventoryType.CASH) {
                if (Math.floor(item.itemId / 1000000) === 1) {
                  if (isPetEquipItemId(item.itemId)) {
                    // Pet equips go on a summoned pet, not the character
                    void PetManager.equipPetItem(item, slotIndex, this.charecter);
                  } else {
                    // Cash clothes wear as a costume cover (slot base+100)
                    // over the real gear — v83 style, stats untouched
                    this.equipItem(item, slotIndex, true);
                  }
                } else if (isPetItemId(item.itemId)) {
                  // Live pet: double-click toggles summon
                  void PetManager.toggleSummon(item, this.charecter);
                } else if (isPetFoodItemId(item.itemId)) {
                  PetManager.feedPet(item, slotIndex, this.charecter);
                } else if (item.itemId === EVOLUTION_ROCK_ID) {
                  void PetManager.useEvolutionRock(item, slotIndex, this.charecter);
                } else if (isMegaphoneItem(item.itemId)) {
                  void UIAvatarMegaphone.promptAndSend(item, this.charecter);
                } else if (isWeatherItem(item.itemId)) {
                  // Weather items: ask for the message, consume, relay to the map
                  void Weather.promptAndUse(item, slotIndex, this.charecter);
                } else if (FACE_COUPON_EXPRESSIONS[item.itemId]) {
                  // Face-expression coupons fire their emote (not consumed)
                  this.charecter.playEmote?.(FACE_COUPON_EXPRESSIONS[item.itemId]);
                }
              }
              return true;
            }

            this.lastClickSlot = slotIndex;
            this.lastClickTime = now;
            this.handleItemDrag(item, slotIndex);
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  // Canvas-based drag state — drawn during render, no DOM elements
  draggingItem: any = null;
  draggingSlotIndex: number = -1;
  draggingIcon: HTMLImageElement | null = null;
  isDragging: boolean = false;

  // Handle dragging an item out of the inventory
  handleItemDrag(item: any, slotIndex: number) {
    // Checked before any state is set, not just before beginPending. This
    // window keeps its own drag flags and draws its own carried icon, so a
    // press landing on a window stacked above this one still produced a
    // second ghost here — two things dragging off one click.
    if (!this.ownsPoint(this.GameCanvas.mouseX, this.GameCanvas.mouseY)) return;

    ClickManager.isDraggingItem = true;
    this.isDragging = true;
    this.draggingItem = item;
    this.draggingSlotIndex = slotIndex;
    const startX = this.GameCanvas.mouseX;
    const startY = this.GameCanvas.mouseY;
    this.dragStartX = startX;
    this.dragStartY = startY;

    // Get item icon for canvas rendering — icons live at info/iconRaw for
    // both Item.wz items and Character.wz equips
    let iconImg: HTMLImageElement | null = null;
    try {
      // iconRaw first, then icon. Not every item has iconRaw — chairs are one
      // — and without the fallback the icon came back null, which skipped
      // beginPending entirely, so those items could not be dragged onto a
      // quickslot or a key at all. ShopUI has always used the same fallback.
      const iconNode =
        item.node?.info?.iconRaw ?? item.node?.info?.icon ??
        item.node?.iconRaw ?? item.node?.icon;
      if (iconNode?.nGetImage) {
        iconImg = iconNode.nGetImage();
        this.draggingIcon = iconImg;
      }
    } catch (e) {
      this.draggingIcon = null;
    }

    // Also register with global DragManager for hotkey bar drops. Only when
    // this window owns the point — overlapping menus each read the mouse for
    // themselves, so without it two windows start a drag off one press.
    if (iconImg) {
      DragManager.beginPending('item', item.itemId, iconImg, startX, startY);
    }

    // Listen for mouse up on the canvas element
    const gameEl = document.getElementById('game') as HTMLCanvasElement;
    const onMouseUp = () => {
      gameEl?.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mouseup', onMouseUp);

      if (!this.isDragging) return;
      this.isDragging = false;
      ClickManager.isDraggingItem = false;

      const mouseX = this.GameCanvas.mouseX;
      const mouseY = this.GameCanvas.mouseY;

      // Below the drag threshold it's just a click, not a drag-drop
      const dragDist = Math.sqrt((mouseX - startX) ** 2 + (mouseY - startY) ** 2);
      if (dragDist < 4) {
        this.draggingItem = null;
        this.draggingIcon = null;
        this.draggingSlotIndex = -1;
        return;
      }

      // The DragManager path (hotkey bar assignment) only owns the drop when
      // it actually lands on the bar — otherwise reclaim it so scroll
      // application and ground drops below still work
      if (DragManager.isDragging) {
        const barSlot = UIHotkeyBar.getSlotAtMouse?.(mouseX, mouseY) ?? -1;
        // A key in the KEYBOARD SETTING window is a drop target too — without
        // this the cancel below killed the drag before the frame could bind
        // it, which is why an item could never be dropped onto a key.
        const onKey = UIKeyConfig.isOverKey?.(mouseX, mouseY) ?? false;
        if (onKey) {
          // Bind here, on the actual mouse-up, rather than leaving it for the
          // next frame to notice. This handler is the release; deferring it
          // made the drop depend on a later frame still seeing wasMouseUp,
          // and when that frame missed it the icon stayed on the cursor and
          // took a second click to place.
          UIKeyConfig.handleDrop({
            type: 'item',
            id: this.draggingItem?.itemId,
            icon: this.draggingIcon,
            mouseX,
            mouseY,
          } as any);
          DragManager.cancel();
          this.draggingItem = null;
          this.draggingIcon = null;
          this.draggingSlotIndex = -1;
          return;
        }
        if (barSlot >= 0) {
          this.draggingItem = null;
          this.draggingIcon = null;
          this.draggingSlotIndex = -1;
          return;
        }
        DragManager.cancel();
      }

      // Check if mouse is outside inventory window (in canvas coords)
      let invW = 172, invH = 290;
      try {
        const rect = this.getRect({} as CameraInterface);
        invW = rect.width;
        invH = rect.height;
      } catch (e) {}

      // Upgrade scroll (2040xxx) dropped onto a worn item in the equip window
      const isScroll = item.itemId >= 2040000 && item.itemId < 2050000;
      if (isScroll) {
        const equipMenu = (window as any).MapStateInstance?.equipMenu;
        const targetSlot = equipMenu?.getSlotAt?.(mouseX, mouseY);
        if (targetSlot !== null && targetSlot !== undefined) {
          this.applyScrollToEquippedSlot(item, targetSlot);
          this.draggingItem = null;
          this.draggingIcon = null;
          this.draggingSlotIndex = -1;
          return;
        }
      }

      // Dropped onto another slot in the grid — move/swap/merge
      const targetSlot = this.getSlotAtMouse(mouseX, mouseY);
      if (targetSlot >= 0) {
        this.moveItemToSlot(slotIndex, targetSlot);
        this.draggingItem = null;
        this.draggingIcon = null;
        this.draggingSlotIndex = -1;
        return;
      }

      const isOutside =
        mouseX < this.x || mouseX > this.x + invW ||
        mouseY < this.y || mouseY > this.y + invH;

      if (isOutside) {
        this.showItemDropDialog(item, slotIndex);
      }

      this.draggingItem = null;
      this.draggingIcon = null;
      this.draggingSlotIndex = -1;
    };

    if (gameEl) gameEl.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mouseup', onMouseUp);
  }

  dragStartX: number = 0;
  dragStartY: number = 0;

  // Draw the dragged item icon at cursor position (called from draw method)
  drawDragIcon(canvas: GameCanvas) {
    // DragManager handles the ghost icon when drag threshold is met
    if (DragManager.isDragging) return;
    if (!this.isDragging || !this.draggingIcon) return;

    const mouseX = canvas.mouseX;
    const mouseY = canvas.mouseY;

    // Only show drag icon after mouse has moved enough (avoids flicker on click)
    const dist = Math.sqrt((mouseX - this.dragStartX) ** 2 + (mouseY - this.dragStartY) ** 2);
    if (dist < 10) return;

    const img = this.draggingIcon;

    // Draw semi-transparent icon centered on cursor
    canvas.context.save();
    canvas.context.globalAlpha = 0.8;
    canvas.drawImage({
      img,
      dx: mouseX - Math.floor(img.width / 2),
      dy: mouseY - Math.floor(img.height / 2),
    });
    canvas.context.restore();
  }

  async drawText(canvas: GameCanvas) {
    const mesosWithCommas = this.charecter.inventory.mesos
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    // Right-aligned inside the white meso field like GMS — the field ends
    // just left of the window's right border, so even max mesos
    // (2,147,483,647) stays within the box
    canvas.drawText({
      text: mesosWithCommas,
      x: this.x + 136,
      y: this.y + 270,
      fontSize: 11,
      align: 'right',
    });
  }

  loadButtons(canvas: GameCanvas) {
    try {
      if (
        this.inventoryNode &&
        this.inventoryNode.BtCoin &&
        this.inventoryNode.BtCoin.nChildren &&
        this.inventoryNode.BtCoin.nChildren.length > 0
      ) {
        const dropMesoButton = new MapleStanceButton(canvas, {
          x: this.x + 8,
          y: this.y + 267,
          img: this.inventoryNode.BtCoin.nChildren,
          isRelativeToCamera: true,
          isPartOfUI: true,
          onClick: () => {
            this.showMesoDropDialog();
          },
        });
        ClickManager.addButton(dropMesoButton);
        this.buttons = [dropMesoButton];
      }
    } catch (e) {
      console.error("Error loading meso button:", e);
      this.buttons = [];
    }
  }

  moveTo(position: Position) {
    const deltaX = position.x - this.x;
    const deltaY = position.y - this.y;
    this.x = position.x;
    this.y = position.y;
    this.buttons.forEach((button) => {
      button.x += deltaX;
      button.y += deltaY;
    });
    this.loadBackground();
    this.originalX = position.x;
    this.originalY = position.y;
  }
  
  // Show the WZ-based meso drop dialog
  showMesoDropDialog() {
    if (!this.mesoDropDialog || !this.mesoDropDialog.isHidden) return;
    this.mesoDropDialog.show(this.charecter.inventory.mesos, (amount: number) => {
      this.dropMesos(amount);
    });
  }
  
  // Equip an item from the Equip tab (double-click). asCash wears it as a
  // v83 costume cover: slot base+100, swapped occupants return to the CASH
  // tab, and the real gear underneath keeps its slot and stats.
  async equipItem(item: any, slotIndex: number, asCash: boolean = false) {
    if (!item || !this.charecter) return;

    const itemId = item.itemId;
    const baseSlot = getEquipSlotForItem(itemId);
    if (baseSlot < 0) {
      console.warn(`[Inventory] Cannot determine equip slot for item ${itemId}`);
      return;
    }
    const slot = asCash ? baseSlot + 100 : baseSlot;

    // An id with no Character.wz data (not a v83 item) cannot be worn —
    // and must not be half-equipped: the old rule pulled it out of the bag
    // and took the worn piece off before the missing file threw
    if (!item.node) {
      console.warn(`[Inventory] ${itemId} has no equip data — cannot equip`);
      import('../UIChatLog').then(({ default: UIChatLog }) => UIChatLog.system(`Item ${itemId} has no data and cannot be equipped.`)).catch(() => {});
      return;
    }

    // v83 requirement gate: level/stats/fame must meet the item's reqs
    // (like GMS, the double-click simply does nothing when unmet — the
    // tooltip shows the requirements)
    const infoNode = item.node?.info || item.node?.nGet?.("info");
    if (!this.charecter.canEquip(infoNode, itemId)) {
      console.log(`[Inventory] Cannot equip ${itemId} — requirements not met`);
      return;
    }

    // Remove from inventory first so the swapped-out item can take this slot
    const equipArr = asCash
      ? this.charecter.inventory.cash
      : this.charecter.inventory.equip;
    const idx = equipArr.indexOf(item);
    if (idx !== -1) {
      equipArr[idx] = null;
    }

    // If slot is already occupied, unequip current item first (swap),
    // carrying its per-instance scroll data back to the inventory item
    const currentItemId = this.charecter.equippedItemIds[slot];
    const currentEquipData = this.charecter.equippedItemData?.[slot];
    if (currentItemId) {
      this.charecter.detachEquip(slot);
      try {
        const oldItem = await Item.fromOpts({
          itemId: currentItemId,
          quantity: 1,
          equipData: currentEquipData,
        });
        // Reuse the vacated slot; fall back to first free slot
        let freeSlot = idx !== -1 ? idx : equipArr.findIndex((it: any) => !it);
        if (freeSlot === -1) freeSlot = equipArr.length;
        equipArr[freeSlot] = oldItem;
      } catch (e) {
        console.error('[Inventory] Failed to create unequipped item:', e);
      }
    }

    // Equip on character (loads visuals + tracks ID + loads icon) and carry
    // the item instance's scroll data onto the worn slot. A refusal puts the
    // item back where it was and the old piece back on.
    let attached: any = false;
    try { attached = await this.charecter.attachEquip(slot, itemId); } catch { attached = false; }
    if (attached === false) {
      const back = idx !== -1 ? idx : equipArr.findIndex((it: any) => !it);
      equipArr[back === -1 ? equipArr.length : back] = item;
      if (currentItemId) {
        const restored = equipArr.findIndex((it: any) => it && it.itemId === currentItemId && it !== item);
        if (restored !== -1) equipArr[restored] = null;
        try { await this.charecter.attachEquip(slot, currentItemId); } catch { /* keep it in the bag */ }
        if (currentEquipData) this.charecter.equippedItemData[slot] = currentEquipData;
      }
      return;
    }
    if (item.equipData) {
      this.charecter.equippedItemData[slot] = item.equipData;
      this.charecter.recalcLocalStats?.();
    }
    console.log(`[Inventory] Equipped item ${itemId} in slot ${slot}`);
  }

  // Consume a use-tab item (double-click)
  /**
   * Setup tab double-click. Only chairs (3010000-3019999) do anything in
   * v83 — the rest of the tab is decorations and mega-phones we don't
   * implement. Sitting is toggled: double-clicking the chair you're already
   * on stands you up.
   */
  useSetupItem(item: any) {
    const id = item?.itemId;
    const chr: any = this.charecter;
    if (!chr || !Number.isFinite(id)) return;
    if (id < 3010000 || id >= 3020000) return;

    if (chr.chairId === id) {
      chr.standUpFromChair();
      return;
    }
    // Can't sit mid-air, on a rope, while attacking or dead
    if (chr.isDead || chr.isInClimbingRope || !chr.pos?.fh) return;
    chr.sitOnChair(id);
  }

  consumeItem(item: any, slotIndex: number) {
    if (!item || !this.charecter) return;

    // Potions/food (2000xxx-2029xxx), return scrolls (2030xxx) and the cure
    // potions (2050xxx: Antidote, Eyedrop, Tonic, Holy Water, All Cure) are
    // usable. Upgrade scrolls (2040xxx), arrows, stars, cards are NOT
    const id = item.itemId;
    const isCure = id >= 2050000 && id < 2050100;
    if (!isCure && (id < 2000000 || id >= 2040000)) return;

    // Access spec via WZ node — try both property access and nGet
    const spec = item.node?.spec || item.node?.nGet?.('spec');
    if (!spec || (!spec.nChildren && !spec.hp && !spec.mp && !spec.moveTo)) {
      console.log(`[Inventory] Item #${item.itemId} has no spec — cannot consume`);
      return;
    }

    // Return scrolls: spec/moveTo (999999999 = the current map's return map)
    const moveToNode = spec.moveTo ?? spec.nGet?.('moveTo');
    const moveTo = parseInt(moveToNode?.nValue ?? moveToNode ?? NaN);
    if (!isNaN(moveTo)) {
      // fieldLimit PORTALSCROLL (0x20): the map refuses return scrolls
      if (currentMapForbids(FieldLimit.PORTALSCROLL)) {
        UIChatLog.system(FIELD_LIMIT_MESSAGE);
        return;
      }
      this.consumeReturnScroll(item, moveTo);
      return;
    }

    // fieldLimit POTIONUSE (0x400, the client's STATCHANGEITEMCONSUMELIMIT):
    // no potions or food here — v83's "You can't use it here in this map."
    if (currentMapForbids(FieldLimit.POTIONUSE)) {
      UIChatLog.system(FIELD_LIMIT_MESSAGE);
      return;
    }

    // Cure flags in the spec (poison/darkness/weakness/seal/curse) lift the
    // matching mob-skill diseases; the potion is spent whether or not one
    // was active, as in v83
    const cureFlags: [string, number][] = [
      ['poison', MobSkillId.POISON], ['darkness', MobSkillId.DARKNESS],
      ['weakness', MobSkillId.WEAKNESS], ['seal', MobSkillId.SEAL], ['curse', MobSkillId.CURSE],
    ];
    const readFlag = (name: string) => {
      const node = spec[name] ?? spec.nGet?.(name);
      return Number(node?.nValue ?? node ?? 0) > 0;
    };
    const cures = cureFlags.filter(([name]) => readFlag(name)).map(([, sid]) => sid);
    if (cures.length) {
      for (const sid of cures) this.charecter.status?.remove?.(sid);
      if (this.consumeSound) PLAY_AUDIO(this.consumeSound, 0.5, true);
      this.removeOneFromUseTab(item);
      return;
    }

    // Read spec values from WZ node children
    let hpRecover = 0;
    let mpRecover = 0;
    let hpPercent = 0;
    let mpPercent = 0;

    if (spec.nChildren) {
      for (const prop of spec.nChildren) {
        switch (prop.nName) {
          case 'hp': hpRecover = parseInt(prop.nValue) || 0; break;
          case 'mp': mpRecover = parseInt(prop.nValue) || 0; break;
          case 'hpR': hpPercent = parseInt(prop.nValue) || 0; break;
          case 'mpR': mpPercent = parseInt(prop.nValue) || 0; break;
        }
      }
    } else {
      // Direct property access fallback
      hpRecover = parseInt(spec.hp?.nValue ?? spec.hp ?? 0) || 0;
      mpRecover = parseInt(spec.mp?.nValue ?? spec.mp ?? 0) || 0;
      hpPercent = parseInt(spec.hpR?.nValue ?? spec.hpR ?? 0) || 0;
      mpPercent = parseInt(spec.mpR?.nValue ?? spec.mpR ?? 0) || 0;
    }

    // Apply percentage-based recovery
    if (hpPercent > 0) {
      hpRecover += Math.floor(this.charecter.effectiveMaxHp * hpPercent / 100);
    }
    if (mpPercent > 0) {
      mpRecover += Math.floor(this.charecter.effectiveMaxMp * mpPercent / 100);
    }

    // Apply recovery (clamped to max)
    if (hpRecover > 0) {
      this.charecter.hp = Math.min(this.charecter.hp + hpRecover, this.charecter.effectiveMaxHp);
    }
    if (mpRecover > 0) {
      this.charecter.mp = Math.min(this.charecter.mp + mpRecover, this.charecter.effectiveMaxMp);
    }

    console.log(`[Inventory] Consumed item #${item.itemId}: +${hpRecover} HP, +${mpRecover} MP`);

    // Timed specs are a buff (Ciders' pad/mad, Bubble Gum's jump, the map
    // protection of Air Bubble / Soft White Bun) — see BuffManager.applyItemBuff
    const specNum = (name: string): number => {
      const n = spec[name] ?? spec.nGet?.(name);
      const v = n?.nValue ?? n;
      return typeof v === 'number' || typeof v === 'string' ? (parseInt(String(v)) || 0) : 0;
    };
    const timeMs = specNum('time');
    if (timeMs > 0 && this.charecter.buffManager?.applyItemBuff) {
      const buffSpec = {
        pad: specNum('pad'), mad: specNum('mad'), pdd: specNum('pdd'), mdd: specNum('mdd'),
        acc: specNum('acc'), eva: specNum('eva'), speed: specNum('speed'), jump: specNum('jump'),
        thaw: specNum('thaw'),
      };
      let icon: HTMLImageElement | null = null;
      try { icon = item.node?.info?.icon?.nGetImage?.() ?? null; } catch { icon = null; }
      this.charecter.buffManager.applyItemBuff(item.itemId, buffSpec, timeMs, icon);
    }

    // Play consumption sound
    if (this.consumeSound) {
      PLAY_AUDIO(this.consumeSound, 0.5, true);
    }

    this.removeOneFromUseTab(item);
  }

  /** Spend one of a USE-tab stack (the consumed potion, scroll, cure). */
  private removeOneFromUseTab(item: any) {
    const inventoryArray = this.charecter.inventory.use || [];
    const actualItem = inventoryArray.find((i: any) => i && i.itemId === item.itemId);
    if (actualItem) {
      if ((actualItem.quantity || 1) <= 1) {
        const idx = inventoryArray.indexOf(actualItem);
        if (idx !== -1) inventoryArray[idx] = null;
      } else {
        actualItem.quantity--;
      }
      (window as any).__mySocket?.requestSave?.();
    }
  }

  // Apply an upgrade scroll to a worn equip (v83 scroll flow)
  async applyScrollToEquippedSlot(scrollItem: any, slot: number) {
    const character = this.charecter;
    const equipId = character.equippedItemIds?.[slot];
    if (!equipId) return;

    const { applyScroll } = await import('../../Inventory/ScrollSystem');

    // Ensure the worn slot has instance data (restored gear may lack it)
    if (!character.equippedItemData[slot]) {
      const equipNode = character.equips?.[slot];
      character.equippedItemData[slot] = {
        bonus: {},
        tuc: equipNode?.info?.tuc?.nValue ?? 0,
        level: 0,
      };
    }

    const result = applyScroll(scrollItem.node, scrollItem.itemId, equipId, character.equippedItemData[slot]);

    // Surface the outcome as the player's chat balloon
    character.chatMessage = result.message;
    character.showChatBalloon = true;
    character.chatBalloonTimer = 0;
    character.chatBalloonDuration = 4000;

    if (!result.applied) return;

    // Scroll is consumed on success or failure
    character.inventory.removeFromInventory(scrollItem.itemId, 1);

    if (result.destroyed) {
      character.detachEquip(slot);
    }
    if (this.consumeSound) {
      PLAY_AUDIO(this.consumeSound, 0.5, true);
    }
    character.recalcLocalStats?.();
  }

  // Return scroll: consume one and warp to the target (or the map's return map)
  async consumeReturnScroll(item: any, moveTo: number) {
    const mapState = (window as any).MapStateInstance;
    if (!mapState?.changeMap) return;

    let targetMap = moveTo;
    if (moveTo === 999999999) {
      targetMap = this.charecter.map?.wzNode?.info?.returnMap?.nValue ?? 0;
    }
    if (!targetMap || targetMap === 999999999) {
      console.warn(`[Inventory] Return scroll #${item.itemId} has no valid target`);
      return;
    }

    if (this.consumeSound) {
      PLAY_AUDIO(this.consumeSound, 0.5, true);
    }
    this.charecter.inventory.removeFromInventory(item.itemId, 1);

    const { fadeToBlack } = await import('../../MapState');
    fadeToBlack();
    await mapState.changeMap(targetMap);
  }

  // Drop items — single items drop immediately, stackable items show quantity dialog
  async showItemDropDialog(item: any, slotIndex: number) {
    // What the item itself says. v83 marks untradeable and quest items in
    // their own WZ info node, and their tooltips already tell the player as
    // much in orange — nothing was enforcing it, so a Relaxer chair
    // (tradeBlock=1) could be thrown on the floor. This covers every item
    // carrying the flags, not just chairs.
    const { canDropItem, dropVanishes, UNTRADEABLE_DROP_WARNING } = await import('../../Inventory/ItemRestrictions');
    if (!(await canDropItem(item.itemId))) {
      console.log(`[Inventory] #${item.itemId} cannot be dropped (quest item)`);
      return;
    }

    // Untradeable: v83 lets it go, but warns that it will be gone — the drop
    // then vanishes where it lands rather than staying on the floor
    const vanish = await dropVanishes(item.itemId);
    if (vanish && !(this as any)._dropConfirmed) {
      if (!this.confirmDialog || !this.confirmDialog.isHidden) return;
      this.confirmDialog.show(UNTRADEABLE_DROP_WARNING, (yes: boolean) => {
        if (!yes) return;
        (this as any)._dropConfirmed = true;
        void this.showItemDropDialog(item, slotIndex).finally(() => { (this as any)._dropConfirmed = false; });
      });
      return;
    }

    // NOTE: no active-quest-requirements check here on purpose. GMS only
    // protects true quest items — the ones flagged quest=1 in their own WZ
    // info, which canDropItem above already enforces. A common item that a
    // quest merely needs (Branch, Stone, ...) stays droppable.

    const maxQuantity = item.quantity || 1;

    if (maxQuantity <= 1) {
      // Single item — drop immediately, no dialog
      this.dropItem(item, 1, slotIndex, vanish);
      return;
    }

    // Stackable item — show quantity dialog
    if (!this.mesoDropDialog || !this.mesoDropDialog.isHidden) return;
    this.mesoDropDialog.show(maxQuantity, (quantity: number) => {
      this.dropItem(item, quantity, slotIndex, vanish);
    }, 'item', item.name || '');
  }

  drawTooltip(canvas: GameCanvas) {
    if (!this.hoveredItem || !this.itemNamesReady) return;

    const item = this.hoveredItem;
    const itemId = item.itemId;

    // Equips get the GMS-style detailed tooltip (REQ stats, job bar, ...)
    if (Math.floor(itemId / 1000000) === 1) {
      if (UIEquipTooltip.draw(canvas, itemId, item.equipData, this.hoveredSlotX, this.hoveredSlotY + 30)) {
        return;
      }
    }
    const name = getItemNameSync(itemId);
    const rawDesc = getItemDescSync(itemId).replace(/\\n/g, '\n');

    // Parse format codes into segments: { text, color }
    // #c...# = orange text, strip other codes like #b #r #k #n
    const descSegments: { text: string; color: string }[] = [];
    let remaining = rawDesc;
    while (remaining.length > 0) {
      const cStart = remaining.indexOf('#c');
      if (cStart === -1) {
        if (remaining) descSegments.push({ text: remaining, color: '#CCCCCC' });
        break;
      }
      if (cStart > 0) {
        descSegments.push({ text: remaining.substring(0, cStart), color: '#CCCCCC' });
      }
      remaining = remaining.substring(cStart + 2);
      const cEnd = remaining.indexOf('#');
      if (cEnd === -1) {
        if (remaining) descSegments.push({ text: remaining, color: '#FFaa00' });
        break;
      }
      descSegments.push({ text: remaining.substring(0, cEnd), color: '#FFaa00' });
      remaining = remaining.substring(cEnd + 1);
    }
    // Pet status block: name/level/closeness/fullness above the desc, and
    // the doll line when the pet's life ran out
    if (isPetItemId(item.itemId) && item.equipData?.petLevel != null) {
      const d: any = item.equipData;
      const next = ExpTable.getClosenessNeededForLevel(Math.min(30, (d.petLevel ?? 1) + 1));
      descSegments.unshift({
        text:
          `${d.petName ?? ''}\n` +
          `Level: ${d.petLevel} | Closeness: ${d.closeness ?? 0}/${next}\n` +
          `Fullness: ${d.fullness ?? 100}/100${rawDesc ? '\n' : ''}`,
        color: '#FFffff',
      });
      if (d.dead) {
        descSegments.push({
          text: '\nThis pet has turned back into a doll.',
          color: '#FF8888',
        });
      }
    }
    // Cash Shop rental countdown rides the same colored-segment pipeline
    if (item.equipData?.expireAt) {
      descSegments.push({
        text: `${rawDesc ? '\n' : ''}${isPetItemId(item.itemId) ? 'Life remaining' : 'Remaining'}: ${formatRemaining(item.equipData.expireAt)}`,
        color: '#FFaa00',
      });
    }
    // Build plain desc for layout calculation, keep segments for colored rendering
    const desc = descSegments.map(s => s.text).join('');

    // Get item icon
    let icon: HTMLImageElement | null = null;
    try {
      if (item.node?.iconRaw) icon = item.node.iconRaw.nGetImage();
      if (!icon && item.node?.info?.iconRaw) icon = item.node.info.iconRaw.nGetImage();
    } catch {}

    const iconSize = 38;
    const padding = 8;
    const nameFont = 12;
    const descFont = 11;
    const lineHeight = 14;

    // Build colored word list from segments
    type ColorWord = { word: string; color: string; newline?: boolean };
    const colorWords: ColorWord[] = [];
    for (const seg of descSegments) {
      const lines = seg.text.split('\n');
      for (let li = 0; li < lines.length; li++) {
        if (li > 0) colorWords.push({ word: '', color: seg.color, newline: true });
        const words = lines[li].split(' ').filter(w => w.length > 0);
        for (const w of words) colorWords.push({ word: w, color: seg.color });
      }
    }

    // Word-wrap into lines of colored spans
    type ColorSpan = { text: string; color: string };
    const maxTextWidth = 150;
    const descLines: ColorSpan[][] = [];
    let currentLine: ColorSpan[] = [];
    let currentLineWidth = 0;

    for (const cw of colorWords) {
      if (cw.newline) {
        descLines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
        continue;
      }
      const wordW = canvas.measureText({ text: cw.word + ' ', fontSize: descFont })?.width || 0;
      if (currentLineWidth + wordW > maxTextWidth && currentLine.length > 0) {
        descLines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
      }
      currentLine.push({ text: cw.word + ' ', color: cw.color });
      currentLineWidth += wordW;
    }
    if (currentLine.length > 0) descLines.push(currentLine);

    // Calculate tooltip dimensions
    const iconAreaWidth = iconSize + padding;
    const descBlockWidth = descLines.length > 0
      ? Math.min(maxTextWidth, Math.max(...descLines.map(spans => {
          const lineText = spans.map(s => s.text).join('');
          const m = canvas.measureText({ text: lineText, fontSize: descFont });
          return m ? m.width : 0;
        })))
      : 0;
    const nameWidth = canvas.measureText({ text: name, fontSize: nameFont })?.width || 60;

    const contentWidth = Math.max(nameWidth + 14, iconAreaWidth + descBlockWidth + padding);
    const tooltipWidth = contentWidth + padding * 2;

    const nameAreaHeight = nameFont + 6;
    const bodyHeight = Math.max(iconSize, descLines.length * lineHeight);
    const tooltipHeight = nameAreaHeight + bodyHeight + padding * 2 + 4;

    // Position tooltip below-right of the hovered slot
    let tx = this.hoveredSlotX;
    let ty = this.hoveredSlotY + 30;

    // Keep tooltip on screen
    const canvasW = canvas.game?.width || 1280;
    const canvasH = canvas.game?.height || 720;
    if (tx + tooltipWidth > canvasW) tx = canvasW - tooltipWidth;
    if (ty + tooltipHeight > canvasH) ty = this.hoveredSlotY - tooltipHeight;
    if (tx < 0) tx = 0;
    if (ty < 0) ty = 0;

    // The shared v83 translucent navy plate
    drawPlate(canvas.context, tx, ty, tooltipWidth, tooltipHeight);

    // Draw item name with bullet
    canvas.drawText({
      text: '\u2022 ' + name,
      x: tx + padding,
      y: ty + padding,
      color: '#FFFFFF',
      fontSize: nameFont,
      fontWeight: 'bold',
    });

    // Separator line
    const separatorY = ty + nameAreaHeight + padding;
    canvas.drawLine({
      x1: tx + 4,
      y1: separatorY,
      x2: tx + tooltipWidth - 4,
      y2: separatorY,
      color: '#666666',
      width: 1,
      alpha: 0.6,
    });

    // Draw icon
    const bodyY = separatorY + 4;
    if (icon) {
      // The icon sits straight on the plate — v83 has no backing square here
      canvas.drawImage({
        img: icon,
        dx: tx + padding + (iconSize - icon.width) / 2,
        dy: bodyY + (iconSize - icon.height) / 2,
      });
    }

    // Draw description text with colored spans
    const textX = tx + padding + iconAreaWidth;
    for (let i = 0; i < descLines.length; i++) {
      let spanX = textX;
      for (const span of descLines[i]) {
        canvas.drawText({
          text: span.text,
          x: spanX,
          y: bodyY + i * lineHeight + 2,
          color: span.color,
          fontSize: descFont,
        });
        spanX += canvas.measureText({ text: span.text, fontSize: descFont })?.width || 0;
      }
    }
  }

  destroy() {
    this.destroyed = true;
  }

  update(msPerTick: number) {
    this.delay += msPerTick;
  }

  draw(canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) {
    if (this.isHidden) return;
    if (!this.isNotFirstDraw) {
      this.loadButtons(canvas);
      this.isNotFirstDraw = true;
    }
    const rect = this.getRect(camera);
    UIDevTools.track('inventory', rect.x, rect.y, rect.width, rect.height, 'screen', 'UI.wz/UIWindow.img/Item');
    this.drawBackground(canvas);
    // Wheel over the window scrolls the grid a row at a time
    const mx = (canvas as any).mouseX ?? -1, my = (canvas as any).mouseY ?? -1;
    if (mx >= rect.x && mx < rect.x + rect.width && my >= rect.y && my < rect.y + rect.height) {
      if ((canvas as any).scrolledUp) this.scrollBy(-1);
      if ((canvas as any).scrolledDown) this.scrollBy(1);
    }
    this.drawItems(canvas);
    this.drawScrollbar(canvas);
    this.drawText(canvas);
    this.buttons.forEach((obj) => {
      obj.draw(canvas, camera, lag, msPerTick, tdelta);
    });

    // Draw dragged item icon at cursor
    this.drawDragIcon(canvas);

    // Draw item tooltip on hover
    this.drawTooltip(canvas);

    // Draw meso drop dialog on top
    if (this.confirmDialog) {
      this.confirmDialog.update(msPerTick);
      this.confirmDialog.draw(canvas, camera, lag, msPerTick, tdelta);
    }
    if (this.mesoDropDialog) {
      this.mesoDropDialog.update(msPerTick);
      this.mesoDropDialog.draw(canvas, camera, lag, msPerTick, tdelta);
    }
  }
}

export default InventoryMenuSprite;
