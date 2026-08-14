import { PetWz, PetInteract, PetActVariant } from './PetWzData';

/**
 * Chat-command matching, pure functions. The typed chat text is matched
 * against the pet's PetDialog alias lists (`c1` = "sit", `c5` =
 * "bad|no|badgirl|badboy", ...); the matching interact entry must also
 * cover the pet's current level via its l0/l1 band.
 */

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

/** All interact entries whose command aliases match the typed text AND whose level band covers petLevel */
export function matchCommand(msg: string, wz: PetWz, petLevel: number): PetInteract | null {
  const norm = normalize(msg);
  if (!norm) return null;
  for (const entry of wz.interact) {
    if (petLevel < entry.l0 || petLevel > entry.l1) continue;
    const aliases = wz.dialog[entry.command];
    if (!aliases) continue;
    if (aliases.split('|').some((a) => normalize(a) === norm)) return entry;
  }
  return null;
}

/** True when the text matches ANY band of the pet's commands (used to avoid slang reactions to real commands the pet has outgrown/not reached) */
export function isKnownCommandWord(msg: string, wz: PetWz): boolean {
  const norm = normalize(msg);
  if (!norm) return false;
  for (const entry of wz.interact) {
    const aliases = wz.dialog[entry.command];
    if (aliases && aliases.split('|').some((a) => normalize(a) === norm)) return true;
  }
  return false;
}

export function pickVariant(variants: PetActVariant[]): PetActVariant | null {
  if (!variants.length) return null;
  return variants[Math.floor(Math.random() * variants.length)];
}

/** Resolve a variant's dialog keys against the pet's PetDialog strings and pick one line */
export function pickLine(wz: PetWz, variant: PetActVariant | null): string | null {
  if (!variant) return null;
  const lines = variant.lineKeys.map((k) => wz.dialog[k]).filter(Boolean);
  if (!lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

/** Direct dialog-key list → one resolved line (slang, feeding f-lines) */
export function pickLineFromKeys(wz: PetWz, keys: string[]): string | null {
  const lines = keys.map((k) => wz.dialog[k]).filter(Boolean);
  if (!lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}
