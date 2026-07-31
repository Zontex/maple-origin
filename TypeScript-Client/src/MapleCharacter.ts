import WZManager from "./wz-utils/WZManager";
import GUIUtil from "./GuiUtils";
import PLAY_AUDIO from "./Audio/PlayAudio";
import { Physics } from "./Physics";
import Stance from "./Constants/enums/Stance";
import {
  areAnyRectanglesOverlapping,
  areRectanglesOverlappingWithMinOverlap,
  findMaxXY,
  findMinXY,
  isPositionInsideRect,
  isPositionInsideRectByConrners,
} from "./Physics/Collision";
import ClimbDirections from "./Constants/enums/ClimbDirections";
import getEquipTypeById, {
  WeaponType,
  getWeaponConfig,
  DEFAULT_PROJECTILE_ID,
  playAudioForAttackByWeaponType,
} from "./Constants/EquipType";
import ExpTable from "./Constants/ExpTable";
import Projectile from "./Projectile/Projectile";
import DamageIndicator, {
  DamageIndicatorType,
} from "./Effects/DamageIndicator";
import { AttackType } from "./Constants/AttackType";
import Inventory from "./Inventory/Inventory";
import Stats, { DamageRange } from "./Stats/Stats";
import { BOOSTER_SKILL_IDS } from "./Constants/CombatSkills";
import { MapleMap } from "./MapleMap";
import Monster from "./Monster";
import Portal from "./Portal";
import DropItemSprite from "./DropItem/DropItemSprite";
import GameCanvas from "./GameCanvas";
import { CameraInterface } from "./Camera";

// Played the moment a quest's requirements are met — killing the 10th of 10
// snails — alongside the red balloon. This is "quest finished", which in GMS
// is a separate cue from "quest cleared" (turning it in at the NPC), the
// latter being QuestClear plus the over-the-character effect.
const FULFILLED_SOUND = "Sound.wz/UI.img/Invite";

// Standing height of a v83 character sprite, used as the vertical extent of
// a melee swing
const ATTACK_BODY_H = 60;

// Touch-damage hitbox: a slim fixed box around the body, anchored at the
// foothold contact point, like the original client. The old check used the
// union of every drawn body-part sprite (body, head, hair — including their
// transparent padding), which made the effective hitbox far wider than the
// character and mobs "hit" before visually touching.
const TOUCH_HALF_W = 15;
const TOUCH_H = 55;

// Nudge for the chair's base relative to the character's foothold contact
// point. Positive sinks it into the floor, negative lifts it.
const CHAIR_BASE_OFFSET = 0;

// How far past the end of a ladder or rope counts as still touching it. Used
// asymmetrically when grabbing (see checkForLadder) and as the overshoot that
// carries the character over the lip of the platform when they reach the top.
const GRAB_SLACK = 5;

class MapleCharacter {
  opts: any;
  active: boolean = true;
  skinColor: number = 0;
  stance: string = "stand1";
  frame: number = 0;
  delay: number = 0;
  nextDelay: number = 0;
  useStanceUntilMaxFrame: boolean = false;
  stanceMaxTime: number = 0;
  isOscillateFrames: boolean = false;
  oscillateFactor: number = 1;
  head: any = null;
  body: any = null;
  baseBody: any = null;
  hair: any = null;
  Face: any = null;
  face: number = 20000;
  
  // Chat balloon properties
  chatBalloon: any = null; // Will hold the balloon image parts
  chatMessage: string = ""; // Current chat message
  showChatBalloon: boolean = false; // Whether to show the balloon
  chatBalloonTimer: number = 0; // Timer to track balloon display duration
  chatBalloonDuration: number = 5000; // Show chat balloon for 5 seconds
  faceExpr: string = "blink";
  faceFrame: number = 0;
  faceDelay: number = 0;
  faceNextDelay: number = 0;
  equips: any = [];
  equippedItemIds: Record<number, number> = {};
  equippedItemIcons: Record<number, HTMLImageElement | null> = {};
  // Per-slot instance data (scroll bonuses/tuc) for worn equips
  equippedItemData: Record<number, { bonus: Record<string, number>; tuc: number; level: number }> = {};
  // Default underwear WZ nodes — v83 characters are never fully naked
  underwearTop: any = null;
  underwearBottom: any = null;
  flipped: boolean = false;
  id: number = 0;
  name: string = "";
  gender: number = 0;
  // hp/mp are accessors so every change — damage, potions, chairs, scripts —
  // schedules a save for the LOCAL player. Remote players' mirrors change
  // constantly from network state and must not trigger saves.
  private _hp: number = 100;
  get hp(): number {
    return this._hp;
  }
  set hp(v: number) {
    if (v === this._hp) return;
    this._hp = v;
    if (!this.isRemote) (window as any).__mySocket?.requestSave?.();
  }
  maxHp: number = 100;
  private _mp: number = 100;
  get mp(): number {
    return this._mp;
  }
  set mp(v: number) {
    if (v === this._mp) return;
    this._mp = v;
    if (!this.isRemote) (window as any).__mySocket?.requestSave?.();
  }
  maxMp: number = 100;
  exp: number = 0;
  fame: number = 0;
  job: number = 0;
  stats: Stats;
  maxExp: number = 0;
  inventory: Inventory = new Inventory({});
  questManager: any = null;
  skillManager: any = null;
  buffManager: any = null;
  skillEffectActive: boolean = false;
  skillEffectFrames: any[] | null = null;
  skillEffectFrame: number = 0;
  skillEffectDelay: number = 0;
  _portalScriptEngine: any = null;
  pos: Physics;
  bodyRects: any = [];
  bodyStartPoistion: any = { x: 0, y: 0 };
  spriteBottomY: number = 0; // lowest drawn pixel relative to pos.y (mounts extend below the feet)
  // Taming mob riding — the mount animates on its own clock while the body
  // Setup-item chair being sat on; 0 when standing. The sprite comes from
  // Item.wz/Install/<prefix>.img/<id>/effect/0 and draws behind the body
  // (its `z` is -1), and info/recoveryHP is applied on a 10s tick.
  chairId: number = 0;
  chairFrame: any = null;
  chairRecoveryHP: number = 0;
  chairRecoveryTimer: number = 0;

  // holds the 'sit' stance attached at the mount's navel point
  mountStance: string = "stand1";
  mountFrame: number = 0;
  mountDelay: number = 0;
  defaultSaddle: any = null; // 01912000 saddle visuals, used when no saddle is equipped
  isInAttack: boolean = false;
  isInAlert: boolean = false;
  isInPortal: boolean = false;
  isRemote: boolean = false; // Network-controlled character — skip local stance logic
  isInClimbingRope: boolean = false;
  isClimbMoving: boolean = false;
  // Whether the grabbed climbable is a ladder (true) or rope (false) —
  // they use different stances (v83: 'ladder' vs 'rope')
  climbingIsLadder: boolean = false;
  /** y-extent of the rope currently held, so the climb can be stopped at its
   *  ends instead of running past them. */
  climbRopeBounds: { y1: number; y2: number } | null = null;
  isDead: boolean = false;
  maxCloseToMobDistance: number = 0;
  mobHitMinOverlapPercentage: number = 0;
  hitCooldownTimeInMS: number = 0;
  lastAttackTime: number = 0;
  lastHitTime: number = 0;
  spawnDefaultHp: number = 0;
  weaponEquip: any = null;
  weaponEquipId: any = null;
  // Stance family from the weapon's WZ info (stand/walk = 1|2) — two-handed
  // weapons like spears only have stand2/walk2 sprite frames
  weaponStandType: 1 | 2 = 1;
  weaponWalkType: 1 | 2 = 1;
  alertStanceTimeout: any = null;
  deathTimeout: any = null;
  // Death/tombstone animation state
  tombstoneNode: any = null;
  tombstoneFrame: number = 0;
  tombstoneDelay: number = 0;
  tombstoneActive: boolean = false;
  tombstoneDone: boolean = false;
  deathPosX: number = 0;
  deathPosY: number = 0;
  // Death dialog assets
  deathDialogBg: any = null;
  deathDialogOkNormal: any = null;
  deathDialogOkHover: any = null;
  deathDialogOkPressed: any = null;
  deathDialogVisible: boolean = false;
  deathDialogLoaded: boolean = false;
  projectiles: any = [];
  DamageIndicator: any = null;
  destroyed: boolean = false;
  levelingUp: boolean = false;
  levelUpFrames: any = null;
  levelUpFrame: number = 0;
  levelUpDelay: number = 0;
  // Quest effects
  questClearActive: boolean = false;
  jobChangedActive: boolean = false;
  jobChangedFrames: any = null;
  jobChangedFrame: number = 0;
  jobChangedDelay: number = 0;
  questClearFrames: any = null;
  questClearFrame: number = 0;
  questClearDelay: number = 0;
  questStartActive: boolean = false;
  questStartFrames: any = null;
  questStartFrame: number = 0;
  questStartDelay: number = 0;
  // EXP gain effect
  incExpActive: boolean = false;
  incExpFrames: any = null;
  incExpFrame: number = 0;
  incExpDelay: number = 0;
  onStanceFinish: any = null;
  onLastFrame: any = null;
  zmap: any = null;
  smap: any = null;
  map: MapleMap | null = null;
  Hair: any = null;

  static async fromOpts(opts: any) {
    const mc = new MapleCharacter(opts);
    await mc.load();
    return mc;
  }
  constructor(opts: any) {
    // body
    this.skinColor = opts.skinColor || 0;
    this.stance = opts.stance || "stand1";
    this.frame = opts.frame || 0;
    this.delay = opts.delay || 0;
    this.nextDelay = opts.nextDelay || 0;
    this.useStanceUntilMaxFrame = false;
    this.stanceMaxTime = 0;
    this.isOscillateFrames = false;
    this.oscillateFactor = 1;

    this.hair = opts.hair || 30030;

    // face
    this.face = opts.face || 20000;
    this.faceExpr = opts.faceExpr || "blink";
    this.faceFrame = opts.faceFrame || 0;
    this.faceDelay = opts.faceDelay || 0;
    this.faceNextDelay = opts.faceNextDelay || 0;

    this.equips = [];

    this.flipped = false;

    this.id = opts.id;
    this.name = opts.name;
    this.gender = opts.gender || 0;
    // male shirt = 1040036 male boxers = 1060026
    // female shirt = 1041046 female boxers = 1061039

    this.hp = opts.hp || 100;
    this.maxHp = opts.maxHp || 100;
    this.mp = opts.mp || 100;
    this.maxMp = opts.maxMp || 100;
    this.exp = opts.exp || 0;
    this.fame = opts.fame || 0;
    this.job = opts.job || 0;
    this.exp = opts.exp || 0;
    this.inventory = opts.inventory;
    // must get stats
    this.stats = opts.stats;
    this.maxExp = ExpTable.getExpNeededForLevel(this.stats.level);

    // physics stuff
    this.pos = new Physics();
    this.bodyRects = [];
    this.bodyStartPoistion = { x: 0, y: 0 };
    this.isInAttack = false;
    this.isInAlert = false;
    this.isInPortal = false;
    this.isInClimbingRope = false;
    this.isClimbMoving = false;
    this.isDead = false;

    this.maxCloseToMobDistance = 80;
    this.mobHitMinOverlapPercentage = 10;
    this.hitCooldownTimeInMS = 1000;
    this.lastHitTime = Date.now();
    this.spawnDefaultHp = 50;
    this.lastAttackTime = 0;

    this.weaponEquip = null;
    this.weaponEquipId = null;

    this.alertStanceTimeout = null;
    this.deathTimeout = null;

    if (this.stats) {
      this.stats.onStatsChanged = () => this.recalcLocalStats();
      this.recalcLocalStats();
    }
  }

  /**
   * Recompute effective stats from base + equips + buffs + passives.
   * Call after any stat-affecting event (equip change, buff change, level up,
   * job change, skill learn, AP allocation, character load).
   */
  recalcLocalStats() {
    if (!this.stats) return;
    this.stats.recalcLocalStats({
      equips: this.equips || [],
      equipBonuses: Object.values(this.equippedItemData || {}).map(d => d.bonus),
      baseMaxHp: this.maxHp,
      baseMaxMp: this.maxMp,
      buffBonuses: this.buffManager?.getStatTotals() ?? null,
      passiveBonuses: this.skillManager?.getPassiveBonuses() ?? null,
      projectileWatk: this.getEquippedAmmoWatk?.() ?? 0,
    });
    // A buff expiring can lower max HP/MP below current values
    this.hp = Math.min(this.hp, this.stats.localMaxHp);
    this.mp = Math.min(this.mp, this.stats.localMaxMp);
  }

  get effectiveMaxHp(): number {
    return this.stats?.localMaxHp || this.maxHp;
  }

  get effectiveMaxMp(): number {
    return this.stats?.localMaxMp || this.maxMp;
  }

  async load() {
    console.log("loading MapleCharacter");
    const zmap: any = await WZManager.get("Base.wz/zmap.img");
    const zmapDict = [...zmap.nChildren].reverse().reduce((acc, node, i) => {
      acc[node.nName] = i;
      return acc;
    }, {});
    this.zmap = {
      dict: zmapDict,
      indexOf: (name: string) => this.zmap.dict[name] || -1,
    };

    const smap: any = await WZManager.get("Base.wz/smap.img");
    const nonNullSmapNodes = smap.nChildren.filter((n: any) => !!n.nValue);
    const smapDict = nonNullSmapNodes.reduce((acc: any, node: any) => {
      acc[node.nName] = node.nValue;
      return acc;
    }, {});
    const reverseSmapDict = nonNullSmapNodes.reduce((acc: any, node: any) => {
      if (!acc[node.nValue]) {
        acc[node.nValue] = new Set();
      }
      acc[node.nValue].add(node.nName);
      return acc;
    }, {});
    this.smap = {
      dict: smapDict,
      reverseDict: reverseSmapDict,
      getValueFromName: (name: string) => this.smap.dict[name],
      getNamesFromValue: (value: string) => this.smap.reverseDict[value],
    };

    await this.setSkinColor(this.skinColor);
    await this.setFace(this.face);
    await this.setHair(this.hair);
    this.setStance(this.stance);

    // Re-attach equipment visuals — equips may have been set before load()
    // was called, and the body/head reload above needs matching equip data
    if (this.equippedItemIds && Object.keys(this.equippedItemIds).length > 0) {
      const savedEquips = { ...this.equippedItemIds };
      this.equips = [];
      for (const [slot, itemId] of Object.entries(savedEquips)) {
        try {
          await this.attachEquip(Number(slot), itemId as number);
        } catch (e) {
          console.error('[Load] Failed to re-attach equip slot', slot, 'item', itemId, e);
        }
      }
    }

    // Load chat balloon images (same as in NPC class)
    try {
      const chatBalloonFile: any = await WZManager.get("UI.wz/ChatBalloon.img");
      const style0 = chatBalloonFile["0"]; // We'll use style "0" (same as NPCs)
      
      // Store chat balloon parts for easy usage
      this.chatBalloon = {
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
    } catch (e) {
      console.error("Error loading chat balloon images:", e);
    }

    // Default underwear — rendered whenever top/bottom slots are empty
    // (male: White Undershirt 1040036 + boxers 1060026; female: 1041046 + 1061039)
    try {
      const uwTopId = this.gender === 1 ? 1041046 : 1040036;
      const uwBottomId = this.gender === 1 ? 1061039 : 1060026;
      this.underwearTop = await WZManager.get(`Character.wz/Coat/0${uwTopId}.img`);
      this.underwearBottom = await WZManager.get(`Character.wz/Pants/0${uwBottomId}.img`);
    } catch (e) {
      console.error('Failed to load default underwear:', e);
    }

    this.projectiles = [];
    this.DamageIndicator = new DamageIndicator();
    this.DamageIndicator.initialize();
    this.recalcLocalStats();
  }
  async setSkinColor(sc = 0) {
    this.head = await WZManager.get(`Character.wz/0001200${sc}.img`);
    this.body = await WZManager.get(`Character.wz/0000200${sc}.img`);
    this.baseBody = await WZManager.get(`Character.wz/00002000.img`);
    this.skinColor = sc;
  }
  setStance(
    stance = "stand1",
    frame = 0,
    useStanceUntilMaxFrame = false,
    isOscillateFrames = true, // is looping back and forth,
    onFinish = () => {}, // only if not looping -> meaning isOscillateFrames = false,
    onLastFrame = () => {} // only if looping -> meaning isOscillateFrames = true,
  ) {
    // print all possible stances
    // console.log(this.baseBody);

    if (this.stance != stance) {
      console.log("stance changed to", stance);
      this.useStanceUntilMaxFrame = useStanceUntilMaxFrame;
      this.stance = stance;
      this.setFrame(frame);
      this.isOscillateFrames = stance.startsWith("stand") || isOscillateFrames;
      this.oscillateFactor = 1;
      this.onStanceFinish = onFinish;
      this.onLastFrame = onLastFrame;
    } else if (stance === "ladder" || stance === "rope") {
      // Climbing toggles between moving (animate) and hanging still (freeze
      // frame) without a stance change — keep the flag in sync every call
      this.isOscillateFrames = isOscillateFrames;
    }
  }
  setFrame(frame = 0, carryOverDelay = 0) {
    if (
      this.useStanceUntilMaxFrame &&
      !this.baseBody[this.stance][frame + 1] &&
      this.baseBody[this.stance][frame]
    ) {
      this.onLastFrame();
    }

    if (!this.baseBody[this.stance][frame]) {
      if (this.useStanceUntilMaxFrame) {
        console.log("Animation ended, switching to stand or alert");

        this.onStanceFinish();

        if (this.isInAttack) {
          this.setAlert();
        } else {
          this.isInAlert = false;
        }
      } else {
        console.log("Animation ended, looping back to 0");
        frame = 0;
      }
    } else {
      this.frame = frame;
    }
    // this.frame = !this.baseBody[this.stance][frame] ? 0 : frame;
    this.delay = carryOverDelay;
    this.nextDelay = Math.abs(
      this.baseBody[this.stance][this.frame].nGet("delay").nGet("nValue", 100)
    );
  }
  advanceFrame() {
    const carryOverDelay = this.delay - this.nextDelay;
    if (!this.isOscillateFrames) {
      this.setFrame(this.frame + 1, carryOverDelay);
    } else {
      const nextFrame = this.frame + 1 * this.oscillateFactor;
      if (!this.baseBody[this.stance][nextFrame]) {
        this.oscillateFactor *= -1;
      }
      const nextOscillatedFrame = this.frame + 1 * this.oscillateFactor;
      // console.log(nextOscillatedFrame);
      this.setFrame(nextOscillatedFrame, carryOverDelay);
    }
  }

  async setFace(face = 20000) {
    this.Face = await WZManager.get(`Character.wz/Face/000${face}.img`);
    this.face = face;
  }
  setFaceExpr(faceExpr = "blink", faceFrame = 0) {
    if (!!this.Face[faceExpr]) {
      this.faceExpr = faceExpr;
      this.setFaceFrame(faceFrame);
    }
  }
  setFaceFrame(faceFrame = 0) {
    this.faceFrame = !this.Face[this.faceExpr][faceFrame] ? 0 : faceFrame;
  }
  advanceFaceFrame() {
    this.setFaceFrame(this.faceFrame + 1);
  }
  async setHair(hair = 30030) {
    this.Hair = await WZManager.get(`Character.wz/Hair/000${hair}.img`);
    this.hair = hair;
  }

  async attachEquip(slot: number, id: number) {
    if (!this.isRemote) (window as any).__mySocket?.requestSave?.();
    const realSlot = slot < 0 ? -(slot + 1) : slot;
    const firstThreeDigits = Math.floor(id / 10000);
    const equipMap: any = {
      101: { dir: "Accessory", slot: 1 }, // face accessory
      102: { dir: "Accessory", slot: 2 }, // eye accessory
      103: { dir: "Accessory", slot: 3 }, // earring
      112: { dir: "Accessory", slot: 16 }, // necklace/pendant
      113: { dir: "Accessory", slot: 18 }, // belt
      114: { dir: "Accessory", slot: 15 }, // medal
      100: { dir: "Cap", slot: 0 },
      110: { dir: "Cape", slot: 8 },
      104: { dir: "Coat", slot: 4 },
      108: { dir: "Glove", slot: 7 },
      105: { dir: "Longcoat", slot: 4 },
      106: { dir: "Pants", slot: 5 },
      180: { dir: "PetEquip", slot: 21 },  // pet equip
      181: { dir: "PetEquip", slot: 22 },  // pet hp
      182: { dir: "PetEquip", slot: 21 },
      183: { dir: "PetEquip", slot: 21 },
      111: { dir: "Ring", slot: 11 },
      109: { dir: "Shield", slot: 9 },
      107: { dir: "Shoes", slot: 6 },
      190: { dir: "TamingMob", slot: 19 },
      191: { dir: "TamingMob", slot: 20 },
      193: { dir: "TamingMob", slot: 19 },
      130: { dir: "Weapon", slot: 10 },
      131: { dir: "Weapon", slot: 10 },
      132: { dir: "Weapon", slot: 10 },
      133: { dir: "Weapon", slot: 10 },
      137: { dir: "Weapon", slot: 10 },
      138: { dir: "Weapon", slot: 10 },
      139: { dir: "Weapon", slot: 10 },
      140: { dir: "Weapon", slot: 10 },
      141: { dir: "Weapon", slot: 10 },
      142: { dir: "Weapon", slot: 10 },
      143: { dir: "Weapon", slot: 10 },
      144: { dir: "Weapon", slot: 10 },
      145: { dir: "Weapon", slot: 10 },
      146: { dir: "Weapon", slot: 10 },
      147: { dir: "Weapon", slot: 10 },
      148: { dir: "Weapon", slot: 10 },
      149: { dir: "Weapon", slot: 10 },
      160: { dir: "Weapon", slot: 10 },
      170: { dir: "Weapon", slot: 10 },
    };
    const mapping = equipMap[firstThreeDigits];
    if (!mapping || mapping.slot === undefined) return;
    const targetSlot = mapping.slot;
    if (realSlot === targetSlot) {
      const dir = mapping.dir;
      const equip = await WZManager.get(`Character.wz/${dir}/0${id}.img`);
      this.equips[realSlot] = equip;
      this.equippedItemIds[realSlot] = id;
      console.log("Adding equip", id, "to slot", realSlot);
      if (targetSlot === 10) {
        this.weaponEquip = equip;
        this.weaponEquipId = id;
        this.weaponStandType = (equip as any)?.info?.stand?.nValue === 2 ? 2 : 1;
        this.weaponWalkType = (equip as any)?.info?.walk?.nValue === 2 ? 2 : 1;
      }
      if (targetSlot === 19 && !this.defaultSaddle) {
        // Saddle visuals live in 01912000.img keyed by mount id — preload so
        // the mount renders saddled even without a saddle item equipped
        try {
          this.defaultSaddle = await WZManager.get(`Character.wz/TamingMob/01912000.img`);
        } catch (e) {
          console.error("Failed to load default saddle:", e);
        }
      }
      // Load item icon for equip window display
      this._loadEquipIcon(realSlot, id);
      this.recalcLocalStats();
    }
  }

  _loadEquipIcon(slot: number, itemId: number) {
    // Icons live inside the already-loaded Character.wz equip node at info/icon or info/iconRaw
    try {
      const equipNode = this.equips[slot];
      if (!equipNode) {
        console.warn(`[EquipIcon] No equip node for slot ${slot}`);
        return;
      }
      const infoNode = equipNode.info;
      if (!infoNode) {
        console.warn(`[EquipIcon] No info node for slot ${slot}, item ${itemId}`);
        return;
      }
      const iconNode = infoNode.iconRaw || infoNode.icon;
      if (!iconNode) {
        console.warn(`[EquipIcon] No icon node for slot ${slot}, item ${itemId}, info keys:`, Object.keys(infoNode));
        return;
      }
      if (iconNode.nGetImage) {
        this.equippedItemIcons[slot] = iconNode.nGetImage();
        console.log(`[EquipIcon] Loaded icon for slot ${slot}, item ${itemId}`);
      }
    } catch (e) {
      console.error(`[EquipIcon] Error loading icon for slot ${slot}:`, e);
    }
  }

  detachEquip(slot: number) {
    if (!this.isRemote) (window as any).__mySocket?.requestSave?.();
    const realSlot = slot < 0 ? -(slot + 1) : slot;
    this.equips[realSlot] = undefined;
    delete this.equippedItemIds[realSlot];
    delete this.equippedItemIcons[realSlot];
    delete this.equippedItemData[realSlot];
    if (realSlot === 10) {
      this.weaponEquip = undefined;
      this.weaponEquipId = undefined;
      this.weaponStandType = 1;
      this.weaponWalkType = 1;
    }
    this.recalcLocalStats();
  }
  destroy() {
    this.destroyed = true;
  }
  deactivate() {
    this.active = false;
  }
  activate() {
    this.active = true;
  }

  changeJob(jobId: number) {
    this.stats.setJobId(jobId);
    this.job = jobId;

    // Grant SP on job advancement (v83: 1st job=1SP, 2nd+=varies, simplified to 1 SP)
    // In v83, job advancement NPCs grant skills directly via script
    // SP is primarily earned through leveling (3 SP/level)
    this.stats.sp += 1;

    // Restore HP/MP to full on job change
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.recalcLocalStats();

    // v83 job advancement fanfare (sound + light pillar effect)
    this.playJobChanged();
  }

  async playJobChanged() {
    try {
      const sfxNode: any = await WZManager.get("Sound.wz/Game.img/JobChanged");
      if (sfxNode?.nGetAudio) PLAY_AUDIO(sfxNode.nGetAudio());
      const fx: any = await WZManager.get("Effect.wz/BasicEff.img/JobChanged");
      if (fx?.nChildren?.length > 0) {
        this.jobChangedFrames = fx.nChildren;
        this.jobChangedActive = true;
        this.jobChangedFrame = 0;
        this.jobChangedDelay = 0;
      }
    } catch (e) {
      console.error('playJobChanged error:', e);
    }
  }

  levelUp() {
    this.stats.level += 1;
    this.maxExp = ExpTable.getExpNeededForLevel(this.stats.level);
    this.stats.addAbilityPoints();

    // SP gain: Beginners get 1 SP, all other jobs get 3 SP per level
    const spGain = this.stats.jobId === 0 ? 1 : 3;
    this.stats.sp += spGain;

    // v83 HP/MP gains per level based on job
    const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
    const jobId = this.stats.jobId;
    let hpGain = 0;
    let mpGain = 0;

    if (jobId === 0) {
      // Beginner
      hpGain = rand(12, 16);
      mpGain = rand(10, 12);
    } else if (jobId >= 100 && jobId < 200) {
      // Warrior
      hpGain = rand(24, 28);
      mpGain = rand(4, 6);
    } else if (jobId >= 200 && jobId < 300) {
      // Magician
      hpGain = rand(10, 14);
      mpGain = rand(22, 24);
    } else if (jobId >= 300 && jobId < 400) {
      // Bowman
      hpGain = rand(20, 24);
      mpGain = rand(14, 16);
    } else if (jobId >= 400 && jobId < 500) {
      // Thief
      hpGain = rand(20, 24);
      mpGain = rand(14, 16);
    } else if (jobId >= 500 && jobId < 600) {
      // Pirate
      hpGain = rand(22, 28);
      mpGain = rand(18, 22);
    } else {
      // Default / Cygnus / Aran
      hpGain = rand(12, 16);
      mpGain = rand(10, 12);
    }

    this.maxHp += hpGain;
    this.maxMp += mpGain;
    this.stats.maxHp = this.maxHp;
    this.stats.maxMp = this.maxMp;
    this.recalcLocalStats();

    // Restore HP/MP to full on level up
    this.hp = this.effectiveMaxHp;
    this.mp = this.effectiveMaxMp;
    this.playLevelUp();
    // Broadcast to other players
    if (!this.isRemote && (window as any).__mySocket) {
      (window as any).__mySocket.sendPlayerLevelUp();
    }
  }

  addExp(exp: number, showEffect: boolean = false) {
    if (exp > 0 && showEffect) this.playIncExp();
    this.exp += exp;
    // Exp (and any level-up further down) persists soon
    if (!this.isRemote) (window as any).__mySocket?.requestSave?.();
    if (exp > 0 && !this.isRemote) {
      import('./UI/UIChatLog').then(({ default: UIChatLog }) => {
        UIChatLog.system(`You have gained experience (+${exp})`);
      }).catch(() => {});
    }
    // Level up as many times as needed (handles multi-level gains)
    while (this.exp >= this.maxExp && this.maxExp > 0) {
      this.exp -= this.maxExp;
      this.levelUp();
    }
  }

  async playLevelUp() {
    const levelUpNode: any = await WZManager.get("Sound.wz/Game.img/LevelUp");
    const levelUpAudio = levelUpNode.nGetAudio();

    const lu: any = await WZManager.get("Effect.wz/BasicEff.img/LevelUp");
    this.levelUpFrames = lu.nChildren;

    PLAY_AUDIO(levelUpAudio);
    this.levelingUp = true;
    this.levelUpFrame = 0;
    this.levelUpDelay = 0;
  }

  async playQuestClear() {
    try {
      const sfxNode: any = await WZManager.get("Sound.wz/Game.img/QuestClear");
      if (sfxNode?.nGetAudio) PLAY_AUDIO(sfxNode.nGetAudio());
      const qc: any = await WZManager.get("Effect.wz/BasicEff.img/QuestClear");
      if (qc?.nChildren?.length > 0) {
        this.questClearFrames = qc.nChildren;
        this.questClearActive = true;
        this.questClearFrame = 0;
        this.questClearDelay = 0;
      }
    } catch (e) {
      console.error('playQuestClear error:', e);
    }
  }

  async playQuestStart() {
    try {
      const sfxNode: any = await WZManager.get("Sound.wz/Game.img/QuestAlert");
      if (sfxNode?.nGetAudio) PLAY_AUDIO(sfxNode.nGetAudio());
      const qa: any = await WZManager.get("Effect.wz/BasicEff.img/QuestAlert/Appear");
      if (qa?.nChildren?.length > 0) {
        // Filter to only canvas frames (some children are $int properties like 'pos')
        this.questStartFrames = qa.nChildren.filter((n: any) => n.nTagName === 'canvas');
        this.questStartActive = true;
        this.questStartFrame = 0;
        this.questStartDelay = 0;
      }
    } catch (e) {
      console.error('playQuestStart error:', e);
    }
  }

  /**
   * Sit on a Setup-tab chair. The chair graphic is the item's `effect/0`
   * canvas; the body just holds the existing `sit` stance (the same one
   * mounts use), so nothing new is needed from Character.wz.
   */
  async sitOnChair(itemId: number) {
    try {
      const padded = `${itemId}`.padStart(8, '0');
      const prefix = padded.substring(0, 4);
      const item: any = await WZManager.get(`Item.wz/Install/${prefix}.img/${padded}`);
      const frame = item?.effect?.['0'];
      if (!frame?.nGetImage) {
        console.warn(`[Chair] item #${itemId} has no effect/0 sprite`);
        return;
      }
      this.chairId = itemId;
      this.chairFrame = frame;
      this.chairRecoveryHP = item?.info?.recoveryHP?.nValue ?? 0;
      this.chairRecoveryTimer = 0;
      // Face the camera like the original rather than keeping the walk
      // direction the player happened to stop on
      this.flipped = false;
    } catch (e) {
      console.error('sitOnChair error:', e);
    }
  }

  /** Leave the chair. Safe to call when not sitting. */
  standUpFromChair() {
    if (!this.chairId) return;
    this.chairId = 0;
    this.chairFrame = null;
    this.chairRecoveryHP = 0;
    this.chairRecoveryTimer = 0;
  }

  /**
   * Chairs restore info/recoveryHP every 10 seconds while seated — the
   * whole point of them in v83.
   */
  updateChair(msPerTick: number) {
    if (!this.chairId || this.chairRecoveryHP <= 0) return;
    if (this.hp >= this.maxHp) {
      this.chairRecoveryTimer = 0;
      return;
    }
    this.chairRecoveryTimer += msPerTick;
    if (this.chairRecoveryTimer < 10000) return;
    this.chairRecoveryTimer -= 10000;

    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + this.chairRecoveryHP);
    const gained = this.hp - before;
    if (gained > 0) {
      // Blue rising number, the same indicator damage uses
      this.DamageIndicator?.addDamageIndicator(
        DamageIndicatorType.Recovery,
        { x: this.pos.x, y: this.pos.y - 40 },
        gained
      );
    }
  }

  /**
   * Requirements-met feedback. Sound only — the announcement itself is the
   * red balloon over the quest notifier, and GMS doesn't also play the
   * over-the-character effect here (that belongs to accepting a quest and to
   * turning one in).
   */
  async playQuestFulfilled() {
    try {
      const sfxNode: any = await WZManager.get(FULFILLED_SOUND);
      if (sfxNode?.nGetAudio) PLAY_AUDIO(sfxNode.nGetAudio());
    } catch (e) {
      console.error('playQuestFulfilled error:', e);
    }
  }

  async playIncExp() {
    try {
      const sfxNode: any = await WZManager.get("Sound.wz/Game.img/IncEXP");
      if (sfxNode?.nGetAudio) PLAY_AUDIO(sfxNode.nGetAudio());
      const ie: any = await WZManager.get("Effect.wz/BasicEff.img/IncEXP");
      if (ie?.nChildren?.length > 0) {
        this.incExpFrames = ie.nChildren;
        this.incExpActive = true;
        this.incExpFrame = 0;
        this.incExpDelay = 0;
      }
    } catch (e) {
      console.error('playIncExp error:', e);
    }
  }

  /** Riding a taming mob (slot 19). Mount + saddle render, attacks are blocked. */
  get isRiding(): boolean {
    return !!this.equips[19];
  }

  /**
   * v83 equip requirement gate (Cosmic canWearEquipment parity): level, total
   * stats (base + equip bonuses) and fame must meet the item's req values.
   * reqJob is display-only in GMS — any class may wear any equip whose stat
   * requirements are met.
   */
  canEquip(infoNode: any): boolean {
    if (!infoNode) return true;
    const req = (key: string) => {
      const v = infoNode.nGet?.(key)?.nGet?.("nValue", 0) ?? 0;
      const n = typeof v === "number" ? v : parseInt(v, 10);
      return Number.isFinite(n) ? n : 0;
    };
    const s: any = this.stats;
    return (
      s.level >= req("reqLevel") &&
      (s.localStr ?? s.str) >= req("reqSTR") &&
      (s.localDex ?? s.dex) >= req("reqDEX") &&
      (s.localInt ?? s.int) >= req("reqINT") &&
      (s.localLuk ?? s.luk) >= req("reqLUK") &&
      this.fame >= req("reqPOP")
    );
  }

  async jump() {
    if (this.stance !== "jump") {
      const jumpNode: any = await WZManager.get("Sound.wz/Game.img/Jump");
      const jumpAudio = jumpNode.nGetAudio();
      PLAY_AUDIO(jumpAudio);
    }

    this.pos.jump();
    this.isInClimbingRope = false;
  }

 /**
 * Attack method — uses WeaponConfig to determine stance, range, and melee vs projectile behavior.
 */
/**
 * Ammo lookup for ranged weapons: first matching Use-tab stack with quantity.
 * Bows use arrows (2060xxx), crossbows bolts (2061xxx), claws stars (207xxxx),
 * guns bullets (233xxxx).
 */
findAmmo(weaponType: number): any | null {
  const useTab = this.inventory?.use || [];
  for (const item of useTab) {
    if (!item || (item.quantity ?? 0) <= 0) continue;
    const id = item.itemId;
    const matches =
      (weaponType === WeaponType.BOW && Math.floor(id / 1000) === 2060) ||
      (weaponType === WeaponType.CROSSBOW && Math.floor(id / 1000) === 2061) ||
      (weaponType === WeaponType.CLAW && Math.floor(id / 10000) === 207) ||
      (weaponType === WeaponType.PISTOL && Math.floor(id / 10000) === 233);
    if (matches) return item;
  }
  return null;
}

/**
 * Equipped ammo weapon attack (Cosmic reapplyLocalStats parity): the first
 * usable stack's incPAD feeds into localWatk for ranged weapons.
 */
getEquippedAmmoWatk(): number {
  const weaponType = getEquipTypeById(this.weaponEquipId);
  const config = getWeaponConfig(weaponType);
  if (!config?.isRanged) return 0;
  const ammo = this.findAmmo(weaponType);
  return ammo?.node?.info?.incPAD?.nValue ?? 0;
}

/**
 * Attack period from weapon attackSpeed (WZ stage 2=fastest..9=slowest,
 * default 6) adjusted by an active Booster buff (effect.x is negative).
 */
getAttackDelayMs(): number {
  const weaponSpeed = this.weaponEquip?.info?.attackSpeed?.nValue ?? 6;
  let boosterDelta = 0;
  if (this.buffManager) {
    for (const skillId of BOOSTER_SKILL_IDS) {
      const buff = this.buffManager.activeBuffs?.get?.(skillId);
      if (buff) {
        boosterDelta = buff.effect.x || 0;
        break;
      }
    }
  }
  const speed = Math.min(9, Math.max(2, weaponSpeed + boosterDelta));
  // Approximate v83 attack periods per speed stage
  const delayTable: Record<number, number> = {
    2: 600, 3: 660, 4: 720, 5: 780, 6: 840, 7: 900, 8: 960, 9: 1020,
  };
  return delayTable[speed] ?? 840;
}

async attack() {
  if (this.isInAttack) return;
  if (this.isRiding) return; // cannot attack while mounted (v83)
  if (Date.now() - this.lastAttackTime < this.getAttackDelayMs()) return;

  const weaponType = getEquipTypeById(this.weaponEquipId);
  const config = getWeaponConfig(weaponType);

  if (!config) {
    console.error('Unknown weapon type:', weaponType);
    return;
  }

  // Attacking while crouched = prone stab, always melee (v83)
  const isProne = !!this.pos.fh && this.pos.down && !this.isInClimbingRope;

  // Ranged weapons fire projectiles unless the player is right next to a mob
  const useRanged = !isProne && config.isRanged && !this.isCloseToMob(false);

  // No ammo, no shot (authentic v83: the attack simply doesn't happen)
  if (useRanged && !this.findAmmo(weaponType)) return;

  this.isInAttack = true;
  this.lastAttackTime = Date.now();
  this.rightClickRelease();
  this.leftClickRelease();
  this.isInAlert = false;
  const stancePool = isProne
    ? [Stance.proneStab]
    : useRanged ? config.stances.ranged : config.stances.melee;

  if (stancePool.length === 0) {
    this.isInAttack = false;
    return;
  }

  // Pick a random stance from the pool for variety
  const attackStance = stancePool[Math.floor(Math.random() * stancePool.length)];

  this.setStance(
    attackStance,
    0,
    true,
    false,
    () => {
      this.isInAttack = false;
    },
    async () => {
      if (useRanged) {
        await this.fireProjectile(weaponType);
      } else {
        await this.executeAttackDamage();
      }
    }
  );
}

/**
 * Execute melee attack damage using the weapon config and proper stat formulas.
 */
async executeAttackDamage() {
  const weaponType = getEquipTypeById(this.weaponEquipId);
  const config = getWeaponConfig(weaponType);
  const attackRange = config?.meleeRange ?? 70;

  try {
    playAudioForAttackByWeaponType(weaponType);
  } catch (error) {
    console.error('Error playing attack sound:', error);
  }

  const isCharacterFacingRight = this.flipped;

  // Vertical reach is the attacker's own body, not a flat tolerance. pos.y
  // is the foothold contact point and sprites extend upward from it, so a
  // body spans [y - height, y]. The old `Math.abs(dy) <= 100` reached a
  // whole platform below, letting you hit mobs on the floor underneath.
  // Comparing spans instead still allows sloped ground and mobs of any
  // height, because it only asks whether the two bodies actually overlap.
  const myTop = this.pos.y - ATTACK_BODY_H;
  const myBottom = this.pos.y;
  const overlapsVertically = (targetY: number, targetH: number) => {
    const h = targetH > 0 ? targetH : ATTACK_BODY_H;
    return targetY - h <= myBottom && targetY >= myTop;
  };

  // Find monsters in melee range facing the right direction
  const monsters = this.map?.monsters.filter((monster: Monster) => {
    if (monster.dying) return false;
    const dx = monster.pos.x - this.pos.x;
    if (isCharacterFacingRight && dx < -20) return false;
    if (!isCharacterFacingRight && dx > 20) return false;
    const monsterHalfWidth = (monster.width || 50) / 2;
    const effectiveDistance = Math.max(0, Math.abs(dx) - monsterHalfWidth);
    return (
      effectiveDistance <= attackRange &&
      overlapsVertically(monster.pos.y, monster.height)
    );
  }) || [];

  // Check reactor hits
  const reactorsHit = this.map?.reactors?.filter((reactor: any) => {
    if (reactor.destroyed) return false;
    const dx = reactor.x - this.pos.x;
    if (isCharacterFacingRight && dx < -20) return false;
    if (!isCharacterFacingRight && dx > 20) return false;
    const halfW = (reactor.width || 48) / 2;
    const hDist = Math.max(0, Math.abs(dx) - halfW);
    return hDist <= attackRange && overlapsVertically(reactor.y, reactor.height);
  }) || [];

  for (const reactor of reactorsHit) {
    reactor.hit(false);
    if ((window as any).__mySocket) {
      (window as any).__mySocket.sendReactorHit(reactor.oId);
    }
  }

  // Nothing hit — play swing sound
  if (monsters.length === 0 && reactorsHit.length === 0) {
    try {
      const missNode = await WZManager.get('Sound.wz/Game.img/Swing');
      if (missNode && missNode.nGetAudio) {
        PLAY_AUDIO(missNode.nGetAudio());
      }
    } catch (error) {
      console.error('Error playing swing sound:', error);
    }
    if (monsters.length === 0) return;
  }

  // Determine attack type from current stance (stab vs swing affects damage multiplier)
  const attackType = this.getAttackTypeFromStance();

  const mastery = this.skillManager?.getWeaponMastery?.(weaponType) ?? 0.1;
  const crit = this.skillManager?.getCritical?.(weaponType) ?? null;

  for (const monster of monsters) {
    try {
      // Get raw damage range, then reduce by monster defense
      const rawRange = this.stats.getAttackRange(weaponType, attackType, mastery);
      const monsterDef = monster.mobFile?.info?.PDDamage?.nValue ?? 0;
      const monsterLevel = monster.mobFile?.info?.level?.nValue ?? 1;
      const defRange = this.stats.getAttackDamageRangeAfterMonsterDefense(rawRange, monsterDef, monsterLevel);
      const isMiss = this.stats.getRandomIsMiss(monsterLevel, monster.eva ?? 0);
      let damage = isMiss ? 0 : Math.max(1, Stats.getRandomAttackDamageFromAttackRange(defRange));
      let isCritical = false;
      if (damage > 0 && crit && Math.random() < crit.chance) {
        damage = Math.floor(damage * crit.damagePct);
        isCritical = true;
      }
      const knockbackDirection = isCharacterFacingRight ? 1 : -1;
      monster.hit(damage, knockbackDirection, this, isCritical);
      this.createHitEffect(monster.pos.x, monster.pos.y);
    } catch (error) {
      console.error('Error processing monster hit:', error);
    }
  }

  // Play hit sound
  try {
    const hitNode = await WZManager.get('Sound.wz/Game.img/Hit');
    if (hitNode && hitNode.nGetAudio) {
      PLAY_AUDIO(hitNode.nGetAudio());
    }
  } catch (error) {
    console.error('Error playing hit sound:', error);
  }

  this.checkForItemDropPickup(true);
}

// Three Snails (skill 1000): each skill level throws exactly its own shell
// tier — L1 Snail Shell (green), L2 Blue Snail Shell, L3 Red Snail Shell.
// Without that specific shell in inventory the skill cannot be cast.
// Damage and ball sprite frame follow the tier.
static readonly THREE_SNAILS_ID = 1000;
static readonly THREE_SNAILS_SHELLS: { itemId: number; damage: number; frame: number }[] = [
  { itemId: 4000019, damage: 10, frame: 0 },  // L1: Snail Shell
  { itemId: 4000000, damage: 25, frame: 1 },  // L2: Blue Snail Shell
  { itemId: 4000016, damage: 40, frame: 2 },  // L3: Red Snail Shell
];

/**
 * Execute a skill — handles attack skills with skill damage multiplier,
 * mob count, attack count, and skill-specific range.
 * Returns true if the cast actually happened (caller consumes MP/cooldown).
 */
async useSkill(skillId: number, effect: any): Promise<boolean> {
  if (this.isInAttack) return false;
  if (this.isRiding) return false; // cannot use skills while mounted (v83)

  const info = (await import('./Skills/SkillData')).default.getSkillSync(skillId);
  if (!info) return false;

  if (info.isAttack) {
    // Attack skills respect weapon attack speed like regular attacks
    if (Date.now() - this.lastAttackTime < this.getAttackDelayMs()) return false;

    // Check if this is a projectile (ball) skill
    const hasBall = effect.ballNode && effect.ballNode.nChildren?.length > 0;

    // Three Snails: the current skill level's own shell tier is thrown —
    // nothing else substitutes. No matching shell in inventory → no cast.
    let fixedDamageOverride = 0;
    let ballFrame: number | null = null;
    if (skillId === MapleCharacter.THREE_SNAILS_ID) {
      const skillLevel = this.skillManager?.getSkillLevel?.(skillId) ?? 1;
      const tier = Math.min(Math.max(1, skillLevel), MapleCharacter.THREE_SNAILS_SHELLS.length);
      const shell = MapleCharacter.THREE_SNAILS_SHELLS[tier - 1];
      const inv = this.inventory;
      const hasShell = inv.etc.some(
        (item: any) => item?.itemId === shell.itemId && item.quantity > 0
      );
      if (!hasShell) {
        console.log(`[Skill] Three Snails L${tier} needs item ${shell.itemId} — not in inventory`);
        return false;
      }
      inv.removeFromInventory(shell.itemId, 1);
      fixedDamageOverride = shell.damage;
      ballFrame = shell.frame;
    }

    this.lastAttackTime = Date.now();
    this.isInAttack = true;
    this.rightClickRelease();
    this.leftClickRelease();
    this.isInAlert = false;

    // Determine body stance
    const weaponType = getEquipTypeById(this.weaponEquipId);
    const config = getWeaponConfig(weaponType);
    const stancePool = config?.stances?.melee || ['swingO1'];
    let attackStance: string = stancePool[Math.floor(Math.random() * stancePool.length)];

    // Prefer the skill's own action stance; otherwise the weapon's normal
    // attack swing is used (GMS: Three Snails plays the regular attack animation)
    if (info.action && this.baseBody?.[info.action]) {
      attackStance = info.action;
    }

    if (hasBall) {
      // Projectile skill — fire a projectile with ball sprites
      this.setStance(
        attackStance,
        0,
        true,
        false,
        () => { this.isInAttack = false; },
        () => {
          this.fireSkillProjectile(effect, info.element, fixedDamageOverride, ballFrame);
        }
      );
    } else {
      // Melee skill — direct hit detection
      this.setStance(
        attackStance,
        0,
        true,
        false,
        () => { this.isInAttack = false; },
        async () => {
          await this.executeSkillDamage(skillId, effect);
        }
      );
    }
    return true;
  } else if (info.isBuff) {
    // Buff — apply the buff effect
    if (this.buffManager) {
      this.buffManager.applyBuff(skillId, effect);
    }
    // Play casting body animation from the skill's WZ action property
    const castStance = info.action || 'alert2';
    if (this.baseBody?.[castStance]) {
      this.isInAttack = true;
      this.setStance(
        castStance,
        0,
        true,    // play through all frames once
        false,   // don't oscillate
        () => { this.isInAttack = false; }, // return to normal on finish
      );
    }
    return true;
  }
  return false;
}

/**
 * Fire a skill projectile using ball sprites from Skill.wz.
 */
fireSkillProjectile(effect: any, element: string | null = null, fixedDamageOverride: number = 0, ballFrame: number | null = null) {
  const projectile = Projectile.fromSkill({
    charecter: this,
    x: this.pos.x,
    y: this.pos.y - 26,
    right: this.flipped,
    ballNode: effect.ballNode,
    hitNode: effect.hitNode,
    ballFrame,
    fixedDamage: fixedDamageOverride || effect.fixdamage || 0,
    magicAttack: (effect.mad || 0) > 0
      ? { spellAttack: effect.mad, mastery: (effect.mastery || 10) / 100, element }
      : null,
    targetMonsters: this.map?.monsters?.filter((m: Monster) => !m.dying) || [],
    maxDistance: effect.range > 0 ? effect.range : 400,
  });
  this.projectiles.push(projectile);
}

/**
 * Execute skill attack damage with skill-specific multipliers.
 */
async executeSkillDamage(skillId: number, effect: any) {
  const weaponType = getEquipTypeById(this.weaponEquipId);
  const skillRange = effect.range > 0 ? effect.range : (getWeaponConfig(weaponType)?.meleeRange ?? 70);
  const mobCount = effect.mobCount || 1;
  const attackCount = effect.attackCount || 1;
  const damagePercent = (effect.damage || 100) / 100;
  const fixDamage = effect.fixdamage || 0;

  try {
    playAudioForAttackByWeaponType(weaponType);
  } catch (e) { /* ignore */ }

  const isCharacterFacingRight = this.flipped;

  // Find monsters in range
  let monsters = this.map?.monsters.filter((monster: Monster) => {
    if (monster.dying) return false;
    const dx = monster.pos.x - this.pos.x;
    const dy = monster.pos.y - this.pos.y;
    if (isCharacterFacingRight && dx < -20) return false;
    if (!isCharacterFacingRight && dx > 20) return false;
    const monsterHalfWidth = (monster.width || 50) / 2;
    const effectiveDistance = Math.max(0, Math.abs(dx) - monsterHalfWidth);
    return effectiveDistance <= skillRange && Math.abs(dy) <= 100;
  }) || [];

  // Limit to mobCount
  if (monsters.length > mobCount) {
    monsters = monsters.slice(0, mobCount);
  }

  if (monsters.length === 0) return;

  const attackType = this.getAttackTypeFromStance();
  const skillInfo = (await import('./Skills/SkillData')).default.getSkillSync(skillId);
  const isMagic = (effect.mad || 0) > 0;
  const element = skillInfo?.element ?? null;
  const mastery = this.skillManager?.getWeaponMastery?.(weaponType) ?? 0.1;
  const crit = this.skillManager?.getCritical?.(weaponType) ?? null;

  for (const monster of monsters) {
    try {
      const elemMult = monster.getElementalMultiplier?.(element) ?? 1;
      for (let hit = 0; hit < attackCount; hit++) {
        let damage: number;
        let isCritical = false;

        if (fixDamage > 0) {
          // Fixed damage skills (e.g., Three Snails)
          damage = fixDamage;
        } else if (isMagic) {
          // Magic skills carry their spell attack in effect.mad; no damagePercent
          const spellMastery = (effect.mastery || 10) / 100;
          const rawRange = this.stats.getMagicAttackRange(effect.mad, spellMastery);
          const monsterMdd = monster.mobFile?.info?.MDDamage?.nValue ?? 0;
          const monsterLevel = monster.mobFile?.info?.level?.nValue ?? 1;
          const defRange = this.stats.getMagicDamageAfterMonsterDefense(rawRange, monsterMdd, monsterLevel);
          const isMiss = this.stats.getRandomIsMiss(monsterLevel, monster.eva ?? 0);
          if (isMiss) {
            damage = 0;
          } else {
            const baseDmg = Math.max(1, Stats.getRandomAttackDamageFromAttackRange(defRange));
            damage = Math.max(1, Math.floor(baseDmg * elemMult));
          }
        } else {
          const rawRange = this.stats.getAttackRange(weaponType, attackType, mastery);
          const monsterDef = monster.mobFile?.info?.PDDamage?.nValue ?? 0;
          const monsterLevel = monster.mobFile?.info?.level?.nValue ?? 1;
          const defRange = this.stats.getAttackDamageRangeAfterMonsterDefense(rawRange, monsterDef, monsterLevel);
          const isMiss = this.stats.getRandomIsMiss(monsterLevel, monster.eva ?? 0);
          if (isMiss) {
            damage = 0;
          } else {
            const baseDmg = Math.max(1, Stats.getRandomAttackDamageFromAttackRange(defRange));
            damage = Math.floor(baseDmg * damagePercent);
            if (crit && Math.random() < crit.chance) {
              damage = Math.floor(damage * crit.damagePct);
              isCritical = true;
            }
          }
        }

        const knockbackDirection = isCharacterFacingRight ? 1 : -1;
        monster.hit(damage, knockbackDirection, this, isCritical);
      }
      this.createHitEffect(monster.pos.x, monster.pos.y);
    } catch (e) {
      console.error('Error processing skill hit:', e);
    }
  }

  // Play hit sound
  try {
    const hitNode = await WZManager.get('Sound.wz/Game.img/Hit');
    if (hitNode && (hitNode as any).nGetAudio) {
      PLAY_AUDIO((hitNode as any).nGetAudio());
    }
  } catch (e) { /* ignore */ }

  this.checkForItemDropPickup(true);
}

/**
 * Determine AttackType (Stab vs Swing) from the current stance name.
 */
getAttackTypeFromStance(): AttackType {
  if (typeof this.stance === 'string' && this.stance.startsWith('stab')) {
    return AttackType.Stab;
  }
  return AttackType.Swing;
}

/**
 * Fire a projectile for ranged weapon attacks (bow, crossbow, claw, pistol).
 */
async fireProjectile(weaponType: number) {
  try {
    playAudioForAttackByWeaponType(weaponType);
  } catch (error) {
    console.error('Error playing attack sound:', error);
  }

  const attackType = this.getAttackTypeFromStance();
  const rangedMastery = this.skillManager?.getWeaponMastery?.(weaponType) ?? 0.1;
  const weaponAttackRange = this.stats.getAttackRange(weaponType, attackType, rangedMastery);

  // Fire the actual equipped ammo and consume one
  const ammo = this.findAmmo(weaponType);
  const projectileItemId = ammo?.itemId || DEFAULT_PROJECTILE_ID[weaponType] || 2060000;
  if (ammo) {
    this.inventory.removeFromInventory(ammo.itemId, 1);
    this.recalcLocalStats();
  }

  try {
    const projectile = await Projectile.fromOpts({
      id: projectileItemId,
      charecter: this,
      x: this.pos.x,
      y: this.pos.y - 30,
      right: this.flipped,
      left: !this.flipped,
      targetMonsters: this.map?.monsters?.filter((m: Monster) => !m.dying) || [],
      weaponAttackRange: weaponAttackRange,
      maxDistance: 600,
    });
    this.projectiles.push(projectile);
  } catch (error) {
    console.error('Error creating projectile:', error);
  }
}

/**
 * Create a visual hit effect at the specified position
 */
async createHitEffect(x, y) {
  try {
    // This is a placeholder for creating hit effects
    // You would typically load a sprite sheet and animate it
    // For now, we'll just log that we want to create an effect
    console.log(`Creating hit effect at (${x}, ${y})`);
    
    // In the future, you could implement something like:
    // const hitEffect = await HitEffect.fromOpts({
    //   x: x, y: y, type: "normal"
    // });
    // this.map.addEffect(hitEffect);
  } catch (error) {
    console.error("Error creating hit effect:", error);
  }
}

/**
 * Improved implementation of isCloseToMob for more accurate distance detection
 */
isCloseToMob = (inAllDirections = true) => {
  if (!this.map || !this.map.monsters || this.map.monsters.length === 0) {
    return false;
  }

  // Filter monsters by direction if not checking in all directions
  const monstersToConsider = inAllDirections
    ? this.map.monsters
    : this.map.monsters.filter((monster: Monster) => {
        const isMonsterOnRight = monster.pos.x > this.pos.x;
        const isMonsterOnLeft = monster.pos.x < this.pos.x;
        const isPlayerFacingRight = this.flipped;

        return (
          (isMonsterOnRight && isPlayerFacingRight) ||
          (isMonsterOnLeft && !isPlayerFacingRight)
        );
      });

  // Use a more generous distance check
  const HORIZONTAL_DISTANCE = 80;
  const VERTICAL_DISTANCE = 60;

  // Check if any monster is within attack range
  const isCloseToMonster = monstersToConsider.some((monster: Monster) => {
    // Skip dead/dying monsters
    if (monster.dying || monster.destroyed) {
      return false;
    }
    
    // Calculate horizontal and vertical distances separately
    const horizontalDistance = Math.abs(monster.pos.x - this.pos.x);
    const verticalDistance = Math.abs(monster.pos.y - this.pos.y);
    
    // Consider monster in range if both horizontal and vertical distances are within limits
    return horizontalDistance <= HORIZONTAL_DISTANCE && verticalDistance <= VERTICAL_DISTANCE;
  });

  return isCloseToMonster;
};
  
  
  async pickUp() {
    console.log("pickUp");
    this.checkForItemDropPickup();
  }

  setAlert() {
    this.isInAttack = false;
    this.isInAlert = true;
    this.setStance(Stance.alert, 0, false, true);

    if (this.alertStanceTimeout) {
      clearTimeout(this.alertStanceTimeout);
    }
    this.alertStanceTimeout = setTimeout(() => {
      this.isInAlert = false;
    }, 5 * 1000);
  }

  checkForLadder(direction: ClimbDirections) {
    const isUp = direction === ClimbDirections.UP;
    const ladderRope = this.map!.wzNode.ladderRope.nChildren.find(
      (ladderRope: any) => {
        // its ladder or rope
        const isLadder = ladderRope.nGet("l").nValue === 1;

        const xRange = isLadder ? 15 : 8;

        // The grab box is deliberately lopsided, and which way depends on the
        // direction asked for. A rope's y1 sits 2px below the foothold it
        // hangs from, so a symmetric box overlaps the platform at the top and
        // the floor at the bottom, and you get grabbed at both ends.
        //
        // Reaching UP: slack at the foot so you can catch a rope while
        // standing under it, but none at the head — otherwise standing on the
        // platform is inside the box and pressing up yanks you back on.
        // Reaching DOWN is the mirror: slack at the head so you can climb on
        // from the platform, none at the foot or you grab the rope you are
        // already standing at the bottom of and sink through the floor.
        const top = ladderRope.y1.nValue - (isUp ? 0 : GRAB_SLACK);
        const bottom = ladderRope.y2.nValue + (isUp ? GRAB_SLACK : -GRAB_SLACK);

        return isPositionInsideRectByConrners(
          {
            x: this.pos.x,
            y: this.pos.y,
          },
          {
            x: ladderRope.x.nValue - xRange,
            y: top,
          },
          {
            x: ladderRope.x.nValue + xRange,
            y: bottom,
          }
        );
      }
    );
    if (ladderRope) {
      const ropeTop = ladderRope.y1.nValue;
      const ropeBottom = ladderRope.y2.nValue;

      // Ladders and ropes use different climb stances (ladder: rungs grip,
      // rope: hands on the rope) — remember which one was grabbed
      this.climbingIsLadder = ladderRope.nGet("l").nValue === 1;
      this.climbRopeBounds = { y1: ropeTop, y2: ropeBottom };
      this.pos.x = ladderRope.x.nValue;
      // That slack means you can grab from just outside the rope's span, so
      // start the climb at the end you caught hold of — otherwise the
      // let-go check below sees you past the end and drops you immediately.
      if (this.pos.y > ropeBottom) this.pos.y = ropeBottom;
      else if (this.pos.y < ropeTop) this.pos.y = ropeTop;
      this.climbRope(direction);
      return true;
    } else {
      // This is the branch that actually ends most climbs: the up/down key is
      // still held, the character has risen or sunk out of the grab box, and
      // no rope matches any more. It has to give the foothold back the same
      // way the end-of-rope check does — but only when there was a rope, or
      // every press of up/down while walking would drop the character's
      // foothold and start them falling.
      if (this.isInClimbingRope) this.releaseRope();
      this.pos.stopClimb();

      return false;
    }
  }

  async checkForPortal() {
    if (this.isInPortal) return;

    const portal = this.map!.portals.filter(
      (portal: Portal) => portal.rect
    ).find((portal: Portal) => {
      return isPositionInsideRect(
        {
          x: this.pos.x,
          y: this.pos.y,
        },
        portal.rect!
      );
    });

    if (!portal) return;

    this.isInPortal = true;

    try {
      // Scripted portals — run portal script engine
      if (portal.script && [7, 8, 9, 11].includes(portal.type)) {
        console.log(`[Portal] Running script "${portal.script}" for portal "${portal.name}" (type ${portal.type})`);
        const PortalScriptEngine = (await import('./PortalScriptEngine')).default;
        if (!this._portalScriptEngine) this._portalScriptEngine = new PortalScriptEngine();
        const allowed = await this._portalScriptEngine.execute(
          portal.script,
          this,
          portal,
          async (mapId: number, portalName?: string) => {
            const MapStateInstance = (window as any).MapStateInstance;
            if (MapStateInstance?.changeMap) {
              await MapStateInstance.changeMap(mapId, portalName);
            }
          }
        );
        if (!allowed) {
          setTimeout(() => { this.isInPortal = false; }, 1000);
          return;
        }
        // Script handled warp — reset after delay
        setTimeout(() => { this.isInPortal = false; }, 1000);
        return;
      }

      // Skip portals with no valid destination (scripted portals without scripts loaded)
      if (portal.toMap >= 999999999 && !portal.toName) {
        this.isInPortal = false;
        return;
      }

      const jumpNode: any = await WZManager.get("Sound.wz/Game.img/Portal");
      const jumpAudio: any = jumpNode.nGetAudio();
      PLAY_AUDIO(jumpAudio);

      if (this.map!.id !== portal.toMap && portal.toMap < 999999999) {
        const { fadeToBlack } = await import('./MapState');
        fadeToBlack();
        await this.map!.load(portal.toMap);
      }

      // Find the destination portal by name
      const othersidePortal = portal.toName ? this.map!.portals.find(
        (newMapPortals: Portal) => {
          return newMapPortals.name === portal.toName;
        }
      ) : null;

      // Reset physics and place character at destination
      this.pos = new Physics();
      this.pos.vx = 0;
      this.pos.vy = 0;
      this.pos.fh = null;
      this.pos.lf = null;
      this.pos.isClimbing = false;

      if (othersidePortal) {
        this.pos.x = othersidePortal.x;
        this.pos.y = othersidePortal.y - 10;
      } else {
        // Fallback: spawn portal, or center of map
        const spawnPortal = this.map!.portals.find((p: Portal) => p.type === 0);
        if (spawnPortal) {
          this.pos.x = spawnPortal.x;
          this.pos.y = spawnPortal.y - 10;
        }
      }
    } catch (error) {
      console.error('Portal transition failed:', error);
    }

    // Always reset after a delay so portals can be used again
    setTimeout(() => {
      this.isInPortal = false;
    }, 1000);
  }

  async upClick() {
    this.pos.up = true;

    if (this.pos) {
      await this.checkForPortal();

      this.checkForLadder(ClimbDirections.UP);
    }
  }

  async downClick() {
    this.pos.down = true;
    this.checkForLadder(ClimbDirections.DOWN);
  }

  rightClick() {
    if (!this.isInAttack) {
      this.pos.right = true;
    }
  }

  leftClick() {
    if (!this.isInAttack) {
      this.pos.left = true;
    }
  }

  downClickRelease() {
    this.pos.down = false;
    if (this.isInClimbingRope) {
      this.pos.stopClimbMovement();
      this.isClimbMoving = false;
    }
  }

  upClickRelease() {
    this.pos.up = false;

    if (this.isInClimbingRope) {
      this.pos.stopClimbMovement();
      this.isClimbMoving = false;
    }
  }

  rightClickRelease() {
    this.pos.right = false;
  }

  leftClickRelease() {
    this.pos.left = false;
  }

  /**
   * Let go of a ladder or rope and hand back to normal physics.
   *
   * Dropping the foothold is the point. Climbing keeps whatever foothold the
   * character was standing on when they grabbed on, and nothing recomputes it
   * on the way off, so walking away from the far end used to resolve against
   * a platform that is no longer under them — off the top of a ladder they
   * fell to the floor below, and off the bottom they were snapped back up to
   * the platform they had left. Clearing it makes them fall the last pixel or
   * two and acquire the foothold they are actually standing on.
   */
  releaseRope() {
    this.isInClimbingRope = false;
    this.isClimbMoving = false;
    this.climbRopeBounds = null;
    this.pos.fh = null;
    this.pos.lf = null;
  }

  // ClimbDirections enum
  climbRope(direction: ClimbDirections) {
    this.isClimbMoving = true;
    this.pos.down = false;
    this.pos.up = false;

    if (direction === ClimbDirections.UP) {
      this.pos.climbUp();
    } else {
      this.pos.climbDown();
    }

    this.isInClimbingRope = true;
  }

  async die() {
    if (this.isDead) return;
    this.isDead = true;
    this.pos.isMoveEnalbed = false;
    this.isInAttack = false;
    this.isInAlert = false;
    this.deathPosX = this.pos.x;
    this.deathPosY = this.pos.y;

    // v83 death EXP loss (Beginners exempt, no de-leveling): 1% in town,
    // otherwise 10% (LUK < 50) or 5% of the level's total EXP
    if (this.stats.jobId !== 0 && !this.isRemote) {
      const divisor = this.map?.isTown ? 100 : this.stats.luk < 50 ? 10 : 20;
      const expLoss = Math.floor(this.maxExp / divisor);
      this.exp = Math.max(0, this.exp - expLoss);
      console.log(`[Death] Lost ${expLoss} EXP`);
    }

    // Tombstone fall: starts 300px above death position, falls down
    this.tombstoneYOffset = -300;
    this.tombstoneActive = true;
    this.tombstoneDone = false;

    // Load tombstone animation
    try {
      this.tombstoneNode = await WZManager.get('Effect.wz/Tomb.img/fall');
      this.tombstoneFrame = 0;
      this.tombstoneDelay = 0;

      // Play tombstone SFX
      const tombSoundNode: any = await WZManager.get('Sound.wz/Game.img/Tombstone');
      if (tombSoundNode) {
        PLAY_AUDIO(tombSoundNode.nGetAudio());
      }
    } catch (e) {
      console.error('Error loading tombstone effect:', e);
      this.tombstoneActive = false;
      this.tombstoneDone = true;
      this.showDeathDialog();
    }
  }

  async showDeathDialog() {
    // Load death dialog assets once
    if (!this.deathDialogLoaded) {
      try {
        const noticeNode: any = await WZManager.get('UI.wz/UIWindow.img/Notice');
        this.deathDialogBg = noticeNode.nGet('0');
        const okBtn: any = await WZManager.get('UI.wz/Basic.img/BtOK');
        this.deathDialogOkNormal = okBtn.normal.nChildren[0];
        this.deathDialogOkHover = okBtn.mouseOver.nChildren[0];
        this.deathDialogOkPressed = okBtn.pressed.nChildren[0];
        this.deathDialogLoaded = true;
      } catch (e) {
        console.error('Error loading death dialog:', e);
        setTimeout(() => this.respawnAtTown(), 2000);
        return;
      }
    }
    this.deathDialogVisible = true;
  }

  getDeathDialogRect() {
    const bgImg = this.deathDialogBg?.nGetImage();
    if (!bgImg) return null;
    const x = Math.floor(400 - bgImg.width / 2);
    const y = Math.floor(300 - bgImg.height / 2);
    return { x, y, width: bgImg.width, height: bgImg.height };
  }

  drawDeathDialog(canvas: any) {
    if (!this.deathDialogVisible || !this.deathDialogLoaded) return;

    const bgImg = this.deathDialogBg?.nGetImage();
    if (!bgImg) return;

    const dlg = this.getDeathDialogRect()!;

    // Draw dialog background
    canvas.drawImage({ img: bgImg, dx: dlg.x, dy: dlg.y });

    // Draw OK button centered at bottom of dialog
    const btnImg = this._getDeathOkBtnImg(canvas);
    if (btnImg) {
      const btnX = dlg.x + Math.floor(dlg.width / 2) - Math.floor(btnImg.width / 2);
      const btnY = dlg.y + dlg.height - btnImg.height - 12;
      canvas.drawImage({ img: btnImg, dx: btnX, dy: btnY });
    }
  }

  _getDeathOkBtnImg(canvas: any) {
    const dlg = this.getDeathDialogRect();
    const normalImg = this.deathDialogOkNormal?.nGetImage();
    if (!dlg || !normalImg) return normalImg;

    const btnX = dlg.x + Math.floor(dlg.width / 2) - Math.floor(normalImg.width / 2);
    const btnY = dlg.y + dlg.height - normalImg.height - 12;
    const mx = canvas.mouseX;
    const my = canvas.mouseY;
    const over = mx >= btnX && mx <= btnX + normalImg.width &&
                 my >= btnY && my <= btnY + normalImg.height;

    if (over && canvas.clicked) return this.deathDialogOkPressed?.nGetImage();
    if (over) return this.deathDialogOkHover?.nGetImage();
    return normalImg;
  }

  handleDeathDialogClick(canvas: any): boolean {
    if (!this.deathDialogVisible) return false;
    const dlg = this.getDeathDialogRect();
    const normalImg = this.deathDialogOkNormal?.nGetImage();
    if (!dlg || !normalImg) return false;

    const btnX = dlg.x + Math.floor(dlg.width / 2) - Math.floor(normalImg.width / 2);
    const btnY = dlg.y + dlg.height - normalImg.height - 12;
    const mx = canvas.mouseX;
    const my = canvas.mouseY;
    if (mx >= btnX && mx <= btnX + normalImg.width &&
        my >= btnY && my <= btnY + normalImg.height) {
      this.respawnAtTown();
      return true;
    }
    return false;
  }

  async respawnAtTown() {
    this.deathDialogVisible = false;
    this.tombstoneActive = false;
    this.tombstoneDone = false;
    this.isDead = false;
    this.hp = Math.min(this.spawnDefaultHp, this.effectiveMaxHp);

    const { fadeToBlack } = await import('./MapState');
    fadeToBlack();

    if (!this.map!.isTown) {
      await this.map!.load(this.map!.getNearbyTownMapId());
    }

    const spawnLocation = this.map!.getCenterFootholdLocation();
    if (spawnLocation) {
      this.pos = new Physics();
      this.pos.x = spawnLocation.x;
      this.pos.y = spawnLocation.y;
    }
  }

  tombstoneYOffset: number = 0;

  updateTombstone(msPerTick: number) {
    if (!this.tombstoneActive || !this.tombstoneNode) return;

    // Animate the tombstone falling from the sky
    if (this.tombstoneYOffset < 0) {
      // Fall speed: accelerate with gravity
      this.tombstoneYOffset += msPerTick * 0.6;
      if (this.tombstoneYOffset >= 0) {
        this.tombstoneYOffset = 0;
      }
    }

    // Animate sprite frames
    this.tombstoneDelay += msPerTick;
    const frameNode = this.tombstoneNode.nChildren[this.tombstoneFrame];
    if (!frameNode) {
      this.tombstoneActive = false;
      this.tombstoneDone = true;
      this.showDeathDialog();
      return;
    }

    const frameDelay = frameNode.nGet('delay').nGet('nValue', 80);
    if (this.tombstoneDelay >= frameDelay) {
      this.tombstoneDelay -= frameDelay;
      this.tombstoneFrame++;
      if (this.tombstoneFrame >= this.tombstoneNode.nChildren.length) {
        // Keep showing last frame, mark done
        this.tombstoneFrame = this.tombstoneNode.nChildren.length - 1;
        this.tombstoneActive = false;
        this.tombstoneDone = true;
        this.showDeathDialog();
      }
    }
  }

  /**
   * Chair sprite. Drawn before the body because the item's `effect/z` is -1,
   * i.e. behind the character.
   *
   * Placed by its base rather than by `pos - origin`. These canvases carry a
   * negative origin.y (-16 on the Relaxer), which under the usual convention
   * puts the whole sprite below the character's feet — the chair ended up
   * floating well under them. Standing it on the foothold and centring it
   * horizontally is what actually matches the original.
   */
  drawChair(canvas: any, camera: any) {
    if (!this.chairId || !this.chairFrame) return;
    const img = this.chairFrame.nGetImage?.();
    if (!img) return;
    const size = GUIUtil.wzSize(this.chairFrame);
    canvas.drawImage({
      img,
      dx: Math.round(this.pos.x - size.width / 2 - camera.x),
      dy: Math.round(this.pos.y - size.height - camera.y + CHAIR_BASE_OFFSET),
    });
  }

  drawTombstone(canvas: any, camera: any) {
    if (!this.tombstoneNode) return;
    if (!this.tombstoneActive && !this.tombstoneDone) return;

    const frameIdx = Math.min(this.tombstoneFrame, this.tombstoneNode.nChildren.length - 1);
    const frameNode = this.tombstoneNode.nChildren[frameIdx];
    if (!frameNode) return;

    const img = frameNode.nGetImage();
    const origin = frameNode.origin;
    if (img && origin) {
      canvas.drawImage({
        img,
        dx: this.deathPosX - camera.x - origin.nX,
        dy: this.deathPosY - camera.y - origin.nY + this.tombstoneYOffset,
      });
    }
  }

  applyFallDamage(fallDistance: number) {
    return; // Fall damage disabled
    // Fall damage only triggers after falling a significant height
    // Normal jump = ~100-150px. Platform gaps = ~200-300px.
    // Only high drops (500+ pixels) should cause damage.
    const fallDamageThreshold = 500;
    if (fallDistance <= fallDamageThreshold) return;
    if (this.isDead) return;

    // Damage: 5% of max HP per 100 pixels beyond threshold
    const excessDistance = fallDistance - fallDamageThreshold;
    const damage = Math.floor(this.maxHp * (excessDistance / 100) * 0.05);
    if (damage > 0) {
      this.takeDamage(damage);
    }
  }

  async takeDamage(damage: number) {
    console.log(`Player take ${damage} damage`);

    if (!this.isDead) {
      if (this.hp - damage <= 0) {
        this.hp = 0;
        this.die();
      } else {
        this.hp -= damage;
      }
    }
  }

  /**
   * Apply damage from a mob to this (local) player — shared by touch damage,
   * mob melee/magic attacks, and mob projectiles. Respects i-frames, rolls
   * miss, computes v83 damage from mob PAD (or an attack override), handles
   * Magic Guard, knockback, indicators, and network notification.
   */
  applyMobAttack = (monster: any, padOverride?: number, isMagic = false) => {
    if (!this.map || this.isRemote || this.isDead) return;

    const currentTime = Date.now();
    if (currentTime - this.lastHitTime < this.hitCooldownTimeInMS) return;
    this.lastHitTime = currentTime;

    // Tutorial mobs always miss the player
    const TUTORIAL_MOB_IDS = [9300018, 9300328, 9300383, 9409000, 9409001];
    const isTutorialMob = TUTORIAL_MOB_IDS.includes(monster.id);

    const isMiss = isTutorialMob || (isMagic
      ? this.stats.getRandomMonsterMagicMiss(monster.mobLevel, monster.acc)
      : this.stats.getRandomMonsterTouchMiss(monster.mobLevel, monster.acc));

    const minXYPosition = findMinXY(this.bodyRects);
    const middleX = (minXYPosition.minX + this.pos.x) / 2;

    if (isMiss) {
      this.DamageIndicator.addDamageIndicator(
        DamageIndicatorType.MobHitPlayer,
        {
          x: middleX,
          y: minXYPosition.minY - 20,
        },
        0
      );
      if ((window as any).__mySocket) {
        (window as any).__mySocket.sendPlayerHitByMob(monster.oId, 0, true);
      }
      return;
    }

    const knowbackXdirection = this.pos.x - monster.pos.x > 0 ? 1 : -1;
    const knowbackYdirection = this.pos.y > monster.pos.y ? 1 : -1;
    this.pos.applyKnockback(knowbackXdirection, knowbackYdirection);

    // v83 mob damage: mob attack scaled by level gap, reduced by the player's
    // matching defense (weapon def for physical, magic def for magic)
    const pad = padOverride ?? (monster.pad || 1);
    const def = isMagic
      ? this.stats.getMagicDefense()
      : this.stats.getWeaponDefense();
    const levelFactor =
      1 + 0.01 * Math.max(0, (monster.mobLevel || 1) - this.stats.level);
    const damageRange = new DamageRange(
      Math.floor(pad * levelFactor * 0.7 - def * 0.6),
      Math.floor(pad * levelFactor - def * 0.5)
    );
    const finalTakenDamage = Math.max(
      1,
      Stats.getRandomAttackDamageFromAttackRange(damageRange)
    );

    // Magic Guard: a portion of the damage is taken from MP instead
    let hpDamage = finalTakenDamage;
    const magicGuard = this.buffManager?.activeBuffs?.get?.(2001002);
    if (magicGuard) {
      const mpPortion = Math.min(
        this.mp,
        Math.floor((finalTakenDamage * (magicGuard.effect.x || 0)) / 100)
      );
      this.mp -= mpPortion;
      hpDamage = finalTakenDamage - mpPortion;
    }
    this.takeDamage(hpDamage);

    this.DamageIndicator.addDamageIndicator(
      DamageIndicatorType.MobHitPlayer,
      {
        x: middleX,
        y: minXYPosition.minY - 20,
      },
      finalTakenDamage
    );

    if (!this.isInAttack) {
      this.setAlert();
    }

    if ((window as any).__mySocket) {
      (window as any).__mySocket.sendPlayerHitByMob(monster.oId, finalTakenDamage, false);
    }
  };

  checkForMobsHit = () => {
    try {
    if (!this.map || this.isRemote) return;
    if (!this.isDead) {
      const currentTime = new Date().getTime();

      if (currentTime - this.lastHitTime >= this.hitCooldownTimeInMS) {
        const monster = this.map!.monsters.filter(
          // bodyAttack === 0 mobs (ranged-only) deal no touch damage
          (monster: Monster) => monster.dying === false && (monster as any).bodyAttack !== 0
        ).find((monster: Monster) => {
          // Slim fixed body box, not the sprite union — see TOUCH_HALF_W
          const isHit = areAnyRectanglesOverlapping(
            [{
              x: this.pos.x - TOUCH_HALF_W,
              y: this.pos.y - TOUCH_H,
              width: TOUCH_HALF_W * 2,
              height: TOUCH_H,
            }],
            {
              x: monster.x,
              y: monster.y,
              width: monster.width,
              height: monster.height,
            },
            this.mobHitMinOverlapPercentage
          );

          return isHit;
        });

        if (monster) {
          this.applyMobAttack(monster);
        }
      }
    }
    } catch (e) {
      console.error('[checkForMobsHit] crash:', e);
    }
  };

  checkForItemDropPickup = (AllowMultiPickupAtOnce = false) => {
    if (!this.map) return;
    const itemDrops: DropItemSprite[] = this.map!.itemDrops.filter(
      (itemDrop: DropItemSprite) => {
        if (itemDrop.isAlreadyPickedUp || !itemDrop.hasLanded) {
          return false;
        }
        // frame may not be set yet if draw hasn't run
        if (!itemDrop.frame || !itemDrop.pos) {
          return false;
        }
        const isHit = areAnyRectanglesOverlapping(
          this.bodyRects,
          {
            x: itemDrop.pos!.x - itemDrop.frame.nWidth / 2,
            y: itemDrop.pos!.y - itemDrop.frame.nHeight,
            width: itemDrop.frame.nWidth,
            height: itemDrop.frame.nHeight,
          },
          1
        );

        return isHit;
      }
    );

    for (const itemDrop of itemDrops) {
      itemDrop.goToPlayer(this.pos.vx, this.pos.vy);
      itemDrop.isAlreadyPickedUp = true;
      console.log("itemDrop", itemDrop);
      // Broadcast pickup to other players
      const netDropId = (itemDrop as any)._netDropId;
      if (netDropId && (window as any).__mySocket) {
        (window as any).__mySocket.sendItemPickup(netDropId);
      }
      // this is async. Equips must use the numeric drop id — their
      // itemFile.nName is a Character.wz filename, not an item id. Other
      // drops (incl. mesos, id=0) keep resolving via itemFile.nName.
      // equipData restores scroll bonuses on picked-up gear.
      const isEquipDrop = Math.floor(itemDrop.id / 1000000) === 1;
      this.inventory.addToInventory(
        isEquipDrop ? itemDrop.id : itemDrop.itemFile.nName,
        itemDrop.amount,
        isEquipDrop ? (itemDrop as any).equipData ?? undefined : undefined,
      );
      this.logPickupMessage(
        isEquipDrop ? itemDrop.id : parseInt(String(itemDrop.itemFile.nName), 10),
        itemDrop.amount,
      );

      if (!AllowMultiPickupAtOnce) {
        break;
      }
    }
  };

  // GMS-style chat log line for a picked-up drop
  async logPickupMessage(itemId: number, amount: number) {
    if (this.isRemote || !Number.isFinite(itemId)) return;
    try {
      const { default: UIChatLog } = await import('./UI/UIChatLog');
      if (itemId >= 9000000 && itemId <= 9000003) {
        UIChatLog.system(`You have gained mesos (+${amount})`);
        return;
      }
      const { ensureItemNames, getItemNameSync } = await import('./Quest/QuestData');
      await ensureItemNames();
      const name = getItemNameSync(itemId) || `Item #${itemId}`;
      UIChatLog.system(`You have gained an item (${name})`);
    } catch { /* chat message is cosmetic */ }
  }

  update(msPerTick: number) {
    if (!this.active) {
      return;
    }

    // Update buff timers
    if (this.buffManager) {
      this.buffManager.update(msPerTick);
    }

    this.updateChair(msPerTick);

    // Update chat balloon timer
    if (this.showChatBalloon) {
      this.chatBalloonTimer += msPerTick;
      if (this.chatBalloonTimer >= this.chatBalloonDuration) {
        this.showChatBalloon = false;
        this.chatBalloonTimer = 0;
      }
    }

    // Update tombstone animation when dead
    if (this.isDead) {
      this.updateTombstone(msPerTick);
      return;
    }

    if (!!this.levelingUp) {
      this.levelUpDelay += msPerTick;
      if (this.levelUpDelay > 120) {
        this.levelUpDelay = this.levelUpDelay - 120;
        this.levelUpFrame += 1;
      }
      if (!this.levelUpFrames[this.levelUpFrame]) {
        this.levelingUp = false;
        this.levelUpFrame = 0;
        this.levelUpDelay = 0;
      }
    }

    // Quest clear effect
    if (this.questClearActive && this.questClearFrames) {
      this.questClearDelay += msPerTick;
      const curFrame = this.questClearFrames[this.questClearFrame];
      const frameDelay = curFrame?.delay?.nValue ?? 100;
      if (this.questClearDelay > frameDelay) {
        this.questClearDelay -= frameDelay;
        this.questClearFrame += 1;
      }
      if (this.questClearFrame >= this.questClearFrames.length || !this.questClearFrames[this.questClearFrame]) {
        this.questClearActive = false;
        this.questClearFrame = 0;
        this.questClearDelay = 0;
      }
    }

    // Job advancement effect
    if (this.jobChangedActive && this.jobChangedFrames) {
      this.jobChangedDelay += msPerTick;
      const curFrame = this.jobChangedFrames[this.jobChangedFrame];
      const frameDelay = curFrame?.delay?.nValue ?? 100;
      if (this.jobChangedDelay > frameDelay) {
        this.jobChangedDelay -= frameDelay;
        this.jobChangedFrame += 1;
      }
      if (this.jobChangedFrame >= this.jobChangedFrames.length || !this.jobChangedFrames[this.jobChangedFrame]) {
        this.jobChangedActive = false;
        this.jobChangedFrame = 0;
        this.jobChangedDelay = 0;
      }
    }

    // Skill effect animation (buff/attack visual)
    if (this.skillEffectActive && this.skillEffectFrames) {
      this.skillEffectDelay += msPerTick;
      const curFrame = this.skillEffectFrames[this.skillEffectFrame];
      const frameDelay = curFrame?.delay?.nValue ?? curFrame?.nGet?.('delay')?.nValue ?? 90;
      if (this.skillEffectDelay > frameDelay) {
        this.skillEffectDelay -= frameDelay;
        this.skillEffectFrame += 1;
      }
      if (this.skillEffectFrame >= this.skillEffectFrames.length || !this.skillEffectFrames[this.skillEffectFrame]) {
        this.skillEffectActive = false;
        this.skillEffectFrame = 0;
        this.skillEffectDelay = 0;
      }
    }

    // Quest start/alert effect
    if (this.questStartActive && this.questStartFrames) {
      this.questStartDelay += msPerTick;
      const curFrame = this.questStartFrames[this.questStartFrame];
      const frameDelay = curFrame?.delay?.nValue ?? 100;
      if (this.questStartDelay > frameDelay) {
        this.questStartDelay -= frameDelay;
        this.questStartFrame += 1;
      }
      if (this.questStartFrame >= this.questStartFrames.length || !this.questStartFrames[this.questStartFrame]) {
        this.questStartActive = false;
        this.questStartFrame = 0;
        this.questStartDelay = 0;
      }
    }

    // IncEXP effect
    if (this.incExpActive && this.incExpFrames) {
      this.incExpDelay += msPerTick;
      const curFrame = this.incExpFrames[this.incExpFrame];
      const frameDelay = curFrame?.delay?.nValue ?? 80;
      if (this.incExpDelay > frameDelay) {
        this.incExpDelay -= frameDelay;
        this.incExpFrame += 1;
      }
      if (this.incExpFrame >= this.incExpFrames.length || !this.incExpFrames[this.incExpFrame]) {
        this.incExpActive = false;
        this.incExpFrame = 0;
        this.incExpDelay = 0;
      }
    }

    this.delay += msPerTick;
    if (this.delay > this.nextDelay) {
      this.advanceFrame();
    }

    // Mount animation runs on its own clock (the body holds the 'sit' frame),
    // and riding grants v83 hog speed (+50%)
    if (this.isRiding) {
      const mountImg: any = this.equips[19];
      const stanceNode = mountImg?.[this.mountStance] || mountImg?.stand1;
      const frameNode = stanceNode?.[this.mountFrame];
      if (!frameNode) {
        this.mountFrame = 0;
        this.mountDelay = 0;
      } else {
        this.mountDelay += msPerTick;
        const frameDelay = Math.abs(frameNode.nGet("delay").nGet("nValue", 180));
        if (this.mountDelay > frameDelay) {
          this.mountDelay -= frameDelay;
          this.mountFrame = stanceNode?.[this.mountFrame + 1] ? this.mountFrame + 1 : 0;
        }
      }
      this.pos.walk_speed = 187.5;
    } else if (this.pos.walk_speed !== 125) {
      this.pos.walk_speed = 125;
    }

    // check if hit by mob
    this.checkForMobsHit();

    this.pos.update(msPerTick);

    // Clamp player to map boundaries — prevent falling off left/right edges
    if (this.map && this.map.boundaries) {
      const b = this.map.boundaries;
      if (this.pos.x < b.left) {
        this.pos.x = b.left;
        this.pos.vx = 0;
      } else if (this.pos.x > b.right) {
        this.pos.x = b.right;
        this.pos.vx = 0;
      }
      // If player falls below the map, respawn at center
      if (this.pos.y > b.bottom + 300) {
        const spawnPos = this.map.getCenterFootholdLocation?.();
        if (spawnPos) {
          this.pos.x = spawnPos.x;
          this.pos.y = spawnPos.y;
        } else {
          this.pos.x = (b.left + b.right) / 2;
          this.pos.y = b.top;
        }
        this.pos.vx = 0;
        this.pos.vy = 0;
        this.pos.fh = null;
      }
    }

    // If the physics climb ended without a key event (dropped off the rope
    // end, knockback), clear the character climb state too — otherwise the
    // rope stance sticks while falling
    if (this.isInClimbingRope && !this.pos.isClimbing) {
      this.releaseRope();
    }

    // Let go at BOTH ends of the rope. Climbing bypasses foothold collision,
    // so without this a descent carries on past the foot and drops the
    // character through the map floor. Letting go hands back to normal
    // physics, which lands them on the foothold at that end.
    //
    // The top end used to pin the character at y1 instead of letting go, and
    // since y1 is 2px below the platform the rope hangs from, that left them
    // standing in the climb stance on top of the terrain rather than stepping
    // onto it. Climb a little past the head, then let go and drop onto the
    // platform — the same few pixels of slack the grab box uses.
    if (this.isInClimbingRope && this.pos.isClimbing && this.climbRopeBounds) {
      const { y1, y2 } = this.climbRopeBounds;
      const offBottom = this.pos.y > y2;
      const offTop = this.pos.y + GRAB_SLACK < y1;
      if (offBottom || offTop) {
        // Only the foot needs snapping back; overshoot at the head is what
        // carries the character up over the lip of the platform.
        if (offBottom) this.pos.y = y2;
        this.pos.stopClimb();
        this.releaseRope();
      }
    }

    // Fall damage: check if we just landed after a long fall
    if (this.pos.fallDistance > 0 && this.pos.fh) {
      this.applyFallDamage(this.pos.fallDistance);
      this.pos.fallDistance = 0;
    }

    this.projectiles = this.projectiles.filter(
      (projectile: Projectile) => !projectile.isFullyDone()
    );

    this.projectiles.forEach((projectile: Projectile) => {
      projectile.update(msPerTick);
    });
  }
  
  getDrawableFrames(
    stance: any,
    frame: number,
    flipped: boolean,
    includeEquips = true
  ) {
    const imgdir = this.baseBody[stance][frame];
    const realStance = !imgdir.action ? stance : imgdir.action.nValue;
    const realFrame = !imgdir.action ? frame : imgdir.frame.nValue;
    const faceExpr = this.faceExpr;
    const faceFrame = this.faceFrame;
    const useBackHead = !this.body[realStance][realFrame].face.nValue;

    const isDrawable = (n: any) =>
      n.nTagName === "canvas" || n.nTagName === "uol";
    const isClimbStance = realStance === 'ladder' || realStance === 'rope';
    const getParts = (img: any) => {
      const stanceNode = img.nGet(realStance);
      if (!stanceNode || !stanceNode.nChildren || stanceNode.nChildren.length === 0) {
        // Climbing (back view): parts without ladder/rope frames are simply
        // not drawn in GMS — weapons have none, so no sword across the face
        if (isClimbStance) return [];
        // Fallback to stand1 if the part doesn't have this stance (e.g. hair has no 'dead')
        return img.nGet('stand1').nGet(0).nChildren;
      }
      return stanceNode.nGet(realFrame).nChildren;
    };
    const getFParts = (img: any) =>
      img.nGet(faceExpr).nGet(faceFrame).nChildren;

    const twoChars = /.{1,2}/g;
    // v83 characters are never fully naked — empty top/bottom slots render
    // default underwear (a longcoat covers both, so no underpants under it)
    const effectiveEquips = [...this.equips];
    const topId = this.equippedItemIds?.[4];
    const hasLongcoat = !!topId && Math.floor(topId / 10000) === 105;
    if (!effectiveEquips[4] && this.underwearTop) {
      effectiveEquips[4] = this.underwearTop;
    }
    if (!effectiveEquips[5] && !hasLongcoat && this.underwearBottom) {
      effectiveEquips[5] = this.underwearBottom;
    }
    // Taming mob + saddle never render as regular equip layers — they are
    // composed as the riding mount (seeded first) when the stance is 'sit'
    const riding = stance === "sit" && !!effectiveEquips[19];
    effectiveEquips[19] = undefined;
    effectiveEquips[20] = undefined;
    if (riding || stance === "sit") {
      // v83 hides the weapon in the sit stance — weapons have no 'sit'
      // frames, so it would otherwise fall back to a standing pose and hang
      // in mid-air across the body. Applies to chairs as well as mounts.
      effectiveEquips[10] = undefined;
    }
    const [hat, faceAcc, ...equips] = effectiveEquips;

    const hatVslot = !hat ? "" : hat.info.vslot.nValue;
    const hatParts = !hat ? [] : getParts(hat).filter(isDrawable);
    const hatSmapValues = hatParts.reduce((acc: any, p: any) => {
      try {
        const part = p.nTagName === "uol" ? p.nResolveUOL() : p;
        return `${acc}${this.smap.getValueFromName(part.z.nValue)}`;
      } catch (ex) {
        console.error(`Broken UOL ${p.nGetPath()}`);
        return acc;
      }
    }, "");
    const hatVslotPairs = new Set(hatVslot.match(twoChars));
    const hatSmapPairs = new Set(hatSmapValues.match(twoChars));
    const hatSmapIntersection = new Set(
      [...hatVslotPairs].filter((val) => hatSmapPairs.has(val))
    );

    const map: any = {};
    const drawableFrames: any = [];

    const addFrame = (p: any, vslot: any) => {
      try {
        p.nResolveUOL();
      } catch (ex) {
        console.error(`Broken UOL ${p.nGetPath()}`);
        return;
      }

      const part = p.nTagName === "uol" ? p.nResolveUOL() : p;
      // A UOL can resolve to nothing (e.g. a part with no frames for this
      // stance) — skip it instead of crashing the whole render frame
      if (!part || !part.map?.nChildren) {
        return;
      }
      const pointInMap = (vector: any) => !!map[vector.nName];
      const pointNotInMap = (vector: any) => !map[vector.nName];

      const mappedPoints = part.map.nChildren.filter(pointInMap);
      const xSum = mappedPoints.reduce((acc: any, mappedPoint: any) => {
        const adjustedPointX = !flipped ? mappedPoint.nX : -mappedPoint.nX;
        return acc + map[mappedPoint.nName].x - adjustedPointX;
      }, 0);
      const ySum = mappedPoints.reduce((acc: any, mappedPoint: any) => {
        return acc + map[mappedPoint.nName].y - mappedPoint.nY;
      }, 0);
      const numMappedPoints = Math.max(mappedPoints.length, 1);
      let x = Math.floor(xSum / numMappedPoints);
      let y = Math.floor(ySum / numMappedPoints);

      part.map.nChildren.filter(pointNotInMap).forEach((mappedPoint: any) => {
        map[mappedPoint.nName] = {
          x: x + (!flipped ? mappedPoint.nX : -mappedPoint.nX),
          y: y + mappedPoint.nY,
        };
      });

      const originX = part.origin.nX;
      const adjustX = !flipped ? originX : part.nWidth - originX;
      x -= adjustX;
      y -= part.origin.nY;

      const partVslot = vslot;
      const partSmapValue = this.smap.getValueFromName(part.z.nValue) || "";
      const partVslotPairs = new Set(vslot.match(twoChars));
      const partSmapPairs = new Set(partSmapValue.match(twoChars));
      const partSmapIntersection = new Set(
        [...partVslotPairs].filter((val) => partSmapPairs.has(val))
      );
      const intersectionWithHat = [...partSmapIntersection].filter((val) => {
        return hatSmapIntersection.has(val);
      });
      const invisibleZs: any = intersectionWithHat.reduce(
        (acc: any, val: any) => {
          (this.smap.getNamesFromValue(val) || []).forEach((z: number) => {
            acc.add(z);
          });
          return acc;
        },
        new Set()
      );
      if (invisibleZs.has(part.z.nValue)) {
        return;
      }

      const realZ = part.z.nValue === 0 ? part.nName : part.z.nValue;
      drawableFrames.push({
        img: part.nGetImage(),
        z: this.zmap.indexOf(realZ),
        x,
        y,
      });
    };

    // Riding: the mount goes in first with no prior map points, so its origin
    // (its own feet) lands exactly at pos — standing on the foothold. Its
    // 'navel' map point is registered, and the sitting body attaches there,
    // raising the rider onto the mount's back. The saddle aligns the same way.
    if (riding) {
      const mountImg: any = this.equips[19];
      const mountVslot = mountImg.info?.vslot?.nValue || "";
      const mStanceNode = mountImg[this.mountStance] || mountImg["stand1"];
      const mFrameNode = mStanceNode?.[this.mountFrame] || mStanceNode?.[0];
      if (mFrameNode) {
        [...mFrameNode.nChildren]
          .filter(isDrawable)
          .forEach((p: any) => addFrame(p, mountVslot));
      }
      if (includeEquips) {
        const saddleImg: any = this.equips[20] || this.defaultSaddle;
        const mountId = this.equippedItemIds[19];
        const sMountNode = saddleImg?.[String(mountId)];
        const sStanceNode = sMountNode?.[this.mountStance] || sMountNode?.["stand1"];
        const sFrameNode = sStanceNode?.[this.mountFrame] || sStanceNode?.[0];
        if (sFrameNode) {
          const saddleVslot = saddleImg.info?.vslot?.nValue || "";
          [...sFrameNode.nChildren]
            .filter(isDrawable)
            .forEach((p: any) => addFrame(p, saddleVslot));
        }
      }
    }

    const imgs = [
      this.body,
      this.head,
      this.Hair,
      this.Face,
      hat,
      faceAcc,
      // ...equips,
    ];

    if (includeEquips) {
      imgs.push(...equips);
    }

    imgs.forEach((img) => {
      if (!img) {
        return;
      }

      const imgVslot = img.info.vslot.nValue;
      const isHead = img === this.head;
      const isFace = img === this.Face || img === faceAcc;
      const isHair = img === this.Hair;

      if (isFace && useBackHead) {
        return;
      }

      let imgParts;
      if (isHead) {
        imgParts = useBackHead ? img.back.nChildren : img.front.nChildren;
      } else if (isFace) {
        imgParts = getFParts(img);
      } else if (isHair) {
        imgParts = getParts(img).filter((n: any) => n.nName !== "hairShade");
      } else {
        imgParts = getParts(img);
      }

      const drawableImgParts = imgParts.filter(isDrawable);

      drawableImgParts.forEach((p: any) => addFrame(p, imgVslot));
    });

    drawableFrames.sort((a: any, b: any) => a.z - b.z);

    return drawableFrames;
  }

  draw(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    // Remove this condition - don't return early for layer 0
    // if(this.pos.layer === 0){
    //   return;
    // }
    
    // console.log(this.frame, `${Math.round(1000 / msPerTick)}fps`);
    // Remote characters get stance from network — skip local stance logic
    if (!this.isRemote) {
      // set whether the character is flipped prior to drawing
      if (this.pos.right && !this.pos.left) {
        this.flipped = true;
      } else if (this.pos.left && !this.pos.right) {
        this.flipped = false;
      }

      // Ladders and ropes have distinct v83 climb stances
      const climbStance = this.climbingIsLadder ? Stance.ladder : Stance.rope;
      // Two-handed weapons use the stand2/walk2 stance family
      const standStance = this.weaponStandType === 2 ? Stance.stand2 : Stance.stand1;
      const walkStance = this.weaponWalkType === 2 ? Stance.walk2 : Stance.walk1;
      // Airborne in a swim map = swimming (fly stance), otherwise jumping
      const airStance = this.map?.isSwimMap ? Stance.fly : Stance.jump;
      // Anything that isn't sitting still gets you out of the chair, the
      // same way the original does — walking, jumping off, crouching,
      // attacking, grabbing a rope or dying
      if (
        this.chairId &&
        (this.isDead ||
          this.isInAttack ||
          this.isInClimbingRope ||
          !this.pos.fh ||
          this.pos.down ||
          this.pos.left !== this.pos.right)
      ) {
        this.standUpFromChair();
      }

      if (this.isDead) {
        this.setStance(Stance.dead);
      } else if (this.chairId) {
        this.setStance("sit");
      } else if (this.isRiding && !this.isInClimbingRope) {
        // v83 riding: the body holds 'sit' while the mount supplies the
        // movement animation (stand1/walk1/jump)
        this.setStance("sit");
        this.mountStance = !this.pos.fh
          ? "jump"
          : this.pos.left !== this.pos.right
            ? "walk1"
            : "stand1";
      } else {
        // set the stance
        if (this.isInAttack || this.isInAlert) {
          // is in alert only
          if (!this.isInAttack) {
            if (!this.pos.fh) {
              if (this.isInClimbingRope) {
                this.setStance(climbStance, 0, false, this.isClimbMoving);
              } else {
                this.setStance(airStance);
              }
            } else {
              if (this.isInAlert && this.pos.left !== this.pos.right) {
                this.setStance(walkStance);
              } else {
                if (this.isInClimbingRope) {
                  this.setStance(climbStance, 0, false, this.isClimbMoving);
                } else if (this.stance) {
                  this.setStance(Stance.alert, 0, false, true);
                }
              }
            }
          } else {
          }
        } else if (this.isInClimbingRope) {
          this.setStance(climbStance, 0, false, this.isClimbMoving);
        } else {
          if (!this.pos.fh) {
            this.setStance(airStance);
          } else if (this.pos.down) {
            // Holding down on the ground crouches (v83 prone)
            this.setStance(Stance.prone);
          } else if (this.pos.left !== this.pos.right) {
            this.setStance(walkStance);
          } else {
            this.setStance(standStance);
          }
        }
      }
    }
  
    // Draw tombstone behind character when dead
    this.drawChair(canvas, camera);
    this.drawTombstone(canvas, camera);

    const characterIsFlipped = !!this.flipped;
    const imgdir = this.baseBody[this.stance][this.frame];
  
    const imgdirFlip = !!imgdir.nGet("flip").nGet("nValue", 0);
    const frameIsFlipped = characterIsFlipped !== imgdirFlip;
    const drawableFrames = this.getDrawableFrames(
      this.stance,
      this.frame,
      frameIsFlipped
    );
  
    // this is inefficient to call everything just to get it without equips, but it's temporary
    const drawableBodyFrames = this.getDrawableFrames(
      this.stance,
      this.frame,
      frameIsFlipped,
      false
    );
  
    const mx = imgdir.nGet("move").nGet("nX", 0);
    const moveX = !characterIsFlipped ? mx : -mx;
    const moveY = imgdir.nGet("move").nGet("nY", 0);
    const rotate = imgdir.nGet("rotate").nGet("nValue", 0);
    const angle = !characterIsFlipped ? rotate : 360 - rotate;
  
    let spriteWidth = 0;
    let spriteHeight = 0;
    let minDx = 0;
    let minDy = 0;
  
    // draws all parts of the character: head, body, etc..
    let spriteBottomY = 0;
    drawableFrames.forEach((frame: any) => {
      const dx = Math.floor(this.pos.x + frame.x - camera.x + moveX);
      const dy = Math.floor(this.pos.y + frame.y - camera.y + moveY);

      spriteBottomY = Math.max(spriteBottomY, frame.y + frame.img.height + moveY);

      canvas.drawImage({
        img: frame.img,
        dx: dx,
        dy: dy,
        flipped: frameIsFlipped,
        rx: -frame.x,
        ry: -frame.y,
        angle,
      });
    });
    this.spriteBottomY = spriteBottomY;
  
    this.bodyRects = [];
    let minX: number | null = null;
    let minY: number | null = null;
  
    drawableBodyFrames.forEach((frame: any) => {
      const dx = Math.floor(this.pos.x + frame.x - camera.x + moveX);
      const dy = Math.floor(this.pos.y + frame.y - camera.y + moveY);
  
      // Draw a border around the player's outline
      //const outlineColor = "blue"; // Change this to the desired border color
      //const borderWidth = 2; // Change this to the desired border width
  
      //canvas.context.strokeStyle = outlineColor;
      //canvas.context.lineWidth = borderWidth;
      //canvas.context.strokeRect(dx, dy, frame.img.width, frame.img.height);
  
      this.bodyRects.push({
        x: dx + camera.x,
        y: dy + camera.y,
        width: frame.img.width,
        height: frame.img.height,
      });
  
      if (minX === null || dx < minX) {
        minX = dx + camera.x;
      }
      if (minY === null || dy < minY) {
        minY = dy + camera.y;
      }
    });
  
    this.bodyStartPoistion = {
      x: minX,
      y: minY,
    };
  
    this.drawName(canvas, camera, lag, msPerTick, tdelta);
  
    this.drawDamageIndicator(canvas, camera, lag, msPerTick, tdelta);
  
    this.projectiles.forEach((projectile: Projectile) => {
      projectile.draw(canvas, camera, lag, msPerTick, tdelta);
    });
  
    const minXYPosition = findMinXY(this.bodyRects);
    const maxXYPosition = findMaxXY(this.bodyRects);

    // Draw chat balloon above character
    if (this.showChatBalloon && this.chatBalloon && this.chatMessage) {
      this.drawChatBalloon(canvas, camera);
    }
  }

  drawChatBalloon(canvas: GameCanvas, camera: CameraInterface) {
    if (!this.chatBalloon || !this.chatMessage || !this.showChatBalloon) return;

    const fontSize = 12;
    const lineH = 14;
    const maxTextW = 140;
    const padX = 8, padY = 4;

    // GMS player balloons show "Name : message"
    const fullText = this.name ? `${this.name} : ${this.chatMessage}` : this.chatMessage;

    // Word-wrap
    const words = fullText.split(' ');
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
    const innerW = Math.max(textW + padX * 2, 60);
    const innerH = Math.max(textH + padY * 2, 20);
    const totalW = nwW + innerW + neW;
    const totalH = nwH + innerH + swH;

    const playerScreenX = this.pos.x - camera.x;
    const bx = Math.round(playerScreenX - totalW / 2);

    // Anchor the tail tip right at the top of the sprite, like GMS.
    // bodyRects (world coords) come from the last draw; fall back to a fixed
    // offset above the feet before the first frame fills them.
    const arrowH = arrow.height || 7;
    let headTopScreenY = this.pos.y - camera.y - 62;
    if (this.bodyRects?.length) {
      headTopScreenY = findMinXY(this.bodyRects).minY - camera.y;
    }
    const by = Math.round(headTopScreenY - totalH - arrowH + 2);

    const ctx = canvas.context;
    ctx.save();

    // Corners
    canvas.drawImage({ img: nw, dx: bx, dy: by });
    canvas.drawImage({ img: ne, dx: bx + totalW - neW, dy: by });
    canvas.drawImage({ img: sw, dx: bx, dy: by + totalH - sw.height });
    canvas.drawImage({ img: se, dx: bx + totalW - se.width, dy: by + totalH - se.height });

    // Top edge
    ctx.save(); ctx.beginPath(); ctx.rect(bx + nwW, by, innerW, nwH); ctx.clip();
    GUIUtil.tileRange(bx + nwW, bx + nwW + innerW, n.width, (tx) => canvas.drawImage({ img: n, dx: tx, dy: by }));
    ctx.restore();

    // Bottom edge
    ctx.save(); ctx.beginPath(); ctx.rect(bx + nwW, by + totalH - s.height, innerW, s.height); ctx.clip();
    GUIUtil.tileRange(bx + nwW, bx + nwW + innerW, s.width, (tx) => canvas.drawImage({ img: s, dx: tx, dy: by + totalH - s.height }));
    ctx.restore();

    // Left edge
    ctx.save(); ctx.beginPath(); ctx.rect(bx, by + nwH, w.width, innerH); ctx.clip();
    GUIUtil.tileRange(by + nwH, by + nwH + innerH, w.height, (ty) => canvas.drawImage({ img: w, dx: bx, dy: ty }));
    ctx.restore();

    // Right edge
    ctx.save(); ctx.beginPath(); ctx.rect(bx + totalW - e.width, by + nwH, e.width, innerH); ctx.clip();
    GUIUtil.tileRange(by + nwH, by + nwH + innerH, e.height, (ty) => canvas.drawImage({ img: e, dx: bx + totalW - e.width, dy: ty }));
    ctx.restore();

    // Center fill
    ctx.save(); ctx.beginPath(); ctx.rect(bx + nwW, by + nwH, innerW, innerH); ctx.clip();
    GUIUtil.tileRange(by + nwH, by + nwH + innerH, c.height, (fy) =>
      GUIUtil.tileRange(bx + nwW, bx + nwW + innerW, c.width, (fx) =>
        canvas.drawImage({ img: c, dx: fx, dy: fy })));
    ctx.restore();

    // Arrow
    canvas.drawImage({ img: arrow, dx: Math.round(playerScreenX - arrow.width / 2), dy: by + totalH - 1 });

    ctx.restore();

    // Text
    const textStartY = by + nwH + padY;
    lines.forEach((line: string, i: number) => {
      canvas.drawText({ text: line, x: bx + totalW / 2, y: textStartY + i * lineH, color: '#000000', align: 'center', fontSize, fontWeight: 'normal' });
    });
  }

  drawName(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    const tagHeight = 16;
    const tagPadding = 4;
    const tagColor = "#000000";
    const tagAlpha = 0.7;
    // Mounts (slot 19) are drawn below the feet — anchor the tag under the
    // mount's lowest pixel instead of across it
    const mountOffset = this.equips[19] ? Math.max(0, this.spriteBottomY) : 0;
    const offsetFromY = 2 + mountOffset;
    const nameOpts = {
      text: this.name,
      x: Math.floor(this.pos.x - camera.x),
      y: Math.floor(this.pos.y - camera.y + offsetFromY + 3),
      color: "#ffffff",
      align: "center",
    };
    const nameWidth = Math.ceil(
      canvas.measureText(nameOpts).width + tagPadding
    );
    const nameTagX = Math.round(this.pos.x - camera.x - nameWidth / 2);
    canvas.drawRect({
      x: nameTagX,
      y: Math.floor(this.pos.y - camera.y + offsetFromY),
      width: nameWidth,
      height: tagHeight,
      color: tagColor,
      alpha: tagAlpha,
    });
    canvas.drawText(nameOpts);
  }
  drawDamageIndicator(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    this.DamageIndicator.drawAllDamageIndicators(
      canvas,
      camera,
      lag,
      msPerTick,
      tdelta
    );
  }
}

export default MapleCharacter;
