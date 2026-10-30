/**
 * VoicePanel — grounded "ask about this finding" panel and speech-to-text tips.
 *
 * Two separate voice paths:
 *  - Desktop dictation: the Wispr Flow desktop app (or any speech-to-text
 *    tool) types into the ordinary text field. No integration is involved.
 *  - Optional Wispr Flow API transcription: shown only when the server has
 *    the feature flag and an approved API key (see server/src/voice.ts). The
 *    transcript is placed in the field for review; it is never submitted
 *    automatically, and the panel can only answer questions, never act.
 *
 * All answers are derived strictly from the finding's own audit data —
 * the claim text, rationale, evidence, numeric comparisons, and limitations.
 * Nothing is invented. If there is not enough information, the panel says so.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Finding } from "@shared/types";
import { fetchVoiceStatus, type VoiceStatus } from "../lib/api";
import { useVoiceRecorder } from "../lib/useVoiceRecorder";
import { CATEGORY_META, CONFIDENCE_META } from "../lib/categories";
import { Icon } from "./Icon";

interface AnswerLine {
  label: string;
  content: string;
}

/**
 * Produce a grounded answer to a question about a finding.
 * Answers are assembled from fields already on the Finding object — no LLM.
 */
function groundedAnswer(question: string, finding: Finding): { summary: string; lines: AnswerLine[] } {
  const q = question.toLowerCase().trim();
  const categoryMeta = CATEGORY_META[finding.category];

  // Classification / category questions
  if (/\b(classif|categor|label|verdict|result|outcome)\b/.test(q)) {
    return {
      summary: `This finding is classified as "${categoryMeta.label}".`,
      lines: [
        { label: "Classification", content: categoryMeta.label },
        { label: "Definition", content: categoryMeta.definition },
        { label: "Confidence", content: `${CONFIDENCE_META[finding.confidence].label} — ${CONFIDENCE_META[finding.confidence].detail}` },
      ],
    };
  }

  // What is the claim / what does it say
  if (/\b(claim|statement|sentence|what.?does|what.?is)\b/.test(q)) {
    return {
      summary: `The claim reads: "${finding.claim.text}"`,
      lines: [
        { label: "Claim text", content: finding.claim.text },
        { label: "Location", content: `${finding.claim.sectionTitle} · page ${finding.claim.page}` },
      ],
    };
  }

  // Why / rationale
  if (/\b(why|reason|rationale|explain|how)\b/.test(q)) {
    return {
      summary: finding.rationale,
      lines: [
        { label: "Rationale", content: finding.rationale },
      ],
    };
  }

  // Evidence questions
  if (/\b(evidence|support|conflict|quote|source|text)\b/.test(q)) {
    if (finding.evidence.length === 0) {
      return {
        summary: "No qualifying evidence was located in the extracted document.",
        lines: [
          { label: "Evidence", content: "No evidence passages met the retrieval threshold." },
          { label: "Note", content: "Absence of evidence is not proof the claim is false." },
        ],
      };
    }
    return {
      summary: `${finding.evidence.length} evidence passage(s) were located.`,
      lines: finding.evidence.map((e, i) => ({
        label: `Evidence ${i + 1} (${e.relation}) · p. ${e.page}`,
        content: e.quote,
      })),
    };
  }

  // Numbers / values
  if (/\b(number|numer|value|metric|score|percent|bleu|f1|accuracy|auc)\b/.test(q)) {
    if (finding.numericComparisons.length === 0) {
      return {
        summary: "No numeric comparisons were produced for this finding.",
        lines: [{ label: "Numeric trace", content: "No matching numeric values were found in the evidence." }],
      };
    }
    return {
      summary: `${finding.numericComparisons.length} numeric comparison(s) were traced.`,
      lines: finding.numericComparisons.map((c) => ({
        label: `${c.metric}: claim ${c.claimValue} vs evidence ${c.evidenceValue}`,
        content: c.delta === "0" ? "Values match." : `Difference: Δ ${c.delta}`,
      })),
    };
  }

  // Limitations
  if (/\b(limit|caveat|uncertain|missing|gap|caution)\b/.test(q)) {
    return {
      summary: `This finding has ${finding.limitations.length} stated interpretation limit(s).`,
      lines: finding.limitations.map((l, i) => ({ label: `Limit ${i + 1}`, content: l })),
    };
  }

  // Page / location
  if (/\b(page|section|locat|where|found)\b/.test(q)) {
    return {
      summary: `Found at ${finding.claim.sectionTitle}, page ${finding.claim.page}.`,
      lines: [
        { label: "Section", content: finding.claim.sectionTitle },
        { label: "Page", content: String(finding.claim.page) },
        { label: "Finding ID", content: finding.id },
      ],
    };
  }

  // Fallback — return the key facts without fabricating anything
  return {
    summary: "Here is a summary of this finding based on the audit data.",
    lines: [
      { label: "Classification", content: categoryMeta.label },
      { label: "Claim", content: finding.claim.text },
      { label: "Rationale", content: finding.rationale.slice(0, 200) + (finding.rationale.length > 200 ? "…" : "") },
      { label: "Evidence count", content: String(finding.evidence.length) },
      { label: "Source", content: `${finding.claim.sectionTitle} · page ${finding.claim.page}` },
    ],
  };
}

interface VoicePanelProps {
  finding: Finding;
}

let voiceStatusRequest: Promise<VoiceStatus | null> | null = null;
function loadVoiceStatus(): Promise<VoiceStatus | null> {
  voiceStatusRequest ??= fetchVoiceStatus().catch(() => null);
  return voiceStatusRequest;
}

const formatSeconds = (value: number) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;

export function VoicePanel({ finding }: VoicePanelProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ReturnType<typeof groundedAnswer> | null>(null);
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [fromApi, setFromApi] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void loadVoiceStatus().then((status) => {
      if (active) setVoice(status);
    });
    return () => {
      active = false;
    };
  }, []);

  const onTranscript = useCallback((text: string) => {
    // Review before submitting: the transcript only fills the field.
    setQuestion(text);
    setAnswer(null);
    setFromApi(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);
  const recorder = useVoiceRecorder(voice?.maxSeconds ?? 90, onTranscript);
  const apiEnabled = voice?.enabled === true;
  const busy = recorder.phase === "requesting" || recorder.phase === "recording" || recorder.phase === "transcribing";

  const ask = () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setAnswer(groundedAnswer(trimmed, finding));
  };

  const reset = () => {
    setQuestion("");
    setAnswer(null);
  };

  // Reset when finding changes
  const key = finding.id;

  return (
    <section className="detail-block voice-panel" aria-labelledby={`voice-heading-${key}`}>
      <button
        type="button"
        className="voice-panel-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={`voice-content-${key}`}
        id={`voice-heading-${key}`}
      >
        <Icon name="quote" size={14} />
        <span>Ask about this finding</span>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={13} />
      </button>

      {open && (
        <div id={`voice-content-${key}`} className="voice-content">
          <p className="voice-hint">
            <Icon name="info" size={12} />
            Dictate into the field with the Wispr Flow desktop app or any speech-to-text tool
            {apiEnabled ? ", or record a question for Wispr Flow API transcription" : ""}. Answers come only
            from the audit data. Nothing is invented.
          </p>

          <div className="voice-input-row">
            <label className="visually-hidden" htmlFor={`voice-input-${key}`}>
              Question about this finding
            </label>
            <input
              id={`voice-input-${key}`}
              type="text"
              className="voice-input"
              ref={inputRef}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                setFromApi(false);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") ask(); if (e.key === "Escape") reset(); }}
              placeholder="e.g. Why is this classified this way? What evidence supports it?"
              autoComplete="off"
            />
            <button
              type="button"
              className="button button-primary button-sm"
              onClick={ask}
              disabled={!question.trim() || busy}
            >
              Ask
            </button>
            {apiEnabled && recorder.phase !== "recording" && recorder.phase !== "transcribing" && (
              <button
                type="button"
                className="button button-ghost button-sm"
                onClick={() => void recorder.start()}
                disabled={recorder.phase === "requesting"}
                aria-label="Record a question for Wispr Flow API transcription"
              >
                <Icon name="quote" size={13} /> Record
              </button>
            )}
            {answer && (
              <button type="button" className="button button-ghost button-sm" onClick={reset}>
                Clear
              </button>
            )}
          </div>

          {apiEnabled && (
            <div className="voice-recorder" aria-live="polite">
              {recorder.phase === "requesting" && <p className="voice-recorder-status">Waiting for microphone permission…</p>}
              {recorder.phase === "recording" && (
                <p className="voice-recorder-status">
                  <span className="voice-recording-dot" aria-hidden="true" /> Recording {formatSeconds(recorder.seconds)} of{" "}
                  {formatSeconds(voice?.maxSeconds ?? 90)}
                  <button type="button" className="button button-primary button-sm" onClick={recorder.stop}>
                    Stop and transcribe
                  </button>
                  <button type="button" className="button button-ghost button-sm" onClick={recorder.cancel}>
                    Cancel
                  </button>
                </p>
              )}
              {recorder.phase === "transcribing" && (
                <p className="voice-recorder-status">
                  Transcribing with the Wispr Flow API…
                  <button type="button" className="button button-ghost button-sm" onClick={recorder.cancel}>
                    Cancel
                  </button>
                </p>
              )}
              {recorder.phase === "error" && recorder.error && (
                <p className="voice-recorder-error" role="alert">
                  {recorder.error}
                </p>
              )}
              {fromApi && recorder.phase === "idle" && question && (
                <p className="voice-recorder-status">
                  Transcript from the Wispr Flow API. Review or edit it, then press Ask.
                </p>
              )}
            </div>
          )}

          {answer && (
            <div className="voice-answer" role="region" aria-label="Answer">
              <p className="voice-answer-summary">{answer.summary}</p>
              <dl className="voice-answer-lines">
                {answer.lines.map((line) => (
                  <div key={line.label} className="voice-answer-line">
                    <dt>{line.label}</dt>
                    <dd>{line.content}</dd>
                  </div>
                ))}
              </dl>
              <p className="voice-answer-note">
                <Icon name="shield" size={11} />
                This answer was assembled from the finding's audit record. No external sources or AI model were consulted.
              </p>
            </div>
          )}

          <div className="voice-tips">
            <p className="voice-tips-label">
              <Icon name="info" size={12} /> Sample questions (speak or type):
            </p>
            <ul>
              <li>"Why is this classified as a potential contradiction?"</li>
              <li>"What evidence was found for this finding?"</li>
              <li>"What are the numeric values being compared?"</li>
              <li>"What are the interpretation limits for this finding?"</li>
              <li>"Where in the paper was this claim found?"</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
