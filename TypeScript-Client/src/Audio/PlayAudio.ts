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

const playingAudios = new Map<any, number>();

/**
 * `volume` stays the caller's per-sound level; the player's SOUND setting
 * scales it, so an effect that was deliberately quiet stays proportionally
 * quiet as the slider moves.
 */
function PLAY_AUDIO(audio: any, volume = 1, allowOverlap = false) {
  const now = Date.now();
  const lastPlayed = playingAudios.get(audio) || 0;

  // Allow overlap, but throttle the same sound to at most once per 50ms
  // to prevent audio spam from rapid-fire calls in the same frame
  if (allowOverlap || now - lastPlayed > 50) {
    const concurrentAudio = audio.cloneNode();
    concurrentAudio.volume = Math.min(1, Math.max(0, volume * Settings.sfxVolume));
    concurrentAudio.play();
    playingAudios.set(audio, now);
  }
}

export default PLAY_AUDIO;
