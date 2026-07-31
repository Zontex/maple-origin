// Key bindings for the KEYBOARD SETTING window.
//
// v83 keys its config by DirectInput scancode, which is why
// UI.wz/UIWindow.img/KeyConfig/key is indexed 2..88 rather than by ASCII —
// the nodes that exist there ARE the bindable key set, so this table mirrors
// them exactly.
//
// No WZ/UI imports here so MapState can depend on it without pulling the UI
// layer in behind it.

const STORAGE_KEY = "maple_keybindings";

/** Every action the client can actually drive from a key. */
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
  | "menu"
  | "chat";

export interface ActionInfo {
  action: BindableAction;
  /** UIWindow.img/KeyConfig/icon/<id> — the sprite dragged onto a key. */
  icon: number;
  label: string;
}

// Icon ids are taken from KeyConfig/icon. The set present is 0-27, 50-54 and
// 100-106; these are the ones whose meaning the client can honour today.
export const ACTIONS: ActionInfo[] = [
  { action: "attack", icon: 100, label: "Attack" },
  { action: "jump", icon: 101, label: "Jump" },
  { action: "pickup", icon: 102, label: "Pick up" },
  { action: "sit", icon: 103, label: "Sit" },
  { action: "equipment", icon: 0, label: "Equipment" },
  { action: "inventory", icon: 1, label: "Items" },
  { action: "stats", icon: 2, label: "Stats" },
  { action: "skills", icon: 3, label: "Skills" },
  { action: "questLog", icon: 4, label: "Quest" },
  { action: "miniMap", icon: 5, label: "Mini Map" },
  { action: "menu", icon: 6, label: "Menu" },
  { action: "chat", icon: 7, label: "Chat" },
];

export const ACTION_BY_NAME = new Map(ACTIONS.map((a) => [a.action, a]));

/**
 * Scancode -> the key name GameCanvas.isKeyDown() understands.
 * Only scancodes with a KeyConfig/key/<n> sprite are listed, so "every key
 * available" means precisely this set.
 */
export const SCANCODE_TO_KEY: Record<number, string> = {
  2: "1", 3: "2", 4: "3", 5: "4", 6: "5", 7: "6", 8: "7", 9: "8", 10: "9",
  11: "0", 12: "-", 13: "=",
  16: "q", 17: "w", 18: "e", 19: "r", 20: "t", 21: "y", 22: "u", 23: "i",
  24: "o", 25: "p", 26: "[", 27: "]",
  29: "ctrl",
  30: "a", 31: "s", 32: "d", 33: "f", 34: "g", 35: "h", 36: "j", 37: "k",
  38: "l", 39: ";", 40: "'", 41: "`",
  42: "shift", 43: "\\",
  44: "z", 45: "x", 46: "c", 47: "v", 48: "b", 49: "n", 50: "m",
  51: ",", 52: ".",
  56: "alt", 57: "space",
  59: "f1", 60: "f2", 61: "f3", 62: "f4", 63: "f5", 64: "f6", 65: "f7",
  66: "f8", 67: "f9", 68: "f10", 87: "f11", 88: "f12",
  69: "numlock", 70: "scrolllock",
  71: "home", 73: "pageup", 79: "end", 81: "pagedown",
  82: "insert", 83: "delete",
};

/** v83 defaults, as the stock client ships them. */
export const DEFAULT_BINDINGS: Record<number, BindableAction> = {
  56: "jump",       // Alt
  29: "attack",     // Ctrl
  44: "pickup",     // Z
  46: "sit",        // C
  18: "equipment",  // E
  23: "inventory",  // I
  31: "stats",      // S
  37: "skills",     // K
  16: "questLog",   // Q
  50: "miniMap",    // M
  1: "menu",        // Esc (no key sprite; kept so the action always has a home)
  28: "chat",       // Enter (likewise)
};

type Bindings = Record<number, BindableAction>;

interface KeyBindingsShape {
  bindings: Bindings;
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
      // Drop anything unrecognised rather than trusting the blob wholesale.
      if (Number.isFinite(code) && ACTION_BY_NAME.has(action)) out[code] = action;
    }
    return Object.keys(out).length ? out : { ...DEFAULT_BINDINGS };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

const KeyBindings: KeyBindingsShape = {
  bindings: load(),

  keyFor(action) {
    for (const k of Object.keys(this.bindings)) {
      if (this.bindings[Number(k)] === action) return Number(k);
    }
    return undefined;
  },

  keyNameFor(action) {
    const code = this.keyFor(action);
    if (code === undefined) return null;
    // Esc/Enter have no KeyConfig sprite but still need to resolve.
    if (code === 1) return "esc";
    if (code === 28) return "enter";
    return SCANCODE_TO_KEY[code] ?? null;
  },

  bind(scancode, action) {
    // An action lives on exactly one key, so moving it clears the old slot.
    const prev = this.keyFor(action);
    if (prev !== undefined) delete this.bindings[prev];
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
