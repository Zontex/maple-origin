import { CameraInterface } from "./Camera";
import GameCanvas from "./GameCanvas";
import config from "./Config";
import WZManager from "./wz-utils/WZManager";

class Tile {
  wzNode: any;
  img: any;
  originX: number = 0;
  originY: number = 0;
  x: number = 0;
  y: number = 0;
  z: number = 0;
  layer: number = 0;

  static async fromWzNode(wzNode: any) {
    const tile = new Tile(wzNode);
    await tile.load();
    return tile;
  }
  constructor(wzNode: any) {
    this.wzNode = wzNode;
  }
  async load() {
    const wzNode = this.wzNode;
    const type = wzNode.nParent.nParent.info.tS.nValue;
    const u = wzNode.u.nValue;
    const no = wzNode.no.nValue;
    const tileFile: any = await WZManager.get(`Map.wz/Tile/${type}.img`);
    const spriteNode = tileFile[u][no];

    void spriteNode.nPreloadImage?.();
    this.img = spriteNode.nGetImage();

    this.originX = spriteNode.origin.nX;
    this.originY = spriteNode.origin.nY;

    this.x = wzNode.x.nValue;
    this.y = wzNode.y.nValue;
    this.z = spriteNode.nGet("z").nGet("nValue", 0) || wzNode.zM.nValue;
  }
  draw(canvas: GameCanvas, camera: CameraInterface) {
    const dx = this.x - camera.x - this.originX;
    const dy = this.y - camera.y - this.originY;
    // Skip tiles fully outside the viewport
    if (
      dx > config.width || dy > config.height ||
      dx + this.img.width < 0 || dy + this.img.height < 0
    ) {
      return;
    }
    canvas.drawImage({ img: this.img, dx, dy });
  }
}

export default Tile;
