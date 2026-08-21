import WZManager from "./wz-utils/WZManager";
import PLAY_AUDIO from "./Audio/PlayAudio";
import { Physics } from "./Physics";
import { MobStance } from "./Constants/enums/Stance";
import WZFiles from "./Constants/enums/WZFiles";
import DamageIndicator, {
  DamageIndicatorType,
} from "./Effects/DamageIndicator";
import { MobSounds } from "./Constants/Mob/Mob";
import DropItemSprite from "./DropItem/DropItemSprite";
import DropRandomizer from "./DropItem/DropRandomizer";
import GameCanvas from "./GameCanvas";
import { CameraInterface } from "./Camera";
import MySocket from "./mysocket";
import MobProjectile from "./Projectile/MobProjectile";
import PartyManager from "./Party/PartyManager";
import SkillData from "./Skills/SkillData";
import { MobSkillArt, MobSkillId, MobSkillLevel } from "./Mob/MobSkillData";
import MobSkillRunner, { MobSkillCast, MobSkillEntry, buffKeyOf } from "./Mob/MobSkillRunner";

/** A timed status a mob skill put on the mob (see MobSkillRunner.buffKeyOf) */
interface MobBuff {
  skillId: number;
  /** The skill's x — percent for stat buffs, fixed damage for reflects */
  value: number;
  /** The skill's y — 145's magic reflect amount */
  y: number;
  until: number;
  /** The skill's `mob` art, carried for the duration */
  art: MobSkillArt | null;
  frame: number;
  delay: number;
}

/** One-shot art drawn at the mob (cast `effect`, group `mob0`) */
interface MobArtPlay {
  art: MobSkillArt;
  frame: number;
  delay: number;
}
// Safety net for a cast whose stance never reports finishing
const CAST_MAX_MS = 3000;

// Aggro tuning (v83-style: firstAttack mobs charge on sight, others when hit)
const AGGRO_RANGE_X = 250;
const AGGRO_RANGE_Y = 100;
const DEAGGRO_RANGE_X = 400;
const DEAGGRO_GRACE_MS = 3000;
const TARGET_SCAN_MS = 250;
// How long a mob keeps chasing after the last hit that provoked it. Aggro used
// to be permanent once damage landed, so a snail you tapped once followed you
// around its patrol for the rest of its life. Aggressive (firstAttack) mobs
// re-acquire on the very next scan while you are in range, so this only calls
// off the chase for mobs whose interest you created by attacking them.
const AGGRO_HOLD_MS = 10000;
// How long a chasing jump-mob must fail to advance before it reads as pinned
// and hops, then how long until it may hop again (longer when the last hop
// gained no ground — that barrier isn't clearable).
const CHASE_PIN_MS = 350;
const CHASE_HOP_MS = 700;
const CHASE_HOP_RETRY_MS = 2500;
// How long a pinned mob walks the other way before it may turn back — long
// enough to read as pacing rather than as a mob vibrating against a wall.
const CHASE_BACKOFF_MS = 900;
// Strikes against the same obstacle before a chasing mob accepts it cannot get
// there, and how long it then ignores the target. Without the window an
// aggressive mob re-acquires the player on the next 250ms scan and walks back
// into the same corner for good.
const PIN_STRIKES_TO_GIVE_UP = 2;
const AGGRO_GIVEUP_MS = 10000;
// Getting around cleanly for this long wipes the strike count
const PIN_STRIKE_RESET_MS = 5000;

type MobMoveType = "stationary" | "walk" | "jump" | "fly";

class Monster {
  opts: any;
  oId: number = 0;
  id: number = 0;

  fh: any = null;
  minX: number = 0;
  maxX: number = 0;
  map: any = null;
  mobFile: any = null;
  pos: any = null;
  jumpProbability: number = 0;
  lastDirectionChangeTime: number = 0;
  delayBetweenDirectionChange: number = 0;
  isBoss: boolean = false;
  hpTagColor: number = 0;
  elemMultipliers: Record<string, number> = {};
  sounds: any = {};
  dying: boolean = false;
  isMovementEnabled: boolean = false;
  isShotHpBar: boolean = false;
  isInHit: boolean = false;
  afterHitShowHpBarTime: number = 0;
  afterHitShowHpBarTimer: any = null;
  maxHp: number = 0;
  maxMp: number = 0;
  hp: number = 0;
  mp: number = 0;
  acc: number = 0;
  eva: number = 0;
  // Weapon/magic attack: the WZ base, read through accessors so a mob
  // skill's attack-up (x% of base) reaches every damage path — touch,
  // melee, projectiles — without those paths knowing about buffs
  _basePad: number = 0;
  _baseMad: number = 0;
  get pad(): number {
    return Math.floor(this._basePad * this.mobBuffPct("padUp"));
  }
  set pad(v: number) {
    this._basePad = v;
  }
  get mad(): number {
    return Math.floor(this._baseMad * this.mobBuffPct("madUp"));
  }
  set mad(v: number) {
    this._baseMad = v;
  }
  mobLevel: number = 1;
  name: string = "";
  DamageIndicator: any = null;
  destroyed: boolean = false;
  respawnScheduled: boolean = false;
  height: number = 0;
  width: number = 0;
  x: number = 0;
  y: number = 0;
  centerPosition: any = null;
  frame: number = 0;
  delay: number = 0;
  nextDelay: number = 0;
  stances: any = {};
  stance: any = null;
  onStanceFinish: any = null;
  flipped: boolean = false;
  // info/noFlip=1 (tutorial sign mobs, some bosses): sprite is never
  // mirrored regardless of facing, so baked-in signage stays readable
  noFlip: boolean = false;
  layer: number = 0;
  isRemote: boolean = false; // Network-controlled mob — skip local AI
  _spawning: boolean = false;  // GMS fade-in effect on respawn
  _spawnAlpha: number = 1;
  _targetX: number = 0;
  _targetY: number = 0;

  // Movement/AI (derived from WZ stances + info in load())
  moveType: MobMoveType = "walk";
  firstAttack: boolean = false;
  bodyAttack: number = 1;
  isFriendly: boolean = false;
  /** Scripted kills (PQ clear) suppress loot */
  _noDrops: boolean = false;
  flySpeed: number = 0;
  spawnCy: number = 0;
  aggroTarget: any = null;
  /** Timestamp the current chase expires at — refreshed by every hit */
  aggroUntil: number = 0;
  lastTargetScan: number = 0;
  outOfRangeSince: number = 0;
  flyTargetX: number = 0;
  flyTargetY: number = 0;
  lastFlyTargetPick: number = 0;

  // Attacks (parsed from WZ attack1-4)
  attacks: any[] = [];
  isAttacking: boolean = false;
  currentAttack: any = null;
  nextAttackTime: number = 0;
  attackElapsed: number = 0;
  attackFired: boolean = false;

  // Mob skills (Mob.wz info/skill + Skill.wz/MobSkill.img) — see src/Mob/
  skills: MobSkillEntry[] = [];
  /** skillId -> earliest next use (host only) */
  skillCooldowns: Map<number, number> = new Map();
  /** Next time the host AI considers a skill at all */
  skillScanAt: number = 0;
  /** A skill stance is playing (like isAttacking for attacks) */
  isCastingSkill: boolean = false;
  _castStance: string = "";
  _castEndsAt: number = 0;
  /** Cast whose effect is still waiting for `effectAfter` to elapse */
  _pendingCast: { cast: MobSkillCast; lv: MobSkillLevel; applyAt: number } | null = null;
  /** Timed mob statuses by buffKeyOf() key — every client keeps its own copy off the relayed cast */
  mobBuffs: Map<string, MobBuff> = new Map();
  _mobArts: MobArtPlay[] = [];
  /** oId of the mob whose summon skill spawned this one (null = map spawn) */
  summonerOId: number | null = null;
  /** Effect.wz/Summon.img art a summon arrives with; the sprite stays hidden until `showAt` */
  _summonEffect: { frames: any[]; frame: number; delay: number; showAt: number } | null = null;

  static async fromOpts(opts: any) {
    const mob = new Monster(opts);
    await mob.load();
    return mob;
  }
  constructor(opts: any) {
    this.opts = opts;
  }
  async load() {
    const opts = this.opts;

    this.oId = opts.oId;
    this.id = opts.id;
    this.fh = opts.fh;
    this.minX = opts.minX;
    this.maxX = opts.maxX;
    this.map = opts.map;

    this.height = 0;
    this.width = 0;
    this.x = 0;
    this.y = 0;
    this.centerPosition = {
      x: 0,
      y: 0,
    };
    this.dying = false;
    // usefull for debugging
    this.isMovementEnabled = true;

    // this.pos.jump();
    // this.pos.left = true;

    let strId = `${this.id}`.padStart(7, "0");
    let mobFile: any = await WZManager.get(`${WZFiles.Mob}/${strId}.img`);
    if (!!mobFile.info.link) {
      const linkId = mobFile.info.link.nValue;
      strId = `${linkId}`.padStart(7, "0");
      mobFile = await WZManager.get(`${WZFiles.Mob}/${strId}.img`);
    }
    this.mobFile = mobFile;
    this.noFlip = !!mobFile.info.noFlip?.nValue;

    // Movement type: v83 has no info.moveAbility — Cosmic derives mobility
    // from stance presence. Honor moveAbility as an override if present.
    const stanceNames = mobFile.nChildren.map((c: any) => c.nName);
    const moveAbility = mobFile.info.moveAbility?.nValue;
    if (moveAbility !== undefined && moveAbility !== null) {
      this.moveType =
        moveAbility === 0 ? "stationary"
        : moveAbility === 2 ? "jump"
        : moveAbility === 3 ? "fly"
        : "walk";
    } else if (stanceNames.includes("fly")) {
      this.moveType = "fly";
    } else if (stanceNames.includes("jump")) {
      this.moveType = "jump";
    } else if (stanceNames.includes("move")) {
      this.moveType = "walk";
    } else {
      this.moveType = "stationary";
    }
    this.firstAttack = (mobFile.info.firstAttack?.nValue ?? 0) > 0;
    this.bodyAttack = mobFile.info.bodyAttack?.nValue ?? 1;
    // Friendly mobs (WZ damagedByMob=1, e.g. the HPQ Moon Bunny) are on the
    // players' side: no touch damage, and being hit never aggros them
    this.isFriendly = (mobFile.info.damagedByMob?.nValue ?? 0) === 1;
    if (this.isFriendly) this.bodyAttack = 0;
    this.flySpeed = mobFile.info.flySpeed?.nValue ?? 0;
    this.mad = mobFile.info.MADamage?.nValue ?? 0;
    this.spawnCy = opts.y;

    // Authentic mob speed: 125 px/s scaled by WZ speed percent delta
    const mobWalkSpeed =
      (125 * (100 + (mobFile.info.speed?.nValue ?? 0))) / 100;
    this.pos = new Physics(opts.x, opts.y, mobWalkSpeed, true);
    if (this.moveType === "fly") {
      this.pos.flying = true;
    }
    this.jumpProbability = 0.05;
    this.lastDirectionChangeTime = 0;
    this.delayBetweenDirectionChange = 300;
    if (this.moveType === "walk" || this.moveType === "jump") {
      this.randomInitialDirection();
    }

    // Parse attack stances (attack1-4): type 0 melee, 1 magic, 2 ranged ball.
    // Range comes as an lt/rb rect or an sp vector + r radius, relative to a
    // left-facing mob's origin.
    this.attacks = [];
    for (const child of mobFile.nChildren) {
      if (!/^attack[1-4]$/.test(child.nName)) continue;
      const ainfo = child.nGet("info");
      const type = ainfo.nGet("type").nGet("nValue", 0);
      const attackAfter = ainfo.nGet("attackAfter").nGet("nValue", 0);
      const padOverrideNode = ainfo.nGet("PADamage");
      const padOverride = padOverrideNode.nGet
        ? padOverrideNode.nGet("nValue", undefined)
        : undefined;
      const isMagicAttack =
        type === 1 || ainfo.nGet("magic").nGet("nValue", 0) > 0;

      let rangeRect: any = null;
      let rangeR = 0;
      const range = ainfo.nGet("range");
      const lt = range.nGet("lt");
      const sp = range.nGet("sp");
      if (lt.nGet && lt.nGet("nX", null) !== null) {
        const rb = range.nGet("rb");
        rangeRect = {
          x1: lt.nGet("nX", 0),
          y1: lt.nGet("nY", 0),
          x2: rb.nGet("nX", 0),
          y2: rb.nGet("nY", 0),
        };
      } else if (sp.nGet && sp.nGet("nX", null) !== null) {
        rangeR = range.nGet("r").nGet("nValue", 0);
        const spX = sp.nGet("nX", 0);
        const spY = sp.nGet("nY", 0);
        rangeRect = {
          x1: spX - rangeR,
          y1: spY - rangeR,
          x2: spX + rangeR,
          y2: spY + rangeR,
        };
      }

      // Ball/effect/hit frame dirs live under attackN/info in Mob.wz
      const ballNode = ainfo.nGet("ball");
      this.attacks.push({
        stance: child.nName,
        type,
        attackAfter,
        padOverride,
        isMagicAttack,
        rangeRect,
        rangeR,
        ballNode: ballNode.nChildren?.length ? ballNode : null,
      });
    }

    // Mob skills: `info/skill/<n>` = {skill, level, action, effectAfter}.
    // Spread the first scan so a freshly loaded map doesn't cast in unison.
    this.skills = MobSkillRunner.readEntries(mobFile.info);
    this.skillScanAt = Date.now() + 1500 + Math.random() * 3000;
    MobSkillRunner.ensureNetHook();

    this.isBoss = false;
    if (mobFile.info.boss && mobFile.info.boss.nValue === 1) {
      this.isBoss = true;
    }
    // Which UIWindow.img/MobGage/Gage colour the boss bar fills with (Mano is
    // 1, red). Bosses that never carry the field fall back to it in the UI.
    this.hpTagColor = mobFile.info.hpTagColor?.nValue ?? 0;

    // Elemental resistances from WZ elemAttr, e.g. "F2I1" = strong vs fire, immune to ice.
    // Digit meaning (Cosmic): 1=immune (x0), 2=strong (x0.5), 3=weak (x1.5), 4=neutral
    this.elemMultipliers = {};
    const elemAttr = mobFile.info.elemAttr?.nValue;
    if (elemAttr) {
      const str = String(elemAttr).toUpperCase();
      const digitToMult: Record<string, number> = { '1': 0, '2': 0.5, '3': 1.5, '4': 1 };
      for (let i = 0; i + 1 < str.length; i += 2) {
        const mult = digitToMult[str[i + 1]];
        if (mult !== undefined) this.elemMultipliers[str[i]] = mult;
      }
    }

    const mobSounds: any = await WZManager.get(`${WZFiles.Sound}/Mob.img`);

    // there bugs in wz files, for exmaple in map - 100020100 the pig sound not exists but
    // name do exits in string.wz
    const thisMobSounds = mobSounds.nGet(strId);

    this.sounds = thisMobSounds.nChildren.reduce((acc: any, node: any) => {
      try {
        const Node = node.nTagName === "sound" ? node : node.nResolveUOL();
        acc[Node.nName] = Node.nGetAudio();
        console.log("loaded sound", Node.nName, Node.nTagName, Node.nGetPath());
      } catch (ex) {
        console.log(
          "Failed to load sound",
          node.nName,
          node.nTagName,
          node.nGetPath()
        );
        console.error(`Broken UOL ${node.nGetPath()}`);
      }
      return acc;
    }, {});

    this.setStance(MobStance.stand);

    // Start decoding every stance + attack-ball frame now — drawImage skips
    // undecoded images, so lazily-created frames blink on first render. Fire
    // and forget: awaiting every decode blocks map load for seconds.
    mobFile.nChildren
      .filter((c: any) => c.nName !== "info")
      .forEach((stanceNode: any) => {
        (stanceNode.nChildren || []).forEach((frame: any) => {
          const f = frame.nTagName === "uol" ? frame.nResolveUOL() : frame;
          void f?.nPreloadImage?.();
        });
      });
    for (const attack of this.attacks) {
      (attack.ballNode?.nChildren || []).forEach((frame: any) => {
        void frame?.nPreloadImage?.();
      });
    }

    this.isInHit = false;
    this.afterHitShowHpBarTime = 6000;
    this.isShotHpBar = false;
    this.afterHitShowHpBarTimer = null;

    this.maxHp = this.mobFile.info.maxHP.nValue;
    this.maxMp = this.mobFile.info.maxMP.nValue;
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.acc = this.mobFile.info.acc?.nValue ?? 0;
    this.eva = this.mobFile.info.eva?.nValue ?? 0;
    this.pad = this.mobFile.info.PADamage?.nValue ?? 0;
    this.mobLevel = this.mobFile.info.level?.nValue ?? 1;
    // await WZManager.get("String.wz/Map.img");
    const mobStringNode: any = await WZManager.get(
      `${WZFiles.String}/Mob.img/${strId}`
    );
    if (mobStringNode) {
      this.name = mobStringNode.name.nValue;
    } else {
      const mobStringNode: any = await WZManager.get(
        `${WZFiles.String}/Mob.img/${this.id}`
      );
      if (mobStringNode) {
        this.name = mobStringNode.name.nValue;
      } else {
        console.log("Mob name not found for both ids:", strId, this.id);
      }
    }

    this.DamageIndicator = new DamageIndicator();
    await this.DamageIndicator.initialize();
  }
  
  /**
 * Enhanced version of the addDrops method for the Monster class
 * This should be integrated into your existing Monster class
 */
// Net id of whoever landed the killing blow — the drops are theirs (and
// their party's) for the owner-lock window; see server/handlers/item.js
_killerNetId: string | null = null;

async addDrops() {
  try {
    // Get random drop items from the monster's drop table
    const monsterDropEntries = await DropRandomizer.getRandomDropItems(
      this.id,
      this.isBoss
    );

    // Mesos come from the drop table itself (itemId 0 rows per mob, the
    // authentic Cosmic model) — no synthetic meso fallback

    // Calculate drop positions - add slight offset to each drop
    // so they don't all appear in the exact same spot
    const baseX = this.pos.x;
    const baseY = this.pos.y;
    const dropSpacing = 20; // Pixels between drops
    
    // Create drops with position offsets
    for (let i = 0; i < monsterDropEntries.length; i++) {
      const monsterDropEntry = monsterDropEntries[i];
      
      // Calculate offset positions (place items in a small arc)
      const offsetX = (i - Math.floor(monsterDropEntries.length / 2)) * dropSpacing;
      
      try {
        // Create the drop item with position offset
        const dropItem = await DropItemSprite.fromOpts({
          id: monsterDropEntry.itemId,
          monster: {
            ...this,
            pos: {
              x: baseX,
              destX: baseX + offsetX,
              y: baseY,
              vx: this.pos.vx / 2,
              vy: this.pos.vy
            }
          },
          amount: monsterDropEntry.chosenAmount,
        });
        
        // Add it to the map
        if (dropItem && !dropItem.destroyed) {
          const dropId = Date.now() + Math.floor(Math.random() * 10000) + i;
          (dropItem as any)._netDropId = dropId;
          this.map.addItemDrop(dropItem);
          MySocket.sendItemDrop(monsterDropEntry.itemId, monsterDropEntry.chosenAmount, baseX + offsetX, baseY, this.pos.vx / 2, this.pos.vy, dropId, this._killerNetId);
        }
      } catch (err) {
        console.error(`Error creating drop for item ${monsterDropEntry.itemId}:`, err);
      }
    }
    // Quest item drops — when player has active quests requiring items from this mob
    const character = (window as any).charecter;
    const questManager = character?.questManager;
    if (questManager) {
      const QuestData = (await import('./Quest/QuestData')).default;
      for (const [questId, active] of questManager.activeQuests) {
        const reqs = QuestData.requirements.get(questId);
        if (!reqs?.complete.items) continue;
        // Check if this quest requires killing this mob type
        const requiresThisMob = reqs.complete.mobs?.some((m: any) => m.id === this.id);
        // Only drop quest items from mobs the quest actually requires
        if (!requiresThisMob) continue;
        // Drop quest items that haven't been fully collected yet
        for (const item of reqs.complete.items) {
          const currentCount = questManager.getItemCount(item.id);
          if (currentCount >= item.count) continue;
          const dropChance = 0.7;
          if (Math.random() < dropChance) {
            try {
              const offsetX = (monsterDropEntries.length) * dropSpacing;
              const dropItem = await DropItemSprite.fromOpts({
                id: item.id,
                monster: {
                  ...this,
                  pos: { x: baseX,
              destX: baseX + offsetX, y: baseY, vx: this.pos.vx / 2, vy: this.pos.vy }
                },
                amount: 1,
              });
              if (dropItem && !dropItem.destroyed) {
                const qDropId = Date.now() + Math.floor(Math.random() * 10000);
                (dropItem as any)._netDropId = qDropId;
                this.map.addItemDrop(dropItem);
                MySocket.sendItemDrop(item.id, 1, baseX + offsetX, baseY, this.pos.vx / 2, this.pos.vy, qDropId, this._killerNetId);
              }
            } catch {}
          }
        }
      }
    }
  } catch (error) {
    console.error("Error in Monster.addDrops:", error);
  }
}

  updatePosition(x: number, y: number) {
    this.pos.x = x;
    this.pos.y = y;
  }
  loadStance(wzNode: any = {}, stance = "stand") {
    if (!wzNode[stance]) {
      return {
        frames: [],
      };
    }

    const frames: any = [];

    wzNode[stance].nChildren.forEach((frame: any) => {
      if (frame.nTagName === "canvas" || frame.nTagName === "uol") {
        const Frame = frame.nTagName === "uol" ? frame.nResolveUOL() : frame;
        frames.push(Frame);
      } else {
        // tod: fix- this happends too much
        // console.log(`Unhandled frame=${frame.nTagName} for cls=Mob`, this);
      }
    });

    return {
      frames,
    };
  }
  playAudio(name: string) {
    if (!!this.sounds[name]) {
      PLAY_AUDIO(this.sounds[name]);
    } else {
      console.log("no sound", name);
    }
  }
  
  /**
   * Fixed version of the die method for the Monster class
   * This should be integrated into your existing Monster class
   */
  die(responsibleMapleCharacter: any, skillId: number = 0, attackerNetId: string | null = null) {
    this.setFrame(!this.stances.die ? "die1" : "die");
    this.playAudio("Die");
    this.dying = true;
    this.isMovementEnabled = false;

    // Only host spawns drops, awards EXP, and broadcasts death
    if (!this.isRemote) {
      // A kill credited through a damage request belongs to that player;
      // otherwise the host (us) did it
      this._killerNetId = attackerNetId ?? MySocket.playerId ?? null;
      if (!this._noDrops) {
        setTimeout(() => {
          this.addDrops();
        }, 100);
      }

      // Broadcast death to other clients. When the finishing blow came from
      // another player's damage request, the kill is theirs — ride the death
      // message with everything they need to pay themselves out, since only
      // the host ever ran this mob's HP.
      try {
        MySocket.sendMobDeath(this.oId, attackerNetId
          ? {
              killerId: attackerNetId,
              mobId: this.id,
              skillId,
              exp: this.mobFile?.info?.exp?.nValue ?? 0,
            }
          : undefined);
      } catch {}
    }

    // Award experience to the player who killed the monster; local kills
    // run the v83 party split (same-map members get their share relayed)
    if (responsibleMapleCharacter) {
      let exp = this.mobFile.info.exp.nValue;
      if (exp > 0 && responsibleMapleCharacter === (window as any).charecter) {
        exp = PartyManager.shareKillExp(exp);
      }
      responsibleMapleCharacter.addExp(exp);
      responsibleMapleCharacter.questManager?.onMobKill(this.id, skillId);
    }
  }

  destroy() {
    this.destroyed = true;
    // delete this;
  }
  setFrame(stance: any, frame = 0, carryOverDelay = 0) {
    if (!this.stances[stance]) {
      return;
    }

    if (!this.stances[stance].frames[frame]) {
      if (this.onStanceFinish) this.onStanceFinish();
    }

    const f = !this.stances[stance].frames[frame] ? 0 : frame;
    const stanceFrame = this.stances[stance].frames[f];

    this.stance = stance;
    this.frame = f;
    this.delay = carryOverDelay;
    this.nextDelay = stanceFrame.nGet("delay").nGet("nValue", 100);
  }

  setStance(stance: any, frame = 0, onFinish = () => {}) {
    if (this.stance !== stance) {
      this.stance = stance;
      this.stances = {};
      this.mobFile.nChildren
        .filter((c: any) => c.nName !== "info")
        .forEach((stance: any) => {
          this.stances[stance.nName] = this.loadStance(
            this.mobFile,
            stance.nName
          );
        });

      this.onStanceFinish = onFinish;
      this.setFrame(this.stance, frame);
    }
  }

  jump() {
    if (this.stances && this.stances[MobStance.jump]) {
      this.pos.jump();
    }
  }

  willHitkill(damage: number) {
    return this.hp - damage <= 0;
  }

  /**
   * Elemental damage multiplier for a skill element char (F/I/L/S/H/D/P).
   * 1 = neutral; 0 = immune (caller should floor damage to 1).
   */
  getElementalMultiplier(element: string | null): number {
    if (!element) return 1;
    const mult = this.elemMultipliers[element];
    return mult === undefined ? 1 : mult;
  }

  hit(
    damage: number,
    knockBackDirection: number,
    responsibleMapleCharacter: any,
    isCritical: boolean = false,
    // Skill that dealt this blow (0 = plain weapon attack). Only carried so a
    // killing blow can be credited to the right skill-tutorial quest.
    skillId: number = 0,
    // Network id of the player this blow belongs to, set when the host is
    // applying a non-host's damage request on their behalf (null for local hits)
    attackerNetId: string | null = null
  ) {
    const indicatorType = isCritical
      ? DamageIndicatorType.PlayerCritialHitMob
      : DamageIndicatorType.PlayerHitMob;
    // The boss gauge is not armed here any more — UIMobGage picks its target
    // off the map's monster list, so it is already up before the first swing
    // and stays up between them.

    // Mob-skill statuses: immunity floors the blow to 1, defense-up scales
    // it, reflect hurts the attacker. Applied where the blow is computed —
    // locally for our own hits; a relayed damage request arrives already
    // adjusted by its sender (attackerNetId set), so it is not touched twice.
    if (!attackerNetId && damage > 0) {
      damage = this.applyMobStatusesToHit(damage, skillId, responsibleMapleCharacter);
    }

    // Remote mob (non-host client): send damage request to host, show visual only
    if (this.isRemote) {
      // Send damage request to host via server
      try {
        MySocket.sendMobDamageRequest(this.oId, damage, knockBackDirection, skillId);
      } catch {}
      // Show damage indicator locally for immediate feedback
      this.DamageIndicator.addDamageIndicator(
        indicatorType,
        { x: this.centerPosition.x - this.width / 2, y: this.centerPosition.y - this.height - 20 },
        damage
      );
      this.playAudio(MobSounds.Damage);
      this.isShotHpBar = true;
      if (this.afterHitShowHpBarTimer) clearTimeout(this.afterHitShowHpBarTimer);
      this.afterHitShowHpBarTimer = setTimeout(() => { this.isShotHpBar = false; }, this.afterHitShowHpBarTime);
      return;
    }

    // Being hit aggros passive mobs onto the attacker, and every further hit
    // renews the interest clock — keep swinging and the mob keeps coming.
    if (responsibleMapleCharacter && !this.dying && !this.isFriendly) {
      this.setAggro(responsibleMapleCharacter);
    }

    // Players hitting a friendly mob (Moon Bunny) makes it "feel sick" —
    // the PQ tracks it and warns the party (Cosmic friendlyDamaged)
    if (this.isFriendly && responsibleMapleCharacter && !this.dying) {
      import('./Events/HenesysPQ')
        .then(({ default: HenesysPQ }) => HenesysPQ.onFriendlyHitByPlayer(this))
        .catch(() => {});
    }

    // Host: apply damage authoritatively
    if (this.hp - damage <= 0) {
      this.isInHit = true;
      this.pos.right = false;
      this.pos.left = false;
      this.hp = 0;
      this.die(responsibleMapleCharacter, skillId, attackerNetId);
    } else {
      this.hp -= damage;
      this.playAudio(MobSounds.Damage);
      if (damage > 0) {
        this.isInHit = true;
        this.pos.right = false;
        this.pos.left = false;

        // v83 knockback: requires damage >= 1% of max HP; bosses never budge
        if (!this.isBoss && damage >= this.maxHp * 0.01) {
          this.pos.applyKnockbackX(knockBackDirection);
        }
        this.setStance(MobStance.hit1, 0, () => {
          this.isInHit = false;
        });

        if (this.afterHitShowHpBarTimer) {
          clearTimeout(this.afterHitShowHpBarTimer);
        }

        this.isShotHpBar = true;
        this.afterHitShowHpBarTimer = setTimeout(() => {
          this.isShotHpBar = false;
        }, this.afterHitShowHpBarTime);
      }
    }

    this.DamageIndicator.addDamageIndicator(
      indicatorType,
      {
        x: this.centerPosition.x - this.width / 2,
        y: this.centerPosition.y - this.height - 20,
      },
      damage
    );
  }

  // ---------------------------------------------------------------------
  // Mob skills — statuses on the mob, cast playback, art
  // ---------------------------------------------------------------------

  hasMobBuff(key: string): boolean {
    return this.mobBuffs.has(key);
  }

  /** x/100 of a percent-valued status, 1 when it is not up */
  mobBuffPct(key: string): number {
    const b = this.mobBuffs?.get(key);
    return b ? b.value / 100 : 1;
  }

  get isWeaponImmune(): boolean {
    return this.mobBuffs.has("wImmune") || this.mobBuffs.has("wReflect") || this.mobBuffs.has("wmReflect");
  }

  get isMagicImmune(): boolean {
    return this.mobBuffs.has("mImmune") || this.mobBuffs.has("mReflect") || this.mobBuffs.has("wmReflect");
  }

  /**
   * Immunity, defense-up and reflect against one incoming blow. Physical or
   * magic is decided by the skill that dealt it (a spell carries `mad`).
   * Reflect hits the attacker with the skill's fixed x (physical) / y
   * (magic) — the v83 emulator's counter handling.
   */
  applyMobStatusesToHit(damage: number, skillId: number, attacker: any): number {
    if (this.mobBuffs.size === 0) return damage;
    const isMagic =
      skillId > 0 && !!SkillData.getSkillSync(skillId)?.effects?.some((e: any) => (e?.mad ?? 0) > 0);
    let out = damage;
    if (isMagic) {
      out = Math.floor(out * this.mobBuffPct("mddUp"));
      if (this.isMagicImmune) out = 1;
      const reflect = this.mobBuffs.get("mReflect") ?? this.mobBuffs.get("wmReflect");
      if (reflect) {
        const amount = reflect.skillId === MobSkillId.PHYSICAL_AND_MAGIC_COUNTER ? reflect.y : reflect.value;
        MobSkillRunner.reflectOntoAttacker(this, attacker, amount);
      }
    } else {
      out = Math.floor(out * this.mobBuffPct("pddUp"));
      if (this.isWeaponImmune) out = 1;
      const reflect = this.mobBuffs.get("wReflect") ?? this.mobBuffs.get("wmReflect");
      if (reflect) MobSkillRunner.reflectOntoAttacker(this, attacker, reflect.value);
    }
    return Math.max(1, out);
  }

  /** Put a self/group status on this mob for the skill's `time` */
  applyMobBuff(lv: MobSkillLevel): void {
    const key = buffKeyOf(lv.skillId);
    if (!key || lv.timeMs <= 0) return;
    // Immunity of one kind never overlaps the other (emulator rule)
    if (key === "wImmune" && this.mobBuffs.has("mImmune")) return;
    if (key === "mImmune" && this.mobBuffs.has("wImmune")) return;
    const buff: MobBuff = {
      skillId: lv.skillId,
      value: lv.x,
      y: lv.y,
      until: Date.now() + lv.timeMs,
      art: lv.mob,
      frame: 0,
      delay: 0,
    };
    this.mobBuffs.set(key, buff);
  }

  /** Heal (114): x HP and y MP, on the host only — non-hosts read HP off the batch */
  healFromSkill(lv: MobSkillLevel): void {
    if (this.isRemote || this.dying) return;
    const amount = lv.rect
      ? Math.floor((lv.x / 1000) * (950 + Math.random() * 1050))
      : lv.x;
    if (amount > 0 && this.hp < this.maxHp) {
      const healed = Math.min(amount, this.maxHp - this.hp);
      this.hp += healed;
      this.DamageIndicator?.addDamageIndicator(
        DamageIndicatorType.Recovery,
        { x: this.centerPosition.x - this.width / 2, y: this.centerPosition.y - this.height - 20 },
        healed
      );
    }
    this.mp = Math.min(this.maxMp, this.mp + Math.max(0, lv.y));
  }

  /** One-shot art at this mob (cast `effect`, group `mob0`) */
  playMobArt(art: MobSkillArt | null): void {
    if (!art?.frames?.length) return;
    this._mobArts.push({ art, frame: 0, delay: 0 });
  }

  setSummonEffect(frames: any[], delayMs: number): void {
    this._summonEffect = { frames, frame: 0, delay: 0, showAt: Date.now() + Math.max(0, delayMs) };
    frames.forEach((f: any) => { void f?.nPreloadImage?.(); });
  }

  /**
   * Every client: face the way the host did, play the `skill<action>`
   * stance (or `attack<action>` where a mob has no skill stance), start the
   * cast art and queue the effect for `effectAfter` ms in.
   */
  beginSkillCast(cast: MobSkillCast, lv: MobSkillLevel): void {
    const now = Date.now();
    this.flipped = !!cast.flipped;
    if (!this.isRemote) {
      this.pos.vx = 0;
      this.stand();
    }
    const stanceName = this.stances[`skill${cast.action}`]?.frames?.length
      ? `skill${cast.action}`
      : this.stances[`attack${cast.action}`]?.frames?.length
        ? `attack${cast.action}`
        : "";
    this.isCastingSkill = true;
    this._castStance = stanceName || String(this.stance);
    this._castEndsAt = now + CAST_MAX_MS;
    if (stanceName && !this.isRemote) {
      this.setStance(stanceName, 0, () => {
        this.isCastingSkill = false;
      });
    } else if (!stanceName) {
      this._castEndsAt = now + 600;
    }
    if (this.sounds[`Skill${cast.action}`]) this.playAudio(`Skill${cast.action}`);
    if (lv.effect) this.playMobArt(lv.effect);
    this._pendingCast = { cast, lv, applyAt: now + Math.max(0, cast.effectAfter) };
  }

  updateSkillCast(msPerTick: number): void {
    const now = Date.now();
    if (this._pendingCast && now >= this._pendingCast.applyAt) {
      const { cast, lv } = this._pendingCast;
      this._pendingCast = null;
      if (!this.dying && !this.destroyed) MobSkillRunner.apply(this, cast, lv);
    }
    if (this.mobBuffs.size) {
      for (const [key, buff] of this.mobBuffs) {
        if (now >= buff.until) {
          this.mobBuffs.delete(key);
          continue;
        }
        this._stepArt(buff, buff.art, msPerTick, true);
      }
    }
    if (this._mobArts.length) {
      this._mobArts = this._mobArts.filter((p) => !this._stepArt(p, p.art, msPerTick, false));
    }
    if (this._summonEffect) {
      const s = this._summonEffect;
      const done = this._stepArt(s, { frames: s.frames, pos: 0, repeat: false }, msPerTick, false);
      if (done && now >= s.showAt) this._summonEffect = null;
    }
  }

  /** Advance one art's frame; returns true once a non-looping art has finished */
  _stepArt(holder: { frame: number; delay: number }, art: MobSkillArt | null, ms: number, loopForever: boolean): boolean {
    if (!art?.frames?.length) return true;
    holder.delay += ms;
    const cur = art.frames[holder.frame];
    const d = cur?.nGet?.("delay")?.nGet?.("nValue", 100);
    const frameDelay = typeof d === "number" ? d : 100;
    if (holder.delay <= frameDelay) return false;
    holder.delay -= frameDelay;
    holder.frame += 1;
    if (holder.frame < art.frames.length) return false;
    if (art.repeat || loopForever) {
      // A status with a single still (the head icon) or a looping aura just stays
      holder.frame = 0;
      return false;
    }
    holder.frame = art.frames.length - 1;
    return true;
  }

  /** WZ `pos` anchor → world y for this mob: 0 feet, 1/2 head top, 3 body centre */
  _artAnchorY(pos: number): number {
    if (pos === 3) return this.pos.y - this.height / 2;
    if (pos === 1 || pos === 2) return this.pos.y - this.height;
    return this.pos.y;
  }

  _drawArtFrame(canvas: GameCanvas, camera: CameraInterface, frame: any, pos: number): void {
    if (!frame?.nGetImage) return;
    const img = frame.nGetImage();
    if (!img || (img instanceof HTMLImageElement && !img.complete)) return;
    const ox = frame.nGet("origin").nGet("nX", 0);
    const oy = frame.nGet("origin").nGet("nY", 0);
    canvas.drawImage({
      img,
      dx: this.pos.x - ox - camera.x,
      dy: this._artAnchorY(pos) - oy - camera.y,
    });
  }

  drawMobSkillArt(canvas: GameCanvas, camera: CameraInterface): void {
    if (this._summonEffect) {
      const s = this._summonEffect;
      this._drawArtFrame(canvas, camera, s.frames[s.frame], 0);
    }
    for (const buff of this.mobBuffs.values()) {
      if (buff.art) this._drawArtFrame(canvas, camera, buff.art.frames[buff.frame], buff.art.pos);
    }
    for (const play of this._mobArts) {
      this._drawArtFrame(canvas, camera, play.art.frames[play.frame], play.art.pos);
    }
  }

  right() {
    this.pos.right = true;
    this.pos.left = false;
  }

  left() {
    this.pos.left = true;
    this.pos.right = false;
  }

  stand() {
    this.pos.left = false;
    this.pos.right = false;
  }

  randomInitialDirection() {
    const currentTime = Date.now();
    const timeSinceLastChange = currentTime - this.lastDirectionChangeTime;
    if (timeSinceLastChange > this.delayBetweenDirectionChange) {
      if (Math.random() < this.jumpProbability) {
        this.jump();
        Math.random() < 0.5 ? this.right() : this.left();
      } else if (Math.random() < 0.2) {
        this.stand();
      } else {
        Math.random() < 0.5 ? this.left() : this.right();
      }

      this.lastDirectionChangeTime = currentTime;
    }
  }

  changeDirectionRandomly() {
    const currentTime = Date.now();
    const timeSinceLastChange = currentTime - this.lastDirectionChangeTime;
    if (timeSinceLastChange > this.delayBetweenDirectionChange) {
      // if not jumping
      if (this.pos.fh) {
        if (this.moveType === "jump" && Math.random() < this.jumpProbability) {
          // Jump-capable mobs (jump stance in WZ) occasionally hop
          this.jump();
          Math.random() < 0.5 ? this.right() : this.left();
        } else if (Math.random() < 0.2) {
          this.stand();
        } else if (Math.random() < 0.5) {
          this.left();
        } else {
          this.right();
        }
      }

      this.lastDirectionChangeTime = currentTime;
    }
  }

  /** Take or refresh a target, restarting the interest clock. */
  setAggro(target: any) {
    this.aggroTarget = target;
    this.aggroUntil = Date.now() + AGGRO_HOLD_MS;
  }

  /** Lose interest and go back to wandering, with no chase state left over. */
  clearAggro() {
    this.aggroTarget = null;
    this.aggroUntil = 0;
    this.outOfRangeSince = 0;
    this._chaseDir = 0;
    this._pinnedSince = 0;
  }

  /**
   * Host-only target scan: validate/de-aggro the current target and let
   * firstAttack mobs auto-acquire a nearby player inside patrol bounds.
   */
  updateAggro(now: number) {
    if (now - this.lastTargetScan < TARGET_SCAN_MS) return;
    this.lastTargetScan = now;

    const candidates = [
      (window as any).charecter,
      ...(this.map?.characters || []),
    ].filter((c: any) => c && !c.isDead && c.pos);

    if (this.aggroTarget) {
      const t = this.aggroTarget;
      // Scripted mob target (the HPQ Moon Bunny): valid for as long as it
      // lives — patrol bounds and player checks don't apply, the whole map
      // converges on it
      if ((t as any).isFriendly) {
        if (t.dying || t.destroyed) {
          this.clearAggro();
        }
        return;
      }
      const stillPresent = candidates.includes(t);
      const dx = Math.abs((t.pos?.x ?? Infinity) - this.pos.x);
      if (now > this.aggroUntil) {
        // Interest ran out — back to wandering. Aggressive mobs pick the player
        // straight back up below if they are still standing close.
        this.clearAggro();
      } else if (!stillPresent || t.isDead || dx > DEAGGRO_RANGE_X) {
        this.clearAggro();
      } else if (t.pos.x < this.minX || t.pos.x > this.maxX) {
        // Target left the patrol area — give up after a grace period
        if (!this.outOfRangeSince) {
          this.outOfRangeSince = now;
        } else if (now - this.outOfRangeSince > DEAGGRO_GRACE_MS) {
          this.clearAggro();
        }
      } else {
        this.outOfRangeSince = 0;
      }
    }

    if (!this.aggroTarget && this.firstAttack && now >= this._aggroBlockedUntil) {
      let best: any = null;
      let bestDx = Infinity;
      for (const c of candidates) {
        const dx = Math.abs(c.pos.x - this.pos.x);
        const dy = Math.abs(c.pos.y - this.pos.y);
        if (
          dx <= AGGRO_RANGE_X &&
          dy <= AGGRO_RANGE_Y &&
          c.pos.x >= this.minX &&
          c.pos.x <= this.maxX &&
          dx < bestDx
        ) {
          best = c;
          bestDx = dx;
        }
      }
      if (best) this.setAggro(best);
    }
  }

  _chaseDir: number = 0;
  _chaseDecideAt: number = 0;
  _lastChaseHop: number = 0;
  _hopFromX: number = 0;
  // Pin state, shared by chasing and wandering
  _lastMoveX: number = 0;
  _pinnedSince: number = 0;
  _moveHoldUntil: number = 0;
  _pinStrikes: number = 0;
  _lastPinAt: number = 0;
  _aggroBlockedUntil: number = 0;

  /**
   * Hop out of a pin, for mobs that can. A hop that got the mob nowhere was
   * into a barrier it cannot clear, so the next attempt waits much longer
   * instead of grinding against it.
   */
  tryPinnedHop(now: number): boolean {
    if (this.moveType !== "jump") return false;
    const lastHopGained = Math.abs(this.pos.x - this._hopFromX) > 8;
    const cooldown = lastHopGained ? CHASE_HOP_MS : CHASE_HOP_RETRY_MS;
    if (now - this._lastChaseHop <= cooldown) return false;
    this._lastChaseHop = now;
    this._hopFromX = this.pos.x;
    this.jump();
    return true;
  }

  /**
   * Get a stuck mob unstuck. Pressing a direction on solid ground while x
   * refuses to advance is a pin — a wall, a step, the end of a foothold, the
   * patrol boundary — and the way out is the same whether the mob is chasing
   * or wandering: hop it if it can, otherwise turn round and walk away for long
   * enough that the next decision does not put it straight back into it.
   *
   * A mob that keeps hitting the same pin while chasing has a target it simply
   * cannot reach. Pacing at the obstacle forever is no better than leaning on
   * it, so after a second strike it loses interest and goes back to its patrol.
   * The give-up window is what makes that stick: an aggressive mob would
   * otherwise re-acquire the player standing below the ledge on the very next
   * scan and walk right back to the same corner.
   *
   * Knockback counts as advancing, so being hit never reads as a pin.
   */
  updatePinEscape(now: number) {
    if (this.moveType === "fly" || this.moveType === "stationary") return;
    if (this.isInHit || this.dying || this.isAttacking || !this.pos.fh) {
      this._pinnedSince = 0;
      this._lastMoveX = this.pos.x;
      return;
    }

    // Strikes lapse once the mob has been getting around fine for a while
    if (this._pinStrikes > 0 && now - this._lastPinAt > PIN_STRIKE_RESET_MS) {
      this._pinStrikes = 0;
    }

    const pressing = this.pos.left || this.pos.right;
    const advanced = Math.abs(this.pos.x - this._lastMoveX) > 0.5;
    this._lastMoveX = this.pos.x;

    if (!pressing || advanced || now < this._moveHoldUntil) {
      this._pinnedSince = 0;
      return;
    }
    if (!this._pinnedSince) {
      this._pinnedSince = now;
      return;
    }
    if (now - this._pinnedSince <= CHASE_PIN_MS) return;

    this._pinnedSince = 0;
    if (this.tryPinnedHop(now)) return;

    this._pinStrikes++;
    this._lastPinAt = now;

    if (this.aggroTarget && this._pinStrikes >= PIN_STRIKES_TO_GIVE_UP) {
      this._pinStrikes = 0;
      this.clearAggro();
      this._aggroBlockedUntil = now + AGGRO_GIVEUP_MS;
    }

    // Turn round and hold the new direction for a beat
    if (this.pos.right) this.left();
    else this.right();
    this._chaseDir = this.pos.right ? 1 : -1;
    this._chaseDecideAt = now;
    this._moveHoldUntil = now + CHASE_BACKOFF_MS;
    this.lastDirectionChangeTime = now;
  }

  /** Walk/jump mobs chase the aggro target at their WZ walk speed. */
  updateChase() {
    const now = Date.now();
    const dx = this.aggroTarget.pos.x - this.pos.x;
    const absDx = Math.abs(dx);

    // A chasing mob never stands still — GMS aggro'd mobs overshoot the
    // target, turn, and overshoot again, restlessly shuffling across the
    // player. The 300ms decision hold is what creates that overshoot (and
    // keeps a target overhead from churning the stance into a shake): the
    // mob walks past you, notices ~a third of a second later, comes back.
    // While backing out of a pin the held direction wins outright, or the mob
    // would turn back into the obstacle on the next decision.
    if (this._chaseDir === 0) this._chaseDir = dx >= 0 ? 1 : -1;
    if (now >= this._moveHoldUntil && now - this._chaseDecideAt >= 300 && absDx > 2) {
      const want = dx > 0 ? 1 : -1;
      if (want !== this._chaseDir) {
        this._chaseDir = want;
        this._chaseDecideAt = now;
      }
    }
    if (this._chaseDir > 0) this.right();
    else this.left();
  }

  /** Flying mobs steer toward a wander point (or the aggro target). */
  updateFlying(now: number) {
    const flyVel = Math.max(60, this.pos.walk_speed * 0.6);
    let targetX: number;
    let targetY: number;

    if (this.aggroTarget) {
      targetX = this.aggroTarget.pos.x;
      targetY = this.aggroTarget.pos.y - 30;
    } else {
      if (
        (!this.flyTargetX && !this.flyTargetY) ||
        now - this.lastFlyTargetPick > 1500 + Math.random() * 1500
      ) {
        this.flyTargetX = this.minX + Math.random() * (this.maxX - this.minX);
        this.flyTargetY = this.spawnCy - 60 + Math.random() * 80;
        this.lastFlyTargetPick = now;
      }
      targetX = this.flyTargetX;
      targetY = this.flyTargetY;
    }

    // The altitude band keeps wandering/player-chasing flyers near their
    // spawn height; a scripted mob target (HPQ bunny) pulls them anywhere
    // on the map — Flyeyes dive off their platforms to reach it
    if (!(this.aggroTarget as any)?.isFriendly) {
      targetY = Math.max(this.spawnCy - 80, Math.min(this.spawnCy + 40, targetY));
    }
    const dx = targetX - this.pos.x;
    const dy = targetY - this.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 5) {
      this.pos.vx = (dx / dist) * flyVel;
      this.pos.vy = (dy / dist) * flyVel;
    } else {
      this.pos.vx = 0;
      this.pos.vy = 0;
    }
    if (this.pos.vx > 1) {
      this.right();
    } else if (this.pos.vx < -1) {
      this.left();
    }
  }

  /** World-space range test for an attack rect (WZ rects assume facing left). */
  inAttackRange(atk: any, target: any): boolean {
    if (!atk.rangeRect || !target?.pos) return false;
    let x1 = atk.rangeRect.x1;
    let x2 = atk.rangeRect.x2;
    if (this.flipped) {
      const tmp = x1;
      x1 = -x2;
      x2 = -tmp;
    }
    const wx1 = this.pos.x + Math.min(x1, x2);
    const wx2 = this.pos.x + Math.max(x1, x2);
    const wy1 = this.pos.y + Math.min(atk.rangeRect.y1, atk.rangeRect.y2);
    const wy2 = this.pos.y + Math.max(atk.rangeRect.y1, atk.rangeRect.y2);
    return (
      target.pos.x >= wx1 &&
      target.pos.x <= wx2 &&
      target.pos.y >= wy1 &&
      target.pos.y <= wy2
    );
  }

  /** Host-only: start an attack when the target is inside a range and off cooldown. */
  tryAttack(now: number) {
    if (
      this.isAttacking ||
      this.attacks.length === 0 ||
      now < this.nextAttackTime ||
      !this.aggroTarget
    ) {
      return;
    }
    for (const atk of this.attacks) {
      if (this.inAttackRange(atk, this.aggroTarget)) {
        this.flipped = this.aggroTarget.pos.x > this.pos.x;
        this.pos.vx = 0;
        this.stand();
        this.isAttacking = true;
        this.currentAttack = atk;
        this.attackElapsed = 0;
        this.attackFired = false;
        this.setStance(atk.stance, 0, () => {
          this.isAttacking = false;
          this.currentAttack = null;
        });
        // Cosmic uses attackAfter as the cooldown; floor keeps melee spam sane
        this.nextAttackTime =
          now + Math.max(atk.attackAfter || 0, 2500) + Math.random() * 1500;
        break;
      }
    }
  }

  /**
   * Stance-driven attack execution — runs on host AND remote clients (remote
   * mobs enter attack stances via mob_state_batch), so every client resolves
   * damage against its own local player.
   */
  updateAttackFire(msPerTick: number) {
    const stanceName = typeof this.stance === "string" ? this.stance : "";
    if (!stanceName.startsWith("attack")) {
      this.attackElapsed = 0;
      this.attackFired = false;
      return;
    }
    const atk =
      this.currentAttack?.stance === stanceName
        ? this.currentAttack
        : this.attacks.find((a: any) => a.stance === stanceName);
    if (!atk) return;

    this.attackElapsed += msPerTick;
    const fireAt = Math.min(atk.attackAfter || 400, 1500);
    if (!this.attackFired && this.attackElapsed >= fireAt) {
      this.attackFired = true;
      this.fireAttack(atk);
    }
  }

  fireAttack(atk: any) {
    if (atk.type === 2 && atk.ballNode?.nChildren?.length) {
      const proj = new MobProjectile({
        x: this.pos.x,
        y: this.pos.y - this.height / 2,
        facingRight: !!this.flipped,
        ballNode: atk.ballNode,
        maxDistance: atk.rangeR > 0 ? atk.rangeR * 2 : 600,
        sourceMob: this,
        padOverride: atk.isMagicAttack ? atk.padOverride ?? this.mad : atk.padOverride,
        isMagic: atk.isMagicAttack,
      });
      if (this.map?.mobProjectiles) {
        this.map.mobProjectiles.push(proj);
      }
    } else {
      // Melee swing / magic zone: each client tests only its own player
      const player = (window as any).charecter;
      if (player && !player.isDead && this.inAttackRange(atk, player)) {
        const pad = atk.isMagicAttack
          ? atk.padOverride ?? this.mad
          : atk.padOverride;
        player.applyMobAttack?.(this, pad, atk.isMagicAttack);
      }
    }
  }

  update(msPerTick: number) {
    this.delay += msPerTick;

    // Mob-skill bookkeeping runs on every client: the pending cast lands
    // after effectAfter, statuses expire, art animates
    this.updateSkillCast(msPerTick);

    // Remote mobs: lerp position, advance animation, skip AI
    if (this.isRemote) {
      // Advance animation frames
      if (this.delay > this.nextDelay && this.stances[this.stance]) {
        const hasNextFrame = !!this.stances[this.stance].frames[this.frame + 1];
        if (this.dying && !hasNextFrame) {
          this.destroy();
          return;
        }
        this.setFrame(this.stance, this.frame + 1, this.delay - this.nextDelay);
      }

      // Lerp toward target position
      const dx = this._targetX - this.pos.x;
      const dy = this._targetY - this.pos.y;
      const lerp = Math.min(1, 0.3 * (msPerTick / 16));
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        this.pos.x = this._targetX;
        this.pos.y = this._targetY;
      } else {
        this.pos.x += dx * lerp;
        this.pos.y += dy * lerp;
      }

      this.centerPosition = {
        x: this.pos.x,
        y: this.pos.y - this.height / 2,
      };

      // Remote mobs still fire attacks locally when the batched stance flips
      // to attackN — each client damages only its own player
      if (!this.dying) {
        this.updateAttackFire(msPerTick);
      }
      return;
    }

    // --- Local AI (host only) ---
    const now = Date.now();

    // isAttacking only means "an attack stance is playing". Nothing but that
    // stance's finish callback ever cleared it, and setStance() replaces the
    // pending callback whenever anything else takes the stance — so a mob hit
    // mid-swing lost its attack callback to hit1's and stayed "attacking" for
    // good: no stance set (the block below falls into the isAttacking arm and
    // does nothing), no movement decisions, and tryAttack refusing to start
    // another. That is what froze the banana-throwing monkeys the moment you
    // hit one mid-throw. Re-deriving the flag from the stance repairs it a
    // frame later, whatever stole the stance.
    if (this.isAttacking && !String(this.stance).startsWith("attack")) {
      this.isAttacking = false;
      this.currentAttack = null;
    }
    // Same repair for a skill stance, plus a deadline for mobs whose skill
    // stance is missing from the WZ (nothing ever reports finishing then)
    if (this.isCastingSkill && (this.stance !== this._castStance || now > this._castEndsAt)) {
      this.isCastingSkill = false;
    }

    if (!this.dying && !this.isInHit) {
      this.updateAggro(now);
      this.tryAttack(now);
      if (!this.isAttacking) MobSkillRunner.tryCast(this, now);
    }

    // Haste-type buffs scale the walk; everything else keeps the WZ speed
    this.pos.speedScale = 1 + (this.mobBuffs.get("speed")?.value ?? 0) / 100;

    if (this.dying) {
      this.setStance(MobStance.die1);
    } else if (this.isInHit) {
      // already added stance with callback in the hit function
    } else if (this.isAttacking || this.isCastingSkill) {
      // keep the attack/skill stance until its frames finish
    } else if (this.moveType === "fly") {
      this.setStance(MobStance.fly);
    } else if (!this.pos.fh) {
      // if not on ground
      if (this.stances[MobStance.jump]) {
        this.setStance(MobStance.jump);
      } else {
        this.setStance(MobStance.stand);
      }
    } else {
      if (this.pos.right || this.pos.left) {
        this.setStance(
          this.stances[MobStance.move] ? MobStance.move : MobStance.stand
        );
      } else {
        this.setStance(MobStance.stand);
      }
    }

    if (this.delay > this.nextDelay) {
      const hasNextFrame = !!this.stances[this.stance].frames[this.frame + 1];
      if (!!this.dying && !hasNextFrame) {
        this.destroy();
        return;
      }
      this.setFrame(this.stance, this.frame + 1, this.delay - this.nextDelay);
    }

    // Movement decisions per move type
    if (!this.isInHit && !this.dying && !this.isAttacking && !this.isCastingSkill) {
      if (this.moveType === "fly") {
        this.updateFlying(now);
      } else if (this.aggroTarget && this.moveType !== "stationary") {
        this.updateChase();
      } else if (this.moveType === "walk" || this.moveType === "jump") {
        // need to add some time between changes to avoid jitter. A mob walking
        // out of a pin keeps its direction until the hold expires — a random
        // turn here is exactly what used to send it back into the corner.
        if (now >= this._moveHoldUntil && Math.random() < 0.02) {
          this.changeDirectionRandomly();
        }
      } else {
        this.stand();
      }
      // Runs for chasing and wandering alike: whatever set the direction above,
      // this is what notices the mob is not actually getting anywhere
      this.updatePinEscape(now);
    }

    this.updateAttackFire(msPerTick);

    // Prevent mobs from walking off foothold edges (GMS behavior)
    // Wandering mobs reverse at edges; chasing mobs stop and wait
    if (
      this.isMovementEnabled &&
      this.pos.fh &&
      !this.dying &&
      this.moveType !== "fly"
    ) {
      const fh = this.pos.fh;
      const margin = 2;
      // Chasing mobs keep the direction pressed while pinned — GMS mobs pace
      // against the wall/ledge rather than freezing, and calling stand()
      // here every frame while updateChase re-pressed the direction churned
      // the stance into a visible shake (and cancelled jump-mob hop takeoffs)
      if (this.pos.x >= fh.x2 - margin && this.pos.vx > 0) {
        // At right edge of foothold — only stop if no connected next foothold
        if (!fh.next || fh.next.x1 >= fh.next.x2) {
          this.pos.x = fh.x2 - margin;
          this.pos.vx = 0;
          if (!this.aggroTarget) this.left();
        }
      } else if (this.pos.x <= fh.x1 + margin && this.pos.vx < 0) {
        // At left edge of foothold — only stop if no connected prev foothold
        if (!fh.prev || fh.prev.x1 >= fh.prev.x2) {
          this.pos.x = fh.x1 + margin;
          this.pos.vx = 0;
          if (!this.aggroTarget) this.right();
        }
      }
    }

    if (this.isMovementEnabled) {
      this.pos.update(msPerTick);
    }

    // Enforce spawn boundaries AFTER physics update
    if (this.pos.x < this.minX) {
      this.pos.x = this.minX;
      this.pos.vx = 0;
      this.aggroTarget ? this.stand() : this.right();
    } else if (this.pos.x > this.maxX) {
      this.pos.x = this.maxX;
      this.pos.vx = 0;
      this.aggroTarget ? this.stand() : this.left();
    }

    // Flying mobs stay inside their vertical band
    if (this.moveType === "fly") {
      const yMin = this.spawnCy - 80;
      const yMax = this.spawnCy + 40;
      if (this.pos.y < yMin) this.pos.y = yMin;
      else if (this.pos.y > yMax) this.pos.y = yMax;
    }

    this.centerPosition = {
      x: this.pos.x,
      y: this.pos.y - this.height / 2,
    };
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
    const offsetFromY = 2;
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

    const monsterLevel = this.mobFile.info.level.nValue;
    const levelTagText = `lv,${monsterLevel}`;
    const levelGapFromName = 2;
    const levelOpts = {
      text: levelTagText,
      x: Math.floor(this.pos.x - camera.x),
      y: Math.floor(this.pos.y - camera.y + offsetFromY + 3),
      color: "#ffffff",
      align: "center",
    };
    const levelWidth = Math.ceil(
      canvas.measureText(levelOpts).width + tagPadding
    );
    const levelTagX = Math.round(this.pos.x - camera.x - levelWidth / 2);

    canvas.drawRect({
      x: nameTagX - levelWidth - levelGapFromName,
      y: Math.floor(this.pos.y - camera.y + offsetFromY),
      width: levelWidth,
      height: tagHeight,
      color: tagColor,
      alpha: tagAlpha,
    });
    levelOpts.x = nameTagX - levelWidth - levelGapFromName + levelWidth / 2;
    canvas.drawText(levelOpts);
  }

  drawHealthBar(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number,
    originY: number
  ) {
    const healthBarHeight = 10;
    const healthBarWidth = 52;
    const healthBarPadding = 2;
    const healthBarColor = "#000000";
    const healthBarAlpha = 0.7;
    const healthBarOffsetFromY = 20;

    // Adjustable border widths
    const blackBorderWidth = 1;
    const whiteBorderWidth = 1;

    // Calculate bar dimensions
    const barX = Math.floor(this.pos.x - camera.x - healthBarWidth / 2);
    const barY = Math.floor(
      this.pos.y - originY - camera.y - healthBarOffsetFromY
    );
    const whiteBarWidth = healthBarWidth - 2 * blackBorderWidth;
    const whiteBarHeight = healthBarHeight - 2 * blackBorderWidth;

    // Draw black border
    const borderOpts = {
      x: barX,
      y: barY,
      width: healthBarWidth,
      height: healthBarHeight,
      color: "#000000",
    };
    canvas.drawRect(borderOpts);

    // Draw white border
    const whiteBorderOpts = {
      x: barX + blackBorderWidth,
      y: barY + blackBorderWidth,
      width: whiteBarWidth,
      height: whiteBarHeight,
      color: "#ffffff",
    };
    canvas.drawRect(whiteBorderOpts);

    // draw black background
    const blackBackgroundOpts = {
      x: whiteBorderOpts.x + whiteBorderWidth,
      y: whiteBorderOpts.y + whiteBorderWidth,
      width: whiteBarWidth - 2 * whiteBorderWidth,
      height: whiteBarHeight - 2 * whiteBorderWidth,
      color: "#000000",
    };
    canvas.drawRect(blackBackgroundOpts);

    // Calculate green fill dimensions
    const fillX = barX + healthBarPadding + whiteBorderWidth;
    const fillY = barY + healthBarPadding + whiteBorderWidth;
    const fillWidth = Math.floor(whiteBarWidth * (this.hp / this.maxHp));
    const fillHeight = whiteBarHeight - 2 * healthBarPadding;

    // Draw the green health bar fill
    const greenColor = "rgb(33, 227, 12)";
    const healthBarFillOpts = {
      x: blackBackgroundOpts.x + 1,
      y: blackBackgroundOpts.y + 1,
      width: fillWidth,
      height: fillHeight,
      color: greenColor,
    };
    canvas.drawRect(healthBarFillOpts);
  }

  draw(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    // Remote mobs get flipped from network; local mobs from movement
    if (!this.isRemote) {
      if (this.pos.right && !this.pos.left) {
        this.flipped = true;
      } else if (this.pos.left && !this.pos.right) {
        this.flipped = false;
      }
    }

    if (!this.stances[this.stance] || !this.stances[this.stance].frames[this.frame]) return;
    const currentFrame = this.stances[this.stance].frames[this.frame];
    const currentImage = currentFrame.nGetImage();

    const originX = currentFrame.nGet("origin").nGet("nX", 0);
    const originY = currentFrame.nGet("origin").nGet("nY", 0);

    // noFlip mobs render unmirrored no matter which way they face
    const drawFlipped = this.noFlip ? false : !!this.flipped;
    const adjustX = !drawFlipped ? originX : currentFrame.nWidth - originX;

    // GMS fade-in effect on respawn (effect -2)
    let alpha = 1;
    if (this._spawning) {
      this._spawnAlpha = Math.min(1, (this._spawnAlpha || 0) + 0.03);
      alpha = this._spawnAlpha;
      if (alpha >= 1) this._spawning = false;
    }

    // A summon arriving with Effect.wz/Summon.img art is unseen until the
    // art's delay has run — the effect is what is on screen until then
    const summonHidden = !!this._summonEffect && Date.now() < this._summonEffect.showAt;

    if (!summonHidden) {
      canvas.drawImage({
        img: currentImage,
        dx: this.pos.x - camera.x - adjustX,
        dy: this.pos.y - camera.y - originY,
        flipped: drawFlipped,
        alpha,
      });
    }

    this.height = currentFrame.nHeight;
    this.width = currentFrame.nWidth;
    this.x = this.pos.x - adjustX;
    this.y = this.pos.y - originY;

    this.drawMobSkillArt(canvas, camera);
    if (summonHidden) return;

    // todo :
    // this need to be displayed only few seconds after being hit
    if (this.isShotHpBar) {
      this.drawHealthBar(canvas, camera, lag, msPerTick, tdelta, originY);
      this.drawName(canvas, camera, lag, msPerTick, tdelta);
    }

    this.DamageIndicator.drawAllDamageIndicators(
      canvas,
      camera,
      lag,
      msPerTick,
      tdelta
    );
  }
}

export default Monster;
