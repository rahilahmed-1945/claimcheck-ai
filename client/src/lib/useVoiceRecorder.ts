/**
 * Microphone recording for the optional Wispr Flow API transcription.
 *
 * Flow: the user presses Record (the browser asks for microphone permission),
 * presses Stop, the audio is converted to 16 kHz mono WAV and sent to the
 * local server, and the transcript is returned for review. Nothing is ever
 * submitted automatically: the caller only receives text to place in the
 * question field. Cancel works while recording and while transcribing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, transcribeRecording } from "./api";
import { downmix, encodeWav, resampleTo16k } from "./wav";

export type VoicePhase = "idle" | "requesting" | "recording" | "transcribing" | "error";

export interface VoiceRecorder {
  phase: VoicePhase;
  seconds: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was denied. Allow the microphone for this site in your browser settings, or type the question.";
  }
  if (name === "NotFoundError") return "No microphone was found. Connect one, or type the question.";
  if (name === "NotReadableError") return "The microphone is in use by another application.";
  return "The microphone could not be started. Type the question instead.";
}

export function useVoiceRecorder(maxSeconds: number, onTranscript: (text: string) => void): VoiceRecorder {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);

  const releaseMic = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelled.current = true;
      request.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      releaseMic();
    },
    [releaseMic],
  );

  const finish = useCallback(async () => {
    releaseMic();
    if (cancelled.current) {
      setPhase("idle");
      return;
    }
    setPhase("transcribing");
    const controller = new AbortController();
    request.current = controller;
    try {
      const blob = new Blob(chunks.current, { type: recorder.current?.mimeType || "audio/webm" });
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      void context.close();
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
      const wav = encodeWav(resampleTo16k(downmix(channels), decoded.sampleRate));
      const result = await transcribeRecording(wav, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.text) {
        setError("No speech was recognised. Try again, or type the question.");
        setPhase("error");
        return;
      }
      onTranscript(result.text);
      setPhase("idle");
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError")) {
        setPhase("idle");
        return;
      }
      setError(caught instanceof ApiError ? caught.payload.message : "The recording could not be processed.");
      setPhase("error");
    } finally {
      request.current = null;
    }
  }, [onTranscript, releaseMic]);

  const start = useCallback(async () => {
    if (phase === "recording" || phase === "transcribing" || phase === "requesting") return;
    setError(null);
    setSeconds(0);
    cancelled.current = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio. Type the question instead.");
      setPhase("error");
      return;
    }
    setPhase("requesting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
    } catch (caught) {
      setError(micErrorMessage(caught));
      setPhase("error");
      return;
    }
    chunks.current = [];
    const media = new MediaRecorder(stream.current);
    recorder.current = media;
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    media.onstop = () => void finish();
    media.start();
    setPhase("recording");
    const startedAt = Date.now();
    timer.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds && media.state === "recording") media.stop();
    }, 250);
  }, [finish, maxSeconds, phase]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    request.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    releaseMic();
    setError(null);
    setPhase("idle");
  }, [releaseMic]);

  return { phase, seconds, error, start, stop, cancel };
}
