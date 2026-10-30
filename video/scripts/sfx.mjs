/**
 * Synthesizes original sound design for the explainer (no third-party audio):
 * a quiet ambient music bed and short UI effects. Writes 48 kHz stereo WAVs
 * to public/audio/.
 *
 *   node scripts/sfx.mjs [musicSeconds]
 */
import fs from "node:fs";
import path from "node:path";

const RATE = 48000;
const OUT = path.resolve(import.meta.dirname, "..", "public", "audio");
fs.mkdirSync(OUT, { recursive: true });

function writeWav(name, left, right = left) {
  const frames = left.length;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 4, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(path.join(OUT, name), buffer);
  console.log(`wrote ${name} (${(frames / RATE).toFixed(2)}s)`);
}

// Deterministic noise.
let seed = 1234567;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 31 - 1;
};
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// --- Music bed: slow evolving pad over a gentle pulse --------------------
const seconds = Number(process.argv[2] ?? 125);
const total = Math.round(seconds * RATE);
const L = new Float32Array(total);
const R = new Float32Array(total);
// Dmaj9 → Bm11 → Gmaj7 → Asus4, 8 s per chord.
const chords = [
  [50, 57, 62, 64, 69],
  [47, 54, 59, 62, 64],
  [43, 50, 55, 59, 66],
  [45, 52, 57, 59, 64],
];
const chordLen = 8 * RATE;
for (let i = 0; i < total; i++) {
  const t = i / RATE;
  const index = Math.floor(i / chordLen);
  const pos = (i % chordLen) / chordLen;
  const current = chords[index % chords.length];
  const next = chords[(index + 1) % chords.length];
  // Crossfade the last 1.5 s of each chord into the next.
  const fade = Math.max(0, (pos - 0.8125) / 0.1875);
  let l = 0;
  let r = 0;
  const voice = (notes, gain) => {
    notes.forEach((n, k) => {
      const f = midi(n);
      const detune = 1 + (k % 2 ? 0.0025 : -0.0025);
      const s = Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 2 * detune * t) * 0.12 + Math.sin(2 * Math.PI * f * 0.5 * t) * (k === 0 ? 0.35 : 0);
      const pan = 0.5 + (k - 2) * 0.12;
      l += s * gain * (1 - pan);
      r += s * gain * pan;
    });
  };
  voice(current, 1 - fade);
  voice(next, fade);
  // Slow swell and a soft 0.5 Hz breathing.
  const breathe = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.125 * t);
  const intro = Math.min(1, t / 4);
  const outro = Math.min(1, (seconds - t) / 4);
  const g = 0.035 * breathe * intro * outro;
  L[i] = l * g;
  R[i] = r * g;
}
// Soft high pulse (muted pluck) every half second after the reveal.
for (let beat = 16; beat < seconds * 2 - 8; beat++) {
  const start = Math.round((beat / 2) * RATE);
  const chord = chords[Math.floor(start / chordLen) % chords.length];
  const f = midi(chord[(beat * 3) % chord.length] + 12);
  for (let j = 0; j < RATE * 0.4 && start + j < total; j++) {
    const env = Math.exp(-j / (RATE * 0.09));
    const s = Math.sin(2 * Math.PI * f * (j / RATE)) * env * 0.018;
    L[start + j] += s * (beat % 2 ? 0.7 : 1);
    R[start + j] += s * (beat % 2 ? 1 : 0.7);
  }
}
// Simple stereo feedback delay for space.
const delay = Math.round(0.36 * RATE);
for (let i = delay; i < total; i++) {
  L[i] += R[i - delay] * 0.28;
  R[i] += L[i - delay] * 0.28;
}
writeWav("music.wav", L, R);

// --- UI effects ------------------------------------------------------------
function effect(name, length, fn) {
  const n = Math.round(length * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / RATE, i);
  writeWav(name, out);
}
// Mouse click: two tiny filtered ticks.
let lp = 0;
effect("click.wav", 0.09, (t) => {
  const env = Math.exp(-t / 0.006) + 0.5 * Math.exp(-Math.max(0, t - 0.035) / 0.005) * (t > 0.035 ? 1 : 0);
  lp += 0.35 * (noise() - lp);
  return (lp * 0.9 + Math.sin(2 * Math.PI * 2400 * t) * 0.25) * env * 0.5;
});
// Whoosh: band-passed noise sweep.
let a = 0;
let b = 0;
effect("whoosh.wav", 0.9, (t) => {
  const env = Math.sin(Math.PI * Math.min(1, t / 0.9)) ** 2;
  const cutoff = 0.02 + 0.25 * (t / 0.9);
  a += cutoff * (noise() - a);
  b += cutoff * (a - b);
  return (a - b) * env * 1.6;
});
// Drop: soft low thud with a short tonal tail.
effect("drop.wav", 0.5, (t) => {
  const env = Math.exp(-t / 0.08);
  return (Math.sin(2 * Math.PI * (90 + 60 * Math.exp(-t / 0.03)) * t) * 0.7 + Math.sin(2 * Math.PI * 660 * t) * 0.08 * Math.exp(-t / 0.15)) * env * 0.7;
});
// Chime: two-note glassy confirmation.
effect("chime.wav", 1.6, (t) => {
  const tone = (f, start) => (t >= start ? Math.sin(2 * Math.PI * f * (t - start)) * Math.exp(-(t - start) / 0.45) : 0);
  return (tone(midi(81), 0) * 0.5 + tone(midi(88), 0.09) * 0.4 + tone(midi(93), 0.18) * 0.25) * 0.35;
});
// Keystroke tick for typing.
effect("key.wav", 0.04, (t) => {
  lp += 0.5 * (noise() - lp);
  return lp * Math.exp(-t / 0.004) * 0.35;
});
