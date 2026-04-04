import MyCharacter from "../MyCharacter";
import WZManager from "../wz-utils/WZManager";
import UICommon from "./UICommon";
import MapleInput from "./MapleInput";
import MapleMap from "../MapleMap";
import config from "../Config";
import { MapleStanceButton } from "./MapleStanceButton";
import ClickManager from "./ClickManager";
import MapState from "../MapState";
import GameCanvas from "../GameCanvas";

export interface UIMapInterface {
  statusBarLevelDigits: any[];
  firstUpdate: boolean;
  chat: MapleInput | null;
  statusBg: any;
  statusBg2: any;
  bars: any;
  graduation: any;
  barGray: any;
  statusBarNode: any;
  buttons: Set<any>;
  numbers: any;
  initialize: () => Promise<void>;
  addButtons: (canvas: GameCanvas) => void;
  doUpdate: (msPerTick: number, camera: any, canvas: GameCanvas) => void;
  drawLevel: (canvas: GameCanvas, level: number) => void;
  drawNumbers: (
    canvas: any,
    hp: number,
    maxHp: number,
    mp: number,
    maxMp: number,
    exp: number,
    maxExp: number
  ) => void;
  doRender: (
    canvas: any,
    camera: any,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) => void;
}

const UIMap = {} as UIMapInterface;

UIMap.initialize = async function () {
  console.log("UIMap.initialize");
  await UICommon.initialize();

  const basic: any = await WZManager.get("UI.wz/Basic.img");
  this.statusBarLevelDigits = basic.LevelNo.nChildren.map((d: any) =>
    d.nGetImage()
  );

  this.firstUpdate = true;
  this.chat = null;

  const statusBar: any = await WZManager.get("UI.wz/StatusBar.img");
  this.statusBg = statusBar.base.backgrnd.nGetImage();
  this.statusBg2 = statusBar.base.backgrnd2.nGetImage();
  this.bars = statusBar.gauge.bar.nGetImage();
  this.graduation = statusBar.gauge.graduation.nGetImage();
  this.barGray = statusBar.gauge.gray.nGetImage();

  this.statusBarNode = statusBar;

  this.buttons = new Set<any>();

  this.numbers = statusBar.number.nChildren.reduce(
    (numbers: any, node: any) => {
      numbers[node.nName] = node.nGetImage();
      return numbers;
    },
    {}
  );
};

const startUIPosition = {
  x: config.width - 800,   // Offset for wider-than-800 resolutions
  y: config.height - 600,  // Offset for taller-than-600 resolutions
};

UIMap.addButtons = function (canvas) {
  console.log("addButtons");
  console.log(this.statusBarNode.EquipKey.nChildren);

  const quickSlot = new MapleStanceButton(canvas, {
    x: 768 + startUIPosition.x,
    y: 536 + startUIPosition.y,
    img: this.statusBarNode.QuickSlot.nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      // console.log("Current stance: ", self.stance);
      console.log("equip click!");
    },
  });
  ClickManager.addButton(quickSlot);
  this.buttons.add(quickSlot);

  const keyboardlKey = new MapleStanceButton(canvas, {
    x: 736 + startUIPosition.x,
    y: 536 + startUIPosition.y,
    img: this.statusBarNode.KeySet.nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      // console.log("Current stance: ", self.stance);
      console.log("keyboard settings click!");
    },
  });
  ClickManager.addButton(keyboardlKey);
  this.buttons.add(keyboardlKey);

  const skillKey = new MapleStanceButton(canvas, {
    x: 704 + startUIPosition.x,
    y: 536 + startUIPosition.y,
    img: this.statusBarNode.SkillKey.nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      if (MapState.skillMenu) {
        MapState.skillMenu.setIsHidden(!MapState.skillMenu.isHidden);
      }
    },
  });
  ClickManager.addButton(skillKey);
  this.buttons.add(skillKey);

  const invetoryKey = new MapleStanceButton(canvas, {
    x: 672 + startUIPosition.x,
    y: 536 + startUIPosition.y,
    img: this.statusBarNode.InvenKey.nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      // console.log("Current stance: ", self.stance);
      console.log("inventory click!");
      MapState.inventoryMenu.setIsHidden(!MapState.inventoryMenu.isHidden);
    },
  });
  ClickManager.addButton(invetoryKey);
  this.buttons.add(invetoryKey);

  const equipKey = new MapleStanceButton(canvas, {
    x: 640 + startUIPosition.x,
    y: 536 + startUIPosition.y,
    img: this.statusBarNode.EquipKey.nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      MapState.equipMenu.setIsHidden(!MapState.equipMenu.isHidden);
    },
  });
  ClickManager.addButton(equipKey);
  this.buttons.add(equipKey);
};

UIMap.doUpdate = function (msPerTick, camera, canvas) {
  if (this.firstUpdate) {
    console.log("First update");
    this.chat = new MapleInput(canvas, {
      x: 5,
      y: 540 + startUIPosition.y,
      width: 530,
      color: "#000000",
      background: "transparent",
      height: 13,
    });
    this.chat.addSubmitListener(() => {
      const msg = this.chat!.input.value;
      this.chat!.input.value = "";
      
      if (msg.trim()) {
        if (msg[0] === "!") {
          // Handle command inputs
          const [command, ...commandArgs] = msg.split(" ");
          console.log(command, commandArgs);
          switch (command) {
            case "!level": {
              const level = Number(commandArgs[0]);
              if (!Number.isInteger(level) || level > 250 || level < 1) {
                break;
              }
              if (level > MyCharacter.stats.level) {
                MyCharacter.playLevelUp();
              }
              MyCharacter.stats.level = level;
              break;
            }
            case "!map": {
              const mapId = Number(commandArgs[0]);
              if (!Number.isInteger(mapId)) {
                break;
              }
              MapleMap.load(mapId);
              break;
            }
            default: {
              break;
            }
          }
        } else {
          // Regular chat message - show in a chat balloon
          this.showPlayerChatBalloon(msg);
          
          // Send chat message to other players via socket
          import('../mysocket').then(({ default: MySocket }) => {
            MySocket.sendChatMessage(msg);
          }).catch(err => {
            console.error("Failed to import MySocket for chat:", err);
          });
        }
      }
      
      canvas.releaseFocusInput();
    });
    this.firstUpdate = false;

    this.addButtons(canvas);
  }
  if (!canvas.focusInput && canvas.focusGame && canvas.isKeyDown("enter")) {
    this.chat!.input.focus();
  }
  UICommon.doUpdate(msPerTick);
};

UIMap.drawLevel = function (canvas, level) {
  const dy = 576 + startUIPosition.y;
  if (level >= 100) {
    const first = Math.floor(level / 100);
    const second = (Math.floor(level / 10) - 10) % 10;
    const third = level % 10;
    canvas.drawImage({
      img: this.statusBarLevelDigits[first],
      dx: 36,
      dy,
    });
    canvas.drawImage({
      img: this.statusBarLevelDigits[second],
      dx: 48,
      dy,
    });
    canvas.drawImage({
      img: this.statusBarLevelDigits[third],
      dx: 60,
      dy,
    });
  } else if (level >= 10) {
    const first = Math.floor(level / 10);
    const second = level % 10;
    canvas.drawImage({
      img: this.statusBarLevelDigits[first],
      dx: 42,
      dy,
    });
    canvas.drawImage({
      img: this.statusBarLevelDigits[second],
      dx: 54,
      dy,
    });
  } else {
    canvas.drawImage({
      img: this.statusBarLevelDigits[level],
      dx: 48,
      dy,
    });
  }
};

UIMap.drawNumbers = function (canvas, hp, maxHp, mp, maxMp, exp, maxExp) {
  canvas.drawImage({
    img: this.numbers.Lbracket,
    dx: 234,
    dy: 570 + startUIPosition.y,
  });

  const hpX = [...`${hp}`, "slash", ...`${maxHp}`].reduce((x, digit) => {
    canvas.drawImage({
      img: this.numbers[digit],
      dx: x,
      dy: 571 + startUIPosition.y,
    });
    x += this.numbers[digit].width + 1;
    return x;
  }, 238);

  canvas.drawImage({
    img: this.numbers.Rbracket,
    dx: hpX + 1,
    dy: 570 + startUIPosition.y,
  });

  canvas.drawImage({
    img: this.numbers.Lbracket,
    dx: 346,
    dy: 570 + startUIPosition.y,
  });

  const mpX = [...`${mp}`, "slash", ...`${maxMp}`].reduce((x, digit) => {
    canvas.drawImage({
      img: this.numbers[digit],
      dx: x,
      dy: 571 + startUIPosition.y,
    });
    x += this.numbers[digit].width + 1;
    return x;
  }, 350);

  canvas.drawImage({
    img: this.numbers.Rbracket,
    dx: mpX + 1,
    dy: 570 + startUIPosition.y,
  });

  const experiencePercentage = (exp / maxExp) * 100;
  const experiencePercentageRounded = experiencePercentage.toFixed(2);
  const expX = [...`${exp}[${experiencePercentageRounded}%]`].reduce(
    (x, digit) => {
      if (digit === ".") {
        canvas.drawRect({
          x: x,
          y: 571 + this.numbers[0].height - 1 + startUIPosition.y,
          width: 2,
          height: 1,
          color: "#ffffff",
        });

        x += 4;
      } else {
        if (digit === "%") {
          digit = "percent";
        } else if (digit === "[") {
          digit = "Lbracket";
        } else if (digit === "]") {
          digit = "Rbracket";
        }

        canvas.drawImage({
          img: this.numbers[digit],
          dx: x,
          dy: 571 + startUIPosition.y,
        });
        x += this.numbers[digit].width + 1;
      }

      return x;
    },
    462
  );
};

UIMap.doRender = function (canvas, camera, lag, msPerTick, tdelta) {
  const barY = 529 + startUIPosition.y;
  const bgW = this.statusBg.width || 800;

  // Draw the left copy normally
  canvas.drawImage({ img: this.statusBg, dx: 0, dy: barY });
  canvas.drawImage({ img: this.statusBg2, dx: 0, dy: barY });

  // Draw a right-aligned copy clipped so only the extra area beyond 800px shows
  if (startUIPosition.x > 0) {
    const ctx = canvas.context;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bgW, barY, config.width - bgW, config.height - barY);
    ctx.clip();
    canvas.drawImage({ img: this.statusBg, dx: config.width - bgW, dy: barY });
    canvas.drawImage({ img: this.statusBg2, dx: config.width - bgW, dy: barY });
    ctx.restore();
  }

  this.drawLevel(canvas, MyCharacter.stats.level);

  canvas.drawText({
    text: MyCharacter.stats.job,
    color: "#ffffff",
    x: 85,
    y: 570 + startUIPosition.y,
  });

  canvas.drawText({
    text: MyCharacter.name,
    color: "#ffffff",
    x: 85,
    y: 585 + startUIPosition.y,
  });

  canvas.drawImage({
    img: this.bars,
    dx: 215,
    dy: 567 + startUIPosition.y,
  });

  const { hp, maxHp, mp, maxMp, exp, maxExp } = MyCharacter;

  const numHpGrays = 105 - Math.floor((hp / maxHp) * 105);
  for (let i = 0; i < numHpGrays; i += 1) {
    canvas.drawImage({
      img: this.barGray,
      dx: 321 - i,
      dy: 581 + startUIPosition.y,
    });
  }

  const numMpGrays = 105 - Math.floor((mp / maxMp) * 105);
  for (let i = 0; i < numMpGrays; i += 1) {
    canvas.drawImage({
      img: this.barGray,
      dx: 429 - i,
      dy: 581 + startUIPosition.y,
    });
  }

  const expBarLength = 115;
  const numExpGrays = expBarLength - Math.floor((exp / maxExp) * expBarLength);
  for (let i = 0; i < numExpGrays; i += 1) {
    canvas.drawImage({
      img: this.barGray,
      dx: 552 - i,
      dy: 581 + startUIPosition.y,
    });
  }

  canvas.drawImage({
    img: this.graduation,
    dx: 215,
    dy: 566 + startUIPosition.y,
  });

  this.drawNumbers(canvas, hp, maxHp, mp, maxMp, exp, maxExp);

  this.buttons.forEach((obj) => {
    obj.draw(canvas, camera, lag, msPerTick, tdelta);
  });

  UICommon.doRender(canvas, camera, lag, msPerTick, tdelta);
  
  // Draw chat balloon if player has one - MUST be drawn LAST to appear on top of everything
  if (MapleMap.PlayerCharacter && 
      MapleMap.PlayerCharacter.showChatBalloon && 
      MapleMap.PlayerCharacter.drawChatBalloon) {
    MapleMap.PlayerCharacter.drawChatBalloon(canvas, camera);
  }
};

// Function to show player chat balloon
UIMap.showPlayerChatBalloon = function(message, character = null) {
  // Use provided character or default to player character
  const targetCharacter = character || MapleMap.PlayerCharacter;
  
  // Make sure the character exists
  if (!targetCharacter) return;
  
  // If the character doesn't have the chat balloon methods/properties yet, add them
  const player = targetCharacter;
  
  // If we need to add the chat balloon functionality to the player
  if (!player.chatMessage) {
    // Initialize chat balloon properties
    player.chatMessage = "";
    player.showChatBalloon = false;
    player.chatBalloonTimer = 0;
    player.chatBalloonDuration = 5000; // Show for 5 seconds
    
    // Add update method for chat balloon to player
    const originalDoUpdate = player.doUpdate || function() {};
    player.doUpdate = function(msPerTick) {
      // Call original update if it exists
      if (originalDoUpdate && typeof originalDoUpdate === 'function') {
        originalDoUpdate.call(this, msPerTick);
      }
      
      // Update chat balloon timer
      if (this.showChatBalloon) {
        this.chatBalloonTimer += msPerTick;
        if (this.chatBalloonTimer >= this.chatBalloonDuration) {
          this.showChatBalloon = false;
          this.chatBalloonTimer = 0;
        }
      }
    };
    
    // Add draw method for chat balloon (proper 9-patch with clip)
    player.drawChatBalloon = function(canvas: any, camera: any) {
      if (!this.chatBalloon || !this.chatMessage || !this.showChatBalloon) return;

      const fontSize = 12;
      const lineH = 14;
      const maxTextW = 140;
      const padX = 8, padY = 4;

      // Word-wrap
      const words = this.chatMessage.split(' ');
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (canvas.measureText({ text: test, fontSize }).width > maxTextW && cur) {
          lines.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur);

      let textW = 0;
      for (const l of lines) textW = Math.max(textW, canvas.measureText({ text: l, fontSize }).width);
      const textH = lines.length * lineH;

      const { nw, ne, sw, se, n, s, w, e, c, arrow } = this.chatBalloon;
      const nwW = nw.width, nwH = nw.height;
      const neW = ne.width;
      const swH = sw.height;
      const seW = se.width;
      const innerW = Math.max(textW + padX * 2, 60);
      const innerH = Math.max(textH + padY * 2, 20);
      const totalW = nwW + innerW + neW;
      const totalH = nwH + innerH + swH;

      const playerScreenX = this.pos.x - camera.x;
      const playerScreenY = this.pos.y - camera.y;
      const bx = Math.round(playerScreenX - totalW / 2);
      const by = Math.round(playerScreenY - totalH - 75);

      const ctx = canvas.context;
      ctx.save();

      // Corners
      canvas.drawImage({ img: nw, dx: bx, dy: by });
      canvas.drawImage({ img: ne, dx: bx + totalW - neW, dy: by });
      canvas.drawImage({ img: sw, dx: bx, dy: by + totalH - sw.height });
      canvas.drawImage({ img: se, dx: bx + totalW - seW, dy: by + totalH - se.height });

      // Top edge
      ctx.save(); ctx.beginPath(); ctx.rect(bx + nwW, by, innerW, nwH); ctx.clip();
      for (let tx = bx + nwW; tx < bx + nwW + innerW; tx += n.width) canvas.drawImage({ img: n, dx: tx, dy: by });
      ctx.restore();

      // Bottom edge
      ctx.save(); ctx.beginPath(); ctx.rect(bx + nwW, by + totalH - s.height, innerW, s.height); ctx.clip();
      for (let tx = bx + nwW; tx < bx + nwW + innerW; tx += s.width) canvas.drawImage({ img: s, dx: tx, dy: by + totalH - s.height });
      ctx.restore();

      // Left edge
      ctx.save(); ctx.beginPath(); ctx.rect(bx, by + nwH, w.width, innerH); ctx.clip();
      for (let ty = by + nwH; ty < by + nwH + innerH; ty += w.height) canvas.drawImage({ img: w, dx: bx, dy: ty });
      ctx.restore();

      // Right edge
      ctx.save(); ctx.beginPath(); ctx.rect(bx + totalW - e.width, by + nwH, e.width, innerH); ctx.clip();
      for (let ty = by + nwH; ty < by + nwH + innerH; ty += e.height) canvas.drawImage({ img: e, dx: bx + totalW - e.width, dy: ty });
      ctx.restore();

      // Center
      ctx.save(); ctx.beginPath(); ctx.rect(bx + nwW, by + nwH, innerW, innerH); ctx.clip();
      for (let fy = by + nwH; fy < by + nwH + innerH; fy += c.height)
        for (let fx = bx + nwW; fx < bx + nwW + innerW; fx += c.width)
          canvas.drawImage({ img: c, dx: fx, dy: fy });
      ctx.restore();

      // Arrow
      canvas.drawImage({ img: arrow, dx: Math.round(playerScreenX - arrow.width / 2), dy: by + totalH - 1 });

      ctx.restore();

      // Text
      const textStartY = by + nwH + padY;
      lines.forEach((line: string, i: number) => {
        canvas.drawText({ text: line, x: bx + totalW / 2, y: textStartY + i * lineH, color: '#000000', align: 'center', fontSize, fontWeight: 'normal' });
      });
    };
  }
  
  // Update the chat balloon loading if needed
  if (!player.chatBalloon) {
    // Load chat balloon images if not already loaded
    WZManager.get("UI.wz/ChatBalloon.img").then((chatBalloonFile) => {
      const style0 = chatBalloonFile["0"]; // Use style "0" (same as NPCs)
      
      // Store chat balloon parts for easy usage
      player.chatBalloon = {
        nw: style0.nw.nGetImage(),
        ne: style0.ne.nGetImage(),
        sw: style0.sw.nGetImage(),
        se: style0.se.nGetImage(),
        n: style0.n.nGetImage(),
        s: style0.s.nGetImage(),
        w: style0.w.nGetImage(),
        e: style0.e.nGetImage(),
        c: style0.c.nGetImage(),
        arrow: style0.arrow.nGetImage(),
      };
      
      // Now that we have the chat balloon loaded, show the message
      player.chatMessage = message;
      player.showChatBalloon = true;
      player.chatBalloonTimer = 0;
    }).catch(e => {
      console.error("Error loading chat balloon images:", e);
    });
  } else {
    // Chat balloon already loaded, just show the message
    player.chatMessage = message;
    player.showChatBalloon = true;
    player.chatBalloonTimer = 0;
  }
};

export default UIMap;
