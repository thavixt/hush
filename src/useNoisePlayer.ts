import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo, useEventListener } from 'expo';
import {
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import {
  DEFAULT_SOUND_ID,
  DEFAULT_TIMER_MIN,
  DEFAULT_VOLUME,
  SLEEP_FADE_MS,
  SOUNDS,
  SWITCH_FADE_MS,
  TIMER_OPTIONS,
  type Sound,
} from './sounds';

const PREFS_KEY = 'hush:prefs';
const LOCK_SCREEN_METADATA = { title: 'Hush', artist: 'Sleep noise' };

// Expo Go doesn't contain this app's background-playback service (it comes from the expo-audio
// config plugin), so lock-screen controls can't work there. Skip them instead of erroring.
const IN_EXPO_GO = isRunningInExpoGo();
if (IN_EXPO_GO) {
  console.warn(
    'Hush is running in Expo Go: background playback and the media notification are disabled. ' +
      'Use a development build (eas build --profile development) to test them.',
  );
}

type Prefs = { soundId: string; volume: number; timerMin: number };

const findSound = (id: string): Sound => SOUNDS.find((s) => s.id === id) ?? SOUNDS[0];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// The player is an imperative native object; these helpers make that explicit
// (and keep the React Compiler lint rules from treating it as React state).
function setPlayerVolume(player: AudioPlayer, v: number) {
  player.volume = clamp01(v);
}
function setPlayerLoop(player: AudioPlayer) {
  player.loop = true;
}

/**
 * One looping player, with:
 *  - short fades on play/pause/switch (the file swap happens while silent, so no click),
 *  - a sleep timer that fades out over SLEEP_FADE_MS and then pauses,
 *  - media notification / lock-screen controls (required for sustained background playback on Android),
 *  - persisted sound, volume and timer.
 *
 * The sleep timer is checked on the player's native status updates rather than with JS timers,
 * because JS timers can stall on Android while the app is in the background.
 */
export function useNoisePlayer() {
  const player = useAudioPlayer(findSound(DEFAULT_SOUND_ID).source, { updateInterval: 250 });

  const [soundId, setSoundId] = useState(DEFAULT_SOUND_ID);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [timerMin, setTimerMinState] = useState(DEFAULT_TIMER_MIN);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Refs mirror state for use inside native-event callbacks and async fades.
  const soundRef = useRef(findSound(DEFAULT_SOUND_ID));
  const volumeRef = useRef(DEFAULT_VOLUME);
  const timerMinRef = useRef(DEFAULT_TIMER_MIN);
  const isPlayingRef = useRef(false);
  const timerEndsAtRef = useRef<number | null>(null);
  const fadeRef = useRef(0); // 0..1 multiplier used for play/pause/switch fades
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const opId = useRef(0); // incremented per user action; stale async work bails out
  const busy = useRef(false); // true while we are fading, so status events don't fight the UI
  const askedNotifications = useRef(false);

  /** Push the combined volume (slider × sound trim × fade × sleep fade) to the player. */
  const applyVolume = useCallback(() => {
    const endsAt = timerEndsAtRef.current;
    const sleepFactor = endsAt === null ? 1 : clamp01((endsAt - Date.now()) / SLEEP_FADE_MS);
    setPlayerVolume(player, volumeRef.current * soundRef.current.gain * fadeRef.current * sleepFactor);
  }, [player]);

  /** Start/restart or clear the sleep timer based on the current playing state and timer choice. */
  const resetTimer = useCallback(() => {
    const min = timerMinRef.current;
    const t = Date.now();
    const endsAt = isPlayingRef.current && min > 0 ? t + min * 60_000 : null;
    timerEndsAtRef.current = endsAt;
    setTimerEndsAt(endsAt);
    setNow(t);
  }, []);

  /** Single place where the playing flag changes; the sleep timer (re)starts on play, clears on pause. */
  const updatePlaying = useCallback(
    (playing: boolean) => {
      if (playing === isPlayingRef.current) return;
      isPlayingRef.current = playing;
      setIsPlaying(playing);
      resetTimer();
    },
    [resetTimer],
  );

  /** Ramp the fade multiplier to `to` over `ms`. Cancels any running ramp. */
  const rampFade = useCallback(
    (to: number, ms: number) =>
      new Promise<void>((resolve) => {
        if (fadeTimer.current) clearInterval(fadeTimer.current);
        const from = fadeRef.current;
        const start = Date.now();
        const timer = setInterval(() => {
          const t = clamp01((Date.now() - start) / ms);
          fadeRef.current = from + (to - from) * t;
          applyVolume();
          if (t >= 1) {
            clearInterval(timer);
            fadeTimer.current = null;
            resolve();
          }
        }, 16);
        fadeTimer.current = timer;
      }),
    [applyVolume],
  );

  // One-time setup: audio mode, looping, saved prefs.
  useEffect(() => {
    setPlayerLoop(player);
    setAudioModeAsync({
      shouldPlayInBackground: true,
      playsInSilentMode: true,
      // Lock-screen controls require an exclusive focus mode.
      interruptionMode: 'doNotMix',
    }).catch(() => {});

    AsyncStorage.getItem(PREFS_KEY)
      .then((raw) => {
        if (!raw) return;
        const p = JSON.parse(raw) as Partial<Prefs>;
        if (typeof p.volume === 'number') {
          volumeRef.current = p.volume;
          setVolumeState(p.volume);
        }
        // Ignore saved values that are no longer offered (e.g. the old "off" = 0).
        if (typeof p.timerMin === 'number' && TIMER_OPTIONS.includes(p.timerMin)) {
          timerMinRef.current = p.timerMin;
          setTimerMinState(p.timerMin);
        }
        if (p.soundId && p.soundId !== DEFAULT_SOUND_ID) {
          const s = findSound(p.soundId);
          soundRef.current = s;
          setSoundId(s.id);
          player.replace(s.source);
        }
      })
      .catch(() => {})
      .finally(() => setPrefsLoaded(true));

    return () => {
      if (fadeTimer.current) clearInterval(fadeTimer.current);
    };
  }, [player]);

  // Persist prefs (debounced so dragging the slider doesn't spam storage).
  useEffect(() => {
    if (!prefsLoaded) return;
    const t = setTimeout(() => {
      const prefs: Prefs = { soundId, volume, timerMin };
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [prefsLoaded, soundId, volume, timerMin]);

  // Tick for the on-screen countdown (display only; the real timer runs on native status updates).
  useEffect(() => {
    if (timerEndsAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timerEndsAt]);

  // Native status updates arrive every ~250 ms while playing, also in the background.
  useEventListener(player, 'playbackStatusUpdate', (status: AudioStatus) => {
    // Reflect play/pause done from the notification, or by audio-focus loss (e.g. a phone call).
    if (!busy.current && status.playing !== undefined) updatePlaying(status.playing);

    const endsAt = timerEndsAtRef.current;
    if (endsAt === null || !status.playing) return;
    if (Date.now() >= endsAt) {
      // Sleep fade finished: stop. Volume stays at 0 until the next play() fades it in.
      opId.current++;
      busy.current = false;
      fadeRef.current = 0;
      player.pause();
      updatePlaying(false);
    } else {
      applyVolume(); // advances the sleep fade-out during its last SLEEP_FADE_MS
    }
  });

  const setVolume = useCallback(
    (v: number) => {
      volumeRef.current = v;
      setVolumeState(v);
      applyVolume();
    },
    [applyVolume],
  );

  const setTimerMin = useCallback(
    (min: number) => {
      timerMinRef.current = min;
      setTimerMinState(min);
      resetTimer(); // changing the timer while playing restarts the countdown from now
      applyVolume();
    },
    [resetTimer, applyVolume],
  );

  const play = useCallback(async () => {
    const id = ++opId.current;
    busy.current = true;
    updatePlaying(true);

    if (Platform.OS === 'android' && !askedNotifications.current) {
      askedNotifications.current = true;
      await requestNotificationPermissionsAsync().catch(() => {});
    }
    if (id !== opId.current) return;

    // (Re)activate the media notification on every play. This (re)binds the playback service if
    // Android disconnected it, which is what keeps playback alive in the background.
    // The metadata is deliberately sound-independent: updating it mid-playback warns while the
    // service is still binding, and re-activating would rebuild the media session while audio plays.
    if (!IN_EXPO_GO) {
      player.setActiveForLockScreen(true, LOCK_SCREEN_METADATA, { isLiveStream: true });
    }

    fadeRef.current = 0;
    applyVolume();
    player.play();
    await rampFade(1, SWITCH_FADE_MS);
    if (id === opId.current) busy.current = false;
  }, [player, applyVolume, rampFade, updatePlaying]);

  const pause = useCallback(async () => {
    const id = ++opId.current;
    busy.current = true;
    updatePlaying(false);
    await rampFade(0, SWITCH_FADE_MS);
    if (id !== opId.current) return;
    player.pause();
    busy.current = false;
  }, [player, rampFade, updatePlaying]);

  const togglePlay = useCallback(() => (isPlaying ? pause() : play()), [isPlaying, play, pause]);

  const selectSound = useCallback(
    async (id: string) => {
      const next = findSound(id);
      if (next.id === soundRef.current.id) return;
      setSoundId(next.id);

      if (!isPlayingRef.current) {
        soundRef.current = next;
        player.replace(next.source);
        return;
      }

      // Fade out, swap while silent, fade back in.
      const op = ++opId.current;
      busy.current = true;
      await rampFade(0, SWITCH_FADE_MS);
      if (op !== opId.current) return;
      soundRef.current = next;
      player.replace(next.source); // keeps playing and keeps `loop`
      await rampFade(1, SWITCH_FADE_MS);
      if (op === opId.current) busy.current = false;
    },
    [player, rampFade],
  );

  const remainingMs = timerEndsAt === null ? null : Math.max(0, timerEndsAt - now);

  return {
    soundId,
    selectSound,
    volume,
    setVolume,
    timerMin,
    setTimerMin,
    isPlaying,
    togglePlay,
    remainingMs,
  };
}
