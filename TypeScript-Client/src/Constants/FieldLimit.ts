/**
 * Map `info/fieldLimit` bitflags — the client's FIELDOPT_* enum (the v95
 * list Arnah published with HaRepacker; the v83 bits are the same, the
 * later additions simply never appear in v83 data).
 *
 * Names follow what the bit actually forbids. Where Cosmic's FieldLimit.java
 * uses a different name the alias is kept so code ported from it reads the
 * same. One deliberate divergence: Cosmic puts CANNOTUSEPOTION on 0x1000,
 * but the client's 0x1000 is NOMOBCAPACITYLIMIT; the bit that makes the v83
 * client refuse a potion with "You can't use it here in this map." is 0x400,
 * STATCHANGEITEMCONSUMELIMIT (potions are "state change items" in the
 * client's nomenclature). The WZ agrees: 0x400 is set on the Mu Lung Dojo
 * floors (925020xxx), where potions are indeed disallowed.
 *
 * Survey of v83 Map.wz (maps with a non-zero fieldLimit): bit 3 (DOOR) is by
 * far the most common, then 18 (FALLDOWN), 6 (VIPROCK), 5 (PORTALSCROLL),
 * 13 (WEDDINGINVITATION), 4 (CHANGECHANNEL). JUMP (bit 0) appears on 34
 * maps, TAMINGMOB on 2270, POTIONUSE on 794.
 */
export const FieldLimit = {
  /** 0x01 — no jumping (FIELDOPT_MOVELIMIT) */
  JUMP: 0x1,
  /** 0x02 — no Flash Jump / Teleport / Dash style movement skills */
  MOVEMENTSKILLS: 0x2,
  /** 0x04 — no summons */
  SUMMON: 0x4,
  /** 0x08 — no Mystic Door */
  DOOR: 0x8,
  /** 0x10 — no channel change / Cash Shop / migration (Cosmic: CANNOTMIGRATE) */
  CHANGECHANNEL: 0x10,
  /** 0x20 — no return scrolls (FIELDOPT_PORTALSCROLLLIMIT) */
  PORTALSCROLL: 0x20,
  /** 0x40 — no VIP / Teleport Rock (Cosmic: CANNOTVIPROCK) */
  VIPROCK: 0x40,
  /** 0x80 — no minigames (omok, match cards) */
  MINIGAME: 0x80,
  /** 0x100 — no specific-portal scrolls (APQ, a few quest maps) */
  SPECIALPORTAL: 0x100,
  /** 0x200 — no mounts (Cosmic: CANNOTUSEMOUNTS) */
  TAMINGMOB: 0x200,
  /** 0x400 — no potions / state-change items: "You can't use it here in this map." */
  POTIONUSE: 0x400,
  /** 0x800 — party boss change limit (Monster Carnival) */
  PARTYBOSSCHANGE: 0x800,
  /** 0x1000 — no mob capacity limit */
  NOMOBCAPACITY: 0x1000,
  /** 0x2000 — no wedding invitations */
  WEDDINGINVITATION: 0x2000,
  /** 0x4000 — no Cash Shop weather items */
  CASHWEATHER: 0x4000,
  /** 0x8000 — no pets */
  NOPET: 0x8000,
  /** 0x10000 — anti-macro limit */
  ANTIMACRO: 0x10000,
  /** 0x20000 — no dropping down through platforms (Cosmic: CANNOTJUMPDOWN) */
  FALLDOWN: 0x20000,
  /** 0x40000 — summon NPC limit */
  SUMMONNPC: 0x40000,
  /** 0x80000 — no EXP loss on death */
  NOEXPDECREASE: 0x80000,
  /** 0x100000 — no fall damage */
  NODAMAGEONFALLING: 0x100000,
  /** 0x200000 — no opening parcels */
  PARCELOPEN: 0x200000,
  /** 0x400000 — no dropping items (Cosmic: DROP_LIMIT) */
  DROP: 0x400000,
  /** 0x800000 — no Rocket Booster (mechanics; never set in v83) */
  ROCKETBOOSTER: 0x800000,
} as const;

export type FieldLimitBit = (typeof FieldLimit)[keyof typeof FieldLimit];

/** Cosmic-style aliases, so ported code keeps its names */
export const CANNOTMIGRATE = FieldLimit.CHANGECHANNEL;
export const CANNOTVIPROCK = FieldLimit.VIPROCK;
export const CANNOTUSEMOUNTS = FieldLimit.TAMINGMOB;
export const CANNOTUSEPOTION = FieldLimit.POTIONUSE;
export const CANNOTJUMPDOWN = FieldLimit.FALLDOWN;

/** The v83 client's refusal line for anything a fieldLimit bit blocks */
export const FIELD_LIMIT_MESSAGE = "You can't use it here in this map.";

/** `(fieldLimit & bit) === bit` — same test as Cosmic's FieldLimit.check */
export function fieldForbids(fieldLimit: number, bit: number): boolean {
  return (fieldLimit & bit) === bit;
}

/**
 * Skills the MOVEMENTSKILLS bit refuses: Flash Jump, the three Teleports,
 * Dash and Recoil Shot. Rush-type attack skills are left alone — they are
 * attacks first, and the bit is about crossing jump-quest gaps.
 */
export const MOVEMENT_SKILL_IDS = new Set<number>([
  4111006, // Flash Jump (Hermit)
  2101002, // Teleport (F/P Wizard)
  2201002, // Teleport (I/L Wizard)
  2301001, // Teleport (Cleric)
  5001005, // Dash (Pirate)
  5201006, // Recoil Shot (Gunslinger)
]);

/**
 * The current map's fieldLimit test without importing MapleMap (the UI and
 * inventory modules reach the map through the player, and some of them
 * cannot import MapleMap without a cycle). Returns false when no map is
 * loaded.
 */
export function currentMapForbids(bit: number): boolean {
  const map = (window as any).charecter?.map;
  if (!map) return false;
  if (typeof map.forbids === 'function') return map.forbids(bit);
  return fieldForbids(Number(map.fieldLimit) || 0, bit);
}
