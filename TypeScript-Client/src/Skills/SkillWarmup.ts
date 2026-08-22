import WZManager from '../wz-utils/WZManager';
import { collectNodeImages, decodeImages, nextIdle } from '../wz-utils/SpriteWarmup';

/**
 * Warm a skill before its first cast: every frame of its effect / effectN /
 * hit / ball / affected art created and decoded, and its Use / Hit clips
 * turned into Audio elements — plus the one-off fetch of Sound.wz/Skill.img
 * (2.7MB of JSON) that otherwise lands, parse and all, inside the first
 * cast. Bound skills are warmed when they land on the hotkey bar.
 */
const warmed = new Set<number>();
let soundRootPromise: Promise<any> | null = null;

export function prefetchSkillSounds(): Promise<any> {
  if (!soundRootPromise) {
    soundRootPromise = WZManager.get('Sound.wz/Skill.img').catch(() => null);
    void WZManager.get('Sound.wz/Game.img').catch(() => null);
  }
  return soundRootPromise;
}

export async function warmSkill(skillId: number): Promise<void> {
  if (!(skillId > 0) || warmed.has(skillId)) return;
  warmed.add(skillId);
  try {
    const jobFile = String(Math.floor(skillId / 10000)).padStart(3, '0');
    const node: any = await WZManager.get(`Skill.wz/${jobFile}.img`);
    const root = node?.nGet?.('skill')?.nGet?.(String(skillId).padStart(7, '0'));
    await nextIdle();
    const imgs = collectNodeImages(root);
    await decodeImages(imgs);

    const sounds: any = await prefetchSkillSounds();
    const clips = sounds?.nGet?.(String(skillId).padStart(7, '0'));
    for (const kind of ['Use', 'Hit']) {
      let clip = clips?.nGet?.(kind);
      if (clip?.nTagName === 'uol') { try { clip = clip.nResolveUOL(); } catch { clip = null; } }
      try { clip?.nGetAudio?.(); } catch { /* best effort */ }
    }
  } catch {
    /* warming is best-effort; the cast still works, just colder */
  }
}
