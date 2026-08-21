import WZManager from '../wz-utils/WZManager';
import PLAY_AUDIO from '../Audio/PlayAudio';

/**
 * Play a skill's own sound from `Sound.wz/Skill.img/<7-digit id>/<Use|Hit>`.
 *
 * Every attack skill in v83 ships a `Hit` clip beside its `Use` clip (Flash
 * Fist's punch thud, Double Shot's ricochet); the generic `Game.img/Hit`
 * weapon clank is the fallback only when the skill has none. `Use` has no
 * fallback — a buff with no clip is silent, as in the original.
 * Returns whether anything was played.
 */
export async function playSkillSound(skillId: number, kind: 'Use' | 'Hit'): Promise<boolean> {
  try {
    const root: any = await WZManager.get('Sound.wz/Skill.img');
    let clip = root?.nGet?.(String(skillId).padStart(7, '0'))?.nGet?.(kind);
    if (clip?.nTagName === 'uol') clip = clip.nResolveUOL();
    if (clip?.nGetAudio) {
      PLAY_AUDIO(clip.nGetAudio());
      return true;
    }
    if (kind === 'Hit') {
      const generic: any = await WZManager.get('Sound.wz/Game.img/Hit');
      if (generic?.nGetAudio) {
        PLAY_AUDIO(generic.nGetAudio());
        return true;
      }
    }
  } catch (e) {
    /* sound is best-effort */
  }
  return false;
}
