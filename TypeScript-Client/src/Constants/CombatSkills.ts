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

// Passive critical skills: chance = effect.prop / 100, damage = effect.damage / 100
export const CRITICAL_SKILLS: Record<number, number[]> = {
  [WeaponType.BOW]: [3000001],                 // Critical Shot
  [WeaponType.CROSSBOW]: [3000001],
  [WeaponType.CLAW]: [4100001],                // Critical Throw
};

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
