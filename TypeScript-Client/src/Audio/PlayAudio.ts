/**
 * Plays audio.
 *
 * This function allows an audio object to be played concurrently, i.e.
 * it is not necessary for an audio object to finish playing before it can
 * be played again.
 *
 * @param {Audio} audio - The audio object.
 * @param {float} [volume=1] - Loudness of audio.
 */
// function PLAY_AUDIO(audio, volume = 1) {
//   const concurrentAudio = audio.cloneNode();
//   concurrentAudio.volume = volume;
//   concurrentAudio.play();
// }

import Settings from "../Settings";

// WeakMap, not Map: this is keyed by the source Audio element, so a strong
// Map pinned one entry per WZ sound node for the life of the page and kept
// every element it had ever throttled alive alongside it
const playingAudios = new WeakMap<object, number>();

/**
 * `volume` stays the caller's per-sound level; the player's SOUND setting
 * scales it, so an effect that was deliberately quiet stays proportionally
 * quiet as the slider moves.
 */
function PLAY_AUDIO(audio: any, volume = 1, allowOverlap = false) {
  if (!audio || typeof audio.cloneNode !== "function") {
    return;
  }

  const now = Date.now();
  const lastPlayed = playingAudios.get(audio) || 0;

  // Allow overlap, but throttle the same sound to at most once per 50ms
  // to prevent audio spam from rapid-fire calls in the same frame
  if (allowOverlap || now - lastPlayed > 50) {
    const concurrentAudio = audio.cloneNode();
    concurrentAudio.volume = Math.min(1, Math.max(0, volume * Settings.sfxVolume));
    // Rejects under autoplay policy and while the source is still loading —
    // unhandled, it surfaces as an unhandledrejection and gets logged home
    concurrentAudio.play()?.catch(() => {});
    playingAudios.set(audio, now);
  }
}

export default PLAY_AUDIO;
