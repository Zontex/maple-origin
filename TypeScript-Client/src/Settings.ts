// Client-side settings backed by localStorage, for the SYSTEM OPTION and
// GAME OPTION windows.
//
// Kept deliberately free of WZ/UI imports so the audio path can depend on it
// without pulling the UI layer in behind it.

const STORAGE_KEY = "maple_settings";

// v83's default background music level. Sound effects play at full volume.
const DEFAULT_BGM_VOLUME = 0.4;
const DEFAULT_SFX_VOLUME = 1;

// The twelve GAME OPTION rows, top to bottom as they appear on
// UIWindow.img/GameOpt/backgrnd. Each is a plain allow/refuse flag; the
// original ships them all allowed.
const GAME_OPTION_KEYS = [
  "whisper",
  "friends",
  "chatInvite",
  "tradeRequest",
  "partyInvite",
  "partySearch",
  "gameInvite",
  "guildChat",
  "guildInvite",
  "allianceTournament",
  "allianceInvite",
  "familyInvite",
] as const;

type GameOptionKey = (typeof GAME_OPTION_KEYS)[number];
type GameOptions = Record<GameOptionKey, boolean>;

interface Resolution {
  width: number;
  height: number;
}

interface SettingsShape {
  bgmVolume: number;
  sfxVolume: number;
  gameOptions: GameOptions;
  /** null = classic 800x600 */
  resolution: Resolution | null;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

const defaultGameOptions = (): GameOptions =>
  GAME_OPTION_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as GameOptions);

interface SettingsInterface extends SettingsShape {
  /** Called whenever bgmVolume changes, so the live <audio> element tracks it. */
  onBgmVolumeChange: ((volume: number) => void) | null;
  setBgmVolume: (volume: number) => void;
  setSfxVolume: (volume: number) => void;
  setGameOption: (key: GameOptionKey, allowed: boolean) => void;
  setResolution: (width: number, height: number) => void;
  save: () => void;
}

function loadResolution(raw: any): Resolution | null {
  if (!raw || typeof raw !== "object") return null;
  const w = Number(raw.width);
  const h = Number(raw.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < 800 || h < 600 || w > 3840 || h > 2160) return null;
  return { width: Math.floor(w), height: Math.floor(h) };
}

function loadGameOptions(raw: any): GameOptions {
  const out = defaultGameOptions();
  if (!raw || typeof raw !== "object") return out;
  // Read key by key rather than trusting the stored object wholesale, so a
  // partial or hand-edited blob still yields all twelve flags.
  for (const key of GAME_OPTION_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

function load(): SettingsShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("no saved settings");
    const parsed = JSON.parse(raw);
    return {
      bgmVolume: clamp01(parsed.bgmVolume ?? DEFAULT_BGM_VOLUME),
      sfxVolume: clamp01(parsed.sfxVolume ?? DEFAULT_SFX_VOLUME),
      gameOptions: loadGameOptions(parsed.gameOptions),
      resolution: loadResolution(parsed.resolution),
    };
  } catch {
    return {
      bgmVolume: DEFAULT_BGM_VOLUME,
      sfxVolume: DEFAULT_SFX_VOLUME,
      gameOptions: defaultGameOptions(),
      resolution: null,
    };
  }
}

const stored = load();

const Settings: SettingsInterface = {
  bgmVolume: stored.bgmVolume,
  sfxVolume: stored.sfxVolume,
  gameOptions: stored.gameOptions,
  resolution: stored.resolution,
  onBgmVolumeChange: null,

  setBgmVolume(volume: number) {
    this.bgmVolume = clamp01(volume);
    // Applied immediately — the player should hear the slider as they drag it,
    // not only after confirming the dialog.
    this.onBgmVolumeChange?.(this.bgmVolume);
    this.save();
  },

  setSfxVolume(volume: number) {
    this.sfxVolume = clamp01(volume);
    this.save();
  },

  setGameOption(key: GameOptionKey, allowed: boolean) {
    this.gameOptions[key] = allowed;
    this.save();
  },

  setResolution(width: number, height: number) {
    this.resolution =
      width === 800 && height === 600 ? null : { width, height };
    this.save();
  },

  save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          bgmVolume: this.bgmVolume,
          sfxVolume: this.sfxVolume,
          gameOptions: this.gameOptions,
          resolution: this.resolution,
        })
      );
    } catch (e) {
      // Private browsing or a full quota — settings just do not persist.
      console.warn("[Settings] could not save", e);
    }
  },
};

export default Settings;
export { DEFAULT_BGM_VOLUME, DEFAULT_SFX_VOLUME, GAME_OPTION_KEYS };
export type { GameOptionKey, GameOptions };
