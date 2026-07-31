// Client-side settings backed by localStorage, for the SYSTEM OPTION window.
//
// Kept deliberately free of WZ/UI imports so the audio path can depend on it
// without pulling the UI layer in behind it.

const STORAGE_KEY = "maple_settings";

// v83's default background music level. Sound effects play at full volume.
const DEFAULT_BGM_VOLUME = 0.4;
const DEFAULT_SFX_VOLUME = 1;

interface SettingsShape {
  bgmVolume: number;
  sfxVolume: number;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

interface SettingsInterface extends SettingsShape {
  /** Called whenever bgmVolume changes, so the live <audio> element tracks it. */
  onBgmVolumeChange: ((volume: number) => void) | null;
  setBgmVolume: (volume: number) => void;
  setSfxVolume: (volume: number) => void;
  save: () => void;
}

function load(): SettingsShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("no saved settings");
    const parsed = JSON.parse(raw);
    return {
      bgmVolume: clamp01(parsed.bgmVolume ?? DEFAULT_BGM_VOLUME),
      sfxVolume: clamp01(parsed.sfxVolume ?? DEFAULT_SFX_VOLUME),
    };
  } catch {
    return { bgmVolume: DEFAULT_BGM_VOLUME, sfxVolume: DEFAULT_SFX_VOLUME };
  }
}

const stored = load();

const Settings: SettingsInterface = {
  bgmVolume: stored.bgmVolume,
  sfxVolume: stored.sfxVolume,
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

  save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ bgmVolume: this.bgmVolume, sfxVolume: this.sfxVolume })
      );
    } catch (e) {
      // Private browsing or a full quota — settings just do not persist.
      console.warn("[Settings] could not save", e);
    }
  },
};

export default Settings;
export { DEFAULT_BGM_VOLUME, DEFAULT_SFX_VOLUME };
