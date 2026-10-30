/**
 * Optional Wispr Flow API transcription (server-side proxy).
 *
 * The Flow API requires an organization approved by Wispr ("exclusive access",
 * https://api-docs.wisprflow.ai/quickstart). This module is inert unless the
 * operator sets both:
 *
 *   CLAIMCHECK_WISPR_API=1         feature flag
 *   WISPR_FLOW_API_KEY=fl-...      organization API key (server only)
 *
 * The browser records a question, converts it to 16 kHz mono 16-bit WAV, and
 * posts the bytes here. The server forwards them to the documented REST
 * endpoint (POST /api/v1/dash/api, `Authorization: Bearer <key>`, body
 * `{ audio: <base64 wav>, language, context }`) and returns only the text.
 * The key never leaves the server, so no client token is minted and the
 * browser's Content-Security-Policy stays `connect-src 'self'`.
 *
 * Nothing here has been exercised against the live API: no approved
 * credentials were available. Tests use a local mock of the documented
 * request/response shapes.
 */
import type { AuditErrorPayload } from "../../shared/types.js";

export const WISPR_REST_URL = "https://platform-api.wisprflow.ai/api/v1/dash/api";
/** Questions are short; the Flow API itself accepts up to 6 minutes / 25 MB. */
export const MAX_VOICE_SECONDS = 90;
export const MAX_VOICE_BYTES = 44 + 16_000 * 2 * MAX_VOICE_SECONDS;
const UPSTREAM_TIMEOUT_MS = 30_000;

export interface VoiceConfig {
  enabled: boolean;
  /** Why voice transcription is off, in operator terms. Never contains the key. */
  reason: "enabled" | "flag_off" | "missing_key" | "invalid_endpoint";
  endpoint: string;
  apiKey: string | null;
}

export interface VoiceStatus {
  enabled: boolean;
  provider: "wispr-flow-rest";
  reason: VoiceConfig["reason"];
  maxSeconds: number;
  verified: false;
  note: string;
}

export function readVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const endpoint = env.WISPR_FLOW_API_URL?.trim() || WISPR_REST_URL;
  const apiKey = env.WISPR_FLOW_API_KEY?.trim() || null;
  if (env.CLAIMCHECK_WISPR_API !== "1") return { enabled: false, reason: "flag_off", endpoint, apiKey: null };
  if (!apiKey) return { enabled: false, reason: "missing_key", endpoint, apiKey: null };
  // The key is sent to this URL, so only HTTPS or a loopback test server is accepted.
  if (!/^https:\/\//.test(endpoint) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(endpoint)) {
    return { enabled: false, reason: "invalid_endpoint", endpoint, apiKey: null };
  }
  return { enabled: true, reason: "enabled", endpoint, apiKey };
}

export function voiceStatus(config: VoiceConfig): VoiceStatus {
  const notes: Record<VoiceConfig["reason"], string> = {
    enabled: "Questions can be recorded and transcribed by the Wispr Flow API. The transcript is shown for review before anything is asked.",
    flag_off: "Wispr Flow API transcription is off. Dictation with the Wispr Flow desktop app into the text field still works.",
    missing_key: "CLAIMCHECK_WISPR_API is set but WISPR_FLOW_API_KEY is missing, so API transcription is off.",
    invalid_endpoint: "WISPR_FLOW_API_URL must be an https:// URL, so API transcription is off.",
  };
  return {
    enabled: config.enabled,
    provider: "wispr-flow-rest",
    reason: config.reason,
    maxSeconds: MAX_VOICE_SECONDS,
    verified: false,
    note: notes[config.reason],
  };
}

export class VoiceError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly payload: AuditErrorPayload,
  ) {
    super(payload.message);
    this.name = "VoiceError";
  }
}

const voiceError = (status: number, code: string, title: string, message: string, recovery: string[]) =>
  new VoiceError(status, { code, title, message, recovery });

export const VOICE_ERRORS = {
  notConfigured: () =>
    voiceError(503, "VOICE_NOT_CONFIGURED", "Voice transcription is not configured", "Wispr Flow API transcription is turned off on this server.", [
      "Type your question, or dictate it into the field with the Wispr Flow desktop app.",
    ]),
  badAudio: (detail: string) =>
    voiceError(400, "VOICE_BAD_AUDIO", "The recording could not be used", detail, ["Record the question again."]),
  tooLong: () =>
    voiceError(413, "VOICE_TOO_LONG", "The recording is too long", `Questions can be up to ${MAX_VOICE_SECONDS} seconds.`, [
      "Ask a shorter question, or type it.",
    ]),
  authFailed: () =>
    voiceError(502, "VOICE_AUTH_FAILED", "The transcription service rejected this server", "The Wispr Flow API did not accept the configured credentials.", [
      "Type the question instead.",
      "Server operator: check WISPR_FLOW_API_KEY and that the organization's API access is approved.",
    ]),
  rateLimited: () =>
    voiceError(503, "VOICE_RATE_LIMITED", "The transcription service is busy", "The Wispr Flow API asked this server to slow down.", [
      "Wait a moment and try again, or type the question.",
    ]),
  upstream: () =>
    voiceError(502, "VOICE_UPSTREAM_ERROR", "Transcription failed", "The Wispr Flow API could not transcribe this recording.", [
      "Try again, or type the question.",
    ]),
  unavailable: () =>
    voiceError(503, "VOICE_UNAVAILABLE", "The transcription service could not be reached", "The request to the Wispr Flow API failed or timed out.", [
      "Check the network connection and try again, or type the question.",
    ]),
  cancelled: () =>
    voiceError(499, "VOICE_CANCELLED", "Transcription cancelled", "The recording was cancelled before a transcript was returned.", []),
};

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  seconds: number;
}

/** Check that the bytes are the 16 kHz mono 16-bit PCM WAV the Flow API documents. */
export function inspectWav(bytes: Buffer): WavInfo {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw VOICE_ERRORS.badAudio("The recording is not a WAV file.");
  }
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataBytes = -1;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "fmt " && offset + 24 <= bytes.length) {
      format = {
        audioFormat: bytes.readUInt16LE(offset + 8),
        channels: bytes.readUInt16LE(offset + 10),
        sampleRate: bytes.readUInt32LE(offset + 12),
        bitsPerSample: bytes.readUInt16LE(offset + 22),
      };
    } else if (id === "data") {
      dataBytes = Math.min(size, bytes.length - offset - 8);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!format || dataBytes < 0) throw VOICE_ERRORS.badAudio("The WAV file has no audio data.");
  if (format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16_000 || format.bitsPerSample !== 16) {
    throw VOICE_ERRORS.badAudio("The recording must be 16 kHz mono 16-bit PCM.");
  }
  if (dataBytes === 0) throw VOICE_ERRORS.badAudio("The recording is silent or empty.");
  const seconds = dataBytes / (format.sampleRate * format.channels * 2);
  if (seconds > MAX_VOICE_SECONDS) throw VOICE_ERRORS.tooLong();
  return { ...format, dataBytes, seconds };
}

export interface TranscribeOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Uncommon terms (metric names, symbols) that improve recognition. */
  dictionary?: string[];
}

/**
 * Send one recording to the Flow REST API and return its transcript.
 * Errors never include the API key or the upstream response body.
 */
export async function transcribe(config: VoiceConfig, wav: Buffer, options: TranscribeOptions = {}): Promise<{ text: string; seconds: number }> {
  if (!config.enabled || !config.apiKey) throw VOICE_ERRORS.notConfigured();
  const info = inspectWav(wav);
  if (options.signal?.aborted) throw VOICE_ERRORS.cancelled();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), options.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  const onCancel = () => controller.abort("cancelled");
  options.signal?.addEventListener("abort", onCancel, { once: true });

  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(config.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: wav.toString("base64"),
          language: ["en"],
          context: {
            app: { name: "ClaimCheck AI", type: "other" },
            dictionary_context: (options.dictionary ?? []).slice(0, 50),
          },
        }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.reason === "cancelled") throw VOICE_ERRORS.cancelled();
      throw VOICE_ERRORS.unavailable();
    }

    if (response.status === 401 || response.status === 403) throw VOICE_ERRORS.authFailed();
    if (response.status === 429) throw VOICE_ERRORS.rateLimited();
    if (response.status === 413) throw VOICE_ERRORS.tooLong();
    if (response.status === 400) throw VOICE_ERRORS.badAudio("The transcription service could not read the recording.");
    if (!response.ok) throw VOICE_ERRORS.upstream();

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (controller.signal.reason === "cancelled") throw VOICE_ERRORS.cancelled();
      throw VOICE_ERRORS.upstream();
    }
    const text = (body as { text?: unknown } | null)?.text;
    if (typeof text !== "string") throw VOICE_ERRORS.upstream();
    return { text: text.trim().slice(0, 2000), seconds: info.seconds };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onCancel);
  }
}
