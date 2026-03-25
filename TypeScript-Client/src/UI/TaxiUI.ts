import WZManager from "../wz-utils/WZManager";
import GameCanvas from "../GameCanvas";
import MapStateInstance from "../MapState";
import { CameraInterface } from "../Camera";
import ClickManager from "./ClickManager";
import { MapleStanceButton } from "./MapleStanceButton";
import MapleButton from "./MapleButton";

export interface TaxiDestination {
  mapId: number;
  name: string;
  cost: number;
}

// TaxiUI using UtilDlgEx WZ dialog frame (same as NPC dialog)
const TaxiUI: any = {
  isVisible: false,
  destinations: [] as TaxiDestination[],
  hoverIndex: -1,
  npcId: 1022000,
  npcName: 'Regular Cab',
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  loaded: false,
  prevClicked: false,
  // WZ assets
  utilDlgExNode: null as any,
  topImg: null as any,
  fillImg: null as any,
  bottomImg: null as any,
  nameTagImg: null as any,
  speakerImg: null as any,
  dot0Img: null as any,
  dot1Img: null as any,
  lineImg: null as any,
  closeButton: null as MapleButton | null,
  fillCount: 6,

  show(canvas: GameCanvas, destinations: TaxiDestination[], npcId?: number, npcName?: string) {
    if (this.isVisible) return;

    this.isVisible = true;
    this.destinations = Array.isArray(destinations) ? destinations : [];
    this.hoverIndex = -1;
    if (npcId) this.npcId = npcId;
    if (npcName) this.npcName = npcName;

    if (!this.loaded) {
      this.loadAssets();
    } else {
      this.recalcLayout();
    }
  },

  hide() {
    this.isVisible = false;
    this.hoverIndex = -1;
    if (this.closeButton) {
      ClickManager.removeButton(this.closeButton);
      this.closeButton = null;
    }
  },

  async loadAssets() {
    try {
      this.utilDlgExNode = await WZManager.get('UI.wz/UIWindow.img/UtilDlgEx');

      this.topImg = this.utilDlgExNode.t.nGetImage();
      this.fillImg = this.utilDlgExNode.c.nGetImage();
      this.bottomImg = this.utilDlgExNode.s.nGetImage();
      this.nameTagImg = this.utilDlgExNode.bar.nGetImage();

      // Load bullet dots for list items
      if (this.utilDlgExNode.dot0) this.dot0Img = this.utilDlgExNode.dot0.nGetImage();
      if (this.utilDlgExNode.dot1) this.dot1Img = this.utilDlgExNode.dot1.nGetImage();
      if (this.utilDlgExNode.line) this.lineImg = this.utilDlgExNode.line.nGetImage();

      // Load taxi NPC sprite
      const strId = `${this.npcId}`.padStart(7, '0');
      const npcNode: any = await WZManager.get(`Npc.wz/${strId}.img`);
      if (npcNode?.stand?.[0]) {
        this.speakerImg = npcNode.stand[0].nGetImage();
      }

      this.loaded = true;
      this.recalcLayout();
    } catch (e) {
      console.error('Error loading TaxiUI assets:', e);
    }
  },

  recalcLayout() {
    if (!this.topImg || !this.fillImg || !this.bottomImg) return;

    // Calculate fillCount based on content height needed
    const speakerH = this.speakerImg?.height || 80;
    const nameTagH = this.nameTagImg?.height || 19;
    const destLineHeight = 20;
    const headerTextHeight = 20;
    const contentHeight = Math.max(
      speakerH + nameTagH + 10,
      headerTextHeight + this.destinations.length * destLineHeight + 20
    );

    this.fillCount = Math.max(6, Math.ceil(contentHeight / this.fillImg.height));

    this.width = this.topImg.width;
    this.height = this.topImg.height + this.fillCount * this.fillImg.height + this.bottomImg.height;

    // Center on screen (800x600)
    this.x = Math.floor(400 - this.width / 2);
    this.y = Math.floor(300 - this.height / 2);

    // Setup close button
    if (this.closeButton) {
      ClickManager.removeButton(this.closeButton);
    }
    this.closeButton = new MapleStanceButton(null, {
      x: this.x + 9,
      y: this.y + this.topImg.height + this.fillCount * this.fillImg.height + 33,
      img: this.utilDlgExNode.BtClose.nChildren,
      isRelativeToCamera: true,
      isPartOfUI: true,
      onClick: () => {
        this.hide();
      },
    });
    ClickManager.addButton(this.closeButton);
  },

  update(msPerTick: number) {
    if (!this.isVisible || !this.loaded) return;

    const canvas = (window as any).ClickManager?.GameCanvas;
    if (!canvas) return;

    const mouseX = canvas.mouseX;
    const mouseY = canvas.mouseY;

    // Destination list hit area
    const textStartX = this.x + 166;
    const textStartY = this.y + 48;
    const destLineHeight = 20;
    const listWidth = this.width - 166 - 20;

    this.hoverIndex = -1;

    for (let i = 0; i < this.destinations.length; i++) {
      const itemY = textStartY + 20 + i * destLineHeight;
      if (mouseX >= textStartX && mouseX <= textStartX + listWidth &&
          mouseY >= itemY - 6 && mouseY <= itemY + destLineHeight - 6) {
        this.hoverIndex = i;
        break;
      }
    }

    // Handle click on destination
    if (canvas.clicked && !this.prevClicked) {
      if (this.hoverIndex !== -1) {
        this.teleportToDestination(this.hoverIndex);
      }
    }

    this.prevClicked = canvas.clicked;
  },

  teleportToDestination(index: number) {
    if (index < 0 || index >= this.destinations.length) return;

    const dest = this.destinations[index];

    // Check mesos
    const playerMesos = (window as any).MapStateInstance?.PlayerCharacter?.inventory?.mesos || 0;
    if (playerMesos < dest.cost) {
      console.log('Not enough mesos:', playerMesos, '<', dest.cost);
      return;
    }

    // Deduct mesos
    if ((window as any).MapStateInstance?.PlayerCharacter?.inventory) {
      (window as any).MapStateInstance.PlayerCharacter.inventory.mesos -= dest.cost;
    }

    this.hide();
    if (MapStateInstance) {
      MapStateInstance.changeMap(dest.mapId, 'sp');
    }
  },

  render(canvas: GameCanvas, camera: CameraInterface) {
    if (!this.isVisible) return;
    if (!this.loaded || !this.topImg || !this.fillImg || !this.bottomImg) return;

    const leftPadding = 20;

    // Draw top
    canvas.drawImage({
      img: this.topImg,
      dx: this.x,
      dy: this.y,
    });

    // Draw fill (repeated)
    for (let i = 0; i < this.fillCount; i++) {
      canvas.drawImage({
        img: this.fillImg,
        dx: this.x,
        dy: this.y + this.topImg.height + i * this.fillImg.height,
      });
    }

    // Draw bottom
    canvas.drawImage({
      img: this.bottomImg,
      dx: this.x,
      dy: this.y + this.topImg.height + this.fillCount * this.fillImg.height,
    });

    // Draw NPC speaker sprite
    if (this.speakerImg) {
      const speakerX = this.x + leftPadding + Math.floor((this.nameTagImg?.width || 121) / 2) - Math.floor(this.speakerImg.width / 2);
      canvas.drawImage({
        img: this.speakerImg,
        dx: speakerX,
        dy: this.y + this.topImg.height,
      });
    }

    // Draw name tag
    if (this.nameTagImg && this.speakerImg) {
      const midHeight = Math.floor((this.topImg.height + this.fillCount * this.fillImg.height) / 2);
      const finalHeight = this.speakerImg.height > midHeight ? this.speakerImg.height : midHeight;
      canvas.drawImage({
        img: this.nameTagImg,
        dx: this.x + leftPadding,
        dy: this.y + this.topImg.height + finalHeight,
      });

      // Draw NPC name on name tag
      canvas.drawText({
        text: this.npcName,
        color: '#FFFFFF',
        x: this.x + leftPadding + Math.floor(this.nameTagImg.width / 2),
        y: this.y + this.topImg.height + 5 + finalHeight,
        align: 'center',
      });
    }

    // Draw "Choose your destination:" header text
    const textStartX = this.x + 166;
    const textStartY = this.y + 48;

    canvas.drawText({
      text: 'Choose your destination:',
      color: '#000000',
      x: textStartX,
      y: textStartY,
    });

    // Draw destination list
    const destLineHeight = 20;
    for (let i = 0; i < this.destinations.length; i++) {
      const dest = this.destinations[i];
      const itemY = textStartY + 20 + i * destLineHeight;
      const isHovered = i === this.hoverIndex;

      // Draw bullet dot (dot0 = selected/hover, dot1 = normal)
      const dotImg = isHovered ? this.dot0Img : this.dot1Img;
      if (dotImg) {
        canvas.drawImage({
          img: dotImg,
          dx: textStartX - 2,
          dy: itemY - 3,
        });
      }

      // Draw destination text (blue links, red on hover — like original game)
      const destText = `${dest.name} (${dest.cost.toLocaleString()} mesos)`;
      canvas.drawText({
        text: destText,
        color: isHovered ? '#CC0000' : '#0000CC',
        x: textStartX + 10,
        y: itemY,
        fontSize: 12,
      });
    }

    // Draw close button
    if (this.closeButton) {
      this.closeButton.draw(canvas, camera, 0, 0, 0);
    }
  }
};

// Expose TaxiUI to global scope
(window as any).TaxiUI = TaxiUI;

export default TaxiUI;
