// Renders a map's `shipObj` node — the vessel that sits at the dock, slides
// away at takeoff and glides back in before arrival (shipKind=0 on station
// maps), or the enemy Balrog ship that appears alongside the Orbis boat
// during an invasion (shipKind=1 on the two deck maps). The original client
// drives this from CONTI_STATE/CONTI_MOVE packets; we derive it from the
// wall-clock schedule so it needs no state.

import { CameraInterface } from '../Camera';
import GameCanvas from '../GameCanvas';
import WZManager from '../wz-utils/WZManager';
import TransportationManager from './TransportationManager';

class ShipObject {
  mapId: number;
  x = 0;
  x0 = 0;
  y = 0;
  flipped = false;
  tMoveMs = 15000;
  shipKind = 0;
  frames: any[] = [];
  frame = 0;
  delay = 0;
  nextDelay = 100;

  private constructor(mapId: number) {
    this.mapId = mapId;
  }

  // Returns null when the map has no (usable) shipObj node
  static async fromMapNode(mapWzNode: any, mapId: number): Promise<ShipObject | null> {
    try {
      const node = mapWzNode?.nGet?.('shipObj');
      const path: string | null = node?.nGet?.('shipObj')?.nGet?.('nValue', null);
      if (!path) return null;

      // Paths come in two flavors: "Map/Obj/vehicle.img/ship/ossyria/99" on
      // station maps and extension-less "Map/Obj/vehicle/ship/ossyria/97" on
      // the boat decks — normalize both
      const parts = path.replace(/^Map\/Obj\//, '').split('/');
      const imgFile = parts[0].replace(/\.img$/, '');
      let spriteNode: any = await WZManager.get(`Map.wz/Obj/${imgFile}.img`);
      for (const seg of parts.slice(1)) {
        spriteNode = spriteNode?.[seg];
        if (!spriteNode) return null;
      }

      const ship = new ShipObject(mapId);
      if (spriteNode.nTagName === 'canvas') {
        ship.frames = [spriteNode];
      } else {
        for (const child of spriteNode.nChildren || []) {
          if (child.nTagName === 'canvas') ship.frames.push(child);
          else if (child.nTagName === 'uol') ship.frames.push(child.nResolveUOL());
        }
      }
      if (ship.frames.length === 0) return null;

      ship.x = node.nGet('x').nGet('nValue', 0);
      ship.x0 = node.nGet('x0').nGet('nValue', ship.x);
      ship.y = node.nGet('y').nGet('nValue', 0);
      ship.flipped = !!node.nGet('f').nGet('nValue', 0);
      ship.tMoveMs = node.nGet('tMove').nGet('nValue', 15) * 1000;
      ship.shipKind = node.nGet('shipKind').nGet('nValue', 0);
      ship.nextDelay = ship.frames[0].nGet('delay').nGet('nValue', 100);
      return ship;
    } catch (e) {
      console.error(`[ShipObject] Failed to load shipObj for map ${mapId}:`, e);
      return null;
    }
  }

  update(msPerTick: number) {
    if (this.frames.length < 2) return;
    this.delay += msPerTick;
    if (this.delay > this.nextDelay) {
      this.delay = 0;
      this.frame = (this.frame + 1) % this.frames.length;
      this.nextDelay = this.frames[this.frame].nGet('delay').nGet('nValue', 100);
    }
  }

  // Current x and visibility from the owning route's schedule
  private getVisualState(): { visible: boolean; x: number } {
    if (this.shipKind === 1) {
      return { visible: TransportationManager.isEnemyShipVisible(this.mapId), x: this.x };
    }
    const ph = TransportationManager.getDockShipPhase(this.mapId);
    if (!ph) return { visible: true, x: this.x }; // unknown schedule — stay docked

    // Clamp the slide so it fits even at high dev travel rates
    const slideMs = Math.min(this.tMoveMs, (ph.cycleLenMs - ph.departPos) / 2);
    const pos = ph.cyclePos;
    if (pos < ph.departPos) return { visible: true, x: this.x };
    if (pos < ph.departPos + slideMs) {
      const p = (pos - ph.departPos) / slideMs;
      return { visible: true, x: this.x + (this.x0 - this.x) * p };
    }
    if (pos >= ph.cycleLenMs - slideMs) {
      const p = (pos - (ph.cycleLenMs - slideMs)) / slideMs;
      return { visible: true, x: this.x0 + (this.x - this.x0) * p };
    }
    return { visible: false, x: this.x0 };
  }

  draw(canvas: GameCanvas, camera: CameraInterface) {
    const state = this.getVisualState();
    if (!state.visible) return;
    const frameNode = this.frames[this.frame];
    const img = frameNode.nGetImage();
    if (!img) return;
    const width = frameNode.nWidth;
    const originX = frameNode.nGet('origin').nGet('nX', 0);
    const originY = frameNode.nGet('origin').nGet('nY', 0);
    const dx = state.x - (!this.flipped ? originX : width - originX);
    const dy = this.y - originY;
    canvas.drawImage({
      img,
      dx: Math.round(dx - camera.x),
      dy: Math.round(dy - camera.y),
      flipped: this.flipped,
    });
  }
}

export default ShipObject;
