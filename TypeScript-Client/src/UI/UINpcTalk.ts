import WZManager from '../wz-utils/WZManager';
import WZNode from '../wz-utils/WZNode';
import GameCanvas from '../GameCanvas';
import {CameraInterface} from '../Camera';
import {MapleStanceButton} from './MapleStanceButton';
import ClickManager from './ClickManager';
import NpcTalkType from '../Constants/NpcTalkType';
import {Position} from '../Effects/DamageIndicator';
import MapleButton from './MapleButton';

/**
 * @todo truncate long name, showing ellipsis
 * @todo block clicking on other UIs in click manager
 * @todo prevent character from moving while the dialog is open
 * @todo draggable, refactor as a generic draggable
 * @todo keyboard esc to close
 * @todo typing effect for text
 * @todo handling of 4 type of talk
 * @todo connect with socket server for interaction
 */
export default class UINpcTalk {
  opts: any;
  x: number = 0;
  y: number = 0;
  z: number = 0;
  originalX: number = 0;
  originalY: number = 0;
  width: number = 0;
  height: number = 0;
  isHidden: boolean;
  type: NpcTalkType;

  name: string;
  text: string = '';
  top: WZNode | null;
  fill: WZNode | null;
  fillCount: number = 6;
  bottom: WZNode | null;
  nameTag: WZNode | null;
  speaker: WZNode | undefined;
  buttons: MapleButton[];

  utilDlgExNode: any = null;

  static async fromOpts(opts: any) {
    const object = new UINpcTalk(opts);
    await object.load();
    return object;
  }

  constructor(opts: any) {
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.z = opts.z || 0;
    this.isHidden = opts.isHidden || true;
    this.name = opts.name || '';
    this.text = opts.text || '';
    this.opts = opts;
    this.type = NpcTalkType.YesNo;
    this.top = null;
    this.fill = null;
    this.bottom = null;
    this.nameTag = null;
    this.speaker = null;
    this.buttons = [];
  }

  async load() {
    const opts = this.opts;
    this.x = opts.x;
    this.y = opts.y;
    this.z = opts.z;
    this.originalX = opts.x;
    this.originalY = opts.y;

    this.utilDlgExNode = await WZManager.get('UI.wz/UIWindow.img/UtilDlgEx');
    this.top = this.utilDlgExNode.t;
    this.fill = this.utilDlgExNode.c;
    this.bottom = this.utilDlgExNode.s;
    this.nameTag = this.utilDlgExNode.bar;
    this.width = this.top?.nGetImage().width;
    this.height = this.top?.nGetImage().height + this.fillCount * this.fill?.nGetImage().height + this.bottom?.nGetImage().height;

    this.loadButtons();
    ClickManager.addDragableMenu(this);
  }

  loadButtons() {
    this.buttons.forEach((button) => {
      ClickManager.removeButton(button);
    });
    this.buttons = [];
    const closeButton = new MapleStanceButton(null, {
      x: this.x + 9,
      y: this.y + this.top?.nGetImage().height + this.fillCount * this.fill?.nGetImage().height + 33,
      img: this.utilDlgExNode.BtClose.nChildren,
      isRelativeToCamera: true,
      isPartOfUI: true,
      onClick: () => {
        this.setIsHidden(true);
      },
    });
    this.buttons.push(closeButton);
    this.buttons.forEach((button) => {
      ClickManager.addButton(button);
    });
  }

  draw(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    const leftPadding = 20;
    if (!this.isHidden) {
      canvas.drawImage({
        img: this.top?.nGetImage(),
        dx: this.x,
        dy: this.y,
      });
      for (let i = 0; i < this.fillCount; i++) {
        canvas.drawImage({
          img: this.fill?.nGetImage(),
          dx: this.x,
          dy: this.y + this.top?.nGetImage().height + i * this.fill?.nGetImage().height,
        });
      }
      canvas.drawImage({
        img: this.bottom?.nGetImage(),
        dx: this.x,
        dy: this.y + this.top?.nGetImage().height + this.fillCount * this.fill?.nGetImage().height,
      });

      canvas.drawImage({
        img: this.speaker?.stand?.[0].nGetImage(),
        dx: this.x + leftPadding + Math.floor(this.nameTag?.nGetImage().width / 2) - Math.floor(this.speaker?.stand?.[0].nGetImage().width / 2),
        dy: this.y + this.top?.nGetImage().height,
      });
      const midHeight = Math.floor((this.top?.nGetImage().height + this.fillCount * this.fill?.nGetImage().height) / 2);
      const finalHeight = (this.speaker?.stand?.[0].nGetImage().height > midHeight ? this.speaker?.stand?.[0].nGetImage().height : midHeight);
      canvas.drawImage({
        img: this.nameTag?.nGetImage(),
        dx: this.x + leftPadding,
        dy: this.y + this.top?.nGetImage().height + finalHeight,
      });

      canvas.drawText({
        text: this.text,
        color: "#000000",
        x: this.x + 166,
        y: this.y + 48,
      });

      const nameOpts = {
        text: this.name,
        color: "#FFFFFF",
      };
      canvas.drawText({
        text: this.name,
        color: "#FFFFFF",
        x: this.x + leftPadding + Math.floor(this.nameTag?.nGetImage().width / 2),//canvas.measureText(nameOpts).width,
        y: this.y + this.top?.nGetImage().height + 5 + finalHeight,
        align: 'center'
      });

      this.buttons.forEach((obj) => {
        obj.draw(canvas, camera, lag, msPerTick, tdelta);
      });
    }
  }

  moveTo(position: Position) {
    this.x = position.x;
    this.y = position.y;
    this.buttons.forEach((button) => {
      button.x += -this.originalX + position.x;
      button.y += -this.originalY + position.y;
    });

    this.originalX = position.x;
    this.originalY = position.y;
  }

  getRect(camera: CameraInterface) {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
  }

  setIsHidden(isHidden: boolean) {
    this.isHidden = isHidden;
    this.buttons.forEach((button) => {
      button.isHidden = isHidden;
    });
  }

  async changeText(npcId: number, type: NpcTalkType, speaker: string, text: string) {
    this.fillCount = 6;
    this.name = speaker;
    this.text = text;
    let strId = `${npcId}`.padStart(7, "0");
    this.speaker = await WZManager.get(`Npc.wz/${strId}.img`);
    while (this.speaker?.stand?.[0].nGetImage().height + this.nameTag?.nGetImage().height + 5 > this.fillCount * this.fill?.nGetImage().height) {
      this.fillCount++;
    }

    this.height = this.top?.nGetImage().height + this.fillCount * this.fill?.nGetImage().height + this.bottom?.nGetImage().height;

    this.loadButtons();
  }
}
