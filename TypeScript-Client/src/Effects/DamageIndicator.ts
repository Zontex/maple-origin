import WZManager from "../wz-utils/WZManager";
import WZFiles from "../Constants/enums/WZFiles";
import GameCanvas from "../GameCanvas";
import { CameraInterface } from "../Camera";

const DamageIndicatorTimeTillFade = 1500;
const DamageIndicatorDistanceToMove = 50;

export interface Position {
  x: number;
  y: number;
}

export enum DamageIndicatorType {
  PlayerHitMob = "PlayerHitMob",
  PlayerCritialHitMob = "PlayerCritialHitMob",
  MobHitPlayer = "MobHitPlayer",
  // HP/MP gained — chairs, and anything else that heals. Blue digits, the
  // set v83 ships alongside the red/critical/violet damage numbers.
  Recovery = "Recovery",
}

export class DamageIndicator {
  static _warnedBadNumber = false;
  noRed0Node = null;
  noRed1Node = null;
  noCri0Node = null;
  noCri1Node = null;
  noVioletNode = null;
  noViolet1Node = null;
  damageIndicatorsToDraw: any[] = [];
  DamageIndicatorTypeToImages: any = {};

  constructor() {}

  async initialize() {
    const basicEffectWzNode: any = await WZManager.get(
      `${WZFiles.Effect}/BasicEff.img`
    );

    this.DamageIndicatorTypeToImages = {
      [DamageIndicatorType.PlayerHitMob]: {
        firstNumberNode: basicEffectWzNode.NoRed1,
        otherNumberNode: basicEffectWzNode.NoRed0,
      },
      [DamageIndicatorType.PlayerCritialHitMob]: {
        firstNumberNode: basicEffectWzNode.NoCri1,
        otherNumberNode: basicEffectWzNode.NoCri0,
      },
      [DamageIndicatorType.MobHitPlayer]: {
        firstNumberNode: basicEffectWzNode.NoViolet1,
        otherNumberNode: basicEffectWzNode.NoViolet0,
      },
      [DamageIndicatorType.Recovery]: {
        firstNumberNode: basicEffectWzNode.NoBlue1,
        otherNumberNode: basicEffectWzNode.NoBlue0,
      },
    };
  }

  drawDamage = (
    canvas: GameCanvas,
    position: Position,
    firstNumberNode: any,
    otherNumberNode: any,
    damageNumber = 6000,
    alpha: number = 1
  ) => {
    // The digit sprites only exist for 0-9: a NaN/float/negative here (a bad
    // damage roll upstream) used to throw inside the render loop every frame,
    // which aborted the rest of the frame and left the last good frame smeared
    // across the screen. Sanitise, warn once, and draw a miss instead.
    if (!Number.isFinite(damageNumber) || damageNumber !== Math.floor(damageNumber)) {
      if (!DamageIndicator._warnedBadNumber) {
        DamageIndicator._warnedBadNumber = true;
        console.warn(`[DamageIndicator] non-integer damage ${damageNumber}`, new Error().stack);
      }
      damageNumber = Number.isFinite(damageNumber) ? Math.floor(damageNumber) : 0;
    }
    if (damageNumber <= 0) {
      let image = otherNumberNode["Miss"].nGetImage();
      canvas.drawImage({
        img: image,
        dx: position.x,
        dy: position.y,
        alpha,
      });
    } else {
      [...`${damageNumber}`].reduce((x, digit, index) => {
        if (!otherNumberNode[digit] || (index === 0 && !firstNumberNode[digit])) return x;
        let image = otherNumberNode[digit].nGetImage();
        let y = position.y;
        if (index % 2 === 1) {
          y += 4;
        }

        if (index === 0) {
          image = firstNumberNode[digit].nGetImage();
          y -= 4;
        }

        canvas.drawImage({
          img: image,
          dx: x,
          dy: y,
          alpha,
        });
        x += image.width - 5;
        return x;
      }, position.x);
    }
  };

  drawPlayerHitDamage(
    canvas: GameCanvas,
    position: Position,
    damageNumber = 6000
  ) {
    this.drawDamage(
      canvas,
      position,
      this.noRed1Node,
      this.noRed0Node,
      damageNumber
    );
  }

  drawPlayerHitCriticalDamage(
    canvas: GameCanvas,
    position: Position,
    damageNumber = 6000
  ) {
    this.drawDamage(
      canvas,
      position,
      this.noCri1Node,
      this.noCri0Node,
      damageNumber
    );
  }

  drawAllDamageIndicators = (
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) => {
    const currentTime = Date.now();

    const damageIndicatorIndexesToRemove: number[] = [];

    this.damageIndicatorsToDraw.forEach(
      ({ type, position, damageNumber, timeAdded }, index) => {
        const elapsedTime = currentTime - timeAdded;
        if (elapsedTime <= DamageIndicatorTimeTillFade) {
          const imageSet = this.DamageIndicatorTypeToImages[type];
          if (!imageSet) {
            damageIndicatorIndexesToRemove.push(index);
            return;
          }
          const { firstNumberNode, otherNumberNode } = imageSet;
          const alpha = 1 - elapsedTime / DamageIndicatorTimeTillFade; // Calculate alpha based on time

          const totalDistanceToMove = 50;
          const movementSpeed =
            totalDistanceToMove / DamageIndicatorTimeTillFade;
          const offsetY = movementSpeed * elapsedTime;

          this.drawDamage(
            canvas,
            {
              x: Math.floor(position.x - camera.x),
              y: Math.floor(position.y - camera.y - offsetY), // Apply the offset
            },
            firstNumberNode,
            otherNumberNode,
            damageNumber,
            alpha // Pass the calculated alpha value
          );
        } else {
          damageIndicatorIndexesToRemove.push(index);
        }
      }
    );

    damageIndicatorIndexesToRemove.forEach((index) => {
      this.damageIndicatorsToDraw.splice(index, 1);
    });
  };

  addDamageIndicator(
    type: DamageIndicatorType,
    position: Position,
    damageNumber = 6000
  ) {
    this.damageIndicatorsToDraw.push({
      type,
      position,
      damageNumber,
      timeAdded: Date.now(),
    });
  }
}

export default DamageIndicator;
