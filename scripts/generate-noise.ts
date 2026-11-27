/// <reference types="node" />
/**
 * Generates seamlessly looping noise files for Hush.
 *
 *   npm run generate:sounds
 *
 * Output: assets/sounds/{white,pink,brown}.wav (44.1 kHz, 16-bit PCM, mono, 30 s).
 *
 * Runs directly with Node >= 22.18 / 23.6 (built-in TypeScript type stripping),
 * so this file only uses erasable TS syntax (no enums, namespaces, etc.).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const DURATION_S = 30;
const LOOP_FADE_S = 0.5; // crossfade length at the loop point
const WARMUP_S = 2; // discarded so the filters reach steady state
const PEAK_DBFS = -3;

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

type Generator = (white: () => number) => () => number;

// Small seeded PRNG (mulberry32) so the files are reproducible.
function makeWhite(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0, 1)
    return u * 2 - 1; // uniform [-1, 1)
  };
}

const white: Generator = (w) => w;

// Paul Kellet's refined pink noise filter.
const pink: Generator = (w) => {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const x = w();
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
    b6 = x * 0.115926;
    return out;
  };
};

// Brown noise: leaky integrator over white noise (the leak keeps it from drifting).
const brown: Generator = (w) => {
  let last = 0;
  return () => {
    last = (last + 0.02 * w()) / 1.02;
    return last;
  };
};

function render(gen: Generator, seed: number): Float64Array {
  const next = gen(makeWhite(seed));
  const n = Math.round(SAMPLE_RATE * DURATION_S);
  const fade = Math.round(SAMPLE_RATE * LOOP_FADE_S);

  for (let i = 0; i < SAMPLE_RATE * WARMUP_S; i++) next();

  // Render a continuous stream of n + fade samples.
  const raw = new Float64Array(n + fade);
  for (let i = 0; i < raw.length; i++) raw[i] = next();

  // Remove DC offset (mostly matters for brown noise).
  let mean = 0;
  for (const v of raw) mean += v;
  mean /= raw.length;
  for (let i = 0; i < raw.length; i++) raw[i] -= mean;

  // Loop crossfade: blend the overflow tail (raw[n..n+fade)) into the head.
  // At the loop point, out[n-1] = raw[n-1] is followed by out[0] ≈ raw[n],
  // which are consecutive samples of the same stream, so there is no seam.
  // Equal-power curves keep the level constant (the two parts are uncorrelated).
  const out = raw.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const t = (i / fade) * (Math.PI / 2);
    out[i] = raw[i] * Math.sin(t) + raw[n + i] * Math.cos(t);
  }

  // Normalize to the target peak.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = Math.pow(10, PEAK_DBFS / 20) / peak;
  for (let i = 0; i < n; i++) out[i] *= gain;
  return out;
}

function toWav(samples: Float64Array): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

const sounds: Array<[name: string, gen: Generator, seed: number]> = [
  ['white', white, 1],
  ['pink', pink, 2],
  ['brown', brown, 3],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, gen, seed] of sounds) {
  const file = join(OUT_DIR, `${name}.wav`);
  writeFileSync(file, toWav(render(gen, seed)));
  console.log(`wrote ${file}`);
}
