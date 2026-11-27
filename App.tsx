import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SOUNDS, TIMER_OPTIONS } from './src/sounds';
import { colors } from './src/theme';
import { useNoisePlayer } from './src/useNoisePlayer';

function formatRemaining(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type ChipProps = { label: string; active: boolean; onPress: () => void; color?: string };

/** `color` (6-digit hex) tints the chip: dim text + faint border when idle, soft fill when active. */
function Chip({ label, active, onPress, color }: ChipProps) {
  const tint = color && {
    borderColor: `${color}55`,
    backgroundColor: active ? `${color}33` : colors.surface,
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, tint, pressed && styles.pressed]}
    >
      <Text
        style={[
          styles.chipText,
          active && styles.chipTextActive,
          color ? { color, opacity: active ? 1 : 0.6 } : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function App() {
  const p = useNoisePlayer();

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Hush
        </Text>
        <Text style={styles.subtitle}>noises for sleeping</Text>
      </View>

      <View style={styles.center}>
        <Pressable
          onPress={p.togglePlay}
          accessibilityRole="button"
          accessibilityLabel={p.isPlaying ? 'Pause' : 'Play'}
          style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
        >
          {p.isPlaying ? (
            <View style={styles.pauseIcon}>
              <View style={styles.pauseBar} />
              <View style={styles.pauseBar} />
            </View>
          ) : (
            <View style={styles.playIcon} />
          )}
        </Pressable>

        <Text style={styles.remaining}>
          {p.remainingMs !== null ? formatRemaining(p.remainingMs) : ' '}
        </Text>
      </View>

      <View style={styles.controls}>
        <View style={styles.row}>
          {SOUNDS.map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              color={s.color}
              active={s.id === p.soundId}
              onPress={() => p.selectSound(s.id)}
            />
          ))}
        </View>

        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          value={p.volume}
          onValueChange={p.setVolume}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.surfaceActive}
          thumbTintColor={colors.accent}
          accessibilityLabel="Volume"
        />

        <View style={styles.row}>
          {TIMER_OPTIONS.map((min) => (
            <Chip
              key={min}
              label={`${min}`}
              active={min === p.timerMin}
              onPress={() => p.setTimerMin(min)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const PLAY_SIZE = 180;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 20,
  },
  header: { alignItems: 'center', paddingVertical: 8 },
  title: { color: colors.textDim, fontSize: 22, fontWeight: '300', letterSpacing: 4 },
  subtitle: { color: colors.textDim, fontSize: 13, letterSpacing: 1, opacity: 0.7, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  playButton: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    borderRadius: PLAY_SIZE / 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.surfaceActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // CSS-triangle play icon (no icon library needed).
  playIcon: {
    marginLeft: 10,
    width: 0,
    height: 0,
    borderTopWidth: 30,
    borderBottomWidth: 30,
    borderLeftWidth: 50,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text,
  },
  pauseIcon: { flexDirection: 'row', gap: 16 },
  pauseBar: { width: 16, height: 56, borderRadius: 4, backgroundColor: colors.text },
  remaining: { color: colors.textDim, fontSize: 28, fontVariant: ['tabular-nums'], minHeight: 36 },
  controls: { gap: 28 },
  row: { flexDirection: 'row', gap: 10 },
  chip: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.surfaceActive },
  chipText: { color: colors.textDim, fontSize: 17 },
  chipTextActive: { color: colors.text },
  slider: { height: 48 },
  pressed: { opacity: 0.6 },
});
