// Key bindings for the KEYBOARD SETTING window.
//
// v83 keys its config by DirectInput scancode, which is why
// UI.wz/UIWindow.img/KeyConfig/key is indexed 2..88 rather than by ASCII.
// The 70 sprites under that node are the labels the original prints on the
// keyboard, and every one of them is accounted for in KEY_SLOTS over in
// UIKeyConfig — the two tables were derived from each other, so "every key
// available" means exactly the set the art ships.
//
// No WZ/UI imports here so MapState can depend on it without pulling the UI
// layer in behind it.

const STORAGE_KEY = "maple_keybindings";

/** Every action the client can actually carry out from a key. */
export type BindableAction =
  | "jump"
  | "attack"
  | "pickup"
  | "sit"
  | "inventory"
  | "stats"
  | "equipment"
  | "skills"
  | "questLog"
  | "miniMap"
  | "keyConfig";

export interface ActionInfo {
  action: BindableAction;
  /** UIWindow.img/KeyConfig/icon/<id> — the sprite dragged onto a key. */
  icon: number;
  label: string;
}

// Icon ids read off the sprites themselves rather than guessed: the icon set
// is 0-27 (menus and chat targets), 50-54 (ATTACK/JUMP/PICK UP/SIT/NPC CHAT)
// and 100-106 (the emote faces). Only the ones the client can honour today
// are listed — an icon in the palette is a control that works.
export const ACTIONS: ActionInfo[] = [
  { action: "attack", icon: 52, label: "Attack" },
  { action: "jump", icon: 53, label: "Jump" },
  { action: "pickup", icon: 50, label: "Pick up" },
  { action: "sit", icon: 51, label: "Sit" },
  { action: "equipment", icon: 0, label: "Equipment" },
  { action: "inventory", icon: 1, label: "Item" },
  { action: "stats", icon: 2, label: "Ability" },
  { action: "skills", icon: 3, label: "Skill" },
  { action: "questLog", icon: 8, label: "Quest" },
  { action: "miniMap", icon: 7, label: "Mini Map" },
  { action: "keyConfig", icon: 9, label: "Set Key" },
];

export const ACTION_BY_NAME = new Map(ACTIONS.map((a) => [a.action, a]));

/**
 * Scancode -> the key name GameCanvas.isKeyDown() understands.
 *
 * GameCanvas names the punctuation keys rather than using the glyph
 * ("minus", not "-"), and isKeyDown falls through to `pressedKeys[key]` when
 * the name is unknown, so a wrong name here is silent — the key simply never
 * fires. Every name below is taken from GameCanvas.keys.
 */
export const SCANCODE_TO_KEY: Record<number, string> = {
  2: "1", 3: "2", 4: "3", 5: "4", 6: "5", 7: "6", 8: "7", 9: "8", 10: "9",
  11: "0", 12: "minus", 13: "plus",
  16: "q", 17: "w", 18: "e", 19: "r", 20: "t", 21: "y", 22: "u", 23: "i",
  24: "o", 25: "p", 26: "[", 27: "]",
  29: "ctrl",
  30: "a", 31: "s", 32: "d", 33: "f", 34: "g", 35: "h", 36: "j", 37: "k",
  38: "l", 39: "colon", 40: "quote", 41: "tilde",
  42: "shift", 43: "pipe",
  44: "z", 45: "x", 46: "c", 47: "v", 48: "b", 49: "n", 50: "m",
  51: "comma", 52: "period",
  56: "alt", 57: "space",
  59: "f1", 60: "f2", 61: "f3", 62: "f4", 63: "f5", 64: "f6", 65: "f7",
  66: "f8", 67: "f9", 68: "f10", 87: "f11", 88: "f12",
  71: "home", 73: "pageup", 79: "end", 81: "pagedown",
  82: "insert", 83: "delete",
};

/**
 * v83 defaults. Esc and Enter are deliberately absent: the original has no
 * key sprite and no keyboard slot for either, so the menu and the chat box
 * stay hardwired to them and can never be stranded on an unreachable key.
 */
export const DEFAULT_BINDINGS: Record<number, BindableAction> = {
  29: "attack",     // Ctrl
  56: "jump",       // Alt
  44: "pickup",     // Z
  46: "sit",        // C
  18: "equipment",  // E
  23: "inventory",  // I
  31: "stats",      // S
  37: "skills",     // K
  16: "questLog",   // Q
  50: "miniMap",    // M
  // keyConfig ships unbound, so it starts in the palette.
};

type Bindings = Record<number, BindableAction>;
type ItemBindings = Record<number, number>;

const ITEM_STORAGE_KEY = "maple_keybindings_items";

function loadItems(): ItemBindings {
  try {
    const raw = localStorage.getItem(ITEM_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const out: ItemBindings = {};
    for (const k of Object.keys(parsed)) {
      const code = Number(k);
      const itemId = Number(parsed[k]);
      if (Number.isFinite(code) && SCANCODE_TO_KEY[code] && Number.isFinite(itemId)) {
        out[code] = itemId;
      }
    }
    return out;
  } catch {
    return {};
  }
}

interface KeyBindingsShape {
  bindings: Bindings;
  /**
   * scancode -> itemId. Separate from `bindings` because an item is not a
   * BindableAction: the quickslot bar only offers the eight v83 keys, so
   * putting an item on, say, X has to go through the key config window.
   */
  itemBindings: ItemBindings;
  itemFor: (scancode: number) => number | undefined;
  /** GameCanvas key name for a scancode, or null when it is not bindable. */
  keyNameForScancode: (scancode: number) => string | null;
  keyForItem: (itemId: number) => number | undefined;
  bindItem: (scancode: number, itemId: number) => void;
  clearItem: (scancode: number) => void;
  saveItems: () => void;
  /** scancode currently bound to an action, or undefined. */
  keyFor: (action: BindableAction) => number | undefined;
  /** GameCanvas key name bound to an action, or null when unbound. */
  keyNameFor: (action: BindableAction) => string | null;
  bind: (scancode: number, action: BindableAction) => void;
  clear: (scancode: number) => void;
  resetToDefault: () => void;
  replaceAll: (b: Bindings) => void;
  snapshot: () => Bindings;
  save: () => void;
}

function load(): Bindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("none");
    const parsed = JSON.parse(raw);
    const out: Bindings = {};
    for (const k of Object.keys(parsed)) {
      const code = Number(k);
      const action = parsed[k];
      // Drop anything unrecognised rather than trusting the blob wholesale —
      // an action that was removed from the client would otherwise sit on a
      // key forever, invisible and unbindable.
      if (
        Number.isFinite(code) &&
        SCANCODE_TO_KEY[code] !== undefined &&
        ACTION_BY_NAME.has(action)
      ) {
        out[code] = action;
      }
    }
    // A deliberately empty map is a legitimate state (the Delete button), so
    // only a completely unreadable blob falls back to the defaults.
    return out;
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

const KeyBindings: KeyBindingsShape = {
  bindings: load(),
  itemBindings: loadItems(),

  itemFor(scancode) {
    return this.itemBindings[scancode];
  },

  keyNameForScancode(scancode) {
    return SCANCODE_TO_KEY[scancode] ?? null;
  },

  keyForItem(itemId) {
    for (const k of Object.keys(this.itemBindings)) {
      if (this.itemBindings[Number(k)] === itemId) return Number(k);
    }
    return undefined;
  },

  bindItem(scancode, itemId) {
    // One key per item, and a key holds one thing — dropping an item on a key
    // that has an action takes the key over, and the action goes back to the
    // palette, the same as action-on-action.
    const prev = this.keyForItem(itemId);
    if (prev !== undefined) delete this.itemBindings[prev];
    delete this.bindings[scancode];
    this.itemBindings[scancode] = itemId;
    this.save();
    this.saveItems();
  },

  clearItem(scancode) {
    delete this.itemBindings[scancode];
    this.saveItems();
  },

  saveItems() {
    try {
      localStorage.setItem(ITEM_STORAGE_KEY, JSON.stringify(this.itemBindings));
    } catch (e) {
      console.warn("[KeyBindings] could not save item bindings", e);
    }
  },

  keyFor(action) {
    for (const k of Object.keys(this.bindings)) {
      if (this.bindings[Number(k)] === action) return Number(k);
    }
    return undefined;
  },

  keyNameFor(action) {
    const code = this.keyFor(action);
    if (code === undefined) return null;
    return SCANCODE_TO_KEY[code] ?? null;
  },

  bind(scancode, action) {
    // An action lives on exactly one key, so moving it clears the old slot.
    // Whatever already sat on the target is displaced back to the palette.
    const prev = this.keyFor(action);
    if (prev !== undefined) delete this.bindings[prev];
    // A key holds one thing, so an action dropped onto a key that carries an
    // item displaces the item rather than both firing off the same press.
    if (this.itemBindings[scancode] !== undefined) {
      delete this.itemBindings[scancode];
      this.saveItems();
    }
    this.bindings[scancode] = action;
    this.save();
  },

  clear(scancode) {
    delete this.bindings[scancode];
    this.save();
  },

  resetToDefault() {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.save();
  },

  replaceAll(b) {
    this.bindings = { ...b };
    this.save();
  },

  snapshot() {
    return { ...this.bindings };
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch (e) {
      console.warn("[KeyBindings] could not save", e);
    }
  },
};

export default KeyBindings;
