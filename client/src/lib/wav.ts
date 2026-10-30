/**
 * Convert recorded audio to the format the Wispr Flow API documents:
 * single-channel, 16-bit PCM WAV at 16 kHz.
 *
 * Pure functions only, so they can be unit-tested outside the browser.
 */
export const TARGET_SAMPLE_RATE = 16_000;

/** Average all channels into one. */
export function downmix(channels: Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const mono = new Float32Array(first.length);
  for (const channel of channels) {
    for (let index = 0; index < mono.length; index += 1) mono[index]! += (channel[index] ?? 0) / channels.length;
  }
  return mono;
}

/**
 * Resample to 16 kHz. When downsampling, each output sample averages the input
 * samples it covers, which suppresses most aliasing for speech.
 */
export function resampleTo16k(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === TARGET_SAMPLE_RATE) return samples;
  const ratio = sampleRate / TARGET_SAMPLE_RATE;
  const length = Math.floor(samples.length / ratio);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = index * ratio;
    if (ratio > 1) {
      const from = Math.floor(start);
      const to = Math.min(samples.length, Math.floor(start + ratio));
      let sum = 0;
      for (let cursor = from; cursor < to; cursor += 1) sum += samples[cursor] ?? 0;
      output[index] = sum / Math.max(1, to - from);
    } else {
      const left = Math.floor(start);
      const fraction = start - left;
      output[index] = (samples[left] ?? 0) * (1 - fraction) + (samples[left + 1] ?? samples[left] ?? 0) * fraction;
    }
  }
  return output;
}

/** Encode mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}
