import { MAX_COPIES, TAB_COUNT, isMonsterCardId, isSpecialCard, tabOf } from './MonsterBookData';

export type AddCardResult =
  /** First copy — the card is now in the book */
  | 'new'
  /** Copy 2-5 — reveals another section of the card */
  | 'copy'
  /** Already had all five; the card is consumed and nothing changes */
  | 'full';

/**
 * A character's Monster Book: which cards they hold, how many copies of each,
 * and which one is registered as their book cover.
 *
 * v83 rules, matching the emulator this project ports from:
 *  - a card holds up to 5 copies; only the FIRST copy of a card counts toward
 *    the book level, and each further copy unlocks another part of the card's
 *    page (HP/MP, then the episode, then the drop list, then the habitat list)
 *  - cards 2388xxx (bosses, event monsters) count as SPECIAL, everything else
 *    as BASIC; the level is driven by the two added together
 *  - the level curve needs 11 cards for level 2 and then a widening gap:
 *    31, 61, 101, 151, 211, 281. 343 cards exist, so 8 is the ceiling — which
 *    is exactly how many book covers UIWindow.img/MonsterBook/icon ships.
 */
class MonsterBook {
  /** card id -> copies held, 1..5. A card absent from the map is uncollected. */
  private cards: Map<number, number> = new Map();

  /** Registered book cover card id, 0 for none. */
  cover: number = 0;

  private _basic = 0;
  private _special = 0;
  private _level = 1;

  /**
   * Tabs holding a card obtained since the player last looked at them, drawn
   * with the WZ's blinking `new_n`/`new_s` tab art. Session-scoped: the marker
   * is a client-side "you haven't seen this yet" hint, not saved state.
   */
  readonly unseenTabs: Set<number> = new Set();

  // No catalogue load in the constructor: this is built while MyCharacter's
  // module is still evaluating, before AssetDownloader has opened its cache
  // store, so a fetch here would go to the network in a packaged build. Every
  // consumer (the window, the character-info panel, the pickup path) calls
  // ensureMonsterBookData itself.

  // ---- reads -------------------------------------------------------------

  /** Copies of a card held, 0 if uncollected. */
  copiesOf(cardId: number): number {
    return this.cards.get(cardId) ?? 0;
  }

  has(cardId: number): boolean {
    return this.cards.has(cardId);
  }

  /** All five copies held — the card is complete and wears the fullMark. */
  isComplete(cardId: number): boolean {
    return this.copiesOf(cardId) >= MAX_COPIES;
  }

  /** Unique BASIC (non-2388xxx) cards held. The window's "REG CARD" figure. */
  get basicCards(): number {
    return this._basic;
  }

  /** Unique SPECIAL (2388xxx) cards held. */
  get specialCards(): number {
    return this._special;
  }

  /** Unique cards held, basic + special. */
  get totalCards(): number {
    return this._basic + this._special;
  }

  /** Book master level, 1-8. */
  get level(): number {
    return this._level;
  }

  /** Cards held in one tab — drives the tab's "n / m" counter. */
  countInTab(tab: number): number {
    let n = 0;
    for (const cardId of this.cards.keys()) {
      if (tabOf(cardId) === tab) n++;
    }
    return n;
  }

  // ---- writes ------------------------------------------------------------

  /**
   * Register a picked-up card.
   *
   * Cards carry `spec/consumeOnPickup` in the WZ, so one is always consumed —
   * even the sixth copy, which changes nothing. The caller decides what to say
   * about it; this only moves the book forward.
   */
  addCard(cardId: number): AddCardResult {
    const held = this.cards.get(cardId);

    if (held === undefined) {
      this.cards.set(cardId, 1);
      if (isSpecialCard(cardId)) this._special++;
      else this._basic++;
      this.recalculateLevel();
      this.markUnseen(cardId);
      this.save();
      return 'new';
    }

    if (held >= MAX_COPIES) return 'full';

    this.cards.set(cardId, held + 1);
    this.markUnseen(cardId);
    this.save();
    return 'copy';
  }

  /**
   * Register a card as the book cover, or clear it with 0.
   *
   * Only a card actually held can be the cover — the context menu never offers
   * REGISTER on an empty slot, but a stale click must not slip one through.
   */
  setCover(cardId: number): boolean {
    if (cardId !== 0 && !this.cards.has(cardId)) return false;
    if (this.cover === cardId) return false;
    this.cover = cardId;
    this.save();
    return true;
  }

  markSeen(tab: number): void {
    this.unseenTabs.delete(tab);
  }

  private markUnseen(cardId: number): void {
    const tab = tabOf(cardId);
    if (tab >= 0 && tab < TAB_COUNT) this.unseenTabs.add(tab);
  }

  /**
   * v83's curve, from the emulator: walk up a level at a time, each step
   * costing 10 more cards than the last, until the collection no longer
   * reaches the next rung.
   */
  private recalculateLevel(): void {
    const collected = this.totalCards;
    let level = 0;
    let needed = 1;
    do {
      level++;
      needed += level * 10;
    } while (collected >= needed);
    this._level = level;
  }

  // ---- persistence -------------------------------------------------------

  /** `{ "2380000": 3, ... }` — rides the character save payload. */
  serialize(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [cardId, copies] of this.cards) out[String(cardId)] = copies;
    return out;
  }

  /**
   * Replace the whole book from saved state. Unconditional reset first: this
   * runs on every login, and a leftover card from the character loaded before
   * it would show up in the new one's book.
   */
  deserialize(cards: Record<string, number> | null | undefined, cover: number = 0): void {
    this.cards.clear();
    this._basic = 0;
    this._special = 0;
    this.unseenTabs.clear();

    for (const [key, raw] of Object.entries(cards || {})) {
      const cardId = parseInt(key, 10);
      const stored = Number(raw);
      // Garbage is dropped, not promoted: clamping first turned a NaN or a 0
      // into a phantom copy of a card the player never collected
      if (!Number.isFinite(cardId) || !Number.isFinite(stored) || stored < 1) continue;
      const copies = Math.min(MAX_COPIES, Math.floor(stored));
      this.cards.set(cardId, copies);
      if (isSpecialCard(cardId)) this._special++;
      else this._basic++;
    }

    this.recalculateLevel();
    // A cover pointing at a card the book no longer holds would render as a
    // blank plate on the info page and on other players' character windows
    this.cover = this.cards.has(cover) ? cover : 0;
  }

  private save(): void {
    (window as any).__mySocket?.requestSave?.();
  }

  /** The fields other players' character-info windows read off the roster. */
  summary(): { level: number; cover: number; total: number; basic: number; special: number } {
    return {
      level: this._level,
      cover: this.cover,
      total: this.totalCards,
      basic: this._basic,
      special: this._special,
    };
  }
}

/**
 * Move any monster cards sitting in an inventory tab into the book.
 *
 * Cards were plain ETC-style junk before the book existed, so a character
 * saved back then has them stacked in the USE tab where nothing can act on
 * them — v83 has no interaction for a card in the inventory, because a card
 * can never get there. This drains those slots on login, the same way
 * `sweepExpiredCashItems` reconciles stale cash items, and is a no-op once a
 * character has been through it.
 *
 * Runs BEFORE `_restoreComplete` flips so the follow-up save persists both
 * halves — the emptied slots and the cards now in the book — together.
 */
export function sweepInventoryCards(character: any): number {
  const book: MonsterBook | undefined = character?.monsterBook;
  const inventory = character?.inventory;
  if (!book || !inventory) return 0;

  let migrated = 0;
  for (const tab of ['equip', 'use', 'setup', 'etc', 'cash'] as const) {
    const items = inventory[tab];
    if (!Array.isArray(items)) continue;
    for (let slot = 0; slot < items.length; slot++) {
      const item = items[slot];
      if (!item || !isMonsterCardId(item.itemId)) continue;
      // A stack is that many pickups that were never registered
      for (let i = 0; i < Math.max(1, item.quantity ?? 1); i++) {
        book.addCard(item.itemId);
      }
      migrated += Math.max(1, item.quantity ?? 1);
      items[slot] = null;
    }
  }

  if (migrated > 0) {
    console.log(`[MonsterBook] Registered ${migrated} card(s) found in the inventory`);
  }
  return migrated;
}

export default MonsterBook;
