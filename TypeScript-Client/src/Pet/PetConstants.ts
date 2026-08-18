/**
 * All pet tuning numbers in one place. Follow-AI distances are in world
 * pixels; times in ms unless noted.
 */

// Monster walk formula (125 * (100+speed))/100 with +20% so the pet can
// catch a walking owner instead of teleport-spamming behind them
export const PET_WALK_SPEED = 150;

// Walk hysteresis: start walking when farther than START, stop when closer
// than STOP — the gap prevents jitter at the deadzone edge
export const PET_START_DIST = 72;
export const PET_STOP_DIST = 24;

// Give-up teleport thresholds (v83 pets warp to the owner when left behind)
export const PET_TELEPORT_X = 640;
export const PET_TELEPORT_Y = 350;
export const PET_STUCK_MS = 3000;

// Ledge hop: target this much above and horizontally near → jump
export const PET_JUMP_DY = 40;
export const PET_JUMP_DX_MAX = 140;
export const PET_JUMP_COOLDOWN_MS = 600;

// Rope-follow: the pet clings to the climbing owner's BACK — centered on
// the character, feet anchored this many px above the owner's feet. Low
// enough that the player's torso (drawn after the pet) covers its front,
// so it reads as riding the back with just head/ears peeking out.
export const PET_HANG_Y_OFFSET = -6;

// Idle stance reroll window
export const PET_IDLE_MIN_MS = 5000;
export const PET_IDLE_MAX_MS = 10000;

// Fullness
export const PET_HUNGRY_STANCE_AT = 30;      // ≤ this → hungry idle stance + warning
export const PET_STARVED_FULLNESS_LEFT = 5;  // fullness after a starved despawn
// Decay: fullness −1 every (48 − 6·info.hungry) seconds (hungry 1→42s, 5→18s)
export const petDecayIntervalMs = (hungry: number) =>
  Math.max(6, 48 - 6 * Math.max(1, Math.min(5, hungry || 2))) * 1000;

// randAction idle scheduler
export const PET_RANDACT_MIN_MS = 8000;
export const PET_RANDACT_MAX_MS = 20000;
export const PET_RANDACT_CHANCE = 0.3;

// Chat
export const PET_BALLOON_MS = 4500;
export const PET_SLANG_CHANCE = 0.1; // unknown chat word → 10% chance the pet reacts

export const MAX_PETS = 3;

// Functional-equip cadences
export const PET_LOOT_INTERVAL_MS = 500;
export const PET_LONGRANGE_EXTRA_PX = 100;
export const PET_AUTO_POTION_INTERVAL_MS = 2000;
export const PET_AUTO_POTION_RATIO = 0.5;

export const PET_MAX_LEVEL = 30;

// ---------------------------------------------------------------------------
// Pet equip panel slots. Cell positions are pixel-scanned off the baked
// UIWindow.img/Equip/pet art (4x4 grid of 31px cells, cols x=14/47/80/113,
// rows y=12/45/78/111) — each cell has a printed label in the sprite.

export interface PetEquipCell {
  key: string;
  x: number;
  y: number;
  label: string;
}

export const PET_EQUIP_CELLS: PetEquipCell[] = [
  { key: 'hpPouch',    x: 14,  y: 12,  label: 'Auto HP Pouch' },   // HP POC
  { key: 'mpPouch',    x: 80,  y: 12,  label: 'Auto MP Pouch' },   // MP POC
  { key: 'itemPouch',  x: 14,  y: 45,  label: 'Item Pouch' },      // ITEM POC
  { key: 'mesoMagnet', x: 47,  y: 45,  label: 'Meso Magnet' },     // MESO MAG
  { key: 'ignore',     x: 14,  y: 78,  label: 'Item Ignore' },     // ITEM IGNORE
  { key: 'sweep',      x: 47,  y: 78,  label: 'Wing Boots' },      // PICK UP
  { key: 'binocular',  x: 80,  y: 78,  label: 'Binocular' },       // POS
  { key: 'equip',      x: 113, y: 78,  label: 'Pet Equip' },       // PET EQUIP
  { key: 'scales',     x: 14,  y: 111, label: 'Magic Scales' },    // MOVE UP
  { key: 'labelRing',  x: 80,  y: 111, label: 'Pet Ring' },        // PET RING
  { key: 'quoteRing',  x: 113, y: 111, label: 'Pet Ring' },        // PET RING
];

/** Panel slot for a pet-equip item id (018xxxxx) */
export function petEquipSlotKey(itemId: number): string {
  const prefix4 = Math.floor(itemId / 1000);
  if (prefix4 === 1802) return 'equip'; // cosmetic hats/ribbons
  switch (itemId) {
    case 1812000: return 'mesoMagnet';
    case 1812001: return 'itemPouch';
    case 1812002: return 'hpPouch';
    case 1812003: return 'mpPouch';
    case 1812004: return 'sweep';
    case 1812005: return 'binocular';
    case 1812006: return 'scales';
    case 1812007: return 'ignore';
  }
  const prefix3 = Math.floor(itemId / 10000);
  if (prefix3 === 182) return 'labelRing';
  if (prefix3 === 183) return 'quoteRing';
  return 'equip';
}
