import WZManager from '../wz-utils/WZManager';
import MobSkillData, {
  GROUP_BUFF_IDS,
  MobSkillId,
  MobSkillLevel,
  PLAYER_DEBUFF_IDS,
  SELF_BUFF_IDS,
} from './MobSkillData';
import type Monster from '../Monster';
import { DamageIndicatorType } from '../Effects/DamageIndicator';

/** One `Mob.wz/<id>.img/info/skill/<n>` row */
export interface MobSkillEntry {
  skillId: number;
  level: number;
  /** Stance index: the mob plays `skill<action>` (falling back to `attack<action>`) */
  action: number;
  /** ms into the stance at which the effect lands (0 = at once) */
  effectAfter: number;
}

/**
 * The relayed cast. The host rolls everything that involves randomness
 * (prop, who is in the box, summon positions) and every client replays the
 * same record, so the room agrees without a second round trip.
 */
export interface MobSkillCast {
  mapId: number;
  oId: number;
  skillId: number;
  level: number;
  action: number;
  effectAfter: number;
  x: number;
  y: number;
  flipped: boolean;
  /** The prop roll. A failed cast still plays the stance and the cast art. */
  landed: boolean;
  /** Player ids the disease/dispel/banish reaches (LOCAL_ID when offline) */
  targets: string[];
  /** oIds of every mob a group buff/heal reaches (caster included) */
  mobTargets: number[];
  summons: { oId: number; id: number; x: number; y: number; fh: number }[];
}

const LOCAL_ID = 'local';
// How often a mob re-evaluates its skill list, and the pause after a cast
const SKILL_SCAN_MS = 1000;
const POST_CAST_HOLD_MS = 2500;
// A mob only thinks about skills with somebody near enough to see it —
// the original only ran mob logic for mobs a client controlled
const AWARE_RANGE_X = 800;
const AWARE_RANGE_Y = 450;
// Targets for the rect-less diseases (Reverse Input): this close or nothing
const NO_RECT_RANGE = 300;
// Summons fan out a little from the caster instead of stacking on it
const SUMMON_SPREAD = 80;
// v83 caps a map at 80 live mobs before summons stop
const MAP_MOB_CAP = 80;
const MAX_BANISH_MAP = 999999999;

type Character = any;

function socket(): any {
  return (window as any).__mySocket ?? null;
}

function localPlayer(): Character {
  return (window as any).charecter ?? null;
}

function localPlayerId(): string {
  return socket()?.playerId || LOCAL_ID;
}

function currentMap(): any {
  return localPlayer()?.map ?? null;
}

/** Every character on the map with the id the cast will carry for it */
function playersWithIds(map: any): Array<{ id: string; ch: Character }> {
  const out: Array<{ id: string; ch: Character }> = [];
  const me = localPlayer();
  if (me?.pos && !me.isDead) out.push({ id: localPlayerId(), ch: me });
  const others: Map<string, Character> | undefined = socket()?.otherPlayers;
  for (const c of map?.characters ?? []) {
    if (!c || c === me || !c.pos || c.isDead) continue;
    let id: string | null = null;
    if (others) {
      for (const [pid, ch] of others) {
        if (ch === c) { id = pid; break; }
      }
    }
    if (id) out.push({ id, ch: c });
  }
  return out;
}

function resolvePlayer(id: string): Character {
  if (id === localPlayerId() || id === LOCAL_ID) return localPlayer();
  return socket()?.otherPlayers?.get(id) ?? null;
}

/** World-space box of a skill rect around a caster (WZ rects assume facing left) */
function worldRect(rect: { x1: number; y1: number; x2: number; y2: number }, x: number, y: number, flipped: boolean) {
  let x1 = rect.x1;
  let x2 = rect.x2;
  if (flipped) {
    const t = x1;
    x1 = -x2;
    x2 = -t;
  }
  return {
    x1: x + Math.min(x1, x2),
    x2: x + Math.max(x1, x2),
    y1: y + Math.min(rect.y1, rect.y2),
    y2: y + Math.max(rect.y1, rect.y2),
  };
}

function inRect(r: { x1: number; x2: number; y1: number; y2: number }, pos: any): boolean {
  return !!pos && pos.x >= r.x1 && pos.x <= r.x2 && pos.y >= r.y1 && pos.y <= r.y2;
}

function liveSummonsOf(mob: Monster): number {
  const list: Monster[] = mob.map?.monsters ?? [];
  let n = 0;
  for (const m of list) {
    if (m !== mob && m.summonerOId === mob.oId && !m.destroyed && !m.dying) n++;
  }
  return n;
}

function anyoneAware(mob: Monster, map: any): boolean {
  for (const { ch } of playersWithIds(map)) {
    if (Math.abs(ch.pos.x - mob.pos.x) <= AWARE_RANGE_X && Math.abs(ch.pos.y - mob.pos.y) <= AWARE_RANGE_Y) return true;
  }
  return false;
}

function isReflectSkill(id: number): boolean {
  return id === MobSkillId.PHYSICAL_COUNTER || id === MobSkillId.MAGIC_COUNTER || id === MobSkillId.PHYSICAL_AND_MAGIC_COUNTER;
}

/** The mob-buff key a self/group buff occupies; a mob never stacks two of the same */
export function buffKeyOf(skillId: number): string | null {
  switch (skillId) {
    case MobSkillId.ATTACK_UP: case MobSkillId.ATTACK_UP_M: case MobSkillId.PAD: return 'padUp';
    case MobSkillId.MAGIC_ATTACK_UP: case MobSkillId.MAGIC_ATTACK_UP_M: case MobSkillId.MAD: return 'madUp';
    case MobSkillId.DEFENSE_UP: case MobSkillId.DEFENSE_UP_M: case MobSkillId.PDR: return 'pddUp';
    case MobSkillId.MAGIC_DEFENSE_UP: case MobSkillId.MAGIC_DEFENSE_UP_M: case MobSkillId.MDR: return 'mddUp';
    case MobSkillId.HASTE_M: case MobSkillId.SPEED: return 'speed';
    case MobSkillId.ACC: return 'acc';
    case MobSkillId.EVA: return 'eva';
    case MobSkillId.PHYSICAL_IMMUNE: return 'wImmune';
    case MobSkillId.MAGIC_IMMUNE: return 'mImmune';
    case MobSkillId.HARD_SKIN: return 'hardSkin';
    case MobSkillId.PHYSICAL_COUNTER: return 'wReflect';
    case MobSkillId.MAGIC_COUNTER: return 'mReflect';
    case MobSkillId.PHYSICAL_AND_MAGIC_COUNTER: return 'wmReflect';
    case MobSkillId.SEAL_SKILL: return 'sealSkill';
    default: return null;
  }
}

/**
 * Host-side: may this mob use this skill right now? Mirrors the v83
 * emulator's canUseSkill plus the HP gate its move handler applies.
 */
function canUse(mob: Monster, entry: MobSkillEntry, lv: MobSkillLevel, map: any, now: number): boolean {
  if ((mob.skillCooldowns.get(entry.skillId) ?? 0) > now) return false;
  if (mob.hasMobBuff('sealSkill')) return false;
  const hpPct = mob.maxHp > 0 ? (mob.hp / mob.maxHp) * 100 : 100;
  if (hpPct > lv.hpThreshold) return false;
  if (isReflectSkill(entry.skillId) && (mob.hasMobBuff('wReflect') || mob.hasMobBuff('mReflect') || mob.hasMobBuff('wmReflect'))) return false;
  if (entry.skillId === MobSkillId.PHYSICAL_IMMUNE && mob.hasMobBuff('mImmune')) return false;
  if (entry.skillId === MobSkillId.MAGIC_IMMUNE && mob.hasMobBuff('wImmune')) return false;

  const key = buffKeyOf(entry.skillId);
  if (key && entry.skillId !== MobSkillId.HEAL_M && mob.hasMobBuff(key)) return false;

  if (entry.skillId === MobSkillId.SUMMON) {
    if (lv.summons.length === 0) return false;
    const live = (map?.monsters ?? []).filter((m: Monster) => !m.destroyed && !m.dying).length;
    if (live >= MAP_MOB_CAP) return false;
    return liveSummonsOf(mob) < lv.limit;
  }
  if (entry.skillId === MobSkillId.HEAL_M) {
    if (!lv.rect) return mob.hp < mob.maxHp;
    const r = worldRect(lv.rect, mob.pos.x, mob.pos.y, mob.flipped);
    return (map?.monsters ?? []).some((m: Monster) => !m.destroyed && !m.dying && m.hp < m.maxHp && (m === mob || inRect(r, m.pos)));
  }
  if (PLAYER_DEBUFF_IDS.has(entry.skillId) || entry.skillId === MobSkillId.DISPEL || entry.skillId === MobSkillId.BANISH) {
    return pickPlayerTargets(mob, lv).length > 0;
  }
  return true;
}

/** Players a disease reaches: inside the box, or — with no box — the one the mob is after */
function pickPlayerTargets(mob: Monster, lv: MobSkillLevel): string[] {
  const map = mob.map;
  const all = playersWithIds(map);
  if (lv.rect) {
    const r = worldRect(lv.rect, mob.pos.x, mob.pos.y, mob.flipped);
    const hit = all.filter(({ ch }) => inRect(r, ch.pos)).map(({ id }) => id);
    if (lv.skillId === MobSkillId.SEDUCE) return hit.slice(0, Math.max(1, lv.count));
    return hit;
  }
  const target = mob.aggroTarget;
  const byTarget = target ? all.find(({ ch }) => ch === target) : null;
  if (byTarget) return [byTarget.id];
  let best: { id: string; d: number } | null = null;
  for (const { id, ch } of all) {
    const d = Math.hypot(ch.pos.x - mob.pos.x, ch.pos.y - mob.pos.y);
    if (d <= NO_RECT_RANGE && (!best || d < best.d)) best = { id, d };
  }
  return best ? [best.id] : [];
}

function pickMobTargets(mob: Monster, lv: MobSkillLevel): number[] {
  if (!lv.rect) return [mob.oId];
  const r = worldRect(lv.rect, mob.pos.x, mob.pos.y, mob.flipped);
  const out: number[] = [];
  for (const m of (mob.map?.monsters ?? []) as Monster[]) {
    if (m.destroyed || m.dying) continue;
    if (m === mob || inRect(r, m.pos)) out.push(m.oId);
  }
  return out;
}

function buildSummons(mob: Monster, lv: MobSkillLevel): MobSkillCast['summons'] {
  const room = Math.min(lv.summons.length, lv.limit - liveSummonsOf(mob));
  if (room <= 0) return [];
  const pool = [...lv.summons].sort(() => Math.random() - 0.5).slice(0, room);
  const fh = mob.pos?.fh;
  const fhId = typeof fh?.id === 'number' ? fh.id : mob.fh;
  return pool.map((id) => {
    let x = mob.pos.x + (Math.random() * 2 - 1) * SUMMON_SPREAD;
    if (fh && fh.x1 < fh.x2) x = Math.max(fh.x1 + 2, Math.min(fh.x2 - 2, x));
    return {
      oId: 1_000_000 + Math.floor(Math.random() * 2_000_000_000),
      id,
      x: Math.round(x),
      y: Math.round(mob.pos.y),
      fh: fhId,
    };
  });
}

let hookedSocket: any = null;

const MobSkillRunner = {
  /** Parse `info/skill` off a mob file; kicks the MobSkill.img load the first time any mob has one */
  readEntries(info: any): MobSkillEntry[] {
    const node = info?.skill;
    if (!node?.nChildren?.length) return [];
    const out: MobSkillEntry[] = [];
    for (const c of node.nChildren) {
      const skillId = Number(c.skill?.nValue);
      const level = Number(c.level?.nValue);
      if (!Number.isFinite(skillId) || !Number.isFinite(level)) continue;
      out.push({
        skillId,
        level,
        action: Number(c.action?.nValue) || 1,
        effectAfter: Number(c.effectAfter?.nValue) || 0,
      });
    }
    if (out.length) {
      void MobSkillData.ensureLoaded().then(() => {
        for (const e of out) MobSkillData.preload(MobSkillData.get(e.skillId, e.level));
      });
    }
    return out;
  },

  /** Listen for the room's casts. Idempotent per socket instance. */
  ensureNetHook(): void {
    const sock = socket();
    if (!sock || sock === hookedSocket || typeof sock.on !== 'function') return;
    hookedSocket = sock;
    sock.on('mob_skill', (msg: any) => {
      const cast: MobSkillCast | undefined = msg?.data;
      if (!cast) return;
      // The host's own cast already ran here
      if (sock.isMobHost) return;
      const map = currentMap();
      if (!map || Number(cast.mapId) !== Number(map.id)) return;
      MobSkillRunner.execute(cast);
    });
  },

  /**
   * Host-only, once a second per mob: pick a usable skill at random (the
   * emulator's getRandomSkill + canUseSkill) and cast it.
   */
  tryCast(mob: Monster, now: number): void {
    if (mob.isRemote || mob.dying || mob.isInHit || mob.isAttacking || mob.isCastingSkill) return;
    if (mob.skills.length === 0 || !MobSkillData.isLoaded()) return;
    if (now < mob.skillScanAt) return;
    mob.skillScanAt = now + SKILL_SCAN_MS;
    const map = mob.map;
    if (!map || !anyoneAware(mob, map)) return;
    // Face the target first: every box below is read in that orientation,
    // and the cast carries it so the room orients the art the same way
    if (mob.aggroTarget?.pos) mob.flipped = mob.aggroTarget.pos.x > mob.pos.x;

    const usable: Array<{ entry: MobSkillEntry; lv: MobSkillLevel }> = [];
    for (const entry of mob.skills) {
      const lv = MobSkillData.get(entry.skillId, entry.level);
      if (lv && canUse(mob, entry, lv, map, now)) usable.push({ entry, lv });
    }
    if (usable.length === 0) return;
    const { entry, lv } = usable[Math.floor(Math.random() * usable.length)];

    const landed = lv.prop >= 1 || Math.random() < lv.prop;
    const cast: MobSkillCast = {
      mapId: Number(map.id),
      oId: mob.oId,
      skillId: entry.skillId,
      level: entry.level,
      action: entry.action,
      effectAfter: entry.effectAfter,
      x: mob.pos.x,
      y: mob.pos.y,
      flipped: !!mob.flipped,
      landed,
      targets: [],
      mobTargets: [],
      summons: [],
    };
    if (landed) {
      if (PLAYER_DEBUFF_IDS.has(entry.skillId) || entry.skillId === MobSkillId.DISPEL || entry.skillId === MobSkillId.BANISH) {
        cast.targets = pickPlayerTargets(mob, lv);
      } else if (GROUP_BUFF_IDS.has(entry.skillId)) {
        cast.mobTargets = pickMobTargets(mob, lv);
      } else if (entry.skillId === MobSkillId.SUMMON) {
        cast.summons = buildSummons(mob, lv);
      }
    }

    mob.skillCooldowns.set(entry.skillId, now + Math.max(lv.intervalMs, SKILL_SCAN_MS));
    mob.skillScanAt = now + POST_CAST_HOLD_MS;
    MobSkillRunner.execute(cast);
    try {
      socket()?.sendMessage?.({ type: 'mob_skill', data: cast });
    } catch { /* offline play */ }
  },

  /** Every client: start the stance and the cast art; the effect lands via Monster.updateSkillCast */
  execute(cast: MobSkillCast): void {
    const map = currentMap();
    const mob: Monster | undefined = map?.findMonsterByOId?.(cast.oId);
    if (!mob || mob.destroyed || mob.dying) return;
    const lv = MobSkillData.get(cast.skillId, cast.level);
    if (!lv) {
      // MobSkill.img still loading on a fresh client — the next cast will land
      void MobSkillData.ensureLoaded();
      return;
    }
    mob.beginSkillCast(cast, lv);
  },

  /** The delayed half of a cast — called by the mob once `effectAfter` has elapsed */
  apply(mob: Monster, cast: MobSkillCast, lv: MobSkillLevel): void {
    if (!cast.landed) return;
    const id = cast.skillId;

    if (SELF_BUFF_IDS.has(id)) {
      mob.applyMobBuff(lv);
      return;
    }
    if (GROUP_BUFF_IDS.has(id)) {
      const map = mob.map;
      const ids = cast.mobTargets.length ? cast.mobTargets : [mob.oId];
      for (const oId of ids) {
        const m: Monster | undefined = oId === mob.oId ? mob : map?.findMonsterByOId?.(oId);
        if (!m || m.destroyed || m.dying) continue;
        if (id === MobSkillId.HEAL_M) m.healFromSkill(lv);
        else m.applyMobBuff(lv);
        if (lv.mob0) m.playMobArt(lv.mob0);
      }
      return;
    }
    if (id === MobSkillId.SUMMON) {
      void MobSkillRunner.spawnSummons(mob, cast, lv);
      return;
    }
    if (PLAYER_DEBUFF_IDS.has(id)) {
      for (const pid of cast.targets) {
        const ch = resolvePlayer(pid);
        ch?.status?.apply?.(lv);
      }
      return;
    }
    if (id === MobSkillId.DISPEL) {
      const me = localPlayer();
      if (me && cast.targets.includes(localPlayerId())) {
        const bm = me.buffManager;
        for (const skillId of [...(bm?.activeBuffs?.keys?.() ?? [])]) bm.removeBuff(skillId);
      }
      return;
    }
    if (id === MobSkillId.BANISH) {
      const me = localPlayer();
      if (me && cast.targets.includes(localPlayerId())) {
        const returnMap = Number(me.map?.wzNode?.info?.returnMap?.nValue);
        const state = (window as any).MapStateInstance;
        if (returnMap > 0 && returnMap < MAX_BANISH_MAP && state?.changeMap) void state.changeMap(returnMap);
      }
      return;
    }
    // Area poison mist (131), stop potion/motion (134/135), fear (136) and
    // hard skin (142) have no client model yet — logged so the gap is visible
    console.log(`[MobSkill] ${mob.name || mob.id} used skill ${id} lv${cast.level} (not modelled)`);
  },

  async spawnSummons(mob: Monster, cast: MobSkillCast, lv: MobSkillLevel): Promise<void> {
    const map = mob.map;
    if (!map?.spawnMonster) return;
    let effectFrames: any[] | null = null;
    let effectDelay = 0;
    if (lv.summonEffect > 0) {
      try {
        const node: any = await WZManager.get(`Effect.wz/Summon.img/${lv.summonEffect}`);
        const frames = (node?.nChildren ?? [])
          .filter((c: any) => /^\d+$/.test(c.nName) && c.nTagName === 'canvas')
          .sort((a: any, b: any) => Number(a.nName) - Number(b.nName));
        if (frames.length) {
          effectFrames = frames;
          const d = node?.delay?.nValue;
          effectDelay = typeof d === 'number' ? d : frames.length * 100;
        }
      } catch { /* no art, the mob simply appears */ }
    }
    for (const s of cast.summons) {
      if (map.findMonsterByOId?.(s.oId)) continue;
      try {
        await map.spawnMonster({
          oId: s.oId,
          id: s.id,
          x: s.x,
          y: s.y,
          fh: s.fh,
          minX: mob.minX,
          maxX: mob.maxX,
          stance: '',
          map,
          fadeIn: !effectFrames,
        });
        const born: Monster | undefined = (map.monsters as Monster[]).find((m) => m.oId === s.oId && !m.destroyed);
        if (!born) continue;
        born.summonerOId = mob.oId;
        if (effectFrames) born.setSummonEffect(effectFrames, effectDelay);
      } catch (e) {
        console.error('[MobSkill] summon failed', s, e);
      }
    }
  },

  /**
   * Weapon/Magic Reflect: the attacker takes the skill's fixed damage. The
   * local player is the only one whose HP we own, and nothing but the
   * reflect can be dodged or absorbed — it is not an attack roll.
   */
  reflectOntoAttacker(mob: Monster, attacker: Character, amount: number): void {
    const me = localPlayer();
    if (!attacker || attacker !== me || !me || me.isDead || amount <= 0) return;
    me.hp = Math.max(0, (Number(me.hp) || 0) - amount);
    try {
      me.DamageIndicator?.addDamageIndicator(DamageIndicatorType.MobHitPlayer, { x: me.pos.x, y: me.pos.y - 40 }, amount);
      socket()?.sendPlayerHitByMob?.(mob.oId, amount, false);
    } catch { /* indicator is cosmetic */ }
    if (me.hp <= 0) void me.die?.();
  },
};

export default MobSkillRunner;
