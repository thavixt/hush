/// <reference types="node" />
/**
 * Generates the app icons (crescent moon + "zZz") as PNGs, with no dependencies.
 *
 *   npm run generate:icons
 *
 * Shapes are drawn with signed distance functions, so edges are anti-aliased at any size.
 * Writes into assets/: icon.png, android-icon-{foreground,background,monochrome}.png,
 * splash-icon.png, favicon.png.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

type RGB = [number, number, number];
type Layer = { sdf: (x: number, y: number) => number; color: RGB };

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

const BG_CENTER = hex('#1b2232');
const BG_EDGE = hex('#0b0d12');
const MOON = hex('#b9a97e'); // muted moonlight
const ZZZ = hex('#8f9bbd'); // soft blue-grey

// ---- Shapes, in a unit square (0..1, y down) ----

const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) - r;

/** Distance to a line segment with round caps of half-width w. */
const capsule = (ax: number, ay: number, bx: number, by: number, w: number) => (x: number, y: number) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t) - w;
};

const union = (...fs: Array<(x: number, y: number) => number>) => (x: number, y: number) =>
  Math.min(...fs.map((f) => f(x, y)));

/** A rounded "Z": top bar, diagonal, bottom bar. (x, y) = top-left, s = height. */
function zGlyph(x: number, y: number, s: number) {
  const w = s * 0.8, stroke = s * 0.1;
  return union(
    capsule(x, y, x + w, y, stroke),
    capsule(x + w, y, x, y + s, stroke),
    capsule(x, y + s, x + w, y + s, stroke),
  );
}

// Crescent: big circle minus an offset circle.
const moonOuter = circle(0.4, 0.6, 0.3);
const moonCut = circle(0.53, 0.47, 0.25);
const moon = (x: number, y: number) => Math.max(moonOuter(x, y), -moonCut(x, y));

const zzz = union(zGlyph(0.55, 0.41, 0.11), zGlyph(0.67, 0.22, 0.15), zGlyph(0.8, 0.05, 0.1));

const ART: Layer[] = [
  { sdf: moon, color: MOON },
  { sdf: zzz, color: ZZZ },
];

/** Bounding circle of the art (center of its bounding box + farthest inked point), sampled. */
function fitArt() {
  const inked: Array<[number, number]> = [];
  for (let y = -0.2; y <= 1.2; y += 0.004)
    for (let x = -0.2; x <= 1.2; x += 0.004) if (ART.some((l) => l.sdf(x, y) <= 0)) inked.push([x, y]);
  const xs = inked.map((p) => p[0]), ys = inked.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const r = Math.max(...inked.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  return { cx, cy, r };
}
const FIT = fitArt();

// ---- Rendering ----

type Options = {
  size: number;
  /** Radius of the art's bounding circle as a fraction of the canvas size (art is centered). */
  radius: number;
  background: boolean;
  /** Draw all art in this color instead (for the monochrome layer). */
  mono?: RGB;
  /** Skip the art entirely (adaptive-icon background layer). */
  noArt?: boolean;
};

function render({ size, radius, background, mono, noArt }: Options): Buffer {
  const px = new Uint8Array(size * size * 4);
  const k = FIT.r / radius; // art units per canvas unit
  const aa = k / size; // one pixel, in art units

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) / size, v = (j + 0.5) / size;
      let [r, g, b] = [0, 0, 0];
      let a = 0;

      if (background) {
        // Soft radial glow.
        const t = Math.min(1, Math.hypot(u - 0.5, v - 0.42) / 0.75);
        [r, g, b] = BG_CENTER.map((c, k) => c + (BG_EDGE[k] - c) * t) as RGB;
        a = 1;
      }

      const x = FIT.cx + (u - 0.5) * k, y = FIT.cy + (v - 0.5) * k;
      for (const layer of noArt ? [] : ART) {
        const cov = Math.max(0, Math.min(1, 0.5 - layer.sdf(x, y) / aa));
        if (cov === 0) continue;
        const c = mono ?? layer.color;
        const outA = cov + a * (1 - cov);
        [r, g, b] = [0, 1, 2].map((k) => (c[k] * cov + [r, g, b][k] * a * (1 - cov)) / outA) as RGB;
        a = outA;
      }

      const o = (j * size + i) * 4;
      px[o] = Math.round(r);
      px[o + 1] = Math.round(g);
      px[o + 2] = Math.round(b);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, px);
}

// ---- Minimal PNG encoder (RGBA, 8-bit) ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w: number, h: number, rgba: Uint8Array) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Outputs ----

// Android adaptive icons are masked to a circle/squircle. The guaranteed-visible safe zone
// is a circle of 33dp radius on the 108dp canvas (≈0.305), so the art stays inside 0.29.
const outputs: Array<[file: string, opts: Options]> = [
  ['icon.png', { size: 1024, radius: 0.4, background: true }],
  ['android-icon-foreground.png', { size: 1024, radius: 0.29, background: false }],
  ['android-icon-background.png', { size: 1024, radius: 0.29, background: true, noArt: true }],
  ['android-icon-monochrome.png', { size: 1024, radius: 0.29, background: false, mono: [255, 255, 255] }],
  ['splash-icon.png', { size: 1024, radius: 0.4, background: false }],
  ['favicon.png', { size: 48, radius: 0.46, background: true }],
];

for (const [file, opts] of outputs) {
  writeFileSync(join(ASSETS, file), render(opts));
  console.log(`wrote ${join(ASSETS, file)}`);
}
