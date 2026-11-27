import type { AudioSource } from 'expo-audio';

export type Sound = {
  id: string;
  label: string;
  source: AudioSource;
  /** Per-sound level trim (0..1) so switching colors doesn't jump in loudness. */
  gain: number;
  /** Muted tint for the sound's button (kept dim for the dark theme). 6-digit hex. */
  color: string;
};

// To add a sound: drop a seamlessly looping file in assets/sounds and add a line here.
export const SOUNDS: Sound[] = [
  { id: 'pink', label: 'Pink', source: require('../assets/sounds/pink.wav'), gain: 1, color: '#b07f92' },
  { id: 'brown', label: 'Brown', source: require('../assets/sounds/brown.wav'), gain: 1, color: '#a3815f' },
  // White is ~5 dB louder (RMS) than pink/brown at the same peak level.
  { id: 'white', label: 'White', source: require('../assets/sounds/white.wav'), gain: 0.55, color: '#a9adb6' },
];

/** Sleep timer choices in minutes. A timer is always active while playing. */
export const TIMER_OPTIONS = [15, 30, 45, 60];

export const DEFAULT_SOUND_ID = 'pink';
export const DEFAULT_VOLUME = 0.3;
export const DEFAULT_TIMER_MIN = 30;

/** Fade used when switching sounds or pressing play/pause. */
export const SWITCH_FADE_MS = 250;
/** Fade at the end of the sleep timer. */
export const SLEEP_FADE_MS = 30_000;
