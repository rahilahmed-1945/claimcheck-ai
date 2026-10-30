/**
 * Animated illustration of the voice-input workflow (Wispr Flow dictation into
 * the question field). The page underneath is the real app; the listening pill,
 * waveform, and word-by-word text are drawn, and the scene is labelled as an
 * illustration. The answer shown after Ask is the real capture for this exact
 * question (manifest.voice).
 */
import React from "react";
import { interpolate } from "remotion";
import manifest from "../public/capture/manifest.json";
import { C, MONO, SANS, SERIF } from "./theme";
import { APP as a } from "./timeline";
import { clamp, ease, easeOut } from "./ui";

const v = manifest.voice;
const WORDS = v.question.split(" ");
const cubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Where the real input sits at time t (it moves while the panel scrolls). */
export function inputRect(t: number) {
  const width = t < a.clickAsk ? v.input.width : v.inputEnd.width;
  const p = Math.max(0, Math.min(1, (t - a.voiceScroll) / (29 / 30)));
  const y = t < a.voiceScroll ? v.input.y : v.input.y + (v.inputEnd.y - v.input.y) * cubic(p);
  return { x: v.input.x, y, width, height: v.input.height };
}

const Waveform: React.FC<{ t: number; level: number }> = ({ t, level }) => {
  const bars = 22;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 26 }}>
      {Array.from({ length: bars }, (_, i) => {
        // Speech-like motion: syllable rhythm × slow phrase envelope × per-bar variation.
        const syllable = Math.abs(Math.sin(t * 9.3 + i * 0.7)) * 0.6 + Math.abs(Math.sin(t * 4.1 + i * 1.9)) * 0.4;
        const phrase = 0.55 + 0.45 * Math.sin(t * 1.7 + 0.4);
        const shape = Math.sin((Math.PI * (i + 0.5)) / bars);
        const h = 3 + 21 * level * syllable * phrase * (0.4 + 0.6 * shape);
        return <div key={i} style={{ width: 3, height: h, borderRadius: 2, background: i % 5 === 2 ? C.gold : "#e9e3d4", opacity: 0.55 + 0.45 * level }} />;
      })}
    </div>
  );
};

/** Drawn inside the browser viewport (viewport coordinates). */
export const VoiceLayer: React.FC<{ t: number }> = ({ t }) => {
  const field = inputRect(t);
  const fieldIn = interpolate(t, [a.wordsStart - 0.25, a.wordsStart], [0, 1], clamp);
  const fieldOut = interpolate(t, [a.scrollReviewer, a.scrollReviewer + 0.3], [1, 0], clamp);
  const pillIn = interpolate(t, [a.listenStart - 0.35, a.listenStart + 0.15], [0, 1], { ...clamp, easing: easeOut });
  const pillOut = interpolate(t, [a.clickAsk, a.clickAsk + 0.4], [1, 0], clamp);
  const listening = interpolate(t, [a.listenStart, a.listenStart + 0.3, a.listenEnd - 0.2, a.listenEnd], [0, 1, 1, 0.08], clamp);
  const per = (a.wordsEnd - a.wordsStart) / WORDS.length;
  const shown = WORDS.map((word, i) => ({ word, p: interpolate(t, [a.wordsStart + i * per, a.wordsStart + i * per + 0.16], [0, 1], clamp) })).filter((w) => w.p > 0);
  const caret = t < a.listenEnd && Math.floor(t * 2.2) % 2 === 0;
  const done = t >= a.listenEnd;

  // Connections between question, finding, and evidence once the real answer is in view.
  const link = interpolate(t, [a.connect, a.connect + 0.9], [0, 1], { ...clamp, easing: ease });
  const linkOut = interpolate(t, [a.reviewer - 0.35, a.reviewer], [1, 0], clamp);
  const finding = v.findingEnd;
  const q = { x: field.x, y: field.y, width: field.width, height: 59 };
  const evidence = { x: field.x + 8, y: q.y + q.height + 4, width: 632, height: 116 };
  const ring = (r: { x: number; y: number; width: number; height: number }, delay: number) => {
    const p = interpolate(t, [a.connect + delay, a.connect + delay + 0.5], [0, 1], { ...clamp, easing: easeOut });
    return { left: r.x - 6, top: r.y - 6, width: r.width + 12, height: r.height + 12, opacity: p * linkOut, transform: `scale(${0.985 + p * 0.015})` };
  };
  const label = (text: string, x: number, y: number, delay: number) => {
    const p = interpolate(t, [a.connect + delay, a.connect + delay + 0.45], [0, 1], { ...clamp, easing: easeOut });
    return (
      <div style={{ position: "absolute", left: x, top: y, padding: "5px 11px", borderRadius: 999, background: C.accentInk, color: "#f6f2e8", fontFamily: MONO, fontSize: 12, letterSpacing: 1.2, opacity: p * linkOut, transform: `translateY(${(1 - p) * 6}px)`, whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.18)" }}>
        {text}
      </div>
    );
  };
  const pathA = `M ${q.x - 6} ${q.y + 30} C ${q.x - 70} ${q.y + 30}, ${finding.x + finding.width + 70} ${finding.y + 67}, ${finding.x + finding.width + 6} ${finding.y + 67}`;
  const pathB = `M ${finding.x + finding.width + 6} ${finding.y + 100} C ${finding.x + finding.width + 40} ${evidence.y + 60}, ${evidence.x - 50} ${evidence.y + 60}, ${evidence.x - 6} ${evidence.y + 60}`;

  return (
    <>
      {/* Dictated text in a copy of the real input, allowed to wrap so nothing is clipped. */}
      {fieldIn > 0 ? (
        <div
          style={{
            position: "absolute",
            left: field.x,
            top: field.y,
            width: field.width,
            minHeight: field.height,
            boxSizing: "border-box",
            padding: "8px 13px",
            borderRadius: 7,
            background: "#fffefa",
            border: `1.5px solid ${C.accent}`,
            boxShadow: `0 0 0 3px rgba(20,99,86,0.14), 0 10px 24px rgba(0,0,0,${0.1 * fieldIn})`,
            fontFamily: SANS,
            fontSize: 15,
            lineHeight: "20px",
            color: C.ink,
            opacity: fieldIn * fieldOut,
          }}
        >
          {shown.map(({ word, p }, i) => (
            <span key={i} style={{ opacity: p, filter: `blur(${(1 - p) * 3}px)`, display: "inline-block", transform: `translateY(${(1 - p) * 3}px)`, marginRight: 4 }}>
              {word}
            </span>
          ))}
          {caret ? <span style={{ display: "inline-block", width: 1.5, height: 17, background: C.ink, verticalAlign: -3 }} /> : null}
        </div>
      ) : null}

      {/* Wispr Flow–style listening pill (an original illustration, not Wispr's UI). */}
      {pillIn * pillOut > 0 ? (
        <div
          style={{
            position: "absolute",
            left: v.input.x + v.input.width - 330,
            top: v.input.y - 66,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 16px 8px 8px",
            borderRadius: 999,
            background: "rgba(14,24,21,0.94)",
            border: "1px solid rgba(217,196,154,0.3)",
            boxShadow: "0 14px 34px rgba(0,0,0,0.3)",
            opacity: pillIn * pillOut,
            transform: `translateY(${(1 - pillIn) * 10}px) scale(${0.96 + pillIn * 0.04})`,
          }}
        >
          <div style={{ width: 32, height: 32, borderRadius: 16, background: done ? C.accent : "#1d7a69", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: done ? "none" : `0 0 0 ${3 + listening * 4}px rgba(29,122,105,${0.25 * listening})` }}>
            {done ? (
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg width="14" height="18" viewBox="0 0 14 18"><rect x="4" y="1" width="6" height="10" rx="3" fill="#fff" /><path d="M1.5 8.5a5.5 5.5 0 0 0 11 0M7 14v3" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
            )}
          </div>
          <Waveform t={t} level={listening} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: "#f6f2e8" }}>Wispr Flow</span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: done ? "#9fd3c2" : C.gold, letterSpacing: 0.6 }}>{done ? "text inserted" : "listening…"}</span>
          </div>
        </div>
      ) : null}

      {/* Question → finding → evidence. */}
      {link > 0 ? (
        <>
          <svg width="1440" height="900" style={{ position: "absolute", left: 0, top: 0, opacity: linkOut }}>
            {[pathA, pathB].map((d, i) => (
              <path key={i} d={d} fill="none" stroke="#b8913f" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="600" strokeDashoffset={600 * (1 - interpolate(link, [i * 0.35, 0.65 + i * 0.35], [0, 1], clamp))} />
            ))}
          </svg>
          {[ring(q, 0), ring(finding, 0.25), ring(evidence, 0.55)].map((style, i) => (
            <div key={i} style={{ position: "absolute", borderRadius: 12, border: "2px solid #b8913f", boxShadow: "0 0 0 6px rgba(184,145,63,0.12)", ...style }} />
          ))}
          {label("YOUR QUESTION", q.x + q.width - 128, q.y - 34, 0.1)}
          {label("FINDING F-001", finding.x + 10, finding.y - 34, 0.35)}
          {label("EVIDENCE · TABLE 2, P. 2", evidence.x + evidence.width - 210, evidence.y + evidence.height + 12, 0.65)}
        </>
      ) : null}
    </>
  );
};

/** Stage-level label: makes clear the scene is an illustration, not a recording of Wispr Flow. */
export const IllustrationBadge: React.FC<{ t: number }> = ({ t }) => {
  const p = interpolate(t, [a.askIn + 0.1, a.askIn + 0.6, a.reviewer - 0.3, a.reviewer], [0, 1, 1, 0], clamp);
  if (p <= 0) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 30, display: "flex", justifyContent: "center", opacity: p }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderRadius: 999, background: "rgba(8,17,14,0.82)", border: "1px solid rgba(217,196,154,0.3)", boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}>
        <span style={{ fontFamily: MONO, fontSize: 13, letterSpacing: 2.5, color: C.gold }}>ANIMATED ILLUSTRATION</span>
        <span style={{ width: 1, height: 16, background: "rgba(217,196,154,0.35)" }} />
        <span style={{ fontFamily: SERIF, fontSize: 21, color: "#efe9dc" }}>Voice input with Wispr Flow · not a screen recording</span>
      </div>
    </div>
  );
};
