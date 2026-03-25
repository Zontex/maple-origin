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
import UIMesoDropDialog from "../UIMesoDropDialog";
import QuestData from "../../Quest/QuestData";
import PLAY_AUDIO from "../../Audio/PlayAudio";

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
        this.charecter.map.addItemDrop(mesosDrop);
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
        this.charecter.map.addItemDrop(itemDrop);
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

    // Define the starting position and layout for item slots.
    const slotStartX = this.x + 14;
    const slotStartY = this.y + 55;
    const slotColumns = 4;
    const slotRows = 6;
    const slotSize = 30;
    const slotPadding = 4;

    for (let row = 0; row < slotRows; row++) {
      for (let col = 0; col < slotColumns; col++) {
        const slotIndex = row * slotColumns + col;
        const slotX = slotStartX + col * (slotSize + slotPadding);
        const slotY = slotStartY + row * (slotSize + slotPadding);

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

          // Draw quantity in the lower-right if greater than 1.
          const quantity = item.quantity || 1;
          if (quantity > 1) {
            // Position at bottom-right corner of the slot
            const textX = slotX + slotSize - 5;
            const textY = slotY + slotSize - 8;
            
            // First draw a dark outline/shadow
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = -1; dy <= 1; dy++) {
                if (dx !== 0 || dy !== 0) { // Skip the center
                  canvas.drawText({
                    text: quantity.toString(),
                    x: textX + dx,
                    y: textY + dy,
                    color: "#000000",
                    align: "right",
                    fontSize: 12
                  });
                }
              }
            }
            
            // Then draw the white text on top
            canvas.drawText({
              text: quantity.toString(),
              x: textX,
              y: textY,
              color: "#FFFFFF",
              align: "right",
              fontSize: 12
            });
          }
        }
      }
    }

    // Draw the tabs over the items.
    this.drawTabs(canvas);
  }

  drawTabs(canvas: GameCanvas) {
    const tabStartX = this.x + 3;
    const tabStartY = this.y + 25;
    const tabWidth = 29;
    const tabHeight = 18;
    const tabSpacing = 1;

    const tabs = [
      { type: MapleInventoryType.EQUIP, label: "Equip" },
      { type: MapleInventoryType.USE, label: "Use" },
      { type: MapleInventoryType.SETUP, label: "Setup" },
      { type: MapleInventoryType.ETC, label: "Etc" },
      { type: MapleInventoryType.CASH, label: "Cash" }
    ];

    tabs.forEach((tab, index) => {
      const tabX = tabStartX + index * (tabWidth + tabSpacing);
      const isActive = this.currentTab === tab.type;

      if (this.inventoryNode && this.inventoryNode.Tab) {
        try {
          const tabImg = isActive
            ? this.inventoryNode.Tab.tabSelected.nGetImage()
            : this.inventoryNode.Tab.tabNormal.nGetImage();
          canvas.drawImage({
            img: tabImg,
            dx: tabX,
            dy: tabStartY,
          });
        } catch (e) {
          canvas.drawRect({
            x: tabX,
            y: tabStartY,
            width: tabWidth,
            height: tabHeight,
            color: isActive ? "#5566AA" : "#333333",
            alpha: isActive ? 0.9 : 0.6,
          });
        }
      } else {
        canvas.drawRect({
          x: tabX,
          y: tabStartY,
          width: tabWidth,
          height: tabHeight,
          color: isActive ? "#5566AA" : "#333333",
          alpha: isActive ? 0.9 : 0.6,
        });
      }

      canvas.drawText({
        text: tab.label,
        x: tabX + tabWidth / 2,
        y: tabStartY + tabHeight / 2 - 5,
        color: "#FFFFFF",
        align: "center",
        fontSize: 10,
      });
    });
  }

  handleTabClick(mouseX: number, mouseY: number) {
    const tabStartX = this.x + 3;
    const tabStartY = this.y + 25;
    const tabWidth = 29;
    const tabHeight = 18;
    const tabSpacing = 1;

    const tabs = [
      MapleInventoryType.EQUIP,
      MapleInventoryType.USE,
      MapleInventoryType.SETUP,
      MapleInventoryType.ETC,
      MapleInventoryType.CASH
    ];

    for (let i = 0; i < tabs.length; i++) {
      const tabX = tabStartX + i * (tabWidth + tabSpacing);
      if (
        mouseX >= tabX &&
        mouseX < tabX + tabWidth &&
        mouseY >= tabStartY &&
        mouseY < tabStartY + tabHeight
      ) {
        this.currentTab = tabs[i];
        console.log(`Switched to tab: ${this.currentTab}`);
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
    const slotStartX = this.x + 14;
    const slotStartY = this.y + 55;
    const slotColumns = 4;
    const slotRows = 6;
    const slotSize = 30;
    const slotPadding = 4;
    
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
        const slotX = slotStartX + col * (slotSize + slotPadding);
        const slotY = slotStartY + row * (slotSize + slotPadding);
        
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

            // Double-click detection — consume item
            if (slotIndex === this.lastClickSlot && now - this.lastClickTime < 400) {
              this.lastClickSlot = -1;
              this.lastClickTime = 0;
              if (this.currentTab === MapleInventoryType.USE) {
                this.consumeItem(item, slotIndex);
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
    try {
      if (item.node?.iconRaw) {
        this.draggingIcon = item.node.iconRaw.nGetImage();
      }
    } catch (e) {
      this.draggingIcon = null;
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
        // Was just a click, not a drag — do nothing (double-click handled separately)
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
  
  // Consume a use-tab item (double-click)
  consumeItem(item: any, slotIndex: number) {
    if (!item || !this.charecter) return;

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
    this.drawBackground(canvas);
    this.drawItems(canvas);
    this.drawText(canvas);
    this.buttons.forEach((obj) => {
      obj.draw(canvas, camera, lag, msPerTick, tdelta);
    });

    // Draw dragged item icon at cursor
    this.drawDragIcon(canvas);

    // Draw meso drop dialog on top
    if (this.mesoDropDialog) {
      this.mesoDropDialog.update(msPerTick);
      this.mesoDropDialog.draw(canvas, camera, lag, msPerTick, tdelta);
    }
  }
}

export default InventoryMenuSprite;
