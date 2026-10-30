import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import manifest from "../public/capture/manifest.json";
import { C, MONO, SANS } from "./theme";
import { FPS, LINES, lineText } from "./timeline";

export const ease = Easing.bezier(0.45, 0, 0.2, 1);
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Interpolate over keyframes [time, value] with easing between neighbours. */
export function keyed(t: number, keys: [number, number][], easing = ease): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t <= t1) return interpolate(t, [t0, t1], [v0, v1], { ...clamp, easing });
  }
  return keys[keys.length - 1][1];
}

/** Atmospheric dark stage: layered radial light, vignette, and fine grain. */
export const Stage: React.FC<{ hue?: "green" | "warm" }> = ({ hue = "green" }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 140) * 40;
  const glow = hue === "warm" ? "rgba(217,196,154,0.16)" : "rgba(40,120,100,0.22)";
  return (
    <AbsoluteFill style={{ background: C.stage }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1100px 700px at ${720 + drift}px ${380 - drift / 2}px, ${glow}, transparent 70%), radial-gradient(900px 600px at ${1500 - drift}px 900px, rgba(217,196,154,0.08), transparent 70%)`,
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)" }} />
      <AbsoluteFill style={{ opacity: 0.07, mixBlendMode: "overlay" }}>
        <svg width="1920" height="1080">
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 8} />
          </filter>
          <rect width="1920" height="1080" filter="url(#grain)" />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// --- Browser ----------------------------------------------------------------
export const VIEW_W = 1440;
export const VIEW_H = 900;
export const WIN_SCALE = 0.88;
export const CHROME_H = 46;
export const WIN_LEFT = (1920 - VIEW_W * WIN_SCALE) / 2;
export const WIN_TOP = 84;

/** Screen (viewport CSS px) → stage px, before camera. */
export const toStage = (x: number, y: number) => ({ x: WIN_LEFT + x * WIN_SCALE, y: WIN_TOP + CHROME_H + y * WIN_SCALE });

export const BrowserWindow: React.FC<{
  url: string;
  children: React.ReactNode;
  download?: { progress: number; visible: number; name: string; size: string };
}> = ({ url, children, download }) => (
  <div
    style={{
      position: "absolute",
      left: WIN_LEFT,
      top: WIN_TOP,
      width: VIEW_W * WIN_SCALE,
      height: VIEW_H * WIN_SCALE + CHROME_H,
      borderRadius: 14,
      overflow: "hidden",
      background: C.bg,
      boxShadow: "0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)",
    }}
  >
    <div
      style={{
        height: CHROME_H,
        background: "linear-gradient(#efebe1, #e7e2d6)",
        borderBottom: "1px solid #d9d3c4",
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        gap: 10,
        fontFamily: SANS,
        position: "relative",
      }}
    >
      {["#e46b5c", "#e4b44c", "#5fae6a"].map((color) => (
        <div key={color} style={{ width: 13, height: 13, borderRadius: 7, background: color, opacity: 0.9 }} />
      ))}
      <div
        style={{
          marginLeft: 90,
          flex: "0 0 760px",
          height: 28,
          borderRadius: 8,
          background: "#fbf9f3",
          border: "1px solid #ddd6c7",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 8,
          fontSize: 15,
          color: "#5b645f",
        }}
      >
        <svg width="12" height="14" viewBox="0 0 12 14">
          <rect x="1.5" y="6" width="9" height="7" rx="1.5" fill="none" stroke="#7d8781" strokeWidth="1.4" />
          <path d="M3.5 6V4.2a2.5 2.5 0 0 1 5 0V6" fill="none" stroke="#7d8781" strokeWidth="1.4" />
        </svg>
        <span style={{ color: "#2b3430" }}>{url}</span>
      </div>
      {download && download.visible > 0 ? (
        <div
          style={{
            position: "absolute",
            right: 18,
            top: 7,
            height: 32,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 14px 0 10px",
            borderRadius: 9,
            background: "#fffdf7",
            border: `1px solid ${C.accent}55`,
            boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
            opacity: download.visible,
            transform: `translateY(${(1 - download.visible) * -8}px)`,
            fontSize: 14,
            color: C.ink,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="9" fill="none" stroke="#e2dccd" strokeWidth="2.4" />
            <circle
              cx="11"
              cy="11"
              r="9"
              fill="none"
              stroke={C.accent}
              strokeWidth="2.4"
              strokeDasharray={`${download.progress * 56.5} 56.5`}
              transform="rotate(-90 11 11)"
              strokeLinecap="round"
            />
            {download.progress >= 1 ? <path d="M7 11.3l2.6 2.6L15 8.6" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
          </svg>
          <span style={{ fontWeight: 500 }}>{download.name}</span>
          <span style={{ color: C.muted, fontFamily: MONO, fontSize: 12 }}>{download.size}</span>
        </div>
      ) : null}
    </div>
    <div style={{ position: "relative", width: VIEW_W * WIN_SCALE, height: VIEW_H * WIN_SCALE, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: VIEW_W, height: VIEW_H, transform: `scale(${WIN_SCALE})`, transformOrigin: "0 0" }}>
        {children}
      </div>
    </div>
  </div>
);

/** One captured screenshot of the real app, in viewport coordinates. */
export const Shot: React.FC<{ file: string; style?: React.CSSProperties }> = ({ file, style }) => (
  <Img src={staticFile(`capture/${file}`)} style={{ position: "absolute", left: 0, top: 0, width: VIEW_W, height: VIEW_H, ...style }} />
);

type SeqName = keyof typeof manifest.sequences;
/** File for a recorded sequence at time t (seconds since it started), one capture per video frame by default. */
export function seqFile(name: SeqName, t: number, framesPerCapture = 1): string {
  const files = manifest.sequences[name].files as string[];
  const index = Math.max(0, Math.min(files.length - 1, Math.floor((t * FPS) / framesPerCapture)));
  return files[index];
}
export const seqLength = (name: SeqName, framesPerCapture = 1) => (manifest.sequences[name].frames * framesPerCapture) / FPS;

// --- Cursor -------------------------------------------------------------------
export type CursorKey = { t: number; x: number; y: number; click?: boolean };

export function cursorAt(t: number, keys: CursorKey[]) {
  let x = keys[0].x;
  let y = keys[0].y;
  if (t >= keys[keys.length - 1].t) {
    x = keys[keys.length - 1].x;
    y = keys[keys.length - 1].y;
  } else {
    for (let i = 0; i < keys.length - 1; i++) {
      const k0 = keys[i];
      const k1 = keys[i + 1];
      if (t >= k0.t && t <= k1.t) {
        const p = ease(Math.min(1, (t - k0.t) / Math.max(0.001, k1.t - k0.t)));
        // A slight arc makes the motion feel hand-driven.
        const arc = Math.sin(p * Math.PI) * Math.min(60, Math.hypot(k1.x - k0.x, k1.y - k0.y) * 0.12);
        x = k0.x + (k1.x - k0.x) * p;
        y = k0.y + (k1.y - k0.y) * p - arc;
        break;
      }
    }
  }
  const clicks = keys.filter((k) => k.click).map((k) => k.t);
  const lastClick = clicks.filter((c) => c <= t).pop();
  const since = lastClick === undefined ? 99 : t - lastClick;
  return { x, y, since };
}

export const Cursor: React.FC<{ x: number; y: number; since: number; carrying?: React.ReactNode; opacity?: number }> = ({ x, y, since, carrying, opacity = 1 }) => {
  const press = since < 0.18 ? interpolate(since, [0, 0.08, 0.18], [1, 0.86, 1]) : 1;
  const ring = since < 0.6 ? since / 0.6 : 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, pointerEvents: "none" }}>
      {ring > 0 ? (
        <div
          style={{
            position: "absolute",
            left: -26 * (0.4 + ring),
            top: -26 * (0.4 + ring),
            width: 52 * (0.4 + ring),
            height: 52 * (0.4 + ring),
            borderRadius: "50%",
            border: `2.5px solid ${C.accent}`,
            opacity: 1 - ring,
          }}
        />
      ) : null}
      {carrying}
      <svg width="30" height="36" viewBox="0 0 30 36" style={{ position: "absolute", left: -3, top: -2, transform: `scale(${press})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.35))" }}>
        <path d="M3 2 L3 27 L9.5 21 L14 31.5 L18.5 29.6 L14.2 19.4 L23 19.4 Z" fill="#fff" stroke="#151a18" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

// --- Captions -------------------------------------------------------------------
function chunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text];
  const out: string[] = [];
  for (const part of parts) {
    if (part.length <= 92) {
      out.push(part);
      continue;
    }
    const comma = part.lastIndexOf(",", Math.floor(part.length / 2) + 20);
    if (comma > 20) {
      out.push(part.slice(0, comma + 1).trim(), part.slice(comma + 1).trim());
    } else out.push(part);
  }
  return out;
}

export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const line = LINES.find((l) => t >= l.start - 0.05 && t <= l.start + l.duration + 0.25);
  if (!line) return null;
  const pieces = chunks(lineText[line.id]);
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  let acc = line.start;
  let current = pieces[pieces.length - 1];
  let pieceStart = acc;
  for (const piece of pieces) {
    const len = (piece.length / total) * line.duration;
    if (t < acc + len) {
      current = piece;
      pieceStart = acc;
      break;
    }
    acc += len;
  }
  const appear = interpolate(t - pieceStart, [0, 0.18], [0, 1], clamp);
  const lineOut = interpolate(t, [line.start + line.duration, line.start + line.duration + 0.25], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 46, pointerEvents: "none" }}>
      <div
        style={{
          maxWidth: 1340,
          padding: "12px 26px 13px",
          borderRadius: 12,
          background: "rgba(8,17,14,0.78)",
          backdropFilter: "blur(6px)",
          color: "#f6f2e8",
          fontFamily: SANS,
          fontSize: 31,
          lineHeight: 1.32,
          letterSpacing: -0.1,
          textAlign: "center",
          opacity: appear * lineOut,
          transform: `translateY(${(1 - appear) * 6}px)`,
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        }}
      >
        {current}
      </div>
    </AbsoluteFill>
  );
};
