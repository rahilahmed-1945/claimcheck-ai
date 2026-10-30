/**
 * Optional Wispr Flow API transcription.
 *
 * No approved Wispr Flow credentials exist for this project, so these tests
 * run against a local mock that implements the documented REST contract
 * (POST /api/v1/dash/api, `Authorization: Bearer <key>`, body `{ audio,
 * language, context }`, response `{ text, ... }`). They prove the proxy's
 * behaviour, not that the live API accepts these requests.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { downmix, encodeWav, resampleTo16k } from "../client/src/lib/wav.js";
import {
  MAX_VOICE_SECONDS,
  VoiceError,
  inspectWav,
  readVoiceConfig,
  transcribe,
  voiceStatus,
} from "../server/src/voice.js";

const TEST_KEY = "fl-test-secret-0000";
const tone = (seconds: number, rate = 16_000) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, index) => 0.3 * Math.sin((2 * Math.PI * 220 * index) / rate));
const wav = (seconds = 1, rate = 16_000) => Buffer.from(encodeWav(tone(seconds, rate), rate));
const enabled = readVoiceConfig({ CLAIMCHECK_WISPR_API: "1", WISPR_FLOW_API_KEY: TEST_KEY });

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<VoiceError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof VoiceError, `expected VoiceError, got ${String(error)}`);
    assert.equal(error.payload.code, code);
    assert.ok(!JSON.stringify(error.payload).includes(TEST_KEY), "error payload must not contain the API key");
    return error;
  }
  assert.fail(`expected ${code}`);
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test("voice transcription is off unless the flag and key are both set", () => {
  assert.equal(readVoiceConfig({}).reason, "flag_off");
  assert.equal(readVoiceConfig({ WISPR_FLOW_API_KEY: TEST_KEY }).reason, "flag_off");
  assert.equal(readVoiceConfig({ CLAIMCHECK_WISPR_API: "1" }).reason, "missing_key");
  assert.equal(
    readVoiceConfig({ CLAIMCHECK_WISPR_API: "1", WISPR_FLOW_API_KEY: TEST_KEY, WISPR_FLOW_API_URL: "http://example.com/api" }).reason,
    "invalid_endpoint",
    "the key must never be sent over plain HTTP to a remote host",
  );
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.endpoint, "https://platform-api.wisprflow.ai/api/v1/dash/api");
});

test("the public status never exposes the key and is marked unverified", () => {
  const status = voiceStatus(enabled);
  assert.equal(status.enabled, true);
  assert.equal(status.verified, false);
  assert.ok(!JSON.stringify(status).includes(TEST_KEY));
});

test("transcribe refuses to run when the feature is not configured", async () => {
  await rejectsWith(transcribe(readVoiceConfig({}), wav()), "VOICE_NOT_CONFIGURED");
});

// ---------------------------------------------------------------------------
// Audio validation and conversion
// ---------------------------------------------------------------------------

test("the browser-side encoder produces the documented 16 kHz mono 16-bit WAV", () => {
  const stereo48k = [tone(2, 48_000), tone(2, 48_000)];
  const mono16k = resampleTo16k(downmix(stereo48k), 48_000);
  assert.equal(mono16k.length, 32_000);
  const info = inspectWav(Buffer.from(encodeWav(mono16k)));
  assert.deepEqual(
    { rate: info.sampleRate, channels: info.channels, bits: info.bitsPerSample, seconds: info.seconds },
    { rate: 16_000, channels: 1, bits: 16, seconds: 2 },
  );
});

test("audio that is not 16 kHz mono PCM WAV, empty, or too long is rejected", async () => {
  await rejectsWith(Promise.resolve().then(() => inspectWav(Buffer.from("not audio at all, just text....................."))), "VOICE_BAD_AUDIO");
  await rejectsWith(Promise.resolve().then(() => inspectWav(wav(1, 44_100))), "VOICE_BAD_AUDIO");
  await rejectsWith(Promise.resolve().then(() => inspectWav(Buffer.from(encodeWav(new Float32Array(0))))), "VOICE_BAD_AUDIO");
  await rejectsWith(Promise.resolve().then(() => inspectWav(wav(MAX_VOICE_SECONDS + 1))), "VOICE_TOO_LONG");
});

// ---------------------------------------------------------------------------
// Upstream handling (mocked fetch)
// ---------------------------------------------------------------------------

test("a normal response returns the transcript and sends the documented request", async () => {
  let seen: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
  const result = await transcribe(enabled, wav(1.5), {
    fetchImpl: async (url, init) => {
      seen = {
        url: String(url),
        auth: new Headers(init?.headers).get("Authorization"),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return jsonResponse(200, { id: "x", text: "  Why is this a contradiction?  ", detected_language: "en", total_time: 300, generated_tokens: 6 });
    },
  });
  assert.equal(result.text, "Why is this a contradiction?");
  assert.equal(result.seconds, 1.5);
  assert.ok(seen);
  const request = seen as { url: string; auth: string | null; body: Record<string, unknown> };
  assert.equal(request.url, "https://platform-api.wisprflow.ai/api/v1/dash/api");
  assert.equal(request.auth, `Bearer ${TEST_KEY}`);
  assert.deepEqual(request.body.language, ["en"]);
  assert.equal(Buffer.from(String(request.body.audio), "base64").toString("ascii", 0, 4), "RIFF");
});

test("authentication failures are reported without the key or the upstream body", async () => {
  for (const status of [401, 403]) {
    await rejectsWith(
      transcribe(enabled, wav(), { fetchImpl: async () => jsonResponse(status, { detail: `bad key ${TEST_KEY}` }) }),
      "VOICE_AUTH_FAILED",
    );
  }
});

test("transcription errors map to clear, non-leaking errors", async () => {
  await rejectsWith(transcribe(enabled, wav(), { fetchImpl: async () => jsonResponse(500, { detail: "Error running inference" }) }), "VOICE_UPSTREAM_ERROR");
  await rejectsWith(transcribe(enabled, wav(), { fetchImpl: async () => jsonResponse(400, { detail: "No audio data provided!" }) }), "VOICE_BAD_AUDIO");
  await rejectsWith(transcribe(enabled, wav(), { fetchImpl: async () => jsonResponse(413, { detail: "too big" }) }), "VOICE_TOO_LONG");
  await rejectsWith(transcribe(enabled, wav(), { fetchImpl: async () => jsonResponse(429, {}) }), "VOICE_RATE_LIMITED");
  await rejectsWith(transcribe(enabled, wav(), { fetchImpl: async () => new Response("<html>", { status: 200 }) }), "VOICE_UPSTREAM_ERROR");
  await rejectsWith(transcribe(enabled, wav(), { fetchImpl: async () => jsonResponse(200, { transcript: "wrong field" }) }), "VOICE_UPSTREAM_ERROR");
  await rejectsWith(transcribe(enabled, wav(), { fetchImpl: async () => { throw new TypeError("fetch failed"); } }), "VOICE_UNAVAILABLE");
});

const hangingFetch: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

test("a hung upstream request times out", async () => {
  await rejectsWith(transcribe(enabled, wav(), { fetchImpl: hangingFetch, timeoutMs: 30 }), "VOICE_UNAVAILABLE");
});

test("cancellation aborts the upstream request", async () => {
  const controller = new AbortController();
  const pending = transcribe(enabled, wav(), { fetchImpl: hangingFetch, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await rejectsWith(pending, "VOICE_CANCELLED");
  // Already-cancelled requests never reach the network.
  let called = false;
  const cancelled = new AbortController();
  cancelled.abort();
  await rejectsWith(
    transcribe(enabled, wav(), {
      signal: cancelled.signal,
      fetchImpl: async (url, init) => {
        called = true;
        return hangingFetch(url, init);
      },
    }),
    "VOICE_CANCELLED",
  );
  assert.equal(called, false, "an already-cancelled request must not reach the network");
});

// ---------------------------------------------------------------------------
// HTTP routes, against a real server process and a local mock of the Flow API
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
let mockMode: "ok" | "unauthorized" | "error" | "hang" = "ok";
let mockRequests = 0;
let hungRequestClosed = false;
const mock = http.createServer((req, res) => {
  mockRequests += 1;
  if (mockMode === "hang") res.on("close", () => (hungRequestClosed = true));
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (mockMode === "hang") return;
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== `Bearer ${TEST_KEY}` || mockMode === "unauthorized") {
      res.statusCode = 401;
      res.end(JSON.stringify({ detail: "Invalid API key" }));
      return;
    }
    if (mockMode === "error") {
      res.statusCode = 500;
      res.end(JSON.stringify({ detail: "Error running inference" }));
      return;
    }
    const audio = (JSON.parse(body) as { audio?: string }).audio ?? "";
    res.end(JSON.stringify({ id: "mock", text: `heard ${Buffer.from(audio, "base64").length} bytes`, detected_language: "en" }));
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(env: Record<string, string>) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claimcheck-voice-"));
  const base = { ...process.env };
  delete base.CLAIMCHECK_WISPR_API;
  delete base.WISPR_FLOW_API_KEY;
  delete base.WISPR_FLOW_API_URL;
  const child = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    cwd: ROOT,
    env: { ...base, ...env, PORT: String(port), CLAIMCHECK_DATA_DIR: dataDir, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) break;
    } catch {
      // not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return {
    baseUrl,
    logs,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
}

let disabledServer: Awaited<ReturnType<typeof startServer>>;
let enabledServer: Awaited<ReturnType<typeof startServer>>;

before(async () => {
  const mockPort = await freePort();
  await new Promise<void>((resolve) => mock.listen(mockPort, "127.0.0.1", resolve));
  [disabledServer, enabledServer] = await Promise.all([
    startServer({}),
    startServer({
      CLAIMCHECK_WISPR_API: "1",
      WISPR_FLOW_API_KEY: TEST_KEY,
      WISPR_FLOW_API_URL: `http://127.0.0.1:${mockPort}/api/v1/dash/api`,
    }),
  ]);
});

after(async () => {
  await Promise.all([disabledServer?.stop(), enabledServer?.stop()]);
  mock.closeAllConnections();
  await new Promise((resolve) => mock.close(resolve));
});

const postWav = (baseUrl: string, bytes: Buffer, signal?: AbortSignal) =>
  fetch(`${baseUrl}/api/voice/transcribe`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Uint8Array(bytes), signal });

test("route: an unconfigured server reports voice off, blocks the microphone, and returns 503", async () => {
  const status = await (await fetch(`${disabledServer.baseUrl}/api/voice/status`)).json();
  assert.equal(status.enabled, false);
  assert.equal(status.reason, "flag_off");
  const health = await fetch(`${disabledServer.baseUrl}/api/health`);
  assert.match(health.headers.get("permissions-policy") ?? "", /microphone=\(\)/);
  const response = await postWav(disabledServer.baseUrl, wav());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "VOICE_NOT_CONFIGURED");
});

test("route: a configured server transcribes through the API and allows the microphone for itself", async () => {
  mockMode = "ok";
  const health = await fetch(`${enabledServer.baseUrl}/api/health`);
  assert.match(health.headers.get("permissions-policy") ?? "", /microphone=\(self\)/);
  const response = await postWav(enabledServer.baseUrl, wav(1));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.text, `heard ${wav(1).length} bytes`);
  assert.equal(body.seconds, 1);
});

test("route: authentication and upstream failures never leak the key", async () => {
  mockMode = "unauthorized";
  const auth = await postWav(enabledServer.baseUrl, wav());
  const authText = await auth.text();
  assert.equal(auth.status, 502);
  assert.match(authText, /VOICE_AUTH_FAILED/);
  assert.ok(!authText.includes(TEST_KEY));

  mockMode = "error";
  const failed = await postWav(enabledServer.baseUrl, wav());
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error.code, "VOICE_UPSTREAM_ERROR");
  assert.ok(!enabledServer.logs.join("").includes(TEST_KEY), "server logs must not contain the key");
});

test("route: invalid and oversized recordings are rejected before reaching the API", async () => {
  mockMode = "ok";
  const before = mockRequests;
  const notWav = await postWav(enabledServer.baseUrl, Buffer.from("this is definitely not a wav file............"));
  assert.equal(notWav.status, 400);
  assert.equal((await notWav.json()).error.code, "VOICE_BAD_AUDIO");
  const tooLong = await postWav(enabledServer.baseUrl, wav(MAX_VOICE_SECONDS + 5));
  assert.equal(tooLong.status, 413);
  assert.equal((await tooLong.json()).error.code, "VOICE_TOO_LONG");
  assert.equal(mockRequests, before, "rejected recordings must not be forwarded");
});

test("route: a client that cancels mid-transcription releases the upstream request", async () => {
  mockMode = "hang";
  hungRequestClosed = false;
  const controller = new AbortController();
  const pending = postWav(enabledServer.baseUrl, wav(), controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 300));
  controller.abort();
  await assert.rejects(pending, /abort/i);
  const deadline = Date.now() + 3_000;
  while (!hungRequestClosed && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(hungRequestClosed, true, "the server must abort its upstream request when the client cancels");
  // The server stays healthy after the cancelled request.
  mockMode = "ok";
  const next = await postWav(enabledServer.baseUrl, wav());
  assert.equal(next.status, 200);
});
