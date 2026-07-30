import MyCharacter from "../MyCharacter";
import UIMobGage from './UIMobGage';
import WZManager from "../wz-utils/WZManager";
import UICommon from "./UICommon";
import MapleInput from "./MapleInput";
import MapleMap from "../MapleMap";
import config from "../Config";
import { MapleStanceButton } from "./MapleStanceButton";
import ClickManager from "./ClickManager";
import MapState from "../MapState";
import GameCanvas from "../GameCanvas";
import UIDevTools from "./UIDevTools";
import UIHotkeyBar from "./UIHotkeyBar";
import UIChatLog from "./UIChatLog";

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
  // GMS v83 status-bar key row, right-aligned (left → right):
  // BtClaim | EquipKey InvenKey StatKey SkillKey | KeySet | QuickSlot arrow
  const rowY = 536 + startUIPosition.y;
  const addBtn = (x: number, node: any, onClick: () => void, y: number = rowY) => {
    const btn = new MapleStanceButton(canvas, {
      x: x + startUIPosition.x,
      y,
      img: node.nChildren,
      isRelativeToCamera: true,
      isPartOfUI: true,
      onClick,
    });
    ClickManager.addButton(btn);
    this.buttons.add(btn);
    return btn;
  };

  // QuickSlot toggle — up arrow shown while the quickslot is hidden,
  // down arrow while it is open (two overlapping buttons, one visible)
  const syncQuickSlotArrows = () => {
    quickSlotUp.isHidden = UIHotkeyBar.isVisible;
    quickSlotDown.isHidden = !UIHotkeyBar.isVisible;
  };
  const toggleQuickSlot = () => {
    UIHotkeyBar.isVisible = !UIHotkeyBar.isVisible;
    syncQuickSlotArrows();
  };
  const quickSlotUp = addBtn(768, this.statusBarNode.QuickSlot, toggleQuickSlot);
  const quickSlotDown = addBtn(768, this.statusBarNode.QuickSlotD, toggleQuickSlot);
  syncQuickSlotArrows();

  addBtn(736, this.statusBarNode.KeySet, () => {
    console.log("keyboard settings click!");
  });
  addBtn(704, this.statusBarNode.SkillKey, () => {
    if (MapState.skillMenu) {
      MapState.skillMenu.setIsHidden(!MapState.skillMenu.isHidden);
    }
  });
  addBtn(672, this.statusBarNode.StatKey, () => {
    if (MapState.statsMenu) {
      MapState.statsMenu.setIsHidden(!MapState.statsMenu.isHidden);
    }
  });
  addBtn(640, this.statusBarNode.InvenKey, () => {
    MapState.inventoryMenu.setIsHidden(!MapState.inventoryMenu.isHidden);
  });
  addBtn(608, this.statusBarNode.EquipKey, () => {
    MapState.equipMenu.setIsHidden(!MapState.equipMenu.isHidden);
  });

  // White claim (siren) button left of the key group — 20x19, nudged down
  // to sit on the same baseline as the 20px pills
  addBtn(583, this.statusBarNode.BtClaim, () => {
    console.log("claim click!");
  }, rowY + 1);

  // Big 54x34 buttons on the lower gray band, right-aligned under the key
  // row (left → right): SHOP, TRADE, MENU, SHORT CUT
  const bigY = 565 + startUIPosition.y;
  addBtn(570, this.statusBarNode.BtShop, () => {
    console.log("cash shop click — not implemented yet");
  }, bigY);
  addBtn(626, this.statusBarNode.BtNPT, () => {
    console.log("trade click — not implemented yet");
  }, bigY);
  addBtn(682, this.statusBarNode.BtMenu, () => {
    console.log("menu click — not implemented yet");
  }, bigY);
  addBtn(738, this.statusBarNode.BtShort, () => {
    console.log("shortcut click — not implemented yet");
  }, bigY);
};

UIMap.doUpdate = function (msPerTick, camera, canvas) {
  if (this.firstUpdate) {
    console.log("First update");
    this.chat = new MapleInput(canvas, {
      x: 90,
      y: 540 + startUIPosition.y,
      width: 445,
      color: "#000000",
      background: "transparent",
      height: 13,
    });
    UIChatLog.notice('[Welcome] Welcome to MapleStory!!');
    // Minimized chat closes the input once typing ends
    this.chat.addFocusoutListener(() => {
      UIChatLog.typing = false;
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
          UIChatLog.addMessage(`${MyCharacter.name} : ${msg}`, 'player');

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
    // Minimized chat opens the input just for typing (GMS behavior).
    // Un-hide before focus() — a display:none input can't take focus.
    if (!UIChatLog.expanded) UIChatLog.typing = true;
    this.chat!.input.style.display = '';
    this.chat!.input.focus();
  }
  // The HTML input only exists on screen while the chat row is open —
  // minimized chat replaces the row with the last-message strip
  if (this.chat && !canvas.focusInput) {
    const open = UIChatLog.expanded || UIChatLog.typing;
    this.chat.input.style.display = open ? '' : 'none';
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
  // Top-center mob HP gauge (drawn under the rest of the HUD)
  UIMobGage.draw(canvas);
  const barY = 529 + startUIPosition.y;
  const bgW = this.statusBg.width || 800;

  UIDevTools.track('statusBar', 0, barY, config.width, config.height - barY, 'screen', 'UI.wz/StatusBar.img');
  UIDevTools.track('statusBar.bars', 215, 567 + startUIPosition.y, 340, 20, 'screen', 'UI.wz/StatusBar.img/gauge', 'statusBar');
  UIDevTools.track('statusBar.level', 36, 576 + startUIPosition.y, 40, 14, 'screen', undefined, 'statusBar');

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

  const { hp, mp, exp, maxExp } = MyCharacter;
  const maxHp = MyCharacter.effectiveMaxHp;
  const maxMp = MyCharacter.effectiveMaxMp;

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

  // Chat log above the status bar (under the cursor drawn by UICommon)
  UIChatLog.render(canvas);

  UICommon.doRender(canvas, camera, lag, msPerTick, tdelta);

  // Draw chat balloon if player has one - MUST be drawn LAST to appear on top of everything
  if (MapleMap.PlayerCharacter && 
      MapleMap.PlayerCharacter.showChatBalloon && 
      MapleMap.PlayerCharacter.drawChatBalloon) {
    MapleMap.PlayerCharacter.drawChatBalloon(canvas, camera);
  }
};

// Show a chat balloon above a character. MapleCharacter owns the balloon
// assets (loaded in load()), the timer (update()) and the drawing
// (drawChatBalloon()) — this just sets the state.
UIMap.showPlayerChatBalloon = function(message, character = null) {
  const player = character || MapleMap.PlayerCharacter;
  if (!player) return;
  player.chatMessage = message;
  player.showChatBalloon = true;
  player.chatBalloonTimer = 0;
  player.chatBalloonDuration = 5000;
};

export default UIMap;
