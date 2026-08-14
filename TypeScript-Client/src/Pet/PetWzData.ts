import WZManager from '../wz-utils/WZManager';

/**
 * Per-petId WZ cache: sprites, info, interact/food/slang/randAction tables,
 * PetDialog strings, sounds, name-tag/balloon art. Loaded once per pet.
 *
 * Node shapes (verified against Item.wz/Pet/5000000.img):
 * - stances are top-level imgdirs (everything except info/interact/food/
 *   slang/randAction) of numbered canvas frames + $uol aliases; rest0 may
 *   carry a stance-level $int zigzag=1 (ping-pong playback)
 * - interact/<i>: command/inc/prob/l0/l1 + success|fail/<variant> where each
 *   variant is { act: stance, 0..3: PetDialog keys } — the variant index is
 *   NOT a level band; the entry itself is band-scoped by l0/l1
 * - food|slang/<band>: l0/l1 (+ success/fail variants for food, act+keys
 *   for slang)
 */

export interface PetActVariant {
  act: string;
  lineKeys: string[]; // PetDialog keys, resolve via wz.dialog at display time
}

export interface PetInteract {
  command: string; // PetDialog alias key, e.g. "c1"
  inc: number;
  prob: number;
  l0: number;
  l1: number;
  success: PetActVariant[];
  fail: PetActVariant[];
}

export interface PetFoodBand {
  l0: number;
  l1: number;
  success: PetActVariant[];
  fail: PetActVariant[];
}

export interface PetSlangBand {
  l0: number;
  l1: number;
  act: string;
  lineKeys: string[];
}

export interface PetRandAction {
  l0: number;
  l1: number;
  act: string;
}

export interface PetStance {
  frames: any[]; // WZ canvas nodes (uol-resolved)
  zigzag: boolean;
}

export interface PetEvolTarget {
  id: number;
  prob: number;
}

export interface PetWz {
  petId: number;
  name: string;
  desc: string;
  descD: string; // "turned back into a doll" text
  info: {
    hungry: number;
    life: number; // days; 0 = permanent
    limitedLife: number; // seconds (5000054 only); 0 = none
    permanent: boolean;
    nameTag: number | null;
    chatBalloon: number | null;
    autoReact: boolean;
    noRevive: boolean;
    evolReqItemID: number;
    evolReqPetLvl: number;
    iconD: any | null; // doll icon node
  };
  evolTargets: PetEvolTarget[]; // empty = does not evolve
  stances: Record<string, PetStance>;
  interact: PetInteract[];
  food: PetFoodBand[];
  slang: PetSlangBand[];
  randAction: PetRandAction[];
  dialog: Record<string, string>;
  sounds: Record<string, any>;
  nameTagArt: { w: any; c: any; e: any; color: string } | null;
  balloonArt: BalloonArt | null;
}

export interface BalloonArt {
  nw: HTMLImageElement; ne: HTMLImageElement; sw: HTMLImageElement; se: HTMLImageElement;
  n: HTMLImageElement; s: HTMLImageElement; w: HTMLImageElement; e: HTMLImageElement;
  c: HTMLImageElement; arrow: HTMLImageElement;
  color: string; // text color from clr
}

const NON_STANCE_NODES = new Set(['info', 'interact', 'food', 'slang', 'randAction']);

const petCache = new Map<number, Promise<PetWz>>();

const intOf = (node: any, def = 0): number => node?.nValue ?? def;
const strOf = (node: any, def = ''): string =>
  node?.nValue != null ? String(node.nValue) : def;

/** Signed WZ clr int → css color (clr -1 = white) */
function clrToCss(clr: number | undefined, fallback: string): string {
  if (clr == null) return fallback;
  const rgb = (clr >>> 0) & 0xffffff;
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

function parseVariants(containerNode: any): PetActVariant[] {
  const out: PetActVariant[] = [];
  if (!containerNode?.nChildren) return out;
  for (const variant of containerNode.nChildren) {
    const lineKeys: string[] = [];
    for (const child of variant.nChildren ?? []) {
      if (child.nName === 'act') continue;
      const key = strOf(child);
      if (key) lineKeys.push(key);
    }
    out.push({ act: strOf(variant.act, 'stand0'), lineKeys });
  }
  return out;
}

function parseStances(petNode: any): Record<string, PetStance> {
  const stances: Record<string, PetStance> = {};
  for (const child of petNode.nChildren ?? []) {
    if (NON_STANCE_NODES.has(child.nName)) continue;
    const frames: any[] = [];
    for (const frame of child.nChildren ?? []) {
      if (frame.nTagName === 'canvas') {
        frames.push(frame);
      } else if (frame.nTagName === 'uol') {
        const resolved = frame.nResolveUOL?.();
        if (resolved) frames.push(resolved);
      }
    }
    if (frames.length) {
      stances[child.nName] = { frames, zigzag: intOf(child.zigzag) === 1 };
    }
  }
  return stances;
}

export async function loadPetData(petId: number): Promise<PetWz> {
  const cached = petCache.get(petId);
  if (cached) return cached;
  const promise = doLoadPetData(petId);
  petCache.set(petId, promise);
  promise.catch(() => petCache.delete(petId));
  return promise;
}

async function doLoadPetData(petId: number): Promise<PetWz> {
  const petNode: any = await WZManager.get(`Item.wz/Pet/${petId}.img`);
  const info = petNode.info ?? {};

  // Strings — names + dialog. Missing entries are fine (fallbacks below).
  let name = `Pet ${petId}`;
  let desc = '';
  let descD = 'The pet has turned back into a doll.';
  try {
    const strRoot: any = await WZManager.get('String.wz/Pet.img');
    const entry = strRoot[String(petId)];
    if (entry) {
      name = strOf(entry.name, name);
      desc = strOf(entry.desc, desc);
      descD = strOf(entry.descD, descD);
    }
  } catch { /* no Pet.img — keep fallbacks */ }

  const dialog: Record<string, string> = {};
  try {
    const dialogRoot: any = await WZManager.get('String.wz/PetDialog.img');
    const entry = dialogRoot[String(petId)];
    for (const child of entry?.nChildren ?? []) {
      dialog[child.nName] = strOf(child);
    }
  } catch { /* pet without dialog */ }

  const sounds: Record<string, any> = {};
  try {
    const soundRoot: any = await WZManager.get('Sound.wz/Pet.img');
    const entry = soundRoot[String(petId)];
    for (const node of entry?.nChildren ?? []) {
      try {
        const resolved = node.nTagName === 'sound' ? node : node.nResolveUOL?.();
        if (resolved) sounds[resolved.nName] = resolved.nGetAudio();
      } catch { /* single bad sound — skip */ }
    }
  } catch { /* pet without sounds */ }

  // interact / food / slang / randAction tables
  const interact: PetInteract[] = [];
  for (const entry of petNode.interact?.nChildren ?? []) {
    interact.push({
      command: strOf(entry.command),
      inc: intOf(entry.inc, 1),
      prob: intOf(entry.prob, 50),
      l0: intOf(entry.l0, 1),
      l1: intOf(entry.l1, 30),
      success: parseVariants(entry.success),
      fail: parseVariants(entry.fail),
    });
  }

  const food: PetFoodBand[] = [];
  for (const entry of petNode.food?.nChildren ?? []) {
    food.push({
      l0: intOf(entry.l0, 1),
      l1: intOf(entry.l1, 30),
      success: parseVariants(entry.success),
      fail: parseVariants(entry.fail),
    });
  }

  const slang: PetSlangBand[] = [];
  for (const entry of petNode.slang?.nChildren ?? []) {
    // slang entries carry act + numbered keys directly (no success/fail)
    const lineKeys: string[] = [];
    for (const child of entry.nChildren ?? []) {
      if (child.nName === 'act' || child.nName === 'l0' || child.nName === 'l1') continue;
      const key = strOf(child);
      if (key) lineKeys.push(key);
    }
    slang.push({
      l0: intOf(entry.l0, 1),
      l1: intOf(entry.l1, 30),
      act: strOf(entry.act, 'stand1'),
      lineKeys,
    });
  }

  const randAction: PetRandAction[] = [];
  for (const entry of petNode.randAction?.nChildren ?? []) {
    randAction.push({
      l0: intOf(entry.l0, 1),
      l1: intOf(entry.l1, 30),
      act: strOf(entry.act, 'stand1'),
    });
  }

  // Evolution targets: evol1..evol5 + evolProb1..5; denominators are
  // inconsistent across pets (Dragons sum 100, Robos 1000) — store raw
  // weights, roll against the sum
  const evolTargets: PetEvolTarget[] = [];
  for (let i = 1; i <= 5; i++) {
    const id = intOf(info[`evol${i}`]);
    if (id) evolTargets.push({ id, prob: intOf(info[`evolProb${i}`], 1) });
  }

  // Name tag / chat balloon art (indices into UI.wz pet variants)
  const nameTagIdx = info.nameTag != null ? intOf(info.nameTag, -1) : -1;
  const balloonIdx = info.chatBalloon != null ? intOf(info.chatBalloon, -1) : -1;

  let nameTagArt: PetWz['nameTagArt'] = null;
  if (nameTagIdx >= 0) {
    try {
      const tagRoot: any = await WZManager.get('UI.wz/NameTag.img');
      const tag = tagRoot.pet?.[String(nameTagIdx)];
      if (tag?.w && tag?.c && tag?.e) {
        nameTagArt = {
          w: tag.w.nGetImage(),
          c: tag.c.nGetImage(),
          e: tag.e.nGetImage(),
          color: clrToCss(tag.clr?.nValue, '#ffffff'),
        };
      }
    } catch { /* keep null → plain fallback tag */ }
  }

  let balloonArt: BalloonArt | null = null;
  if (balloonIdx >= 0) {
    try {
      const balloonRoot: any = await WZManager.get('UI.wz/ChatBalloon.img');
      const style = balloonRoot.pet?.[String(balloonIdx)];
      if (style?.nw) {
        balloonArt = {
          nw: style.nw.nGetImage(), ne: style.ne.nGetImage(),
          sw: style.sw.nGetImage(), se: style.se.nGetImage(),
          n: style.n.nGetImage(), s: style.s.nGetImage(),
          w: style.w.nGetImage(), e: style.e.nGetImage(),
          c: style.c.nGetImage(), arrow: style.arrow.nGetImage(),
          color: clrToCss(style.clr?.nValue, '#000000'),
        };
      }
    } catch { /* keep null → default balloon */ }
  }

  return {
    petId,
    name,
    desc,
    descD,
    info: {
      hungry: intOf(info.hungry, 2),
      life: intOf(info.life, 90),
      limitedLife: intOf(info.limitedLife),
      permanent: intOf(info.permanent) === 1,
      nameTag: nameTagIdx >= 0 ? nameTagIdx : null,
      chatBalloon: balloonIdx >= 0 ? balloonIdx : null,
      autoReact: intOf(info.autoReact) === 1,
      noRevive: intOf(info.noRevive) === 1,
      evolReqItemID: intOf(info.evolReqItemID, -1),
      evolReqPetLvl: intOf(info.evolReqPetLvl),
      iconD: info.iconRawD ?? info.iconD ?? null,
    },
    evolTargets,
    stances: parseStances(petNode),
    interact,
    food,
    slang,
    randAction,
    dialog,
    sounds,
    nameTagArt,
    balloonArt,
  };
}

// ---------------------------------------------------------------------------
// Shared PetEff.img effects

export interface EffectAnim {
  frames: any[]; // canvas nodes with origin/delay
}

let basicEffPromise: Promise<Record<string, EffectAnim>> | null = null;

function framesOf(node: any): any[] {
  const frames: any[] = [];
  for (const frame of node?.nChildren ?? []) {
    if (frame.nTagName === 'canvas') frames.push(frame);
    else if (frame.nTagName === 'uol') {
      const r = frame.nResolveUOL?.();
      if (r) frames.push(r);
    }
  }
  return frames;
}

export async function loadBasicPetEffects(): Promise<Record<string, EffectAnim>> {
  if (!basicEffPromise) {
    basicEffPromise = (async () => {
      const out: Record<string, EffectAnim> = {};
      try {
        const eff: any = await WZManager.get('Effect.wz/PetEff.img');
        for (const key of ['LevelUp', 'Evolution', 'Teleport', 'hang']) {
          const node = eff.Basic?.[key];
          if (node) out[key] = { frames: framesOf(node) };
        }
      } catch (e) {
        console.warn('[Pet] PetEff.img load failed', e);
      }
      return out;
    })();
  }
  return basicEffPromise;
}

/** Per-pet warp animation, falling back to Basic/Teleport */
export async function loadWarpEffect(petId: number): Promise<EffectAnim | null> {
  try {
    const eff: any = await WZManager.get('Effect.wz/PetEff.img');
    const warp = eff[String(petId)]?.warp;
    if (warp) {
      const frames = framesOf(warp);
      if (frames.length) return { frames };
    }
  } catch { /* fall through */ }
  const basic = await loadBasicPetEffects();
  return basic.Teleport ?? null;
}

// Default balloon (style "0", same as player/NPC) for pets without a
// chatBalloon index
let defaultBalloonPromise: Promise<BalloonArt | null> | null = null;
export async function loadDefaultBalloon(): Promise<BalloonArt | null> {
  if (!defaultBalloonPromise) {
    defaultBalloonPromise = (async () => {
      try {
        const balloonRoot: any = await WZManager.get('UI.wz/ChatBalloon.img');
        const style = balloonRoot['0'];
        return {
          nw: style.nw.nGetImage(), ne: style.ne.nGetImage(),
          sw: style.sw.nGetImage(), se: style.se.nGetImage(),
          n: style.n.nGetImage(), s: style.s.nGetImage(),
          w: style.w.nGetImage(), e: style.e.nGetImage(),
          c: style.c.nGetImage(), arrow: style.arrow.nGetImage(),
          color: '#000000',
        };
      } catch {
        return null;
      }
    })();
  }
  return defaultBalloonPromise;
}
