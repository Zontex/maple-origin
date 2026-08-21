import WZManager from '../wz-utils/WZManager';

/**
 * Arm one of a skill's animation nodes on a character. The frames sit on
 * the character and MapleMap's drawPlayerEffects pass renders them,
 * mirrored to the character's facing. Works for the local player and for
 * remote characters alike.
 */
async function playSkillArt(character: any, skillId: number, nodeName: 'effect' | 'affected'): Promise<void> {
  try {
    const jobFileId = Math.floor(skillId / 10000);
    const paddedJobId = String(jobFileId).padStart(3, '0');
    const skillNode: any = await WZManager.get(`Skill.wz/${paddedJobId}.img`);
    const artNode = skillNode?.nGet?.('skill')?.nGet?.(String(skillId).padStart(7, '0'))?.nGet?.(nodeName);
    if (!artNode?.nChildren || artNode.nChildren.length === 0) return;
    character.skillEffectFrames = artNode.nChildren;
    character.skillEffectFrame = 0;
    character.skillEffectDelay = 0;
    character.skillEffectActive = true;
  } catch (e) {
    /* a missing effect is not an error */
  }
}

/**
 * A skill's `effect` animation — the art drawn at the caster when a skill
 * goes off (Magic Claw's swipe, Double Shot's muzzle flash, a buff's burst).
 */
export function playSkillCastEffect(character: any, skillId: number): Promise<void> {
  return playSkillArt(character, skillId, 'effect');
}

/**
 * A skill's `affected` animation — what a party buff draws on each member
 * it lands on (Haste's wings, Bless's sparkle, Holy Symbol's glyph). Every
 * v83 party buff ships one; a skill without it simply plays nothing.
 */
export function playSkillAffectedEffect(character: any, skillId: number): Promise<void> {
  return playSkillArt(character, skillId, 'affected');
}
