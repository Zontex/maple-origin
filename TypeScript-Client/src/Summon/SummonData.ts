import SkillData, { SkillInfo, SkillLevelEffect } from '../Skills/SkillData';

/**
 * Parsed `summon` imgdir of a v83 summon skill (Skill.wz/<job>.img/skill/
 * <id>/summon). Every summon ships its own stance set there; the attack
 * stances also carry an `info` block describing the blow.
 *
 * Surveyed shapes (all 27 summon skills in the client's data):
 *   summoned, stand, die        — every summon
 *   fly                         — flyers (Silver Hawk, Golden Eagle, Phoenix,
 *                                 Frostprey, Summon Dragon, Bahamut, Gaviota)
 *   move                        — walkers (Ifrit, Elquines, Beholder, Cygnus
 *                                 1st-job elementals)
 *   neither fly nor move        — stationary (Octopus, Puppet)
 *   attack1 [attack2]           — attackers; `info` has range{lt,rb,sp,r},
 *                                 type, attackAfter, mobCount and, for the
 *                                 Octopus, a `ball` + bulletSpeed
 *   hit                         — Puppet only: the decoy's flinch stance
 *   skill1..skill6              — Beholder: heal / buff casts, no attacks
 */
export interface SummonBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SummonAttack {
  stance: string;
  /** lt/rb rectangle relative to the anchor, authored facing LEFT */
  box: SummonBox | null;
  /** Target acquisition radius (`r`), or one derived from the box */
  radius: number;
  /** Ball spawn offset, authored facing left */
  sp: { x: number; y: number };
  type: number;
  /** ms into the stance when the blow lands */
  attackAfter: number;
  /** ms into the stance when the attack-local `effect` clip plays (0 = none) */
  effectAfter: number;
  mobCount: number;
  ballNode: any | null;
  bulletSpeed: number;
  /** Attack-local hit art (Silver Hawk's slash), else null — root `hit` is the fallback */
  hitFrames: any[] | null;
  effectFrames: any[] | null;
  /** Total length of the stance animation in ms */
  durationMs: number;
}

export type SummonKind = 'flying' | 'walker' | 'stationary' | 'puppet';

export interface SummonWz {
  skillId: number;
  info: SkillInfo;
  kind: SummonKind;
  stances: Record<string, any[]>;
  attacks: SummonAttack[];
  /** Root `hit/0/<n>` frames, drawn on a struck mob */
  hitFrames: any[] | null;
  height: number;
  element: string | null;
  /** Beholder-style: no attacks, `skillN` stances instead */
  isBeholder: boolean;
}

const DEFAULT_RADIUS = 200;
const cache = new Map<number, SummonWz | null>();

function num(node: any, fallback = 0): number {
  const v = node?.nValue;
  if (v === undefined || v === null) return fallback;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function vec(node: any): { x: number; y: number } | null {
  if (!node || node.nTagName !== 'vector') return null;
  const x = Number(node.nX ?? NaN);
  const y = Number(node.nY ?? NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Canvas frames of an imgdir in numeric order, UOLs resolved. Several
 * stances alias frames (`stand/3 -> ../move/3`, Phoenix's whole attack1 is
 * UOLs into `die`), so the raw child list cannot be drawn as-is.
 */
export function collectFrames(dir: any): any[] {
  if (!dir?.nChildren) return [];
  const out: { i: number; node: any }[] = [];
  for (const child of dir.nChildren) {
    const i = parseInt(child.nName);
    if (!Number.isFinite(i)) continue;
    let node = child;
    if (node.nTagName === 'uol') node = node.nResolveUOL?.();
    if (node?.nTagName !== 'canvas') continue;
    out.push({ i, node });
  }
  out.sort((a, b) => a.i - b.i);
  return out.map(o => o.node);
}

export function frameDelay(frame: any, fallback = 100): number {
  return num(frame?.nGet?.('delay'), fallback) || fallback;
}

export function framesDuration(frames: any[]): number {
  return frames.reduce((acc, f) => acc + frameDelay(f), 0);
}

function parseAttack(stance: string, dir: any): SummonAttack | null {
  const frames = collectFrames(dir);
  if (!frames.length) return null;
  const info = dir.nGet?.('info');
  const range = info?.nGet?.('range');
  const lt = vec(range?.nGet?.('lt'));
  const rb = vec(range?.nGet?.('rb'));
  const box = lt && rb ? { left: lt.x, top: lt.y, right: rb.x, bottom: rb.y } : null;
  let radius = num(range?.nGet?.('r'), 0);
  if (radius <= 0 && box) {
    radius = Math.max(Math.abs(box.left), Math.abs(box.right));
  }
  if (radius <= 0) radius = DEFAULT_RADIUS;
  const sp = vec(range?.nGet?.('sp')) ?? { x: 0, y: -20 };
  const ballNode = info?.nGet?.('ball');
  const hitDir = info?.nGet?.('hit');
  const effectDir = info?.nGet?.('effect');
  const hitFrames = hitDir?.nChildren?.length ? collectFrames(hitDir) : null;
  const effectFrames = effectDir?.nChildren?.length ? collectFrames(effectDir) : null;
  return {
    stance,
    box,
    radius,
    sp,
    type: num(info?.nGet?.('type'), 0),
    attackAfter: num(info?.nGet?.('attackAfter'), 0),
    effectAfter: num(info?.nGet?.('effectAfter'), 0),
    mobCount: Math.max(1, num(info?.nGet?.('mobCount'), 1)),
    ballNode: ballNode?.nChildren?.length ? ballNode : null,
    bulletSpeed: num(info?.nGet?.('bulletSpeed'), 0),
    hitFrames,
    effectFrames,
    durationMs: framesDuration(frames),
  };
}

function parseSummonNode(info: SkillInfo): SummonWz | null {
  const node = info.summonNode;
  if (!node?.nChildren?.length) return null;

  const stances: Record<string, any[]> = {};
  const attacks: SummonAttack[] = [];
  let height = 0;

  for (const child of node.nChildren) {
    const name = String(child.nName);
    if (name === 'height') {
      height = num(child, 0);
      continue;
    }
    if (child.nTagName !== 'imgdir') continue;
    const frames = collectFrames(child);
    if (frames.length) stances[name] = frames;
    if (/^attack\d+$/.test(name)) {
      const atk = parseAttack(name, child);
      if (atk) attacks.push(atk);
    }
  }
  if (!stances.stand && !stances.fly && !stances.move) return null;

  const rootHit = (info as any).effects?.[0]?.hitNode ?? null;
  let hitFrames: any[] | null = null;
  if (rootHit?.nChildren?.length) {
    // hit/0/<frames> — the first child is the frame set (see Projectile)
    hitFrames = collectFrames(rootHit.nChildren[0]);
    if (!hitFrames.length) hitFrames = null;
  }

  const isBeholder = attacks.length === 0 && Object.keys(stances).some(s => /^skill\d+$/.test(s));
  let kind: SummonKind;
  if (attacks.length === 0 && stances.hit && !stances.move && !stances.fly) kind = 'puppet';
  else if (stances.fly) kind = 'flying';
  else if (stances.move) kind = 'walker';
  else kind = 'stationary';

  return {
    skillId: info.id,
    info,
    kind,
    stances,
    attacks,
    hitFrames,
    height,
    element: info.element,
    isBeholder,
  };
}

/** Parsed summon data for a skill, or null when the skill summons nothing */
export async function loadSummonData(skillId: number): Promise<SummonWz | null> {
  if (cache.has(skillId)) return cache.get(skillId) ?? null;
  let parsed: SummonWz | null = null;
  try {
    const info = await SkillData.getSkill(skillId);
    if (info?.hasSummon) parsed = parseSummonNode(info);
  } catch (e) {
    console.warn(`[Summon] failed to parse summon ${skillId}:`, e);
  }
  cache.set(skillId, parsed);
  return parsed;
}

/** Lifetime of a summon for a level's effect, in ms (`time` is seconds) */
export function summonDurationMs(effect: SkillLevelEffect | null | undefined): number {
  const t = Number(effect?.time) || 0;
  return Math.max(1000, t * 1000);
}
