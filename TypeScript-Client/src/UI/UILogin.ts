import WZManager from "../wz-utils/WZManager";
import UICommon from "./UICommon";
import PLAY_AUDIO from "../Audio/PlayAudio";
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
import UILoginNotice, { NoticeType, NoticeMessage } from './UILoginNotice';
import MySocket, { consumeDisconnected } from '../mysocket';
import UILoginTOS from './UILoginTOS';
import config from '../Config';
import MapleStandingCharacter from '../MapleStandingCharacter';
import DebugDrag from './DebugDrag';

interface UILoginInterface {
  uiLogin: WZNode;
  frameImg: any;
  // Sound.wz/Game.img/GameIn — plays as the world loads after you pick a
  // character, distinct from the UI.img/CharSelect click blip
  gameInAudio: any;
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
  createLoginInputs: (canvas: GameCanvas) => void;
  /** Log in with the current field values. Shared by the Log In button and
   *  by Enter in either credential field. Assigned during initialize(). */
  performLogin: (() => Promise<void>) | null;
  _loginInProgress: boolean;
  /** Timestamp of the last character-slot click, for double-click detection. */
  _lastCharClickTime: number;
  /** One-shot latch so a held double-click only enters the game once. */
  _enteringGame: boolean;
  /** True while the mouse is still held from a slot click already handled.
   *  canvas.clicked stays true for the whole press, so without this the slot
   *  handler re-runs every frame and frame 2 of an ordinary click looks like a
   *  double-click against frame 1 — a single click entered the game. */
  _slotClickHeld: boolean;
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
  loadCharactersFromServer: () => Promise<void>;
  createCharStage: 'raceSelect' | 'nameEntry' | 'charCustomize';
  selectedRace: 'normal' | 'knight' | 'aran';
  _drawRaceSelect: (canvas: any, mx: number, my: number, clicked: boolean, msPerTick: number) => void;
  _drawNameEntry: (canvas: any, mx: number, my: number, clicked: boolean) => void;
  _drawCharCustomize: (canvas: any, camera: any, mx: number, my: number, clicked: boolean, msPerTick: number, tdelta: number) => void;
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
  this.charAnimFrame = 0;
  this.charAnimDelay = 0;
  this.charSelected = false;
  this.charSelectEffectFrame = 0;
  this.charSelectEffectDelay = 0;
  this.charSelectScrollFrame = 0;
  this.charSelectScrollDelay = 0;
  this.charSelectScrollState = 'closed';
  this._loginInProgress = false;
  this._lastCharClickTime = 0;
  this._enteringGame = false;
  this.uiLogin = await WZManager.get('UI.wz/Login.img');

  // Load character select sound effect
  const uiSounds: any = await WZManager.get('Sound.wz/UI.img');
  this.charSelectAudio = uiSounds.CharSelect?.nGetAudio?.() || null;
  const gameSounds: any = await WZManager.get('Sound.wz/Game.img');
  this.gameInAudio = gameSounds?.GameIn?.nGetAudio?.() || null;

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

  this.createLoginInputs(canvas);

  const uiLoginRef = this;
  const startButton = new MapleStanceButton(canvas, {
    x: 205,
    y: -1360,
    img: this.uiLogin.nGet('CharSelect').nGet('BtSelect').nChildren,
    stance: 'disabled',
    onClick: async () => {
      if (!uiLoginRef.charSelected) return;
      const selectedChar = uiLoginRef.characters[uiLoginRef.selectedCharIndex];
      if (!selectedChar || !selectedChar._serverId) return;

      // Load full character data from server
      const result = await MySocket.selectCharacter(selectedChar._serverId);
      if (!result.success || !result.character) {
        console.error('Failed to select character:', result.error);
        return;
      }

      // Server accepted the character, so we're definitely entering the
      // world — play the log-in cue now, while the load runs, rather than
      // after it when the screen has already changed
      if (uiLoginRef.gameInAudio) PLAY_AUDIO(uiLoginRef.gameInAudio);

      const charData = result.character;
      const { default: MyChar, reviveOfflineDeath } = await import('../MyCharacter');
      // Died and closed the game before respawning → revive like the original
      // server does on load (50 HP at the death map's returnMap)
      await reviveOfflineDeath(charData);
      // Block saves until the full restore below succeeds — a save with a
      // half-restored character would wipe DB inventory/equips
      (MyChar as any)._restoreComplete = false;

      // Apply appearance
      MyChar.name = charData.name || 'Player';
      await MyChar.setSkinColor(charData.skin ?? 0);
      await MyChar.setFace(charData.face ?? 20000);
      await MyChar.setHair(charData.hair ?? 30030);

      // Apply stats
      MyChar.hp = charData.hp;
      MyChar.maxHp = charData.maxHp;
      MyChar.mp = charData.mp;
      MyChar.maxMp = charData.maxMp;
      MyChar.fame = charData.fame ?? 0;
      if (MyChar.stats) {
        MyChar.stats.level = charData.stats.level;
        MyChar.stats.str = charData.stats.str;
        MyChar.stats.dex = charData.stats.dex;
        MyChar.stats.int = charData.stats.int;
        MyChar.stats.luk = charData.stats.luk;
        MyChar.stats.abilityPoints = charData.stats.ap;
        MyChar.stats.maxHp = charData.stats.maxHp;
        MyChar.stats.maxMp = charData.stats.maxMp;
        MyChar.stats.setJobId(charData.stats.jobId);
        MyChar.job = charData.stats.jobId;
      }
      MyChar.exp = charData.exp ?? 0;
      const { default: ExpTable } = await import('../Constants/ExpTable');
      MyChar.maxExp = ExpTable.getExpNeededForLevel(charData.stats.level);
      MyChar.recalcLocalStats();

      // Apply equipped items — clear and reload from DB
      MyChar.equips = [];
      MyChar.equippedItemIds = {};
      if (charData.equipped) {
        for (const eq of charData.equipped) {
          try {
            await MyChar.attachEquip(eq.slot, eq.item_id);
            // Restore per-instance scroll data onto the worn slot
            if (eq.equip_data) {
              try {
                MyChar.equippedItemData[eq.slot] = JSON.parse(eq.equip_data);
              } catch { /* corrupt JSON — treat as fresh */ }
            }
            console.log('[Login] Equipped slot', eq.slot, 'item', eq.item_id);
          } catch (e) {
            console.error('[Login] Failed to equip slot', eq.slot, 'item', eq.item_id, e);
          }
        }
        MyChar.recalcLocalStats();
      }

      // Apply inventory
      if (MyChar.inventory && charData.inventory) {
        const Item = (await import('../Inventory/Item')).default;
        for (const tab of ['equip', 'use', 'setup', 'etc', 'cash'] as const) {
          const items = charData.inventory[tab] || [];
          // Place items at their saved slot index; keep holes as null
          const restored: any[] = new Array(items.length).fill(null);
          for (let slot = 0; slot < items.length; slot++) {
            const item = items[slot];
            if (item && item.itemId) {
              try {
                restored[slot] = await Item.fromOpts({
                  itemId: item.itemId,
                  quantity: item.quantity,
                  equipData: item.equipData ?? undefined,
                });
              } catch { /* skip failed items */ }
            }
          }
          (MyChar.inventory as any)[tab] = restored;
        }
        MyChar.inventory.mesos = charData.mesos ?? 0;
      }

      // Apply quests. Quest data must be loaded first: forceStartQuest reads
      // requirements to rebuild mob progress — with the data still loading it
      // restored nothing and seeded "not fulfilled", so the poll later saw a
      // false→true flip and popped "Quest completed" on every login.
      if (MyChar.questManager && charData.quests) {
        await MyChar.questManager.initialize();
        for (const q of charData.quests) {
          if (q.state === 2) {
            MyChar.questManager.forceCompleteQuest(q.quest_id, q.completed_at ?? 0);
          } else if (q.state === 1) {
            let mobProgress: Record<string, number> | undefined;
            try {
              if (q.mob_progress) mobProgress = JSON.parse(q.mob_progress);
            } catch {}
            MyChar.questManager.forceStartQuest(q.quest_id, mobProgress);
          }
        }
        // After every quest is back (prereq-quest ordering settled)
        MyChar.questManager.reseedFulfilled();
      }

      // Apply skills
      if (MyChar.skillManager && charData.skills) {
        MyChar.skillManager.deserialize(charData.skills);
      }

      // Apply hotkey bindings (skills + items)
      if (charData.keymap?.length) {
        const UIHotkeyBar = (await import('./UIHotkeyBar')).default;
        await UIHotkeyBar.deserialize(charData.keymap);
      }

      // Apply SP
      if (MyChar.stats && charData.stats?.spByTier) {
        // Per-tier split wins; the flat `sp` below is the pre-split fallback.
        MyChar.stats.spByTier = { ...charData.stats.spByTier };
      } else if (MyChar.stats && charData.stats?.sp !== undefined) {
        MyChar.stats.sp = charData.stats.sp;
      }

      // Store server character ID for saving later
      (MyChar as any)._serverCharId = charData.id;
      console.log('[Login] Set _serverCharId =', charData.id);
      // Set starting map from saved data
      (MyChar as any)._startMapId = charData.mapId;
      (MyChar as any)._startPosX = charData.posX;
      (MyChar as any)._startPosY = charData.posY;

      // Restore finished — saves are safe from here on
      (MyChar as any)._restoreComplete = true;

      // Save dev session for auto-login on HMR reload
      try {
        const { saveDevSession } = await import('../DevAutoLogin');
        saveDevSession(
          (uiLoginRef as any)._lastUsername || 'admin',
          (uiLoginRef as any)._lastPassword || 'admin',
          uiLoginRef.selectedWorldId || 0,
          selectedChar._serverId,
        );
      } catch {}

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
      if (!uiLoginRef.charSelected) return;
      const selectedChar = uiLoginRef.characters[uiLoginRef.selectedCharIndex];
      if (!selectedChar || !selectedChar._serverId) return;
      const result = await MySocket.deleteCharacter(selectedChar._serverId);
      if (result.success) {
        await uiLoginRef.loadCharactersFromServer();
      }
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
        const now = Date.now();
        const isDoubleClick = this.selectedChannelIndex === i && (now - (uiLoginRef._lastChannelClickTime || 0)) < 400;
        uiLoginRef._lastChannelClickTime = now;

        this.selectedChannelIndex = i;
        this.channelSelectAnimation = new FrameAnimation(
          this.uiLogin.nGet('WorldSelect')?.nGet('channel').nGet('chSelect'),
          -145 + col * 92 - 10,
          -620 + row * 30 - 10
        );
        this.channelSelectAnimation.active = true;

        if (isDoubleClick) {
          await uiLoginRef.loadCharactersFromServer();
          await LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
        }
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
      if (uiLoginRef.selectedChannelIndex === null) return;
      // Fetch characters for selected world from server
      await uiLoginRef.loadCharactersFromServer();
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

  // Extracted so Enter in either credential field submits the same way the
  // Log In button does (see createLoginInputs).
  this.performLogin = async () => {
    // Enter can repeat while a request is in flight, and the notice dialogs
    // below leave the fields focused — without this the user can queue up
    // several logins from one hold of the key.
    if (uiLoginRef._loginInProgress) return;

    const username = uiLoginRef.inputUsn?.input?.value?.trim() || '';
    const password = uiLoginRef.inputPwd?.input?.value || '';

    if (!username || !password) {
      uiLoginRef.showNotice(NoticeType.NORMAL, NoticeMessage.INCORRECT_LOGIN_ID);
      return;
    }

    uiLoginRef._loginInProgress = true;
    try {
      // Connect to server if not already connected
      try {
        await MySocket.connectForLogin();
      } catch {
        uiLoginRef.showNotice(NoticeType.NORMAL, NoticeMessage.UNABLE_TO_CONNECT_GAME_SERVER);
        return;
      }

      // Authenticate
      const result = await MySocket.sendLogin(username, password);
      if (!result.success) {
        uiLoginRef.showNotice(NoticeType.ABNORMAL, NoticeMessage.PASSWORD_IS_INCORRECT);
        return;
      }

      // Save credentials for dev auto-login
      (uiLoginRef as any)._lastUsername = username;
      (uiLoginRef as any)._lastPassword = password;

      // Login succeeded — proceed to world select
      await LoginState.switchToSubState(LoginSubState.WORLD_SELECT);
      viewAllCharacterButton.isHidden = false;
      channelBackButton.isHidden = false;
    } finally {
      uiLoginRef._loginInProgress = false;
    }
  };

  const loginButton = new MapleStanceButton(canvas, {
    x: 223,
    y: -85,
    img: this.uiLogin.nGet('Title').nGet('BtLogin').nChildren,
    onClick: async () => {
      await uiLoginRef.performLogin?.();
    },
  });

  ClickManager.addButton(loginButton);
  this.behindFrameButtons.push(loginButton);

  // Login screen buttons — use screen coords (isRelativeToCamera + isPartOfUI)
  this.loginScreenButtons = [];
  this.loginFadeIn = { startTime: Date.now(), delay: 500, duration: 1000 };
  const guestLoginButton = new MapleStanceButton(canvas, {
    x: 587,
    y: 260,
    img: this.uiLogin.nGet('Title').nGet('BtGuestLogin').nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      this.showNotice(NoticeType.NORMAL, NoticeMessage.TROUBLE_LOGGING_IN);
    },
  });

  ClickManager.addButton(guestLoginButton);
  this.loginScreenButtons.push(guestLoginButton);

  const saveLoginIdButton = new MapleStanceButton(canvas, {
    x: 383,
    y: 295,
    img: this.uiLogin.nGet('Title').nGet('BtLoginIDSave').nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {},
  });

  ClickManager.addButton(saveLoginIdButton);
  this.loginScreenButtons.push(saveLoginIdButton);

  const findLoginIdButton = new MapleStanceButton(canvas, {
    x: 483,
    y: 295,
    img: this.uiLogin.nGet('Title').nGet('BtLoginIDLost').nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      this.showNotice(NoticeType.NORMAL, NoticeMessage.TROUBLE_LOGGING_IN);
    },
  });

  ClickManager.addButton(findLoginIdButton);
  this.loginScreenButtons.push(findLoginIdButton);

  const findPwButton = new MapleStanceButton(canvas, {
    x: 588,
    y: 295,
    img: this.uiLogin.nGet('Title').nGet('BtPasswdLost').nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      this.showNotice(NoticeType.NORMAL, NoticeMessage.TROUBLE_LOGGING_IN);
    },
  });

  ClickManager.addButton(findPwButton);
  this.loginScreenButtons.push(findPwButton);

  const registerButton = new MapleStanceButton(canvas, {
    x: 384,
    y: 344,
    img: this.uiLogin.nGet('Title').nGet('BtNew').nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      this.showNotice(NoticeType.NORMAL, NoticeMessage.TROUBLE_LOGGING_IN);
    },
  });

  ClickManager.addButton(registerButton);
  this.loginScreenButtons.push(registerButton);

  const homepageButton = new MapleStanceButton(canvas, {
    x: 488,
    y: 344,
    img: this.uiLogin.nGet('Title').nGet('BtHomePage').nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      this.showNotice(NoticeType.NORMAL, NoticeMessage.TROUBLE_LOGGING_IN);
    },
  });

  ClickManager.addButton(homepageButton);
  this.loginScreenButtons.push(homepageButton);

  const quitButton = new MapleStanceButton(canvas, {
    x: 586,
    y: 344,
    img: this.uiLogin.nGet('Title').nGet('BtQuit').nChildren,
    isRelativeToCamera: true,
    isPartOfUI: true,
    onClick: () => {
      window.close();
    },
  });

  ClickManager.addButton(quitButton);
  this.loginScreenButtons.push(quitButton);

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

  // Plain world coordinates — FrameAnimation.draw already subtracts the camera.
  // This used to be `-830 - Camera.y`, which only ever worked on boot: main.ts
  // awaits the first setState before starting the game loop, so Camera.y was
  // still 0 and the term cancelled out. Returning here from the game (QUIT
  // GAME) runs initialize() while the loop is easing the camera, baking a
  // stale offset that laid the world-select scroll across the login screen.
  const dx = Math.floor(-215);
  const dy = Math.floor(-830);
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

  // Explain a lost connection that bounced the player back here. Done at the
  // end of initialize so uiLoginNotice exists, and guarded because nothing
  // about a notice should be able to stop the login screen coming up.
  try {
    if (consumeDisconnected()) {
      this.showNotice(NoticeType.NORMAL, NoticeMessage.UNABLE_TO_CONNECT_GAME_SERVER);
    }
  } catch (e) {
    console.error('Failed to show disconnect notice:', e);
  }
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

  // Draw login screen buttons (screen-coord based)
  if (LoginState.currentSubState === LoginSubState.LOGIN_SCREEN && this.loginScreenButtons) {
    this.loginScreenButtons.forEach((btn: any) => {
      btn.draw(canvas, camera, lag, msPerTick, tdelta);
    });
  }

  // Track the sign with the camera each frame — the camera eases and settles
  // a few px off its target, so static coords would drift. World anchors
  // measured against the live camera: ID recess (68,-67), PW recess (68,-37)
  if (LoginState.currentSubState === LoginSubState.LOGIN_SCREEN) {
    // Sits in the recess beside the "Login ID" / "Password" labels baked into
    // the sign. The label centres measure y=236 and y=266 on the rendered
    // canvas; the text rides 2px under that and inset from the recess edge,
    // which reads better against the wood than dead-centre does.
    this.inputUsn?.setCanvasPos(72 - Camera.x, -71 - Camera.y);
    this.inputPwd?.setCanvasPos(72 - Camera.x, -41 - Camera.y);
  }

  this.drawMask(canvas);

  // Fade in from black on initial load
  if (this.loginFadeIn) {
    const elapsed = Date.now() - this.loginFadeIn.startTime - this.loginFadeIn.delay;
    const alpha = elapsed < 0 ? 1 : 1 - Math.min(elapsed / this.loginFadeIn.duration, 1);
    if (alpha > 0) {
      const ctx = canvas.context;
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.globalAlpha = alpha;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    } else {
      this.loginFadeIn = null;
    }
  }

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

// Field positions measured from the live canvas (getImageData): the sign's
// "Login ID" label text renders at canvas (401,206), putting the input
// recesses at x=457.., ID row y=205-226, PW row y=235-256.
// Called from initialize() and again when returning to the login screen —
// leaving it calls removeInputs(), so the fields must be recreated.
UILogin.createLoginInputs = function (canvas: GameCanvas) {
  if (this.inputUsn || this.inputPwd) return;
  // Enter in either field logs in. Resolved at keypress time rather than
  // captured here: initialize() creates the inputs before it assigns
  // performLogin, so the reference would be null if we read it now.
  const submit = () => {
    void this.performLogin?.();
  };
  this.inputUsn = new MapleInput(canvas, {
    x: 459,
    y: 207,
    width: 170,
    height: 18,
    color: "#ffffff",
    submitListeners: [submit],
  });
  this.inputPwd = new MapleInput(canvas, {
    x: 459,
    y: 237,
    width: 170,
    height: 18,
    color: "#ffffff",
    type: "password",
    submitListeners: [submit],
  });
};

UILogin.removeInputs = function () {
  if (this.inputUsn) this.inputUsn.remove();
  if (this.inputPwd) this.inputPwd.remove();
  this.inputUsn = null;
  this.inputPwd = null;
};

UILogin.drawCharacterSelect = function (canvas, camera, lag, msPerTick, tdelta) {
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
        // Empty slot — glow (character/0) + ghost placeholder (character/1/0).
        // Both are bottom-center anchored in the WZ data, so drawing them at
        // the slot anchor puts their feet exactly where a created character
        // stands — no per-slot fudge offsets.
        const charGlowNode = charSelectNode.nGet('character').nGet('0');
        const glowFrames = charGlowNode.nChildren;
        const glowFrame = this.charAnimFrame % glowFrames.length;
        const gf = glowFrames[glowFrame];
        if (gf) {
          const gfImg = gf.nGetImage();
          const gox = gf.origin ? gf.origin.nGet('nX', 0) : 0;
          const goy = gf.origin ? gf.origin.nGet('nY', 0) : 0;
          canvas.drawImage({
            img: gfImg,
            dx: slotX - gox,
            dy: slotY - goy,
          });
        }

        // Draw character/1/0 placeholder on top of glow
        const emptySlotNode = charSelectNode.nGet('character').nGet('1').nGet('0');
        if (emptySlotNode) {
          const emptyImg = emptySlotNode.nGetImage();
          const eox = emptySlotNode.origin ? emptySlotNode.origin.nGet('nX', 0) : 0;
          const eoy = emptySlotNode.origin ? emptySlotNode.origin.nGet('nY', 0) : 0;
          DebugDrag.register(`emptySlot${i}`, slotX - eox, slotY - eoy, emptyImg.width || 51, emptyImg.height || 71);
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

    // Click detection — check if mouse clicked on any slot.
    // Edge-triggered: canvas.clicked is true from mousedown right through to
    // mouseup, so this must fire once per press. Left level-triggered, frame 2
    // of an ordinary click saw the selection frame 1 had just made and scored
    // it as a double-click, so one click selected and entered in ~16ms.
    if (!canvas.clicked) {
      this._slotClickHeld = false;
    } else if (!this._slotClickHeld) {
      this._slotClickHeld = true;
      const mx = canvas.mouseX;
      const my = canvas.mouseY;
      for (let i = 0; i < TOTAL_SLOTS; i++) {
        const slotX = charScreenX + i * CHAR_SLOT_SPACING;
        if (mx >= slotX - 30 && mx <= slotX + 30 &&
            my >= charScreenY - 60 && my <= charScreenY + 10) {
          if (i < this.characters.length) {
            // Second click on the already-selected slot enters the game, the
            // same as the world list's double-click. Reuses the Start button's
            // handler so both routes stay in step.
            const now = Date.now();
            const isDoubleClick =
              this.charSelected &&
              this.selectedCharIndex === i &&
              now - (this._lastCharClickTime || 0) < 400;
            this._lastCharClickTime = now;

            if (isDoubleClick) {
              // canvas.clicked stays true for as long as the button is held, so
              // this block runs on every render frame of a single click. Latch
              // it — without this, one double-click fires selectCharacter() and
              // enterGame() once per frame (observed: 5 map loads from a 60ms
              // hold). The latch is cleared when character select is re-entered.
              if (!this._enteringGame && this.startButton && this.startButton.stance !== 'disabled') {
                this._enteringGame = true;
                void this.startButton.onClick(this.startButton);
              }
              break;
            }

            // Deselect previous
            if (this.charSelected && this.selectedCharIndex !== i) {
              this.characters[this.selectedCharIndex]?.setStance('stand1', 0, true);
            }
            this.selectedCharIndex = i;
            this.charSelected = true;
            if (this.charSelectAudio) PLAY_AUDIO(this.charSelectAudio);
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
          const ciX = Math.floor(scrollX + (scrollImg.width - (charInfoImg?.width || 183)) / 2);
          const ciY = scrollY + 30;
          if (charInfoImg) {
            canvas.drawImage({ img: charInfoImg, dx: ciX, dy: ciY });
          }

          // Draw stat values only (labels are baked into charInfo2 image).
          // Card layout (183x115): row 0 JOB full-width; row 1 LV.+FAME;
          // row 2 STR+INT; row 3 DEX+LUK. Rows ~14.5px apart, value areas
          // at x+44 (left) and x+136 (right)
          const stats = char.stat;
          const leftX = ciX + 44;
          const rightX = ciX + 136;

          // Left column values: Job, Level, STR, DEX
          const leftValues = [
            `${stats?.job || 'Beginner'}`,
            `${stats?.level || 1}`,
            `${stats?.str || 4}`,
            `${stats?.dex || 4}`,
          ];
          // Right column values: (JOB row has none), Fame, INT, LUK
          const rightValues = [
            '',
            `${stats?.fame ?? 0}`,
            `${stats?.int || 4}`,
            `${stats?.luk || 4}`,
          ];

          leftValues.forEach((val, i) => {
            canvas.drawText({ text: val, x: leftX, y: ciY + 8 + Math.round(i * 14.5), color: '#000000', fontSize: 11, fontFamily: 'Arial' });
          });
          rightValues.forEach((val, i) => {
            if (!val) return;
            canvas.drawText({ text: val, x: rightX, y: ciY + 8 + Math.round(i * 14.5), color: '#000000', fontSize: 11, fontFamily: 'Arial' });
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
  this._checkingName = false;
  this.createCharStage = 'raceSelect';
  this.selectedRace = 'normal';
  DebugDrag.clear();

  // Hide all login UI buttons so they don't interfere with create char UI
  this.inFrontOfFrameButtons.forEach((btn: any) => { btn.isHidden = true; });
  this.behindFrameButtons.forEach((btn: any) => { btn.isHidden = true; });

  // v83 Beginner starter options
  this.newCharOptions = {
    faces: [20000, 20001, 20002],
    hairs: [30030, 30020, 30000],
    hairColors: [0, 1, 2, 3, 4, 5, 6, 7],
    skinColors: [0, 1, 2, 3, 4, 5, 9],
    tops: [1040002, 1040006, 1040010],
    bottoms: [1060002, 1060006],
    shoes: [1072001, 1072005, 1072037, 1072038],
    weapons: [1302000, 1322005, 1312004],
    faceIndex: 0,
    hairIndex: 0,
    hairColorIndex: 0,
    skinIndex: 0,
    topIndex: 0,
    bottomIndex: 0,
    shoesIndex: 0,
    weaponIndex: 0,
    gender: 0,
  };

  // Keyboard handler for name input (only active in nameEntry and charCustomize stages)
  this._createCharKeyHandler = (e: KeyboardEvent) => {
    if (this.createCharStage === 'raceSelect') return;
    if (this.createCharStage !== 'nameEntry' && this.createCharStage !== 'charCustomize') return;

    if (e.key === 'Backspace') {
      this.newCharName = this.newCharName.slice(0, -1);
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Enter') {
      // Only confirm on Enter in charCustomize stage
      if (this.createCharStage === 'charCustomize' && this.newCharName.trim().length > 0) {
        this.confirmCreateCharacter();
      } else if (this.createCharStage === 'nameEntry' && this.newCharName.trim().length > 0 && !this._checkingName) {
        this._checkingName = true;
        const name = this.newCharName.trim();
        MySocket.checkName(this.selectedWorldId ?? 0, name).then((result: any) => {
          this._checkingName = false;
          if (!result.valid) {
            this.showNotice(NoticeType.NORMAL, NoticeMessage.CANNOT_USE_NAME);
          } else if (result.taken) {
            this.showNotice(NoticeType.NORMAL, NoticeMessage.NAME_IN_USE);
          } else {
            this.createCharStage = 'charCustomize';
            const o = this.newCharOptions;
            MapleStandingCharacter.fromAppearance({
              name: this.newCharName,
              skinColor: o.skinColors[0],
              hairId: o.hairs[0] + o.hairColors[0],
              faceId: o.faces[0],
              flipped: true,
              equipIds: [o.tops[0], o.bottoms[0], o.shoes[0], o.weapons?.[0]].filter(Boolean),
            }).then((ch: any) => { this.newChar = ch; }).catch(() => {});
          }
        }).catch(() => { this._checkingName = false; });
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Escape') {
      if (this.createCharStage === 'charCustomize') {
        this.createCharStage = 'nameEntry';
      } else if (this.createCharStage === 'nameEntry') {
        this.createCharStage = 'raceSelect';
      } else {
        LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key) && this.newCharName.length < 12) {
      this.newCharName += e.key;
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', this._createCharKeyHandler, true);
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

UILogin.confirmCreateCharacter = async function () {
  if (this.characters.length >= 3) return;
  // Use default name if none entered
  if (!this.newCharName || this.newCharName.trim().length === 0) {
    this.showNotice(NoticeType.NORMAL, NoticeMessage.CANNOT_USE_NAME);
    return;
  }
  const o = this.newCharOptions;
  const name = this.newCharName.trim();
  const hair = o.hairs[o.hairIndex] + o.hairColors[o.hairColorIndex];
  const face = o.faces[o.faceIndex];
  const skin = o.skinColors[o.skinIndex];

  // Save to server with selected equipment
  const result = await MySocket.createCharacter({
    worldId: this.selectedWorldId ?? 0,
    name,
    hair,
    face,
    skin,
    gender: 0,
    equips: [
      { slot: 4, itemId: o.tops[o.topIndex] },
      { slot: 5, itemId: o.bottoms[o.bottomIndex] },
      { slot: 6, itemId: o.shoes[o.shoesIndex] },
      { slot: 10, itemId: o.weapons?.[o.weaponIndex] },
    ].filter(e => e.itemId),
  });

  if (!result.success) {
    if (result.error?.includes('name already taken')) {
      this.showNotice(NoticeType.NORMAL, NoticeMessage.NAME_IN_USE);
    } else {
      this.showNotice(NoticeType.NORMAL, NoticeMessage.CANNOT_USE_NAME);
    }
    return;
  }

  // Reload characters from server and go back to select screen
  await this.loadCharactersFromServer();
  LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
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
      o.weapons?.[o.weaponIndex],
    ].filter(Boolean));
  } catch (e) {}
  this._appearanceUpdating = false;
};

UILogin.drawCreateCharacter = function (canvas: any, camera: any, lag: number, msPerTick: number, tdelta: number) {

  const mx = canvas.mouseX;
  const my = canvas.mouseY;
  const rawClick = canvas.clicked || canvas.wasClicked;
  const clicked = rawClick && !this._clickConsumed;
  if (clicked) this._clickConsumed = true;
  if (!rawClick) this._clickConsumed = false;

  switch (this.createCharStage) {
    case 'raceSelect':
      this._drawRaceSelect(canvas, mx, my, clicked, msPerTick);
      break;
    case 'nameEntry':
      this._drawNameEntry(canvas, mx, my, clicked);
      break;
    case 'charCustomize':
      this._drawCharCustomize(canvas, camera, mx, my, clicked, msPerTick, tdelta);
      break;
  }

  DebugDrag.drawAll(canvas);
};

// ============ STAGE 1: Race Selection ============
UILogin._drawRaceSelect = function (canvas: any, mx: number, my: number, clicked: boolean, msPerTick: number) {
  const raceNode = this.uiLogin.nGet('RaceSelect');

  // "Choose Character Type" header
  try {
    const headerImg = raceNode.nGet('textGL').nGet('0').nGetImage();
    if (headerImg) {
      canvas.drawImage({ img: headerImg, dx: 300, dy: 55 });
    }
  } catch (e) {}

  // Three race buttons
  const races = [
    { key: 'knight', btnKey: 'BtKnight', x: 75, y: 110, w: 209, h: 219 },
    { key: 'normal', btnKey: 'BtNormal', x: 290, y: 110, w: 223, h: 221 },
    { key: 'aran', btnKey: 'BtAran', x: 520, y: 110, w: 181, h: 222 },
  ];

  for (const race of races) {
    try {
      const raceGroup = raceNode.nGet(race.key);
      const isSelected = this.selectedRace === race.key;

      // Draw button image (colored if selected, normal otherwise)
      if (isSelected) {
        const onImg = raceGroup.nGet('OnAnimation').nGet('0').nGetImage();
        if (onImg) canvas.drawImage({ img: onImg, dx: race.x, dy: race.y });
      } else {
        const btnImg = raceGroup.nGet(race.btnKey).nGet('normal').nGet('0').nGetImage();
        if (btnImg) canvas.drawImage({ img: btnImg, dx: race.x, dy: race.y, alpha: 0.5 });
      }

      // Click detection
      if (clicked && mx >= race.x && mx <= race.x + race.w &&
          my >= race.y && my <= race.y + race.h) {
        this.selectedRace = race.key;
      }
    } catch (e) {}
  }

  // Description panel for selected race
  try {
    const textImg = raceNode.nGet(this.selectedRace).nGet('text').nGet('0').nGetImage();
    if (textImg) {
      canvas.drawImage({ img: textImg, dx: 100, dy: 340 });
    }
  } catch (e) {}

  // "Select >>" button
  try {
    const selectImg = raceNode.nGet('BtSelect').nGet('normal').nGet('0').nGetImage();
    if (selectImg) {
      const sx = 512, sy = 451;
      canvas.drawImage({ img: selectImg, dx: sx, dy: sy });

      if (clicked && mx >= sx && mx <= sx + 73 && my >= sy && my <= sy + 29) {
        if (this.selectedRace === 'normal') {
          // Proceed to name entry for Explorers
          this.createCharStage = 'nameEntry';
          this.newCharName = '';
        } else {
          // Show "not available" notice for other races
          this.showNotice(NoticeType.NORMAL, NoticeMessage.AN_ERROR_OCCURRED);
        }
      }
    }
  } catch (e) {}

};

// ============ STAGE 2: Name Entry ============
UILogin._drawNameEntry = function (canvas: any, mx: number, my: number, clicked: boolean) {
  const newCharNode = this.uiLogin.nGet('NewChar');

  // Character preview on platform
  if (this.newChar && this.newChar.baseBody) {
    try {
      const drawableFrames = this.newChar.getDrawableFrames(this.newChar.stance, this.newChar.frame, this.newChar.flipped);
      const cp = { x: 385, y: 357 };
      drawableFrames.forEach((f: any) => {
        canvas.drawImage({
          img: f.img,
          dx: Math.floor(cp.x + f.x),
          dy: Math.floor(cp.y + f.y),
          flipped: true,
        });
      });
    } catch (e) {}
  } else if (!this.newChar) {
    const o = this.newCharOptions;
    MapleStandingCharacter.fromAppearance({
      name: '',
      skinColor: o.skinColors[0],
      hairId: o.hairs[0] + o.hairColors[0],
      faceId: o.faces[0],
      flipped: true,
      equipIds: [o.tops[0], o.bottoms[0], o.shoes[0], o.weapons?.[0]].filter(Boolean),
    }).then((ch: any) => { this.newChar = ch; }).catch(() => {});
  }

  // "NAME OF CHARACTER" wooden sign (201x224)
  const sp = { x: 484, y: 116 };
  try {
    const charNameImg = newCharNode.nGet('charName').nGetImage();
    if (charNameImg) {
      canvas.drawImage({ img: charNameImg, dx: sp.x, dy: sp.y });
    }
  } catch (e) {}

  // Name text input on the sign
  const nameDisplay = (this.newCharName || '') + '_';
  canvas.drawText({
    text: nameDisplay,
    x: sp.x + 100,
    y: 224,
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'Arial',
    align: 'center',
  });

  // OK button
  try {
    const okImg = newCharNode.nGet('BtYes').nGet('normal').nGet('0').nGetImage();
    if (okImg) {
      const bp = { x: 519, y: 294 };
      canvas.drawImage({ img: okImg, dx: bp.x, dy: bp.y });

      if (clicked && mx >= bp.x && mx <= bp.x + 81 && my >= bp.y && my <= bp.y + 41) {
        if (this.newCharName.trim().length > 0 && !this._checkingName) {
          this._checkingName = true;
          const name = this.newCharName.trim();
          MySocket.checkName(this.selectedWorldId ?? 0, name).then((result: any) => {
            this._checkingName = false;
            if (!result.valid) {
              this.showNotice(NoticeType.NORMAL, NoticeMessage.CANNOT_USE_NAME);
            } else if (result.taken) {
              this.showNotice(NoticeType.NORMAL, NoticeMessage.NAME_IN_USE);
            } else {
              this.createCharStage = 'charCustomize';
              const o = this.newCharOptions;
              MapleStandingCharacter.fromAppearance({
                name: this.newCharName,
                skinColor: o.skinColors[0],
                hairId: o.hairs[0] + o.hairColors[0],
                faceId: o.faces[0],
                flipped: true,
                equipIds: [o.tops[0], o.bottoms[0], o.shoes[0], o.weapons?.[0]].filter(Boolean),
              }).then((ch: any) => { this.newChar = ch; }).catch(() => {});
            }
          }).catch(() => { this._checkingName = false; });
        } else if (this.newCharName.trim().length === 0) {
          this.showNotice(NoticeType.NORMAL, NoticeMessage.CANNOT_USE_NAME);
        }
      }
    }
  } catch (e) {}

  // Cancel button
  try {
    const cancelImg = newCharNode.nGet('BtNo').nGet('normal').nGet('0').nGetImage();
    if (cancelImg) {
      const bp = { x: 598, y: 294 };
      canvas.drawImage({ img: cancelImg, dx: bp.x, dy: bp.y });

      if (clicked && mx >= bp.x && mx <= bp.x + 81 && my >= bp.y && my <= bp.y + 41) {
        this.createCharStage = 'raceSelect';
      }
    }
  } catch (e) {}
};

// ============ STAGE 3: Character Customization ============
UILogin._drawCharCustomize = function (canvas: any, camera: any, mx: number, my: number, clicked: boolean, msPerTick: number, tdelta: number) {
  const newCharNode = this.uiLogin.nGet('NewChar');

  // Character preview on platform
  if (this.newChar && this.newChar.baseBody) {
    try {
      const drawableFrames = this.newChar.getDrawableFrames(this.newChar.stance, this.newChar.frame, this.newChar.flipped);
      const charX = 385, charY = 357;
      drawableFrames.forEach((f: any) => {
        canvas.drawImage({
          img: f.img,
          dx: Math.floor(charX + f.x),
          dy: Math.floor(charY + f.y),
          flipped: true,
        });
      });
    } catch (e) {}
  }

  // "CHARACTER SETTINGS" panel (charSet: 225x377)
  const panelX = 484, panelY = 116;
  try {
    const charSetImg = newCharNode.nGet('charSet').nGetImage();
    if (charSetImg) {
      canvas.drawImage({ img: charSetImg, dx: panelX, dy: panelY });
    }
  } catch (e) {}

  // Appearance rows on the charSet panel
  const rowLabels = ['FACE', 'HAIR STYLE', 'HAIR COLOR', 'SKIN COLOR', 'TOP', 'BOTTOM', 'SHOES', 'WEAPON', 'GENDER'];
  const indexKeys = ['faceIndex', 'hairIndex', 'hairColorIndex', 'skinIndex', 'topIndex', 'bottomIndex', 'shoesIndex', 'weaponIndex', 'gender'];
  const optionKeys = ['faces', 'hairs', 'hairColors', 'skinColors', 'tops', 'bottoms', 'shoes', 'weapons', null];
  // Exact row Y positions from debug
  const rowPositions = [217, 238, 257, 273, 295, 314, 333, 350, 369];
  const ROW_X = 496;

  const nameMap: Record<string, Record<number, string>> = {
    faces: { 20000: 'Male 2 (Black)', 20001: 'Male 1 (Brown)', 20002: 'Male 3 (Blue)', 21000: 'Female 1 (Black)', 21001: 'Female 2 (Brown)', 21002: 'Female 3 (Blue)' },
    hairs: { 30030: 'Buzz Hair', 30020: 'Sammy', 30000: 'Toben', 31000: 'Angelica', 31010: 'Ariel', 31020: 'Connie' },
    tops: { 1040002: 'White Undershirt', 1040006: 'Undershirt', 1040010: 'Grey T-Shirt' },
    bottoms: { 1060002: 'Blue Jean Shorts', 1060006: 'Red-Striped Shorts' },
    shoes: { 1072001: 'Red Rubber Boots', 1072005: 'Leather Sandals', 1072037: 'Yellow Sneakers', 1072038: 'Blue Sneakers' },
    weapons: { 1302000: 'Sword', 1322005: 'Wooden Club', 1312004: 'Long Sword' },
  };

  for (let i = 0; i < rowLabels.length; i++) {
    const rp = { x: ROW_X, y: rowPositions[i] };
    try {
      const rowBgImg = newCharNode.nGet('avatarSel').nGet(String(i)).nGet('normal').nGetImage();
      if (rowBgImg) {
        canvas.drawImage({ img: rowBgImg, dx: rp.x, dy: rp.y });
      }
    } catch (e) {}

    // Get current value display text
    let displayText = '';
    if (i === 8) {
      // Gender row
      displayText = this.newCharOptions.gender === 0 ? 'Male' : 'Female';
    } else {
      const o = this.newCharOptions;
      const currentIdx = o[indexKeys[i]] as number;
      const optKey = optionKeys[i];
      if (optKey) {
        const currentVal = (o[optKey] as number[])[currentIdx];
        if (optKey === 'skinColors') {
          const skinMap: Record<number, string> = { 0: 'Light', 1: 'Tan', 2: 'Dark', 3: 'Pale', 4: 'Blue', 5: 'White', 9: 'Mercedes' };
          displayText = skinMap[currentVal] || String(currentVal);
        } else if (optKey === 'hairColors') {
          displayText = ['Black', 'Red', 'Orange', 'Blonde', 'Green', 'Blue', 'Purple', 'Brown'][currentVal] || String(currentVal);
        } else if (nameMap[optKey] && nameMap[optKey][currentVal]) {
          displayText = nameMap[optKey][currentVal];
        } else {
          displayText = String(currentVal);
        }
      }
    }

    // Left arrow
    try {
      const leftImg = newCharNode.nGet('BtLeft').nGet('normal').nGet('0').nGetImage();
      if (leftImg) {
        const lx = rp.x + 77, ly = rp.y + 1;
        canvas.drawImage({ img: leftImg, dx: lx, dy: ly });

        if (clicked && mx >= lx && mx <= lx + 15 && my >= ly && my <= ly + 16) {
          if (i === 8) {
            this.newCharOptions.gender = this.newCharOptions.gender === 0 ? 1 : 0;
            // Switch face/hair options for gender
            if (this.newCharOptions.gender === 0) {
              this.newCharOptions.faces = [20000, 20001, 20002];
              this.newCharOptions.hairs = [30030, 30020, 30000];
            } else {
              this.newCharOptions.faces = [21000, 21001, 21002];
              this.newCharOptions.hairs = [31000, 31010, 31020];
            }
            this.newCharOptions.faceIndex = 0;
            this.newCharOptions.hairIndex = 0;
            this.updateNewCharAppearance();
          } else if (optionKeys[i]) {
            const o = this.newCharOptions;
            const arr = o[optionKeys[i]!] as number[];
            o[indexKeys[i]] = ((o[indexKeys[i]] as number) - 1 + arr.length) % arr.length;
            this.updateNewCharAppearance();
          }
        }
      }
    } catch (e) {}

    // Selection text
    canvas.drawText({
      text: displayText,
      x: rp.x + 137,
      y: rp.y + 2,
      color: '#000000',
      fontSize: 11,
      fontFamily: 'Arial',
      align: 'center',
    });

    // Right arrow
    try {
      const rightImg = newCharNode.nGet('BtRight').nGet('normal').nGet('0').nGetImage();
      if (rightImg) {
        const rx = rp.x + 187, ry = rp.y + 1;
        canvas.drawImage({ img: rightImg, dx: rx, dy: ry });

        if (clicked && mx >= rx && mx <= rx + 15 && my >= ry && my <= ry + 16) {
          if (i === 8) {
            this.newCharOptions.gender = this.newCharOptions.gender === 0 ? 1 : 0;
            // Switch face/hair options for gender
            if (this.newCharOptions.gender === 0) {
              this.newCharOptions.faces = [20000, 20001, 20002];
              this.newCharOptions.hairs = [30030, 30020, 30000];
            } else {
              this.newCharOptions.faces = [21000, 21001, 21002];
              this.newCharOptions.hairs = [31000, 31010, 31020];
            }
            this.newCharOptions.faceIndex = 0;
            this.newCharOptions.hairIndex = 0;
            this.updateNewCharAppearance();
          } else if (optionKeys[i]) {
            const o = this.newCharOptions;
            const arr = o[optionKeys[i]!] as number[];
            o[indexKeys[i]] = ((o[indexKeys[i]] as number) + 1) % arr.length;
            this.updateNewCharAppearance();
          }
        }
      }
    } catch (e) {}
  }

  // OK button
  try {
    const okImg = newCharNode.nGet('BtYes').nGet('normal').nGet('0').nGetImage();
    if (okImg) {
      const okp = { x: 516, y: 447 };
      canvas.drawImage({ img: okImg, dx: okp.x, dy: okp.y });

      if (clicked && mx >= okp.x && mx <= okp.x + 81 && my >= okp.y && my <= okp.y + 41) {
        this.confirmCreateCharacter();
      }
    }
  } catch (e) {}

  // Cancel button
  try {
    const cancelImg = newCharNode.nGet('BtNo').nGet('normal').nGet('0').nGetImage();
    if (cancelImg) {
      const cnp = { x: 590, y: 447 };
      canvas.drawImage({ img: cancelImg, dx: cnp.x, dy: cnp.y });

      if (clicked && mx >= cnp.x && mx <= cnp.x + 81 && my >= cnp.y && my <= cnp.y + 41) {
        LoginState.switchToSubState(LoginSubState.CHARACTER_SELECT);
      }
    }
  } catch (e) {}

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

UILogin.loadCharactersFromServer = async function () {
  const worldId = this.selectedWorldId ?? 0;
  const result = await MySocket.getCharacters(worldId);
  const charList = result.characters || [];

  // Build MapleStandingCharacter array from server data
  this.characters = [];
  this.selectedCharIndex = 0;
  this.charSelected = false;
  this._lastCharClickTime = 0;
  this._enteringGame = false;
  this._slotClickHeld = false;

  for (const c of charList) {
    try {
      // Map equipped items to equip IDs array
      const equipIds = (c.equipped || []).map((eq: any) => eq.item_id);
      const ch = await MapleStandingCharacter.fromAppearance({
        name: c.name,
        skinColor: c.skin ?? 0,
        hairId: c.hair ?? 30030,
        faceId: c.face ?? 20000,
        flipped: true,
        equipIds,
      });
      // Store server ID and stats on the character for select/delete and info card
      (ch as any)._serverId = c.id;
      (ch as any).stat = {
        job: (await import('../Constants/Jobs')).getJobNameById(c.job_id ?? 0),
        level: c.level,
        str: c.str,
        dex: c.dex,
        int: c.int,
        luk: c.luk,
        fame: c.fame ?? 0,
      };
      this.characters.push(ch);
    } catch (e) {
      console.error('Failed to load character preview:', c.name, e);
    }
  }
};

UILogin.showNotice = function (noticeType: NoticeType, noticeMessage: NoticeMessage | null) {
  if (!this.uiLoginNotice) {
    console.error('UILoginNotice is not initialized.');
    return;
  }
  // Hide HTML inputs so they don't render on top of the notice
  if (this.inputUsn?.input) this.inputUsn.input.style.visibility = 'hidden';
  if (this.inputPwd?.input) this.inputPwd.input.style.visibility = 'hidden';
  this.uiLoginNotice.okHandler = () => {
    if (this.inputUsn?.input) this.inputUsn.input.style.visibility = 'visible';
    if (this.inputPwd?.input) this.inputPwd.input.style.visibility = 'visible';
  };
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
