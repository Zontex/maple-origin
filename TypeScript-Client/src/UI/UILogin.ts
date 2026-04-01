import WZManager from "../wz-utils/WZManager";
import UICommon from "./UICommon";
import MapleInput from "./MapleInput";
import Random from "../Random";
import { MapleStanceButton } from "./MapleStanceButton";
import ClickManager from "./ClickManager";
import GameCanvas from "../GameCanvas";
import LoginState, {LoginSubState} from '../LoginState';
import Camera from '../Camera';
import WZNode from '../wz-utils/WZNode';
import FrameAnimation from './FrameAnimation';
import MapleButton from './MapleButton';
import LoginPacket from '../Net/Packets/LoginPacket';
import UILoginNotice, { NoticeType, NoticeMessage } from './UILoginNotice';
import UILoginTOS from './UILoginTOS';
import config from '../Config';
import MapleStandingCharacter from '../MapleStandingCharacter';
import DebugDrag from './DebugDrag';

interface UILoginInterface {
  uiLogin: WZNode;
  frameImg: any;
  inputUsn: MapleInput | null;
  inputPwd: MapleInput | null;
  newCharStats: number[];
  initialize: (canvas: GameCanvas) => Promise<void>;
  doUpdate: (msPerTick: number, camera: any, canvas: GameCanvas) => void;
  doRender: (
    canvas: GameCanvas,
    camera: any,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) => void;
  removeInputs: () => void;
  drawMask: (canvas: GameCanvas) => void;
  worlds: any[];
  selectedWorldId: number | null;
  worldButtonImages: Map<number, WZNode>;
  worldImages: Map<number, WZNode>;
  selectedWorldImage: WZNode | null;
  channels: any[];
  channelImgs: any[];
  channelSelectAnimation: FrameAnimation | null;
  selectedChannelIndex: number | null;
  scrollOpenAnimation: any;
  channelBackButton: any;
  behindFrameButtons: MapleButton[];
  inFrontOfFrameButtons: MapleButton[];
  channelButtons: MapleButton[];
  scrollContentFadeIn: {
    active: boolean;
    startTime: number;
    duration: number;
    alpha: number;
  };
  selectWorldChannelImgAnimation: {
    active: boolean;
    type: 'slideIn' | 'fadeOut';
    startTime: number;
    duration: number;
    startX: number;
    targetX: number;
    currentX: number;
    alpha: number;
  };
  startSelectWorldChannelImgSlideIn: () => void;
  startSelectWorldChannelImgFadeOut: () => void;
  selectCharacterImgAnimation: {
    active: boolean;
    type: 'slideIn' | 'fadeOut';
    startTime: number;
    duration: number;
    startX: number;
    targetX: number;
    currentX: number;
    alpha: number;
  };
  startSelectCharacterImgSlideIn: () => void;
  startSelectCharacterImgFadeOut: () => void;
  selectedWorldImageAnimation: {
    active: boolean;
    type: 'slideIn' | 'fadeOut';
    startTime: number;
    duration: number;
    startX: number;
    targetX: number;
    currentX: number;
    alpha: number;
  };
  startSelectedWorldSlideIn: () => void;
  stepImage: (stepId: number) => any;
  uiLoginNotice: UILoginNotice | null;
  showNotice: (noticeType: NoticeType, noticeMessage: NoticeMessage | null) => void;
  uiLoginTOS: UILoginTOS | null;
  showTOS: () => void;
  characters: MapleStandingCharacter[];
  selectedCharIndex: number;
  charSelectNameTag: any;
  charAnimFrame: number;
  charAnimDelay: number;
  charSelected: boolean;
  charSelectEffectFrame: number;
  charSelectEffectDelay: number;
  charSelectScrollFrame: number;
  charSelectScrollDelay: number;
  charSelectScrollState: 'closed' | 'opening' | 'open' | 'closing';
  startButton: MapleStanceButton | null;
  createCharacterButton: MapleStanceButton | null;
  drawCharacterSelect: (canvas: GameCanvas, camera: any, lag: number, msPerTick: number, tdelta: number) => void;
  // Create character
  newChar: MapleStandingCharacter | null;
  newCharOptions: {
    faces: number[];
    hairs: number[];       // base hair IDs (style)
    hairColors: number[];  // color offsets (0-7)
    skinColors: number[];
    tops: number[];
    bottoms: number[];
    shoes: number[];
    faceIndex: number;
    hairIndex: number;
    hairColorIndex: number;
    skinIndex: number;
    topIndex: number;
    bottomIndex: number;
    shoesIndex: number;
  };
  createCharButtons: MapleButton[];
  newCharNameInput: MapleInput | null;
  initCreateCharacter: () => void;
  cleanupCreateCharacter: () => void;
  drawCreateCharacter: (canvas: GameCanvas, camera: any, lag: number, msPerTick: number, tdelta: number) => void;
  updateNewCharAppearance: () => void;
  confirmCreateCharacter: () => void;
  newCharName: string;
  newCharView: number; // unused, kept for back button compat
  _createCharKeyHandler: ((e: KeyboardEvent) => void) | null;
  _appearanceUpdating: boolean;
  _diceAnimFrame: number;
  _diceAnimDelay: number;
  _diceRolling: boolean;
  _clickConsumed: boolean;
}

const UILogin = {} as UILoginInterface;

UILogin.initialize = async function (canvas: GameCanvas) {
  await UICommon.initialize();
  this.behindFrameButtons = [];
  this.inFrontOfFrameButtons = [];
  this.channelButtons = [];
  this.channelSelectAnimation = null;
  this.selectedChannelIndex = null;
  this.characters = [];
  this.selectedCharIndex = 0;
  // Load default character for char select preview
  MapleStandingCharacter.fromAppearance({
    name: 'Player',
    skinColor: 0,
    hairId: 30030,
    faceId: 20000,
    flipped: true,
    equipIds: [1040002, 1060002, 1302000],
  }).then(ch => { this.characters = [ch]; }).catch(() => {});
  this.charAnimFrame = 0;
  this.charAnimDelay = 0;
  this.charSelected = false;
  this.charSelectEffectFrame = 0;
  this.charSelectEffectDelay = 0;
  this.charSelectScrollFrame = 0;
  this.charSelectScrollDelay = 0;
  this.charSelectScrollState = 'closed';
  this.uiLogin = await WZManager.get('UI.wz/Login.img');

  this.frameImg = this.uiLogin.nGet('Common').nGet('frame').nGetImage();
  this.selectedWorldImage = this.uiLogin.nGet('Common').selectWorld.nGetImage();
  this.worlds = [
    {
      id: 0,
      channelCount: 3,
    },
    {
      id: 16,
      channelCount: 3,
    },
    {
      id: 2,
      channelCount: 3,
    },
  ]; // @todo: from server side

  this.worldButtonImages = new Map<number, WZNode>();
  this.worldImages = new Map<number, WZNode>();
  this.worlds.forEach((world) => {
    const buttonImage = this.uiLogin.nGet('WorldSelect')?.BtWorld.nGet(world.id, null);
    if (buttonImage) {
      this.worldButtonImages.set(world.id, buttonImage);
      const worldButton = new MapleStanceButton(canvas, {
        x: -250 + this.worldButtonImages.size * 27,
        y: -800,
        img: buttonImage.nChildren,
        onClick: () => {
          this.scrollOpenAnimation.reset();
          this.scrollOpenAnimation.active = true;
          this.selectedWorldId = world.id;

          this.scrollContentFadeIn.active = false;
          this.scrollContentFadeIn.alpha = 0;

          this.channelButtons.forEach((button, index) => {
            button.isHidden = false;
          });
        },
      });
      ClickManager.addButton(worldButton);
      this.behindFrameButtons.push(worldButton);
    } else {
      console.warn(`World button image for world ${world.id} not found.`);
    }

    const image = this.uiLogin.nGet('WorldSelect')?.world.nGet(world.id, null);
    if (image) {
      this.worldImages.set(world.id, image);
    } else {
      console.warn(`World image for world ${world.id} not found.`);
    }
  });

  this.inputUsn = new MapleInput(canvas, {
    x: 442,
    y: 236,
    width: 142,
    height: 20,
    color: "#ffffff",
  });
  this.inputPwd = new MapleInput(canvas, {
    x: 442,
    y: 265,
    width: 142,
    height: 20,
    color: "#ffffff",
    type: "password",
  });

  const uiLoginRef = this;
  const startButton = new MapleStanceButton(canvas, {
    x: 205,
    y: -1360,
    img: this.uiLogin.nGet('CharSelect').nGet('BtSelect').nChildren,
    stance: 'disabled',
    onClick: async () => {
      if (!uiLoginRef.charSelected) return;
      // Apply selected character's appearance to MyCharacter
      const selectedChar = uiLoginRef.characters[uiLoginRef.selectedCharIndex];
      if (selectedChar) {
        const MyChar = (await import('../MyCharacter')).default;
        MyChar.name = selectedChar.name || 'Player';
        await MyChar.setSkinColor(selectedChar.skinColor ?? 0);
        await MyChar.setFace(selectedChar.faceId ?? 20000);
        await MyChar.setHair(selectedChar.hairId ?? 30030);
        // Apply equips from the selected character
        MyChar.equips = [];
        const equipSlots = selectedChar.equippedIdsBySlot || {};
        for (const [slot, id] of Object.entries(equipSlots)) {
          if (id) await MyChar.attachEquip(Number(slot), id as number);
        }
      }
      await LoginState.enterGame();
    },
  });
  ClickManager.addButton(startButton);
  this.behindFrameButtons.push(startButton);
  this.startButton = startButton;

  const createCharacterButton = new MapleStanceButton(canvas, {
    x: 205,
    y: -1325,
    img: this.uiLogin.nGet('CharSelect').nGet('BtNew').nChildren,
    onClick: async () => {
      if (uiLoginRef.characters.length >= 3) return;
      await LoginState.switchToSubState(LoginSubState.CREATE_CHARACTER);
    },
  });
  ClickManager.addButton(createCharacterButton);
  this.behindFrameButtons.push(createCharacterButton);
  this.createCharacterButton = createCharacterButton;

  const deleteCharacterButton = new MapleStanceButton(canvas, {
    x: 205,
    y: -1275,
    img: this.uiLogin.nGet('CharSelect').nGet('BtDelete').nChildren,
    onClick: async () => {
      console.log('Delete character button clicked!');
    },
  });
  ClickManager.addButton(deleteCharacterButton);
  this.behindFrameButtons.push(deleteCharacterButton);

  for (let i = 0; i < 20; i++) {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const channelButton = new MapleStanceButton(canvas, {
      x: -145 + col * 92,
      y: -620 + row * 30,
      img: this.uiLogin.nGet('WorldSelect')?.nGet('channel')[i].nChildren,
      onClick: async () => {
        console.log(`Channel ${i} selected!`);

        this.selectedChannelIndex = i;
        this.channelSelectAnimation = new FrameAnimation(
          this.uiLogin.nGet('WorldSelect')?.nGet('channel').nGet('chSelect'),
          -145 + col * 92 - 10,
          -620 + row * 30 - 10
        );
        this.channelSelectAnimation.active = true;
        // @todo: handle double click
      },
      isHidden: true
    });
    ClickManager.addButton(channelButton);
    this.channelButtons.push(channelButton);
  }

  const enterChannelButton = new MapleStanceButton(canvas, {
    x: 135,
    y: -470,
    img: this.uiLogin.nGet('WorldSelect')?.BtGoworld.nChildren,
    onClick: async () => {
      await LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
    },
    isHidden: true
  });
  ClickManager.addButton(enterChannelButton);
  this.channelButtons.push(enterChannelButton);

  const viewAllCharacterButton = new MapleStanceButton(canvas, {
    x: 0,
    y: 370,
    img: this.uiLogin.nGet('ViewAllChar').nGet('BtVAC').nChildren,
    isPartOfUI: true,
    isRelativeToCamera: true,
    isHidden: true,
    onClick: async () => {
      console.log('View All Characters button clicked!');
    },
  });
  ClickManager.addButton(viewAllCharacterButton);
  this.inFrontOfFrameButtons.push(viewAllCharacterButton);

  const channelBackButton = new MapleStanceButton(canvas, {
    x: 0,
    y: 420,
    img: this.uiLogin.nGet('Common').nGet('BtStart').nChildren,
    isPartOfUI: true,
    isRelativeToCamera: true,
    isHidden: true,
    onClick: async () => {
      if (LoginState.currentSubState === LoginSubState.CREATE_CHARACTER) {
        await LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
      } else if (LoginState.currentSubState === LoginSubState.CHARACTER_SELECT) {
        await LoginState.switchToSubState(LoginSubState.WORLD_SELECT);
      } else {
        viewAllCharacterButton.isHidden = true;
        channelBackButton.isHidden = true;
        await LoginState.switchToSubState(LoginSubState.LOGIN_SCREEN);
      }
    },
  });
  ClickManager.addButton(channelBackButton);
  this.inFrontOfFrameButtons.push(channelBackButton);
  this.channelBackButton = channelBackButton;

  const loginButton = new MapleStanceButton(canvas, {
    x: 223,
    y: -85,
    img: this.uiLogin.nGet('Title').nGet('BtLogin').nChildren,
    onClick: async () => {
      await LoginState.switchToSubState(LoginSubState.WORLD_SELECT);
      viewAllCharacterButton.isHidden = false;
      channelBackButton.isHidden = false;
    },
  });
  ClickManager.addButton(loginButton);
  this.behindFrameButtons.push(loginButton);

  this.uiLoginNotice = await UILoginNotice.fromOpts({
    x: 220,
    y: 160,
  });
  this.uiLoginTOS = await UILoginTOS.fromOpts({
    x: 195,
    y: 90,
  });

  /*
  const dice = new MapleFrameButton({
    x: 245,
    y: -1835,
    img: uiLogin.NewChar.dice.nChildren,
    onEndFrame: () => {
      this.newCharStats = Random.generateDiceRollStats();
      console.log("Random stats: ", this.newCharStats);
    },
    hoverAudio: false,
  });
  ClickManager.addButton(dice);
  */

  this.newCharStats = Random.generateDiceRollStats();

  const dx = Math.floor(-215);
  const dy = Math.floor(-830 - Camera.y);
  this.scrollOpenAnimation = new FrameAnimation(this.uiLogin.nGet('WorldSelect')?.nGet('scroll').nGet(0), dx, dy);
  this.scrollContentFadeIn = {
    active: false,
    startTime: 0,
    duration: 500,
    alpha: 0,
  };
  this.selectWorldChannelImgAnimation = {
    active: false,
    type: 'slideIn',
    startTime: 0,
    duration: 500,
    startX: -100,
    targetX: 0,
    currentX: 0,
    alpha: 1,
  };
  this.selectCharacterImgAnimation = {
    active: false,
    type: 'slideIn',
    startTime: 0,
    duration: 500,
    startX: -100,
    targetX: 0,
    currentX: 0,
    alpha: 1,
  };
  this.selectedWorldImageAnimation = {
    active: false,
    type: 'slideIn',
    startTime: 0,
    duration: 500,
    startX: -100,
    targetX: 0,
    currentX: 0,
    alpha: 1,
  };
};

UILogin.doUpdate = function (msPerTick, camera, canvas) {
  UICommon.doUpdate(msPerTick);

  // Update standing character animations (blink, idle oscillation)
  for (const ch of this.characters) {
    ch.update(msPerTick);
  }
  if (this.newChar) {
    this.newChar.update(msPerTick);
  }

  const wasScrollActive = this.scrollOpenAnimation.active;
  this.scrollOpenAnimation.update(msPerTick);
  if (this.channelSelectAnimation) {
    this.channelSelectAnimation.update(msPerTick);
  }
  if (wasScrollActive && !this.scrollOpenAnimation.active && this.selectedWorldId !== null) {
    this.scrollContentFadeIn.active = true;
    this.scrollContentFadeIn.startTime = Date.now();
    this.scrollContentFadeIn.alpha = 0;
  }

  if (this.scrollContentFadeIn.active) {
    const elapsed = Date.now() - this.scrollContentFadeIn.startTime;
    this.scrollContentFadeIn.alpha = Math.min(elapsed / this.scrollContentFadeIn.duration, 1);

    if (this.scrollContentFadeIn.alpha === 1) {
      this.scrollContentFadeIn.active = false;
    }
  }

  if (this.selectWorldChannelImgAnimation.active) {
    const elapsed = Date.now() - this.selectWorldChannelImgAnimation.startTime;
    if (this.selectWorldChannelImgAnimation.type === 'slideIn') {
      this.selectWorldChannelImgAnimation.currentX = Math.min(
        this.selectWorldChannelImgAnimation.startX + (elapsed / this.selectWorldChannelImgAnimation.duration) * (this.selectWorldChannelImgAnimation.targetX - this.selectWorldChannelImgAnimation.startX),
        this.selectWorldChannelImgAnimation.targetX
      );
      this.selectWorldChannelImgAnimation.alpha = Math.min(elapsed / this.selectWorldChannelImgAnimation.duration, 1);
    } else if (this.selectWorldChannelImgAnimation.type === 'fadeOut') {
      this.selectWorldChannelImgAnimation.alpha = Math.max(1 - elapsed / this.selectWorldChannelImgAnimation.duration, 0);
    }

    if (this.selectWorldChannelImgAnimation.alpha === 0) {
      this.selectWorldChannelImgAnimation.active = false;
    }
  }
  if (this.selectCharacterImgAnimation.active) {
    const elapsed = Date.now() - this.selectCharacterImgAnimation.startTime;
    if (this.selectCharacterImgAnimation.type === 'slideIn') {
      this.selectCharacterImgAnimation.currentX = Math.min(
        this.selectCharacterImgAnimation.startX + (elapsed / this.selectCharacterImgAnimation.duration) * (this.selectCharacterImgAnimation.targetX - this.selectCharacterImgAnimation.startX),
        this.selectCharacterImgAnimation.targetX
      );
      this.selectCharacterImgAnimation.alpha = Math.min(elapsed / this.selectCharacterImgAnimation.duration, 1);
    } else if (this.selectCharacterImgAnimation.type === 'fadeOut') {
      this.selectCharacterImgAnimation.alpha = Math.max(1 - elapsed / this.selectCharacterImgAnimation.duration, 0);
    }

    if (this.selectCharacterImgAnimation.alpha === 0) {
      this.selectCharacterImgAnimation.active = false;
    }
  }
  if (this.selectedWorldImageAnimation.active) {
    const elapsed = Date.now() - this.selectedWorldImageAnimation.startTime;
    if (this.selectedWorldImageAnimation.type === 'slideIn') {
      this.selectedWorldImageAnimation.currentX = Math.min(
        this.selectedWorldImageAnimation.startX + (elapsed / this.selectedWorldImageAnimation.duration) * (this.selectedWorldImageAnimation.targetX - this.selectedWorldImageAnimation.startX),
        this.selectedWorldImageAnimation.targetX
      );
      this.selectedWorldImageAnimation.alpha = Math.min(elapsed / this.selectedWorldImageAnimation.duration, 1);
    } else if (this.selectedWorldImageAnimation.type === 'fadeOut') {
      this.selectedWorldImageAnimation.alpha = Math.max(1 - elapsed / this.selectedWorldImageAnimation.duration, 0);
    }

    if (this.selectedWorldImageAnimation.alpha === 0) {
      this.selectedWorldImageAnimation.active = false;
    }
  }
};

UILogin.doRender = function (canvas, camera, lag, msPerTick, tdelta) {
  // const currDiceFrame = this.dice[this.diceFrame];
  // const currDiceImage = currDiceFrame.nGetImage();
  // canvas.drawImage({
  //   img: currDiceImage,
  //   dx: this.diceX - camera.x - currDiceFrame.origin.nX,
  //   dy: this.diceY - camera.y - currDiceFrame.origin.nY,
  // });

  this.scrollOpenAnimation.draw(canvas, camera, lag, msPerTick, tdelta);

  // Draw character on the select screen
  if (LoginState.currentSubState === LoginSubState.CHARACTER_SELECT) {
    this.drawCharacterSelect(canvas, camera, lag, msPerTick, tdelta);
  }

  // Draw create character screen
  if (LoginState.currentSubState === LoginSubState.CREATE_CHARACTER) {
    this.drawCreateCharacter(canvas, camera, lag, msPerTick, tdelta);
  }

  this.behindFrameButtons.forEach((obj) => {
    obj.draw(canvas, camera, lag, msPerTick, tdelta);
  });

  if (typeof this.selectedWorldId !== 'undefined' && this.selectedWorldId !== null) {
    const worldImage = this.worldImages.get(this.selectedWorldId);
    if (worldImage) {
      canvas.drawImage({
        img: worldImage.nGetImage(),
        dx: 225,
        dy: -680 - Camera.y,
        alpha: this.scrollContentFadeIn.alpha
      });
    } else {
      console.warn(`World image for selected world ${this.selectedWorldId} not found.`);
    }

    this.channelButtons.forEach((obj) => {
      if (!obj.isHidden) {
        const stanceButton = obj as MapleStanceButton;
        const currentFrame = stanceButton.stances[stanceButton.stance];
        const currentImage = currentFrame?.nGetImage();
        if (currentImage) {
          canvas.drawImage({
            img: currentImage,
            dx: obj.x - camera.x,
            dy: obj.y - camera.y,
            alpha: this.scrollContentFadeIn.alpha
          });
        }
      }
    });

    if (this.channelSelectAnimation) {
      this.channelSelectAnimation.draw(canvas, camera, lag, msPerTick, tdelta);
    }
  }

  canvas.drawImage({
    img: this.frameImg,
    dx: 0,
    dy: 0,
  });

  this.inFrontOfFrameButtons.forEach((obj) => {
    obj.draw(canvas, camera, lag, msPerTick, tdelta);
  });

  if (this.selectWorldChannelImgAnimation.active) {
    canvas.drawImage({
      img: this.stepImage(1),
      dx: this.selectWorldChannelImgAnimation.currentX,
      dy: 30,
      alpha: this.selectWorldChannelImgAnimation.alpha
    });
  }

  if (this.selectCharacterImgAnimation.active) {
    canvas.drawImage({
      img: this.stepImage(2),
      dx: this.selectCharacterImgAnimation.currentX,
      dy: 30,
      alpha: this.selectCharacterImgAnimation.alpha
    });
  }

  if (this.selectedWorldImageAnimation.active) {
    canvas.drawImage({
      img: this.selectedWorldImage,
      dx: this.selectedWorldImageAnimation.currentX,
      dy: 100,
    });
  }

  canvas.drawText({
    text: "Ver. 0.83",
    fontWeight: "bold",
    x: 595,
    y: 13,
  });

  this.drawMask(canvas);

  this.uiLoginNotice.draw(canvas, camera, lag, msPerTick, tdelta);
  this.uiLoginTOS.draw(canvas, camera, lag, msPerTick, tdelta);

  UICommon.doRender(canvas, camera, lag, msPerTick, tdelta);
};

UILogin.drawMask = function (canvas) {
  const frameWidth = this.frameImg.width;
  const frameHeight = this.frameImg.height;
  const frameX = 0;
  const frameY = 0;
  canvas.context.fillStyle = "#000000";
  const canvasWidth = canvas.context.canvas.width;
  const canvasHeight = canvas.context.canvas.height;

  // Draw black rectangles to mask areas outside the frame
  canvas.context.fillRect(0, 0, frameX, canvasHeight); // Left mask
  canvas.context.fillRect(frameX + frameWidth,0, canvasWidth - (frameX + frameWidth), canvasHeight); // Right mask
  canvas.context.fillRect(frameX,0, frameWidth, frameY); // Top mask
  canvas.context.fillRect(frameX, frameY + frameHeight, frameWidth, canvasHeight - (frameY + frameHeight)); // Bottom mask
  canvas.context.restore();
};

UILogin.removeInputs = function () {
  if (this.inputUsn) this.inputUsn.remove();
  if (this.inputPwd) this.inputPwd.remove();
  this.inputUsn = null;
  this.inputPwd = null;
};

UILogin.drawCharacterSelect = function (canvas, camera, lag, msPerTick, tdelta) {
  if (this.characters.length === 0) return;

  // Keep start button disabled until character is selected
  if (this.startButton && !this.charSelected) {
    this.startButton.stance = 'disabled';
  }

  // Disable create button when all 3 slots are taken
  if (this.createCharacterButton) {
    this.createCharacterButton.stance = this.characters.length >= 3 ? 'disabled' : 'normal';
  }

  // Update debug drag system
  DebugDrag.update(canvas.mouseX, canvas.mouseY, canvas.clicked);

  // Advance glow animation counter (used for empty slots)
  this.charAnimDelay += msPerTick;
  if (this.charAnimDelay >= 120) {
    this.charAnimDelay = 0;
    this.charAnimFrame++;
  }

  const char = this.characters[this.selectedCharIndex];

  // Character base screen position (player offset: -133, -9)
  const baseCharScreenX = 10 - 133 - camera.x;
  const baseCharScreenY = -1130 - 9 - camera.y;
  DebugDrag.register('character', baseCharScreenX, baseCharScreenY, 60, 80);
  const charPos = DebugDrag.get('character');
  const charScreenX = charPos.x;
  const charScreenY = charPos.y;

  const charSelectNode = this.uiLogin.nGet('CharSelect');
  const CHAR_SLOT_SPACING = 105;
  const TOTAL_SLOTS = 3;

  try {
    // Draw all 3 character slots
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const slotX = charScreenX + i * CHAR_SLOT_SPACING;
      const slotY = charScreenY;

      if (i < this.characters.length) {
        // Slot has a character
        const slotChar = this.characters[i];
        const isSelected = this.charSelected && this.selectedCharIndex === i;

        // Draw selection light effect behind the selected character
        if (isSelected) {
          const effectNode = charSelectNode.nGet('effect').nGet('1');
          const effectFrames = effectNode.nChildren;

          this.charSelectEffectDelay += msPerTick;
          if (this.charSelectEffectDelay >= 120) {
            this.charSelectEffectDelay = 0;
            if (this.charSelectEffectFrame < effectFrames.length - 1) {
              this.charSelectEffectFrame++;
            }
          }

          const ef = effectFrames[this.charSelectEffectFrame];
          if (ef) {
            const efImg = ef.nGetImage();
            const ox = ef.origin ? ef.origin.nGet('nX', 0) : 0;
            const oy = ef.origin ? ef.origin.nGet('nY', 0) : 0;
            const baseEffX = slotX - ox + 5;
            const baseEffY = slotY - oy - 370;
            DebugDrag.register('effect', baseEffX, baseEffY, efImg.width || 70, efImg.height || 300);
            const effPos = DebugDrag.get('effect');
            canvas.drawImage({
              img: efImg,
              dx: effPos.x,
              dy: effPos.y,
            });
          }
        }

        // Draw the character sprite (frame/stance managed by MapleStandingCharacter.update)
        if (slotChar && slotChar.baseBody) {
          const drawableFrames = slotChar.getDrawableFrames(slotChar.stance, slotChar.frame, slotChar.flipped);
          drawableFrames.forEach((f: any) => {
            canvas.drawImage({
              img: f.img,
              dx: Math.floor(slotX + f.x),
              dy: Math.floor(slotY + f.y),
              flipped: slotChar.flipped,
            });
          });
        }

        // Draw name tag
        const name = slotChar?.name || 'Player';
        const nameTagNode = charSelectNode.nGet('nameTag');
        const tagNode = isSelected ? nameTagNode.nGet('1') : nameTagNode.nGet('0');
        const tagLeft = tagNode.nGet('0').nGetImage();
        const tagCenter = tagNode.nGet('1').nGetImage();
        const tagRight = tagNode.nGet('2').nGetImage();

        if (tagLeft && tagCenter && tagRight) {
          const nameTagY = slotY + 5;
          canvas.context.save();
          canvas.context.font = '12px Arial';
          const textW = canvas.context.measureText(name).width;
          canvas.context.restore();

          const totalW = tagLeft.width + textW + 4 + tagRight.width;
          const tagStartX = slotX - totalW / 2;

          canvas.drawImage({ img: tagLeft, dx: tagStartX, dy: nameTagY });
          canvas.drawImage({
            img: tagCenter,
            dx: tagStartX + tagLeft.width,
            dy: nameTagY,
            dw: textW + 4,
            dh: tagCenter.height,
          });
          canvas.drawImage({
            img: tagRight,
            dx: tagStartX + tagLeft.width + textW + 4,
            dy: nameTagY,
          });

          canvas.drawText({
            text: name,
            x: slotX,
            y: nameTagY + 4,
            color: '#ffffff',
            fontSize: 12,
            fontFamily: 'Arial',
            align: 'center',
          });
        }
      } else {
        // Empty slot — draw character/0 animated glow under placeholder
        const charGlowNode = charSelectNode.nGet('character').nGet('0');
        const glowFrames = charGlowNode.nChildren;
        const glowFrame = this.charAnimFrame % glowFrames.length;
        const gf = glowFrames[glowFrame];
        if (gf) {
          const gfImg = gf.nGetImage();
          const gox = gf.origin ? gf.origin.nGet('nX', 0) : 0;
          const goy = gf.origin ? gf.origin.nGet('nY', 0) : 0;
          const emptyOffsets = [0, 53, 105];
          canvas.drawImage({
            img: gfImg,
            dx: slotX - gox + (emptyOffsets[i] || 0),
            dy: slotY - goy + 2,
          });
        }

        // Draw character/1/0 placeholder on top of glow
        const emptySlotNode = charSelectNode.nGet('character').nGet('1').nGet('0');
        if (emptySlotNode) {
          const emptyImg = emptySlotNode.nGetImage();
          const eox = emptySlotNode.origin ? emptySlotNode.origin.nGet('nX', 0) : 0;
          const eoy = emptySlotNode.origin ? emptySlotNode.origin.nGet('nY', 0) : 0;
          const baseEmptyX = slotX - eox;
          const baseEmptyY = slotY - eoy;
          const emptyOffsets = [0, 53, 105];
          DebugDrag.register(`emptySlot${i}`, baseEmptyX + (emptyOffsets[i] || 0), baseEmptyY, emptyImg.width || 51, emptyImg.height || 71);
          const emptyPos = DebugDrag.get(`emptySlot${i}`);
          canvas.drawImage({
            img: emptyImg,
            dx: emptyPos.x,
            dy: emptyPos.y,
          });
        }
      }
    }

    // Draw pageR (right arrow)
    try {
      const pageRNode = charSelectNode.nGet('pageR').nGet('0').nGet('0');
      const pageRImg = pageRNode.nGetImage();
      if (pageRImg) {
        DebugDrag.register('pageR', charScreenX + 315, charScreenY - 95 + 20, pageRImg.width || 44, pageRImg.height || 36);
        const pageRPos = DebugDrag.get('pageR');
        canvas.drawImage({ img: pageRImg, dx: pageRPos.x, dy: pageRPos.y });
      }
    } catch (e) {}

    // Draw pageL (left arrow)
    try {
      const pageLNode = charSelectNode.nGet('pageL').nGet('0').nGet('0');
      const pageLImg = pageLNode.nGetImage();
      if (pageLImg) {
        DebugDrag.register('pageL', charScreenX - 75 - 46, charScreenY - 95 + 21, pageLImg.width || 43, pageLImg.height || 37);
        const pageLPos = DebugDrag.get('pageL');
        canvas.drawImage({ img: pageLImg, dx: pageLPos.x, dy: pageLPos.y });
      }
    } catch (e) {}

    // Click detection — check if mouse clicked on any slot
    if (canvas.clicked) {
      const mx = canvas.mouseX;
      const my = canvas.mouseY;
      for (let i = 0; i < TOTAL_SLOTS; i++) {
        const slotX = charScreenX + i * CHAR_SLOT_SPACING;
        if (mx >= slotX - 30 && mx <= slotX + 30 &&
            my >= charScreenY - 60 && my <= charScreenY + 10) {
          if (i < this.characters.length) {
            // Deselect previous
            if (this.charSelected && this.selectedCharIndex !== i) {
              this.characters[this.selectedCharIndex]?.setStance('stand1', 0, true);
            }
            this.selectedCharIndex = i;
            this.charSelected = true;
            this.charSelectEffectFrame = 0;
            this.charSelectEffectDelay = 0;
            this.charSelectScrollState = 'opening';
            this.charSelectScrollFrame = 0;
            this.charSelectScrollDelay = 0;
            // Switch selected character to walk animation
            this.characters[i].setStance('walk1', 0, false);
            // Enable the start button
            if (this.startButton) {
              this.startButton.stance = 'normal';
            }
          }
          break;
        }
      }
    }

    // Draw the info scroll panel when character is selected
    if (this.charSelected) {
      const scrollNode = charSelectNode.nGet('scroll');

      this.charSelectScrollDelay += msPerTick;

      if (this.charSelectScrollState === 'opening') {
        const openFrames = scrollNode.nGet('0').nChildren;
        const delay = openFrames[this.charSelectScrollFrame]?.delay?.nValue || 50;
        if (this.charSelectScrollDelay >= delay) {
          this.charSelectScrollDelay = 0;
          this.charSelectScrollFrame++;
          if (this.charSelectScrollFrame >= openFrames.length) {
            this.charSelectScrollState = 'open';
            this.charSelectScrollFrame = 0;
          }
        }
      }

      let scrollImg: any = null;

      if (this.charSelectScrollState === 'opening') {
        const f = scrollNode.nGet('0').nGet(this.charSelectScrollFrame.toString());
        if (f) scrollImg = f.nGetImage();
      } else if (this.charSelectScrollState === 'open') {
        const openFrames = scrollNode.nGet('0').nChildren;
        const f = scrollNode.nGet('0').nGet((openFrames.length - 1).toString());
        if (f) scrollImg = f.nGetImage();
      }

      if (scrollImg) {
        const selSlotX = charScreenX + this.selectedCharIndex * CHAR_SLOT_SPACING;
        const baseScrollX = selSlotX - scrollImg.width / 2 + 8;
        const baseScrollY = charScreenY - scrollImg.height - 20 - 60;
        DebugDrag.register('scroll', baseScrollX, baseScrollY, scrollImg.width, scrollImg.height);
        const scrollPos = DebugDrag.get('scroll');
        const scrollX = scrollPos.x;
        const scrollY = scrollPos.y;

        canvas.drawImage({
          img: scrollImg,
          dx: scrollX,
          dy: scrollY,
        });

        // Draw charInfo2 background on open scroll
        if (this.charSelectScrollState === 'open') {
          const charInfoImg = charSelectNode.nGet('charInfo2').nGetImage();
          if (charInfoImg) {
            canvas.drawImage({
              img: charInfoImg,
              dx: scrollX + (scrollImg.width - charInfoImg.width) / 2,
              dy: scrollY + 30,
            });
          }

          // Draw stat values only (labels are baked into charInfo2 image)
          const stats = char.stat;
          const infoX = scrollX + 50;
          const infoY = scrollY + 38;
          const lineH = 17;
          const col2X = scrollX + scrollImg.width / 2 + 43;

          // Left column values: Job, Level, STR, DEX
          const leftValues = [
            `${stats?.job || 'Beginner'}`,
            `${stats?.level || 1}`,
            `${stats?.str || 4}`,
            `${stats?.dex || 4}`,
          ];
          // Right column values: Fame, (empty), INT, LUK
          const rightValues = [
            '0', // fame not tracked on standing character
            '',
            `${stats?.int || 4}`,
            `${stats?.luk || 4}`,
          ];

          leftValues.forEach((val, i) => {
            canvas.drawText({ text: val, x: infoX, y: infoY + i * lineH, color: '#000000', fontSize: 11, fontFamily: 'Arial' });
          });
          rightValues.forEach((val, i) => {
            if (!val) return;
            canvas.drawText({ text: val, x: col2X, y: infoY + i * lineH, color: '#000000', fontSize: 11, fontFamily: 'Arial' });
          });
        }
      }
    }
  } catch (e) {
    // Character data may not be fully loaded yet
  }

  // Draw debug overlays last
  DebugDrag.drawAll(canvas);
};

UILogin.initCreateCharacter = function () {
  this.createCharButtons = [];
  this.charAnimFrame = 0;
  this.charAnimDelay = 0;
  this.newCharName = '';
  this.newCharView = 1;
  this.newChar = null;
  this._appearanceUpdating = false;
  this._diceAnimFrame = 0;
  this._diceAnimDelay = 0;
  this._diceRolling = false;
  this._clickConsumed = false;
  DebugDrag.clear();

  // Hide all login UI buttons so they don't interfere with create char UI
  this.inFrontOfFrameButtons.forEach((btn: any) => { btn.isHidden = true; });
  this.behindFrameButtons.forEach((btn: any) => { btn.isHidden = true; });

  // v83 Beginner starter options
  this.newCharOptions = {
    faces: [20000, 20001, 20002],
    hairs: [30030, 30020, 30000],
    hairColors: [0, 1, 2, 3, 4, 5, 6, 7],
    skinColors: [0, 1, 2, 3, 4, 5, 6, 7],
    tops: [1040002, 1040006, 1040010],
    bottoms: [1060002, 1060006],
    shoes: [1072001, 1072005, 1072037, 1072038],
    faceIndex: 0,
    hairIndex: 0,
    hairColorIndex: 0,
    skinIndex: 0,
    topIndex: 0,
    bottomIndex: 0,
    shoesIndex: 0,
  };

  // Roll initial stats
  this.newCharStats = Random.generateDiceRollStats();

  // Keyboard handler for name input
  this._createCharKeyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Backspace') {
      this.newCharName = this.newCharName.slice(0, -1);
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Enter') {
      if (this.newCharName.trim().length > 0) {
        this.confirmCreateCharacter();
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Escape') {
      LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key.length === 1 && this.newCharName.length < 12) {
      this.newCharName += e.key;
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', this._createCharKeyHandler, true);

  // Create preview character
  const o = this.newCharOptions;
  MapleStandingCharacter.fromAppearance({
    name: '',
    skinColor: o.skinColors[0],
    hairId: o.hairs[0] + o.hairColors[0],
    faceId: o.faces[0],
    flipped: true,
    equipIds: [o.tops[0], o.bottoms[0], o.shoes[0]],
  }).then(ch => { this.newChar = ch; }).catch(() => {});
};

UILogin.cleanupCreateCharacter = function () {
  if (this._createCharKeyHandler) {
    window.removeEventListener('keydown', this._createCharKeyHandler, true);
    this._createCharKeyHandler = null;
  }
  if (this.createCharButtons) {
    this.createCharButtons.forEach((btn: MapleButton) => ClickManager.removeButton(btn));
    this.createCharButtons = [];
  }
  this.newChar = null;

  // Restore all login UI buttons
  this.inFrontOfFrameButtons.forEach((btn: any) => { btn.isHidden = false; });
  this.behindFrameButtons.forEach((btn: any) => { btn.isHidden = false; });
};

UILogin.confirmCreateCharacter = function () {
  if (this.characters.length >= 3) return;
  // Use default name if none entered
  if (!this.newCharName || this.newCharName.trim().length === 0) {
    this.newCharName = 'Beginner';
  }
  const o = this.newCharOptions;
  const appearance = {
    name: this.newCharName.trim(),
    skinColor: o.skinColors[o.skinIndex],
    hairId: o.hairs[o.hairIndex] + o.hairColors[o.hairColorIndex],
    faceId: o.faces[o.faceIndex],
    flipped: true,
    equipIds: [o.tops[o.topIndex], o.bottoms[o.bottomIndex], o.shoes[o.shoesIndex]],
  };
  console.log('Create character:', appearance, 'stats:', this.newCharStats);

  // Create the standing character and add to the characters array
  MapleStandingCharacter.fromAppearance(appearance).then(ch => {
    this.characters.push(ch);
    LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
  }).catch(() => {
    LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
  });
};

UILogin.updateNewCharAppearance = async function () {
  if (!this.newChar || !this.newCharOptions || this._appearanceUpdating) return;
  this._appearanceUpdating = true;
  try {
    const o = this.newCharOptions;
    const hairId = o.hairs[o.hairIndex] + o.hairColors[o.hairColorIndex];
    await this.newChar.setSkinColor(o.skinColors[o.skinIndex] ?? 0);
    await this.newChar.setFace(o.faces[o.faceIndex] ?? 20000);
    await this.newChar.setHair(hairId ?? 30030);
    await this.newChar.setEquipsByIds([
      o.tops[o.topIndex],
      o.bottoms[o.bottomIndex],
      o.shoes[o.shoesIndex],
    ].filter(Boolean));
  } catch (e) {}
  this._appearanceUpdating = false;
};

UILogin.drawCreateCharacter = function (canvas: any, camera: any, lag: number, msPerTick: number, tdelta: number) {
  DebugDrag.update(canvas.mouseX, canvas.mouseY, canvas.clicked);

  const targetY = -2723;
  if (Math.abs(camera.y - targetY) > 5) return;

  const newCharNode = this.uiLogin.nGet('NewChar');
  const mx = canvas.mouseX;
  const my = canvas.mouseY;
  const clicked = canvas.clicked && !DebugDrag.enabled && !this._clickConsumed;
  if (clicked) this._clickConsumed = true;
  if (!canvas.clicked) this._clickConsumed = false;

  // --- Character preview ---
  if (this.newChar && this.newChar.baseBody) {
    try {
      const drawableFrames = this.newChar.getDrawableFrames(this.newChar.stance, this.newChar.frame, this.newChar.flipped);
      DebugDrag.register('newCharPreview', 395, 357, 60, 80);
      const p = DebugDrag.get('newCharPreview');
      drawableFrames.forEach((f: any) => {
        canvas.drawImage({
          img: f.img,
          dx: Math.floor(p.x + f.x),
          dy: Math.floor(p.y + f.y),
          flipped: true,
        });
      });
    } catch (e) {}
  }

  // ============ RIGHT PANEL: charSet (225x377) — name + stats + dice ============
  const rpx = 475; // right panel x
  const rpy = 103;  // right panel y
  try {
    const charSetImg = newCharNode.nGet('charSet').nGetImage();
    if (charSetImg) {
      DebugDrag.register('charSet', rpx, rpy, 225, 377);
      const p = DebugDrag.get('charSet');
      canvas.drawImage({ img: charSetImg, dx: p.x, dy: p.y });
    }
  } catch (e) {}
  const rp = DebugDrag.get('charSet');

  // Name input
  const nameDisplay = (this.newCharName || '') + '_';
  canvas.drawText({
    text: nameDisplay,
    x: rp.x + 15,
    y: rp.y + 55,
    color: '#000000',
    fontSize: 13,
    fontFamily: 'Arial',
    align: 'left',
  });

  // BtCheck ("CHECK") button — top right of charSet panel
  try {
    const checkImg = newCharNode.nGet('BtCheck').nGet('normal').nGet('0').nGetImage();
    if (checkImg) {
      DebugDrag.register('btCheck', rp.x + 160, rp.y + 10, 50, 24);
      const cp = DebugDrag.get('btCheck');
      canvas.drawImage({ img: checkImg, dx: cp.x, dy: cp.y });
    }
  } catch (e) {}

  // Stats
  const stats = this.newCharStats || [4, 4, 4, 4];
  const statLabels = ['STR', 'DEX', 'INT', 'LUK'];
  const statsX = rp.x + 20;
  const statsY = rp.y + 95;
  for (let i = 0; i < 4; i++) {
    canvas.drawText({
      text: statLabels[i],
      x: statsX,
      y: statsY + i * 25,
      color: '#000000',
      fontSize: 14,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      align: 'left',
    });
    canvas.drawText({
      text: String(stats[i]),
      x: statsX + 55,
      y: statsY + i * 25,
      color: '#000000',
      fontSize: 14,
      fontFamily: 'Arial',
      align: 'left',
    });
  }

  // "GENERATE!!" label
  canvas.drawText({
    text: 'GENERATE!!',
    x: rp.x + 115,
    y: statsY + 5,
    color: '#663300',
    fontSize: 11,
    fontFamily: 'Arial',
    fontWeight: 'bold',
    align: 'left',
  });

  // Dice (animated)
  try {
    if (this._diceRolling) {
      this._diceAnimDelay += msPerTick;
      if (this._diceAnimDelay > 80) {
        this._diceAnimDelay = 0;
        this._diceAnimFrame++;
        if (this._diceAnimFrame >= 4) {
          this._diceAnimFrame = 0;
          this._diceRolling = false;
          this.newCharStats = Random.generateDiceRollStats();
        }
      }
    }
    const diceFrame = this._diceRolling ? this._diceAnimFrame : 3;
    const diceImg = newCharNode.nGet('dice').nGet(String(diceFrame)).nGetImage();
    if (diceImg) {
      DebugDrag.register('dice', rp.x + 155, statsY + 40, 30, 45);
      const dp = DebugDrag.get('dice');
      canvas.drawImage({ img: diceImg, dx: dp.x, dy: dp.y });

      if (clicked && !this._diceRolling &&
          mx >= dp.x && mx <= dp.x + 30 &&
          my >= dp.y && my <= dp.y + 45) {
        this._diceRolling = true;
        this._diceAnimFrame = 0;
        this._diceAnimDelay = 0;
      }
    }
  } catch (e) {}

  // ============ LEFT PANEL: scroll (242x210) — appearance options ============
  const lpx = 120; // left panel x
  const lpy = 151; // left panel y
  try {
    const scrollImg = newCharNode.nGet('scroll').nGet('0').nGet('3').nGetImage();
    if (scrollImg) {
      DebugDrag.register('scroll', lpx, lpy, 242, 210);
      const sp = DebugDrag.get('scroll');
      canvas.drawImage({ img: scrollImg, dx: sp.x, dy: sp.y });
    }
  } catch (e) {}
  const lp = DebugDrag.get('scroll');

  // Appearance rows on the scroll panel
  const rowLabels = ['FACE', 'HAIR STYLE', 'HAIR COLOR', 'SKIN COLOR', 'TOP', 'BOTTOM', 'SHOES'];
  const indexKeys = ['faceIndex', 'hairIndex', 'hairColorIndex', 'skinIndex', 'topIndex', 'bottomIndex', 'shoesIndex'];
  const optionKeys = ['faces', 'hairs', 'hairColors', 'skinColors', 'tops', 'bottoms', 'shoes'];
  const rowStartY = lp.y + 12;
  const rowSpacing = 25;

  for (let i = 0; i < rowLabels.length; i++) {
    const rowY = rowStartY + i * rowSpacing;

    // Category label
    canvas.drawText({
      text: rowLabels[i],
      x: lp.x + 12,
      y: rowY + 3,
      color: '#000000',
      fontSize: 11,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      align: 'left',
    });

    // BtLeft arrow
    try {
      const leftImg = newCharNode.nGet('BtLeft').nGet('normal').nGet('0').nGetImage();
      if (leftImg) {
        const lbx = lp.x + 100;
        const lby = rowY + 1;
        canvas.drawImage({ img: leftImg, dx: lbx, dy: lby });

        if (clicked && mx >= lbx && mx <= lbx + 15 &&
            my >= lby && my <= lby + 16) {
          const o = this.newCharOptions;
          const arr = o[optionKeys[i]] as number[];
          o[indexKeys[i]] = ((o[indexKeys[i]] as number) - 1 + arr.length) % arr.length;
          this.updateNewCharAppearance();
        }
      }
    } catch (e) {}

    // Current selection name (centered between arrows)
    const o = this.newCharOptions;
    const currentIdx = o[indexKeys[i]] as number;
    const currentVal = (o[optionKeys[i]] as number[])[currentIdx];
    let displayText = String(currentVal);
    // Friendly names for known values
    const nameMap: Record<string, Record<number, string>> = {
      faces: { 20000: 'Motivated', 20001: 'Perplexed', 20002: 'Leisure' },
      hairs: { 30030: 'Buzz', 30020: 'Sammy', 30000: 'Toben' },
      tops: { 1040002: 'White Undershirt', 1040006: 'Blue T-Shirt', 1040010: 'Orange T-Shirt' },
      bottoms: { 1060002: 'Blue Jean Shorts', 1060006: 'Red-Striped Shorts' },
      shoes: { 1072001: 'Red Rubber Boots', 1072005: 'Leather Sandals', 1072037: 'Yellow Sneakers', 1072038: 'Blue Sneakers' },
    };
    if (optionKeys[i] === 'skinColors') {
      const skinNames = ['Light', 'Tan', 'Dark', 'Pale', 'Blue', 'White', 'Green', 'Pink'];
      displayText = skinNames[currentVal] || String(currentVal);
    } else if (optionKeys[i] === 'hairColors') {
      const colorNames = ['Black', 'Red', 'Orange', 'Blonde', 'Green', 'Blue', 'Purple', 'Brown'];
      displayText = colorNames[currentVal] || String(currentVal);
    } else if (nameMap[optionKeys[i]] && nameMap[optionKeys[i]][currentVal]) {
      displayText = nameMap[optionKeys[i]][currentVal];
    }
    canvas.drawText({
      text: displayText,
      x: lp.x + 155,
      y: rowY + 3,
      color: '#000000',
      fontSize: 11,
      fontFamily: 'Arial',
      align: 'center',
    });

    // BtRight arrow
    try {
      const rightImg = newCharNode.nGet('BtRight').nGet('normal').nGet('0').nGetImage();
      if (rightImg) {
        const rbx = lp.x + 215;
        const rby = rowY + 1;
        canvas.drawImage({ img: rightImg, dx: rbx, dy: rby });

        if (clicked && mx >= rbx && mx <= rbx + 15 &&
            my >= rby && my <= rby + 16) {
          const o2 = this.newCharOptions;
          const arr = o2[optionKeys[i]] as number[];
          o2[indexKeys[i]] = ((o2[indexKeys[i]] as number) + 1) % arr.length;
          this.updateNewCharAppearance();
        }
      }
    } catch (e) {}
  }

  // ============ BOTTOM: OK + Cancel buttons ============
  try {
    const okNode = newCharNode.nGet('BtYes').nGet('normal').nGet('0');
    const okImg = okNode.nGetImage();
    const okW = (okNode as any).nWidth || 81;
    const okH = (okNode as any).nHeight || 41;
    if (okImg) {
      DebugDrag.register('btYes', 506, 434, okW, okH);
      const bp = DebugDrag.get('btYes');
      canvas.drawImage({ img: okImg, dx: bp.x, dy: bp.y });

      if (clicked && mx >= bp.x && mx <= bp.x + okW &&
          my >= bp.y && my <= bp.y + okH) {
        this.confirmCreateCharacter();
      }
    }
  } catch (e) {}

  try {
    const cancelNode = newCharNode.nGet('BtNo').nGet('normal').nGet('0');
    const cancelImg = cancelNode.nGetImage();
    const cancelW = (cancelNode as any).nWidth || 81;
    const cancelH = (cancelNode as any).nHeight || 41;
    if (cancelImg) {
      DebugDrag.register('btNo', 585, 434, cancelW, cancelH);
      const bp = DebugDrag.get('btNo');
      canvas.drawImage({ img: cancelImg, dx: bp.x, dy: bp.y });

      if (clicked && mx >= bp.x && mx <= bp.x + cancelW &&
          my >= bp.y && my <= bp.y + cancelH) {
        LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
      }
    }
  } catch (e) {}

  DebugDrag.drawAll(canvas);
};

UILogin.startSelectWorldChannelImgSlideIn = function () {
  const targetX = 0;
  this.selectWorldChannelImgAnimation = {
    active: true,
    type: 'slideIn',
    startTime: Date.now(),
    duration: 500,
    startX: targetX - 100,
    targetX: targetX,
    currentX: targetX,
    alpha: 0
  };
};

UILogin.startSelectWorldChannelImgFadeOut = function () {
  this.selectWorldChannelImgAnimation = {
    active: true,
    type: 'fadeOut',
    startTime: Date.now(),
    duration: 500,
    startX: 0,
    targetX: 0,
    currentX: 0,
    alpha: 1
  };
};

UILogin.startSelectCharacterImgSlideIn = function () {
  const targetX = 0;
  this.selectCharacterImgAnimation = {
    active: true,
    type: 'slideIn',
    startTime: Date.now(),
    duration: 500,
    startX: targetX - 100,
    targetX: targetX,
    currentX: targetX,
    alpha: 0
  };
};

UILogin.startSelectCharacterImgFadeOut = function () {
  this.selectCharacterImgAnimation = {
    active: true,
    type: 'fadeOut',
    startTime: Date.now(),
    duration: 500,
    startX: 0,
    targetX: 0,
    currentX: 0,
    alpha: 1
  };
};

UILogin.startSelectedWorldSlideIn = function () {
  const targetX = 0;
  this.selectedWorldImageAnimation = {
    active: true,
    type: 'slideIn',
    startTime: Date.now(),
    duration: 500,
    startX: targetX - 100,
    targetX: targetX,
    currentX: targetX,
    alpha: 0
  };
};

UILogin.stepImage = function (stepId: number) {
  const step = this.uiLogin.nGet('Common').nGet('step').nGet(stepId);
  if (step) {
    return step.nGetImage();
  }
  return null;
};

UILogin.showNotice = function (noticeType: NoticeType, noticeMessage: NoticeMessage | null) {
  if (!this.uiLoginNotice) {
    console.error('UILoginNotice is not initialized.');
    return;
  }
  this.uiLoginNotice.setIsHidden(false);
  this.uiLoginNotice.setNoticeType(noticeType);
  this.uiLoginNotice.setNoticeMessage(noticeMessage);
}

UILogin.showTOS = function () {
  if (!this.uiLoginTOS) {
    console.error('UILoginTOS is not initialized.');
    return;
  }
  this.uiLoginTOS.setIsHidden(false);
}

export default UILogin;
