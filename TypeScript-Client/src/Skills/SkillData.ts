import WZManager from '../wz-utils/WZManager';

export interface SkillLevelEffect {
  mpCon: number;
  hpCon: number;
  damage: number;
  mastery: number;
  time: number;
  prop: number;
  x: number;
  y: number;
  pad: number;
  pdd: number;
  mad: number;
  mdd: number;
  acc: number;
  eva: number;
  speed: number;
  jump: number;
  range: number;
  cooltime: number;
  fixdamage: number;
  mobCount: number;
  attackCount: number;
  bulletCount: number;
  bulletConsume: number;
  hp: number;
  mp: number;
  damagepc: number;
  // WZ nodes for skill projectile and hit effect (stored per-level for skills like Three Snails)
  ballNode: any;
  hitNode: any;
}

export interface SkillInfo {
  id: number;
  name: string;
  description: string;
  maxLevel: number;
  icon: HTMLImageElement | null;
  iconMouseOver: HTMLImageElement | null;
  iconDisabled: HTMLImageElement | null;
  jobId: number;
  isPassive: boolean;
  isBuff: boolean;
  isAttack: boolean;
  invisible: boolean;
  /**
   * Skills that must be raised first, from the WZ `req` node — Magic Claw
   * carries `2001002: 3`, so Energy Bolt at level 3 before it can be taken.
   */
  reqs: { skillId: number; level: number }[];
  effects: SkillLevelEffect[];
  helpStrings: Map<string, string>;
  /** Prerequisite skills from the WZ `req` node: skillId -> level needed */
  req: { id: number; level: number }[];
  action: string | null; // Body stance to play (e.g., 'alert2', 'alert4') from WZ action node
  element: string | null; // WZ elemAttr char: F/I/L/S/H/D/P (fire/ice/lightning/poison/holy/dark/physical)
}

const LEVEL_EFFECT_FIELDS: (keyof SkillLevelEffect)[] = [
  'mpCon', 'hpCon', 'damage', 'mastery', 'time', 'prop',
  'x', 'y', 'pad', 'pdd', 'mad', 'mdd', 'acc', 'eva',
  'speed', 'jump', 'range', 'cooltime', 'fixdamage',
  'mobCount', 'attackCount', 'bulletCount', 'bulletConsume',
  'hp', 'mp', 'damagepc',
];

function emptyEffect(): SkillLevelEffect {
  return {
    mpCon: 0, hpCon: 0, damage: 0, mastery: 0, time: 0, prop: 0,
    x: 0, y: 0, pad: 0, pdd: 0, mad: 0, mdd: 0, acc: 0, eva: 0,
    speed: 0, jump: 0, range: 0, cooltime: 0, fixdamage: 0,
    mobCount: 1, attackCount: 1, bulletCount: 0, bulletConsume: 0,
    hp: 0, mp: 0, damagepc: 0,
    ballNode: null, hitNode: null,
  };
}

// Cache of loaded skill data
const skillCache: Map<number, SkillInfo> = new Map();
// Track which job files have been loaded
const loadedJobFiles: Set<number> = new Set();
// Skill name/description cache from String.wz
let skillStringsLoaded = false;
const skillNames: Map<number, string> = new Map();
const skillDescs: Map<number, string> = new Map();
const skillHelp: Map<number, Map<string, string>> = new Map();

function getJobFileId(skillId: number): number {
  return Math.floor(skillId / 10000);
}

async function ensureSkillStrings(): Promise<void> {
  if (skillStringsLoaded) return;
  skillStringsLoaded = true;

  try {
    const strNode = await WZManager.get('String.wz/Skill.img');
    if (!strNode?.nChildren) return;

    for (const child of (strNode as any).nChildren) {
      const id = parseInt(child.nName);
      if (isNaN(id)) continue;

      const nameNode = child.nGet?.('name');
      if (nameNode?.nValue) skillNames.set(id, String(nameNode.nValue));

      const descNode = child.nGet?.('desc');
      if (descNode?.nValue) skillDescs.set(id, String(descNode.nValue));

      // Help strings (h1, h2, ... h30)
      const helpMap = new Map<string, string>();
      for (const sub of child.nChildren || []) {
        if (sub.nName.startsWith('h') && sub.nValue) {
          helpMap.set(sub.nName, String(sub.nValue));
        }
      }
      if (helpMap.size > 0) skillHelp.set(id, helpMap);
    }

    console.log(`[SkillData] Loaded ${skillNames.size} skill names`);
  } catch (e) {
    console.error('[SkillData] Failed to load skill strings:', e);
  }
}

function parseLevelEffect(levelNode: any): SkillLevelEffect {
  const effect = emptyEffect();
  if (!levelNode?.nChildren) return effect;

  for (const child of levelNode.nChildren) {
    const name = child.nName;
    if (name === 'ball') {
      effect.ballNode = child;
    } else if (name === 'hit') {
      effect.hitNode = child;
    } else {
      const key = name as keyof SkillLevelEffect;
      if (LEVEL_EFFECT_FIELDS.includes(key)) {
        const val = child.nValue;
        if (val !== undefined && val !== null) {
          (effect as any)[key] = typeof val === 'number' ? val : parseFloat(String(val)) || 0;
        }
      }
    }
  }

  return effect;
}

function parseSkillNode(skillNode: any, skillId: number): SkillInfo {
  let hasAction = false;
  let hasHit = false;
  let hasBall = false;
  let hasEffect = false;
  // Most skills keep ball/hit at the skill root, not per level (Three Snails is
  // the exception). Without hoisting these onto every level effect, useSkill saw
  // a null ballNode and silently ran Energy Bolt down the melee path — cast,
  // damage, no bolt.
  let rootBallNode: any = null;
  let rootHitNode: any = null;
  let invisible = false;
  let actionStance: string | null = null;
  let element: string | null = null;

  let icon: HTMLImageElement | null = null;
  let iconMouseOver: HTMLImageElement | null = null;
  let iconDisabled: HTMLImageElement | null = null;
  const effects: SkillLevelEffect[] = [];

  for (const child of skillNode.nChildren || []) {
    const name = child.nName;

    if (name === 'icon' && child.nTagName === 'canvas' && child.nGetImage) {
      icon = child.nGetImage() as HTMLImageElement;
    } else if (name === 'iconMouseOver' && child.nTagName === 'canvas' && child.nGetImage) {
      iconMouseOver = child.nGetImage() as HTMLImageElement;
    } else if (name === 'iconDisabled' && child.nTagName === 'canvas' && child.nGetImage) {
      iconDisabled = child.nGetImage() as HTMLImageElement;
    } else if (name === 'action') {
      hasAction = true;
      // Read the stance name from the action node (e.g., action/0 = "alert2")
      const firstAction = child.nGet?.('0');
      if (firstAction?.nValue) {
        actionStance = String(firstAction.nValue);
      }
    } else if (name === 'hit') {
      hasHit = true;
      rootHitNode = child;
    } else if (name === 'ball') {
      hasBall = true;
      rootBallNode = child;
    } else if (name === 'effect') {
      hasEffect = true;
    } else if (name === 'invisible') {
      invisible = true;
    } else if (name === 'disable') {
      invisible = true;
    } else if (name === 'elemAttr') {
      if (child.nValue) element = String(child.nValue).toUpperCase();
    } else if (name === 'level') {
      // Parse each level
      const levelChildren = (child.nChildren || []).slice();
      // Sort by numeric name
      levelChildren.sort((a: any, b: any) => parseInt(a.nName) - parseInt(b.nName));
      for (const lvl of levelChildren) {
        effects.push(parseLevelEffect(lvl));
      }
    }
  }

  // Push the skill-root ball/hit down onto each level, without clobbering the
  // per-level nodes that skills like Three Snails define themselves
  if (rootBallNode || rootHitNode) {
    for (const e of effects) {
      if (!e.ballNode && rootBallNode) e.ballNode = rootBallNode;
      if (!e.hitNode && rootHitNode) e.hitNode = rootHitNode;
    }
  }

  // Check for dateExpire in level 1 — skip expired time-limited skills
  if (effects.length > 0) {
    const firstLevel = skillNode.nGet?.('level')?.nGet?.('1');
    if (firstLevel) {
      const dateExpire = firstLevel.nGet?.('dateExpire');
      if (dateExpire?.nValue) {
        const ds = String(dateExpire.nValue);
        const y = parseInt(ds.slice(0, 4));
        const m = parseInt(ds.slice(4, 6)) - 1;
        const d = parseInt(ds.slice(6, 8));
        const h = parseInt(ds.slice(8, 10)) || 0;
        if (Date.now() > new Date(y, m, d, h).getTime()) {
          invisible = true;
        }
      }
    }
  }

  // Determine skill type. Some skills (e.g., Three Snails) keep their ball/hit
  // nodes per-level instead of at the skill root, so check both.
  // Prerequisites — the tooltip's [Required] block. e.g. Improved MaxMP
  // Increase (2000001) requires level 5 of Improving MP Recovery (2000000).
  const req: { id: number; level: number }[] = [];
  for (const r of skillNode.nGet('req')?.nChildren || []) {
    const rid = Number(r.nName);
    const rlv = Number(r.nValue);
    if (Number.isFinite(rid) && Number.isFinite(rlv)) req.push({ id: rid, level: rlv });
  }

  const levelHasBallOrHit = effects.some(e => e.ballNode || e.hitNode);
  const isAttack = hasHit || hasBall || levelHasBallOrHit;
  const isBuff = !isAttack && (hasAction || hasEffect);
  const isPassive = !isAttack && !isBuff && effects.length > 0;

  return {
    id: skillId,
    name: skillNames.get(skillId) || `Skill ${skillId}`,
    description: skillDescs.get(skillId) || '',
    maxLevel: effects.length,
    icon,
    iconMouseOver,
    iconDisabled,
    jobId: getJobFileId(skillId),
    isPassive,
    isBuff,
    isAttack,
    invisible,
    reqs: (() => {
      const out: { skillId: number; level: number }[] = [];
      const reqNode: any = skillNode?.nGet?.('req');
      for (const child of reqNode?.nChildren ?? []) {
        const id = Number(child?.nName);
        const lvl = Number(child?.nValue);
        if (Number.isFinite(id) && Number.isFinite(lvl)) {
          out.push({ skillId: id, level: lvl });
        }
      }
      return out;
    })(),
    effects,
    helpStrings: skillHelp.get(skillId) || new Map(),
    req,
    action: actionStance,
    element,
  };
}

async function loadJobFile(jobFileId: number): Promise<void> {
  if (loadedJobFiles.has(jobFileId)) return;
  loadedJobFiles.add(jobFileId);

  try {
    // Pad to at least 3 digits (e.g., 0 → "000", 100 → "100")
    const paddedId = String(jobFileId).padStart(3, '0');
    const wzPath = `Skill.wz/${paddedId}.img`;
    const rootNode = await WZManager.get(wzPath);
    if (!rootNode) return;

    // Skills are under the 'skill' imgdir
    const skillDir = (rootNode as any).nGet?.('skill');
    if (!skillDir?.nChildren) return;

    for (const skillNode of (skillDir as any).nChildren) {
      const skillId = parseInt(skillNode.nName);
      if (isNaN(skillId)) continue;

      try {
        const info = parseSkillNode(skillNode, skillId);
        skillCache.set(skillId, info);
      } catch (e) {
        console.warn(`[SkillData] Failed to parse skill ${skillId}:`, e);
      }
    }

    console.log(`[SkillData] Loaded job file ${jobFileId} (${skillCache.size} skills cached)`);
  } catch (e) {
    console.warn(`[SkillData] Could not load Skill.wz/${jobFileId}.img:`, e);
  }
}

const SkillData = {
  async initialize(): Promise<void> {
    await ensureSkillStrings();
  },

  async getSkill(skillId: number): Promise<SkillInfo | null> {
    await ensureSkillStrings();

    const cached = skillCache.get(skillId);
    if (cached) return cached;

    // Load the job file for this skill
    const jobFileId = getJobFileId(skillId);
    await loadJobFile(jobFileId);

    return skillCache.get(skillId) || null;
  },

  getSkillSync(skillId: number): SkillInfo | null {
    return skillCache.get(skillId) || null;
  },

  async getJobSkills(jobFileId: number): Promise<SkillInfo[]> {
    await ensureSkillStrings();
    await loadJobFile(jobFileId);

    const result: SkillInfo[] = [];
    for (const [id, info] of skillCache) {
      if (getJobFileId(id) === jobFileId) {
        result.push(info);
      }
    }
    return result;
  },

  // Get all visible (non-invisible, non-disabled) skills for a job file
  async getVisibleJobSkills(jobFileId: number): Promise<SkillInfo[]> {
    const all = await this.getJobSkills(jobFileId);
    return all.filter(s => !s.invisible && s.maxLevel > 0);
  },

  // Get the WZ file IDs (= job IDs) for each advancement tier up to given jobId
  // E.g., Crusader (111) → [0, 100, 110, 111]
  getJobTierFileIds(jobId: number): number[] {
    const tiers: number[] = [];

    // Beginner tier: 0 for Explorers, 1000 for Cygnus, 2000 for Aran
    const base = Math.floor(jobId / 1000) * 1000;
    tiers.push(base); // 0, 1000, or 2000

    if (jobId === base) return tiers; // Beginner only

    // 1st job: 100, 200, 300, 400, 500 (or 1100, 1200, etc.)
    const firstJob = Math.floor(jobId / 100) * 100;
    tiers.push(firstJob);

    if (jobId === firstJob) return tiers;

    // 2nd job: 110, 120, 210, etc.
    const secondJob = Math.floor(jobId / 10) * 10;
    tiers.push(secondJob);

    if (jobId === secondJob) return tiers;

    // 3rd job: 111, 121, 211, etc.
    if (jobId % 10 >= 1) {
      const thirdJob = secondJob + 1;
      tiers.push(thirdJob);
    }

    // 4th job: 112, 122, 212, etc.
    if (jobId % 10 >= 2) {
      const fourthJob = secondJob + 2;
      tiers.push(fourthJob);
    }

    return tiers;
  },

  // Get the skill name synchronously (for display)
  getSkillName(skillId: number): string {
    return skillNames.get(skillId) || skillCache.get(skillId)?.name || `Skill ${skillId}`;
  },

  // Get the effect for a specific skill at a specific level
  getEffect(skillId: number, level: number): SkillLevelEffect | null {
    const info = skillCache.get(skillId);
    if (!info || level < 1 || level > info.maxLevel) return null;
    return info.effects[level - 1];
  },

  // Pre-load skills for all job tiers up to the given jobId
  async preloadForJob(jobId: number): Promise<void> {
    await ensureSkillStrings();
    const tiers = this.getJobTierFileIds(jobId);
    for (const fileId of tiers) {
      await loadJobFile(fileId);
    }
  },
};

export default SkillData;
