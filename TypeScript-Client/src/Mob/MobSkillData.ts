import WZManager from '../wz-utils/WZManager';

/**
 * Mob skill ids, as `Skill.wz/MobSkill.img` numbers them. Names follow the
 * v83 emulator's MobSkillType so the two can be read side by side.
 */
export enum MobSkillId {
  ATTACK_UP = 100,
  MAGIC_ATTACK_UP = 101,
  DEFENSE_UP = 102,
  MAGIC_DEFENSE_UP = 103,
  ATTACK_UP_M = 110,
  MAGIC_ATTACK_UP_M = 111,
  DEFENSE_UP_M = 112,
  MAGIC_DEFENSE_UP_M = 113,
  HEAL_M = 114,
  HASTE_M = 115,
  SEAL = 120,
  DARKNESS = 121,
  WEAKNESS = 122,
  STUN = 123,
  CURSE = 124,
  POISON = 125,
  SLOW = 126,
  DISPEL = 127,
  SEDUCE = 128,
  BANISH = 129,
  AREA_POISON = 131,
  REVERSE_INPUT = 132,
  UNDEAD = 133,
  STOP_POTION = 134,
  STOP_MOTION = 135,
  FEAR = 136,
  PHYSICAL_IMMUNE = 140,
  MAGIC_IMMUNE = 141,
  HARD_SKIN = 142,
  PHYSICAL_COUNTER = 143,
  MAGIC_COUNTER = 144,
  PHYSICAL_AND_MAGIC_COUNTER = 145,
  PAD = 150,
  MAD = 151,
  PDR = 152,
  MDR = 153,
  ACC = 154,
  EVA = 155,
  SPEED = 156,
  SEAL_SKILL = 157,
  SUMMON = 200,
}

/** Player-side diseases: what a mob skill does to the player it lands on */
export const PLAYER_DEBUFF_IDS: ReadonlySet<number> = new Set([
  MobSkillId.SEAL, MobSkillId.DARKNESS, MobSkillId.WEAKNESS, MobSkillId.STUN,
  MobSkillId.CURSE, MobSkillId.POISON, MobSkillId.SLOW, MobSkillId.SEDUCE,
  MobSkillId.REVERSE_INPUT, MobSkillId.UNDEAD,
]);

/** Skills that buff the caster alone (no lt/rb — or one that only the caster reads) */
export const SELF_BUFF_IDS: ReadonlySet<number> = new Set([
  MobSkillId.ATTACK_UP, MobSkillId.MAGIC_ATTACK_UP, MobSkillId.DEFENSE_UP, MobSkillId.MAGIC_DEFENSE_UP,
  MobSkillId.PHYSICAL_IMMUNE, MobSkillId.MAGIC_IMMUNE, MobSkillId.HARD_SKIN,
  MobSkillId.PHYSICAL_COUNTER, MobSkillId.MAGIC_COUNTER, MobSkillId.PHYSICAL_AND_MAGIC_COUNTER,
  MobSkillId.PAD, MobSkillId.MAD, MobSkillId.PDR, MobSkillId.MDR, MobSkillId.ACC, MobSkillId.EVA,
  MobSkillId.SPEED, MobSkillId.SEAL_SKILL,
]);

/** Skills that buff/heal every mob inside the lt/rb box, the caster included */
export const GROUP_BUFF_IDS: ReadonlySet<number> = new Set([
  MobSkillId.ATTACK_UP_M, MobSkillId.MAGIC_ATTACK_UP_M, MobSkillId.DEFENSE_UP_M,
  MobSkillId.MAGIC_DEFENSE_UP_M, MobSkillId.HEAL_M, MobSkillId.HASTE_M,
]);

export interface SkillRect { x1: number; y1: number; x2: number; y2: number }

/**
 * One animation node of a mob skill (`effect`, `affected`, `mob`, `mob0`).
 * `pos` is the WZ anchor code: 0 = feet, 1 = above the head, 2 = above the
 * head (the small status icon the mob wears), 3 = body centre. `repeat`
 * means the art loops for the skill's duration instead of playing once.
 */
export interface MobSkillArt {
  frames: any[];
  pos: number;
  repeat: boolean;
}

export interface MobSkillLevel {
  skillId: number;
  level: number;
  mpCon: number;
  /** Cooldown between uses, ms (WZ `interval`, seconds) */
  intervalMs: number;
  /** Duration of the buff/debuff, ms (WZ `time`, seconds) */
  timeMs: number;
  /** Chance the cast lands, 0..1 (WZ `prop`, percent; absent = always) */
  prop: number;
  x: number;
  y: number;
  /** The mob only casts at or below this % of its HP (absent = 100) */
  hpThreshold: number;
  count: number;
  limit: number;
  summonEffect: number;
  summons: number[];
  /** Area box relative to a left-facing caster; null = caster-only skill */
  rect: SkillRect | null;
  /** Cast art at the caster (plays once) */
  effect: MobSkillArt | null;
  /** Art on each player the skill landed on */
  affected: MobSkillArt | null;
  /** Art the buffed mob carries for the duration (aura or head icon) */
  mob: MobSkillArt | null;
  /** Art played once on every mob a group skill reached */
  mob0: MobSkillArt | null;
}

let root: any = null;
let loading: Promise<void> | null = null;
const cache: Map<string, MobSkillLevel | null> = new Map();

/** A named child node, or null — nGet() hands back an empty placeholder instead */
function child(node: any, key: string): any {
  const c = node ? node[key] : null;
  return c && typeof c === 'object' && typeof c.nTagName === 'string' ? c : null;
}

function num(node: any, key: string, fallback: number): number {
  const v = child(node, key)?.nValue;
  return typeof v === 'number' ? v : fallback;
}

function readArt(node: any): MobSkillArt | null {
  if (!node?.nChildren?.length) return null;
  const frames: any[] = [];
  for (const c of node.nChildren) {
    if (!/^\d+$/.test(c.nName)) continue;
    const frame = c.nTagName === 'uol' ? c.nResolveUOL() : c;
    if (frame?.nTagName === 'canvas') frames.push(frame);
  }
  if (frames.length === 0) return null;
  frames.sort((a, b) => Number(a.nName) - Number(b.nName));
  return {
    frames,
    pos: num(node, 'pos', 0),
    repeat: num(node, 'repeat', 0) > 0,
  };
}

function readLevel(skillId: number, level: number, node: any): MobSkillLevel {
  const summons: number[] = [];
  for (let i = 0; ; i++) {
    const s = child(node, String(i));
    if (!s || typeof s.nValue !== 'number') break;
    summons.push(s.nValue);
  }
  const lt = child(node, 'lt');
  const rb = child(node, 'rb');
  const rect: SkillRect | null =
    lt && rb && typeof lt.nX === 'number' && typeof rb.nX === 'number'
      ? { x1: lt.nX, y1: lt.nY ?? 0, x2: rb.nX, y2: rb.nY ?? 0 }
      : null;
  // 141's effect is a UOL to 140's
  let effectNode = child(node, 'effect');
  if (effectNode?.nTagName === 'uol') effectNode = effectNode.nResolveUOL();
  return {
    skillId,
    level,
    mpCon: num(node, 'mpCon', 0),
    intervalMs: num(node, 'interval', 0) * 1000,
    timeMs: num(node, 'time', 0) * 1000,
    prop: num(node, 'prop', 100) / 100,
    x: num(node, 'x', 1),
    y: num(node, 'y', 1),
    hpThreshold: num(node, 'hp', 100),
    count: num(node, 'count', 1),
    limit: num(node, 'limit', 0),
    summonEffect: num(node, 'summonEffect', 0),
    summons,
    rect,
    effect: readArt(effectNode),
    affected: readArt(child(node, 'affected')),
    mob: readArt(child(node, 'mob')),
    mob0: readArt(child(node, 'mob0')),
  };
}

/**
 * `Skill.wz/MobSkill.img` — one level record per (skill, level), parsed on
 * first request and kept for the session. The file is 13MB of mostly art,
 * so it is fetched once and never per mob.
 */
const MobSkillData = {
  async ensureLoaded(): Promise<void> {
    if (root) return;
    if (!loading) {
      loading = WZManager.get('Skill.wz/MobSkill.img')
        .then((n: any) => { root = n; })
        .catch((e: any) => { console.error('[MobSkill] failed to load MobSkill.img', e); });
    }
    await loading;
  },

  isLoaded(): boolean {
    return !!root;
  },

  /** Sync lookup — null until ensureLoaded() resolved, or for an unknown (skill, level) */
  get(skillId: number, level: number): MobSkillLevel | null {
    const key = `${skillId}:${level}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    if (!root) return null;
    const node = child(child(child(root, String(skillId)), 'level'), String(level));
    const parsed = node ? readLevel(skillId, level, node) : null;
    cache.set(key, parsed);
    return parsed;
  },

  /** Decode every canvas of a level's art up front so the first cast doesn't blink */
  preload(entry: MobSkillLevel | null): void {
    if (!entry) return;
    for (const art of [entry.effect, entry.affected, entry.mob, entry.mob0]) {
      art?.frames.forEach((f: any) => { void f?.nPreloadImage?.(); });
    }
  },
};

export default MobSkillData;
