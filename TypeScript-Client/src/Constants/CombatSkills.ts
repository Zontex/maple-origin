import { WeaponType } from './EquipType';

// v83 weapon mastery skills per weapon type (Cosmic skill IDs).
// Damage floor mastery = max learned effect.mastery / 100, else 10%.
export const WEAPON_MASTERY_SKILLS: Record<number, number[]> = {
  [WeaponType.SWORD]: [1100000, 1200000],      // Fighter / Page Sword Mastery
  [WeaponType.SWORD_2H]: [1100000, 1200000],
  [WeaponType.AXE]: [1100001],                 // Axe Mastery
  [WeaponType.AXE_2H]: [1100001],
  [WeaponType.MACE]: [1200001],                // Blunt Weapon Mastery
  [WeaponType.MACE_2H]: [1200001],
  [WeaponType.SPEAR]: [1300000],               // Spear Mastery
  [WeaponType.POLEARM]: [1300001],             // Polearm Mastery
  [WeaponType.BOW]: [3100000],                 // Bow Mastery
  [WeaponType.CROSSBOW]: [3200000],            // Crossbow Mastery
  [WeaponType.CLAW]: [4100000],                // Claw Mastery
  [WeaponType.DAGGER]: [4200000],              // Dagger Mastery
  [WeaponType.KNUCKLER]: [5100001],            // Knuckler Mastery
  [WeaponType.PISTOL]: [5200000],              // Gun Mastery
};

// Final Attack per weapon: after a basic melee hit, `prop`% chance of a second
// swing (the body's F-stance: swingOF/stabTF/...) for `damage`% with the
// skill's own `hit` art. Hunter/Crossbowman versions are projectile follow-ups
// and are not modelled yet.
export const FINAL_ATTACK_SKILLS: Record<number, number[]> = {
  [WeaponType.SWORD]: [1100002, 1200002],      // Fighter / Page Final Attack: Sword
  [WeaponType.SWORD_2H]: [1100002, 1200002],
  [WeaponType.AXE]: [1100003],                 // Final Attack: Axe
  [WeaponType.AXE_2H]: [1100003],
  [WeaponType.MACE]: [1200003],                // Final Attack: Blunt Weapon
  [WeaponType.MACE_2H]: [1200003],
  [WeaponType.SPEAR]: [1300002],               // Final Attack: Spear
  [WeaponType.POLEARM]: [1300003],             // Final Attack: Pole Arm
};

// Monster Magnet (Hero / Paladin / Dark Knight): no damage — drags up to
// `mobCount` mobs within `range` in front of you to your feet, `prop`% each
export const MONSTER_MAGNET_IDS = new Set([1121001, 1221001, 1321001]);

// Assassinate (Shadower). GMS: "Strikes an unsuspecting monster at its vital
// spots 4 times. The last strike can be lethal with a given success rate." The
// WZ carries attackCount=3 plus `criticalDamage`/`prop` for that fourth,
// lethal strike, and a `time` (the stun) that would otherwise read as a buff.
export const ASSASSINATE_ID = 4221001;

// Lines of a multi-hit attack past the body's attack frames follow at the
// frame delay of the skill's own Hit art; this is the last-resort cadence
// when a skill ships no Hit art either.
export const MULTI_HIT_FALLBACK_CADENCE_MS = 90;

// Passive critical skills: chance = effect.prop / 100, damage = effect.damage / 100
export const CRITICAL_SKILLS: Record<number, number[]> = {
  [WeaponType.BOW]: [3000001],                 // Critical Shot
  [WeaponType.CROSSBOW]: [3000001],
  [WeaponType.CLAW]: [4100001],                // Critical Throw
};

// Skills whose level data keeps its stat in the generic `x`/`y` slots rather
// than named fields — the original client special-cases these by id, and so
// does every v83 server. Mapped onto the named fields at parse time so the
// passive/buff aggregators see them.
export const XY_STAT_SKILLS: Record<number, { x: string; y: string }> = {
  5000000: { x: 'acc', y: 'eva' },     // Bullet Time: accuracy / avoidability
  5001005: { x: 'speed', y: 'jump' },  // Dash: speed / jump
};

export const DASH_SKILL_ID = 5001005;

// Pirate 1st-job attack skills whose cast sound is the WEAPON's Attack clip,
// not Sound.wz/Skill.img/<id>/Use. Verified against the raw v83 Sound.wz:
// 5001000-5001007 is the pre-pirate GM job's block (GMs were job 500 before
// 900; 9001xxx is a byte-identical copy), so Flash Fist's "Use" is Haste's
// clip, Sommersault Kick's is Holy Symbol's, Double Shot's is Bless's, Dash's
// is Shining Ray's. Nexon authored real Hit clips for 5001001-3 but never
// replaced the Use ones. knuckle/Attack and gun/Attack (one per bullet) are
// the only pirate cast sounds the WZ has; Dash keeps its Use — the clip is a
// sustained whoosh and the WZ offers nothing else.
export const WEAPON_SOUND_SKILLS = new Set([5001001, 5001002, 5001003]);
export const usesWeaponSound = (skillId: number) => WEAPON_SOUND_SKILLS.has(skillId);

// Gap between the bullets of a multi-bullet gun skill (Double Shot)
export const SKILL_BULLET_STAGGER_MS = 150;

// Weapon booster buffs — effect.x lowers attack speed stage (negative value)
export const BOOSTER_SKILL_IDS = [
  1101004, 1101005, // Sword / Axe Booster (Fighter)
  1201004, 1201005, // Sword / Blunt Booster (Page)
  1301004, 1301005, // Spear / Polearm Booster (Spearman)
  3101002,          // Bow Booster
  3201002,          // Crossbow Booster
  4101003,          // Claw Booster
  4201002,          // Dagger Booster
  5101006,          // Knuckler Booster
  5201003,          // Gun Booster
];

// v83 party buffs — cast by one member, applied to every member inside the
// skill's `lt`/`rb` box on the same map (PartyManager.onMemberBuff). Heal
// (2301002) and Dispel are attack-shaped and excluded; Mystic Door and Time
// Leap are not buffs.
export const PARTY_BUFF_SKILLS = new Set([
  1101006,          // Rage
  1301006,          // Iron Will
  1301007,          // Hyper Body
  2101001, 2201001, // Meditation (F/P, I/L)
  2301004,          // Bless
  2311003,          // Holy Symbol
  4101004, 4201003, // Haste (Assassin, Bandit)
  3121002, 3221002, // Sharp Eyes
  5121009,          // Speed Infusion
  1121000, 1221000, 1321000, 2121000, 2221000, 2321000, // Maple Warrior
  3121000, 3221000, 4121000, 4221000, 5121000, 5221000,
]);
export const isPartyBuffSkill = (skillId: number) => PARTY_BUFF_SKILLS.has(skillId);
