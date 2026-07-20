import WZManager from "../../wz-utils/WZManager";
import WZFiles from "../../Constants/enums/WZFiles";
import ClickManager from "../ClickManager";
import { MapleStanceButton } from "../MapleStanceButton";
import DragableMenu from "./DragableMenu";
import { MapleInventoryType } from "../../Constants/Inventory/MapleInventory";
import { CameraInterface } from "../../Camera";
import { Position } from "../../Effects/DamageIndicator";
import GameCanvas from "../../GameCanvas";
import DropItemSprite from "../../DropItem/DropItemSprite";
import Item from "../../Inventory/Item";
import UIMesoDropDialog from "../UIMesoDropDialog";
import QuestData from "../../Quest/QuestData";
import PLAY_AUDIO from "../../Audio/PlayAudio";
import { ensureItemNames, getItemNameSync, getItemDescSync } from "../../Quest/QuestData";
import DragManager from '../DragManager';
import UIDevTools from "../UIDevTools";
import mySocket from "../../mysocket";
import { getEquipSlotForItem } from "./EquipMenuSprite";

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
  // Double-click tracking
  lastClickSlot: number = -1;
  lastClickTime: number = 0;
  consumeSound: any = null;
  // Scrollbar images
  _scrollbarImages: any = null;
  // Tab frame images from Basic.img/Tab
  _tabFrames: any = null;
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
      // Tab frame pieces (0 = inactive, 1 = active/selected)
      const tabFrame = basicNode.Tab;
      if (tabFrame) {
        this._tabFrames = {
          left0: tabFrame.left0?.nGetImage(),
          left1: tabFrame.left1?.nGetImage(),
          fill0: tabFrame.fill0?.nGetImage(),
          fill1: tabFrame.fill1?.nGetImage(),
          right0: tabFrame.right0?.nGetImage(),
          right1: tabFrame.right1?.nGetImage(),
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
      this.charecter.inventory.mesos -= amount;
      
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
  async dropItem(item: any, quantity: number, slotIndex: number) {
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
      actualItem = inventoryArray.find(i => i.itemId === item.itemId);
      
      if (!actualItem) {
        console.warn("Item not found in inventory");
        return;
      }
    }
    
    try {
      // Handle quantity for stackable items
      const originalQuantity = actualItem.quantity || 1;
      if (quantity >= originalQuantity) {
        // Remove the entire item if dropping all
        const itemIndex = inventoryArray.indexOf(actualItem);
        if (itemIndex !== -1) {
          inventoryArray.splice(itemIndex, 1);
        }
      } else {
        // Reduce the quantity
        actualItem.quantity -= quantity;
      }
      
      // Create a DropItemSprite for the item
      const itemDrop = await DropItemSprite.fromOpts({
        id: item.itemId,
        amount: quantity,
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
      if (this.charecter.map && !itemDrop.destroyed) {
        const dropId = Date.now() + Math.floor(Math.random() * 10000);
        (itemDrop as any)._netDropId = dropId;
        this.charecter.map.addItemDrop(itemDrop);
        mySocket.sendItemDrop(item.itemId, quantity, this.charecter.pos.x, this.charecter.pos.y - 20, 0, 0, dropId);
        console.log(`Dropped ${quantity} of item ${item.itemId}`);
      }
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

  // Merge stackable items (for non-EQUIP tabs) by summing their quantities.
  mergeStackableItems(items: any[]) {
    const mergedMap = new Map();
    for (const item of items) {
      const qty = item.quantity || 1;
      const key = item.itemId;
      if (this.currentTab === MapleInventoryType.EQUIP) {
        mergedMap.set(Symbol(), item);
      } else {
        if (mergedMap.has(key)) {
          const existing = mergedMap.get(key);
          existing.quantity = (existing.quantity || 1) + qty;
        } else {
          mergedMap.set(key, { ...item, quantity: qty });
        }
      }
    }
    return Array.from(mergedMap.values());
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

    console.log(`Drawing ${items.length} items for tab ${this.currentTab}`);

    if (this.currentTab !== MapleInventoryType.EQUIP) {
      items = this.mergeStackableItems(items);
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
        const slotIndex = row * slotColumns + col;
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
          if (item.node && item.node.iconRaw) {
            try {
              icon = item.node.iconRaw.nGetImage();
            } catch (e) {
              console.warn(`Failed to get iconRaw image for item ${item.itemId}`);
            }
          }
          if (!icon && item.node && item.node.info && item.node.info.iconRaw) {
            try {
              icon = item.node.info.iconRaw.nGetImage();
            } catch (e) {
              console.warn(`Failed to get info.iconRaw image for item ${item.itemId}`);
            }
          }

          if (icon) {
            try {
              canvas.drawImage({
                img: icon,
                dx: slotX + (slotSize - icon.width) / 2,
                dy: slotY + (slotSize - icon.height) / 2,
              });
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
        const slotIndex = row * slotColumns + col;
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
    const labels = ['Equip', 'Use', 'Set-up', 'Etc', 'Cash'];

    // Tabs fit within the inventory width (175px), with small margins
    const tabTotalWidth = 168;
    const tabCount = 5;
    const tabW = Math.floor(tabTotalWidth / tabCount);
    let tabX = this.x + 4;
    const tabY = this.y + 24;
    const tabH = 20;

    for (let i = 0; i < tabTypes.length; i++) {
      const isActive = this.currentTab === tabTypes[i];

      // Draw tab background — active = pink/red, inactive = light grey-blue
      const ctx = canvas.context;
      ctx.save();

      // Draw rounded tab shape
      const r = 3; // corner radius
      ctx.beginPath();
      ctx.moveTo(tabX + r, tabY);
      ctx.lineTo(tabX + tabW - r, tabY);
      ctx.arcTo(tabX + tabW, tabY, tabX + tabW, tabY + r, r);
      ctx.lineTo(tabX + tabW, tabY + tabH);
      ctx.lineTo(tabX, tabY + tabH);
      ctx.lineTo(tabX, tabY + r);
      ctx.arcTo(tabX, tabY, tabX + r, tabY, r);
      ctx.closePath();

      if (isActive) {
        ctx.fillStyle = '#dd4466';
        ctx.fill();
        // Lighter top highlight
        ctx.save();
        ctx.clip();
        ctx.fillStyle = '#ee6688';
        ctx.fillRect(tabX, tabY, tabW, 2);
        ctx.restore();
      } else {
        ctx.fillStyle = '#b8c4d8';
        ctx.fill();
      }

      // Thin border
      ctx.strokeStyle = '#8899bb';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();

      // Draw label — try WZ image first, fall back to text
      let labelImg: HTMLImageElement | null = null;
      try {
        if (tabNode) {
          const stateNode = isActive ? tabNode.enabled : tabNode.disabled;
          labelImg = stateNode.nGet(`${i}`).nGetImage();
        }
      } catch (e) { /* fallback */ }

      if (labelImg && labelImg.width > 0) {
        const labelX = tabX + Math.floor((tabW - labelImg.width) / 2);
        const labelY = tabY + Math.floor((tabH - (labelImg.height || 11)) / 2);
        canvas.drawImage({ img: labelImg, dx: labelX, dy: labelY });
      } else {
        canvas.drawText({
          text: labels[i],
          x: tabX + tabW / 2,
          y: tabY + 4,
          color: isActive ? '#ffffff' : '#444466',
          align: 'center',
          fontSize: 11,
          fontWeight: isActive ? 'bold' : '',
        });
      }

      tabX += tabW;
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

    // Thumb (static position for now — no scroll functionality yet)
    if (thumb) {
      const trackY = sbTopY + arrowH;
      canvas.drawImage({ img: thumb, dx: sbX, dy: trackY });
    }
  }

  handleTabClick(mouseX: number, mouseY: number) {
    // Tab click regions — 5 tabs across the top
    // Tabs are at y=28 to y=45, with varying widths
    const tabY = this.y + 28;
    const tabH = 16;

    if (mouseY < tabY || mouseY > tabY + tabH) return false;

    const tabs = [
      MapleInventoryType.EQUIP,
      MapleInventoryType.USE,
      MapleInventoryType.SETUP,
      MapleInventoryType.ETC,
      MapleInventoryType.CASH
    ];

    // Each tab is ~30px wide, starting at x=7
    const tabStartX = this.x + 7;
    const tabWidth = 30;

    for (let i = 0; i < tabs.length; i++) {
      const tabX = tabStartX + i * tabWidth;
      if (mouseX >= tabX && mouseX < tabX + tabWidth) {
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
    
    if (this.currentTab !== MapleInventoryType.EQUIP) {
      items = this.mergeStackableItems(items);
    }
    
    for (let row = 0; row < slotRows; row++) {
      for (let col = 0; col < slotColumns; col++) {
        const slotIndex = row * slotColumns + col;
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
    ClickManager.isDraggingItem = true;
    this.isDragging = true;
    this.draggingItem = item;
    this.draggingSlotIndex = slotIndex;
    const startX = this.GameCanvas.mouseX;
    const startY = this.GameCanvas.mouseY;
    this.dragStartX = startX;
    this.dragStartY = startY;

    // Get item icon for canvas rendering
    let iconImg: HTMLImageElement | null = null;
    try {
      if (item.node?.iconRaw) {
        iconImg = item.node.iconRaw.nGetImage();
        this.draggingIcon = iconImg;
      }
    } catch (e) {
      this.draggingIcon = null;
    }

    // Also register with global DragManager for hotkey bar drops
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

      // Only consider it a drag-drop if mouse moved at least 10px from start
      const dragDist = Math.sqrt((mouseX - startX) ** 2 + (mouseY - startY) ** 2);
      if (dragDist < 10) {
        this.draggingItem = null;
        this.draggingIcon = null;
        this.draggingSlotIndex = -1;
        return;
      }

      // If DragManager is active, let it handle the drop (e.g., onto hotkey bar)
      // Don't show the item drop dialog in that case
      if (DragManager.isDragging) {
        this.draggingItem = null;
        this.draggingIcon = null;
        this.draggingSlotIndex = -1;
        return;
      }

      // Check if mouse is outside inventory window (in canvas coords)
      let invW = 172, invH = 290;
      try {
        const rect = this.getRect({} as CameraInterface);
        invW = rect.width;
        invH = rect.height;
      } catch (e) {}

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
    canvas.drawText({
      text: mesosWithCommas,
      x: this.x + 96,
      y: this.y + 270,
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
  
  // Equip an item from the Equip tab (double-click)
  async equipItem(item: any, slotIndex: number) {
    if (!item || !this.charecter) return;

    const itemId = item.itemId;
    const slot = getEquipSlotForItem(itemId);
    if (slot < 0) {
      console.warn(`[Inventory] Cannot determine equip slot for item ${itemId}`);
      return;
    }

    // If slot is already occupied, unequip current item first (swap)
    const currentItemId = this.charecter.equippedItemIds[slot];
    if (currentItemId) {
      this.charecter.detachEquip(slot);
      try {
        const oldItem = await Item.fromOpts({ itemId: currentItemId, quantity: 1 });
        this.charecter.inventory.equip.push(oldItem);
      } catch (e) {
        console.error('[Inventory] Failed to create unequipped item:', e);
      }
    }

    // Remove from inventory
    const equipArr = this.charecter.inventory.equip;
    const idx = equipArr.indexOf(item);
    if (idx !== -1) {
      equipArr.splice(idx, 1);
    }

    // Equip on character (loads visuals + tracks ID + loads icon)
    await this.charecter.attachEquip(slot, itemId);
    console.log(`[Inventory] Equipped item ${itemId} in slot ${slot}`);
  }

  // Consume a use-tab item (double-click)
  consumeItem(item: any, slotIndex: number) {
    if (!item || !this.charecter) return;

    // Only potions/food are consumable (2000000-2049999)
    // Scrolls, arrows, throwing stars, cards, etc. are NOT consumable via double-click
    const id = item.itemId;
    if (id < 2000000 || id >= 2050000) return;

    // Access spec via WZ node — try both property access and nGet
    const spec = item.node?.spec || item.node?.nGet?.('spec');
    if (!spec || (!spec.nChildren && !spec.hp && !spec.mp)) {
      console.log(`[Inventory] Item #${item.itemId} has no spec — cannot consume`);
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
      hpRecover += Math.floor(this.charecter.maxHp * hpPercent / 100);
    }
    if (mpPercent > 0) {
      mpRecover += Math.floor(this.charecter.maxMp * mpPercent / 100);
    }

    // Apply recovery (clamped to max)
    if (hpRecover > 0) {
      this.charecter.hp = Math.min(this.charecter.hp + hpRecover, this.charecter.maxHp);
    }
    if (mpRecover > 0) {
      this.charecter.mp = Math.min(this.charecter.mp + mpRecover, this.charecter.maxMp);
    }

    console.log(`[Inventory] Consumed item #${item.itemId}: +${hpRecover} HP, +${mpRecover} MP`);

    // Play consumption sound
    if (this.consumeSound) {
      PLAY_AUDIO(this.consumeSound, 0.5, true);
    }

    // Remove one from inventory
    const inventoryArray = this.charecter.inventory.use || [];
    const actualItem = inventoryArray.find((i: any) => i && i.itemId === item.itemId);
    if (actualItem) {
      if ((actualItem.quantity || 1) <= 1) {
        const idx = inventoryArray.indexOf(actualItem);
        if (idx !== -1) inventoryArray.splice(idx, 1);
      } else {
        actualItem.quantity--;
      }
    }
  }

  // Drop items — single items drop immediately, stackable items show quantity dialog
  showItemDropDialog(item: any, slotIndex: number) {
    // Block dropping quest items
    const questManager = this.charecter?.questManager;
    if (questManager) {
      for (const [, active] of questManager.activeQuests) {
        const reqs = QuestData.requirements.get(active.questId);
        if (reqs?.complete?.items?.some((i: any) => i.id === item.itemId)) {
          console.log(`[Quest] Cannot drop quest item #${item.itemId}`);
          return;
        }
        if (reqs?.start?.items?.some((i: any) => i.id === item.itemId)) {
          console.log(`[Quest] Cannot drop quest item #${item.itemId}`);
          return;
        }
      }
    }

    const maxQuantity = item.quantity || 1;

    if (maxQuantity <= 1) {
      // Single item — drop immediately, no dialog
      this.dropItem(item, 1, slotIndex);
      return;
    }

    // Stackable item — show quantity dialog
    if (!this.mesoDropDialog || !this.mesoDropDialog.isHidden) return;
    this.mesoDropDialog.show(maxQuantity, (quantity: number) => {
      this.dropItem(item, quantity, slotIndex);
    }, 'item', item.name || '');
  }

  drawTooltip(canvas: GameCanvas) {
    if (!this.hoveredItem || !this.itemNamesReady) return;

    const item = this.hoveredItem;
    const itemId = item.itemId;
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

    // Draw dark blue/purple background (matching original MapleStory tooltip)
    canvas.drawRect({
      x: tx,
      y: ty,
      width: tooltipWidth,
      height: tooltipHeight,
      color: '#1a1230',
      alpha: 0.92,
      stroke: '#6666AA',
      strokeWidth: 1,
    });

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
      // Icon background
      canvas.drawRect({
        x: tx + padding,
        y: bodyY,
        width: iconSize,
        height: iconSize,
        color: '#14102a',
        alpha: 0.6,
      });
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
    if (this.mesoDropDialog) {
      this.mesoDropDialog.update(msPerTick);
      this.mesoDropDialog.draw(canvas, camera, lag, msPerTick, tdelta);
    }
  }
}

export default InventoryMenuSprite;
