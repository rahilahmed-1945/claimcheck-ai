/**
 * The product walkthrough: one continuous browser session built from real
 * captures of the running app. Screens, scroll sequences, typing frames, and
 * cursor targets all come from public/capture/manifest.json.
 */
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import manifest from "../public/capture/manifest.json";
import report from "./report.json";
import { PipelineOverlay, ReportOverlay, SignalsOverlay } from "./graphics";
import { IllustrationBadge, VoiceLayer } from "./VoiceScene";
import { C, MONO, SANS, SERIF } from "./theme";
import { APP as a, FPS } from "./timeline";
import { BrowserWindow, CHROME_H, clamp, Cursor, cursorAt, type CursorKey, ease, easeOut, seqFile, Shot, Stage, toStage, VIEW_H, VIEW_W, WIN_LEFT, WIN_SCALE, WIN_TOP } from "./ui";

const shots = manifest.shots as unknown as Record<string, { file: string; click?: { x: number; y: number; width: number; height: number }; dropzone?: { x: number; y: number; width: number; height: number } }>;
const center = (name: string) => {
  const r = shots[name].click!;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
const processingFrames = manifest.processing.filter((p) => p.auditing).map((p) => p.file);
const zone = shots.home.dropzone!;
const zoneCenter = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };

// Derived times.
const dragHover = a.dropAt - 1.15;
const voice = manifest.voice;
const voiceAsk = { x: voice.ask.x + voice.ask.width / 2, y: voice.ask.y + voice.ask.height / 2 };
const pos = {
  f009: center("f009"),
  f001: center("f001"),
  doc: center("document"),
  confirmed: { x: voice.confirmed.x + voice.confirmed.width / 2, y: voice.confirmed.y + voice.confirmed.height / 2 },
  markdown: { x: voice.markdown.x + voice.markdown.width / 2, y: voice.markdown.y + voice.markdown.height / 2 },
};

export const CLICKS = [a.dropAt, a.clickF009, a.clickF001, a.clickDocument, a.clickAsk, a.clickConfirmed, a.clickMarkdown];

const cursorKeys: CursorKey[] = [
  { t: a.dragStart, x: 40, y: 880 },
  { t: dragHover, x: zoneCenter.x - 60, y: zoneCenter.y + 40 },
  { t: a.dropAt - 0.25, x: zoneCenter.x, y: zoneCenter.y + 10 },
  { t: a.dropAt, x: zoneCenter.x, y: zoneCenter.y + 10, click: true },
  { t: a.dropAt + 0.9, x: 1240, y: 640 },
  { t: a.scrollPage - 0.4, x: 980, y: 640 },
  { t: a.scrollList - 0.5, x: 520, y: 700 },
  { t: a.clickF009 - 0.35, x: pos.f009.x + 40, y: pos.f009.y },
  { t: a.clickF009, x: pos.f009.x + 40, y: pos.f009.y, click: true },
  { t: a.listUp, x: 560, y: 640 },
  { t: a.clickF001 - 0.35, x: pos.f001.x + 40, y: pos.f001.y },
  { t: a.clickF001, x: pos.f001.x + 40, y: pos.f001.y, click: true },
  { t: a.scrollDetail - 0.3, x: 1080, y: 560 },
  { t: a.scrollDetail + 66 / FPS, x: 1110, y: 560 },
  { t: a.clickDocument - 0.4, x: pos.doc.x, y: pos.doc.y },
  { t: a.clickDocument, x: pos.doc.x, y: pos.doc.y, click: true },
  { t: a.askIn + 0.2, x: pos.doc.x, y: pos.doc.y },
  { t: a.listenStart + 0.3, x: voiceAsk.x - 40, y: voiceAsk.y + 90 },
  { t: a.wordsEnd, x: voiceAsk.x - 30, y: voiceAsk.y + 84 },
  { t: a.clickAsk - 0.05, x: voiceAsk.x, y: voiceAsk.y },
  { t: a.clickAsk, x: voiceAsk.x, y: voiceAsk.y, click: true },
  { t: a.voiceScroll + 0.6, x: 1400, y: 240 },
  { t: a.reviewer - 0.2, x: 1400, y: 240 },
  { t: a.scrollReviewer - 0.2, x: 1150, y: 560 },
  { t: a.clickConfirmed - 0.4, x: pos.confirmed.x, y: pos.confirmed.y },
  { t: a.clickConfirmed, x: pos.confirmed.x, y: pos.confirmed.y, click: true },
  { t: a.scrollTop + 0.1, x: 1000, y: 420 },
  { t: a.clickMarkdown - 0.3, x: pos.markdown.x, y: pos.markdown.y },
  { t: a.clickMarkdown, x: pos.markdown.x, y: pos.markdown.y, click: true },
  { t: a.appEnd, x: pos.markdown.x + 60, y: pos.markdown.y + 120 },
];

/** Which real capture is on screen at app time t (with an optional crossfade from the previous one). */
function screenAt(t: number): { file: string; previous?: string; mix?: number } {
  if (t < dragHover) return { file: shots.home.file };
  if (t < a.dropAt) return { file: shots.dragover.file };
  if (t < a.processingEnd) {
    const step = (a.processingEnd - a.dropAt) / processingFrames.length;
    return { file: processingFrames[Math.min(processingFrames.length - 1, Math.floor((t - a.dropAt) / step))] };
  }
  if (t < a.pipelineOut - 0.6) return { file: processingFrames[processingFrames.length - 1] };
  if (t < a.scrollPage) return { file: shots.results.file };
  if (t < a.scrollList) return { file: seqFile("scroll-page", t - a.scrollPage) };
  if (t < a.clickF009) return { file: seqFile("scroll-list", t - a.scrollList) };
  if (t < a.listUp) return { file: shots.f009.file };
  if (t < a.clickF001) return { file: seqFile("scroll-list-up", t - a.listUp) };
  if (t < a.scrollDetail) return { file: shots.f001.file };
  if (t < a.clickDocument) return { file: seqFile("scroll-detail", t - a.scrollDetail) };
  if (t < a.askIn) return { file: shots.document.file };
  if (t < a.clickAsk) return { file: voice.base, previous: shots.document.file, mix: interpolate(t, [a.askIn, a.askIn + 0.4], [0, 1], clamp) };
  if (t < a.voiceScroll) return { file: voice.answer };
  if (t < a.scrollReviewer) return { file: seqFile("voice-scroll", t - a.voiceScroll) };
  if (t < a.clickConfirmed) return { file: seqFile("voice-scroll-reviewer", t - a.scrollReviewer) };
  if (t < a.scrollTop) return { file: voice.reviewed };
  if (t < a.clickMarkdown - 0.3) return { file: seqFile("voice-scroll-top", t - a.scrollTop) };
  return { file: voice.export };
}

/** Camera: [time, zoom, focusX, focusY] in viewport coordinates. */
const camera: [number, number, number, number][] = [
  [0, 1, 720, 450],
  [a.dragStart, 1, 720, 450],
  [dragHover, 1.28, zoneCenter.x - 160, zoneCenter.y + 120],
  [a.dropAt + 0.3, 1.3, zoneCenter.x - 120, zoneCenter.y + 100],
  [a.dropAt + 1.0, 1.18, 690, 440],
  [a.pipelineIn + 0.6, 1.0, 720, 450],
  [a.results, 1.0, 720, 450],
  [a.results + 6, 1.06, 820, 470],
  [a.signalsOut, 1.0, 720, 450],
  [a.scrollList - 0.4, 1.0, 720, 450],
  [a.scrollList + 0.4, 1.14, 640, 560],
  [a.clickF009 - 0.2, 1.14, 640, 560],
  [a.clickF009 + 0.8, 1.22, 960, 560],
  [a.listUp, 1.18, 860, 500],
  [a.clickF001 + 0.8, 1.24, 1000, 440],
  [a.scrollDetail, 1.24, 1000, 440],
  [a.scrollDetail + 66 / FPS + 0.3, 1.32, 1060, 520],
  [a.clickDocument - 0.6, 1.3, 1100, 560],
  [a.document + 0.4, 1.62, 680, 420],
  [a.askIn - 0.2, 1.6, 680, 420],
  [a.askIn + 0.8, 1.34, 1050, 790],
  [a.clickAsk, 1.34, 1070, 800],
  [a.voiceScroll + 1.0, 1.2, 1000, 600],
  [a.connect, 1.0, 820, 470],
  [a.reviewer - 0.2, 1.0, 820, 470],
  [a.clickConfirmed, 1.3, 1040, 740],
  [a.scrollTop, 1.2, 1000, 600],
  [a.clickMarkdown - 0.4, 1.12, 1080, 300],
  [a.reportIn, 1.0, 720, 450],
];

function cameraAt(t: number) {
  let i = 0;
  while (i < camera.length - 1 && t > camera[i + 1][0]) i++;
  const k0 = camera[i];
  const k1 = camera[Math.min(i + 1, camera.length - 1)];
  const p = k1[0] === k0[0] ? 1 : ease(Math.max(0, Math.min(1, (t - k0[0]) / (k1[0] - k0[0]))));
  return { z: k0[1] + (k1[1] - k0[1]) * p, fx: k0[2] + (k1[2] - k0[2]) * p, fy: k0[3] + (k1[3] - k0[3]) * p };
}

/** Translate that centres the focus point, clamped so the window never drifts far from the frame edges. */
function cameraTranslate(z: number, fx: number, fy: number) {
  const focus = toStage(fx, fy);
  const axis = (target: number, start: number, size: number, frame: number, gap: number) => {
    const scaled = size * z;
    // Allowed range for the window's leading edge after transform.
    const min = frame - scaled - gap;
    const max = gap;
    const edge = target + start * z;
    if (min > max) return (frame - scaled) / 2 - start * z;
    return Math.max(min, Math.min(max, edge)) - start * z;
  };
  const tx = axis(960 - focus.x * z, WIN_LEFT, VIEW_W * WIN_SCALE, 1920, 260);
  const ty = axis(540 - focus.y * z, WIN_TOP, VIEW_H * WIN_SCALE + CHROME_H, 1080, 150);
  return { tx, ty };
}

/** Findings and the detail panel appear one by one on first view of the results. */
const ResultsReveal: React.FC<{ t: number }> = ({ t }) => {
  const list = manifest.shots.results.list;
  const cards = (manifest.shots.results.findings as { id: string; x: number; y: number; width: number; height: number }[]).filter((card) => card.y < VIEW_H);
  const detail = { x: 690, y: list.y, width: 702, height: VIEW_H - list.y };
  const items = [...cards.map((card, i) => ({ ...card, at: 0.5 + i * 0.32 })), { ...detail, id: "detail", at: 0.95 }];
  const cover = interpolate(t, [2.6, 3.0], [1, 0], clamp);
  return (
    <>
      <div style={{ position: "absolute", left: list.x - 4, top: list.y - 4, width: 1400 - list.x, height: VIEW_H - list.y + 4, background: C.bg, opacity: cover }} />
      {items.map((item) => {
        const p = interpolate(t, [item.at, item.at + 0.55], [0, 1], { ...clamp, easing: easeOut });
        return (
          <div key={item.id} style={{ position: "absolute", left: item.x, top: item.y, width: item.width, height: Math.min(item.height, VIEW_H - item.y), overflow: "hidden", opacity: p * cover, transform: `translateY(${(1 - p) * 18}px)` }}>
            <Img src={staticFile(`capture/${shots.results.file}`)} style={{ position: "absolute", left: -item.x, top: -item.y, width: VIEW_W, height: VIEW_H }} />
          </div>
        );
      })}
    </>
  );
};

const FileChip: React.FC<{ opacity: number; scale: number }> = ({ opacity, scale }) => (
  <div
    style={{
      position: "absolute",
      left: 14,
      top: 20,
      opacity,
      transform: `scale(${scale}) rotate(-3deg)`,
      transformOrigin: "0 0",
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 16px 10px 12px",
      background: "#fffdf7",
      border: `1px solid ${C.accent}66`,
      borderRadius: 10,
      boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
      fontFamily: SANS,
      fontSize: 15,
      color: C.ink,
      whiteSpace: "nowrap",
    }}
  >
    <svg width="26" height="30" viewBox="0 0 26 30">
      <path d="M4 1h12l8 8v18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="#fbe9e4" stroke={C.danger} strokeWidth="1.5" />
      <text x="5" y="23" fontSize="7.5" fontFamily="Inter" fontWeight="700" fill={C.danger}>PDF</text>
    </svg>
    <div>
      <div style={{ fontWeight: 600 }}>claimcheck-demo-paper.pdf</div>
      <div style={{ fontSize: 12, color: C.muted }}>9.5 KB · 3 pages</div>
    </div>
  </div>
);

const Chapter: React.FC<{ t: number }> = ({ t }) => {
  const chapters: [number, string, string][] = [
    [0.3, "01", "Upload"],
    [a.results, "02", "Audit"],
    [a.inspect, "03", "Inspect"],
    [a.askIn, "04", "Review"],
    [a.exportIn, "05", "Export"],
  ];
  const current = [...chapters].reverse().find(([start]) => t >= start);
  if (!current) return null;
  const p = interpolate(t - current[0], [0, 0.6], [0, 1], { ...clamp, easing: easeOut });
  return (
    <div style={{ position: "absolute", left: 44, top: 26, padding: "10px 20px 12px", borderRadius: 12, background: "rgba(8,17,14,0.72)", border: "1px solid rgba(217,196,154,0.18)", display: "flex", alignItems: "baseline", gap: 14, opacity: p * 0.95, transform: `translateX(${(1 - p) * -16}px)` }}>
      <span style={{ fontFamily: MONO, fontSize: 16, color: C.gold, letterSpacing: 2 }}>{current[1]}</span>
      <span style={{ fontFamily: SERIF, fontSize: 30, color: C.ivory, letterSpacing: -0.3 }}>{current[2]}</span>
    </div>
  );
};

export const AppScene: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const screen = screenAt(t);
  const cam = cameraAt(t);
  const { tx, ty } = cameraTranslate(cam.z, cam.fx, cam.fy);
  const enterP = interpolate(t, [0, 1.6], [0, 1], { ...clamp, easing: easeOut });
  const pipeline = interpolate(t, [a.pipelineIn, a.pipelineIn + 0.5, a.pipelineOut - 0.4, a.pipelineOut], [0, 1, 1, 0], clamp);
  const signals = interpolate(t, [a.signalsIn, a.signalsIn + 0.5, a.signalsOut - 0.35, a.signalsOut], [0, 1, 1, 0], clamp);
  const reportP = interpolate(t, [a.reportIn - 0.2, a.reportIn + 0.6], [0, 1], clamp);
  const dim = Math.max(pipeline, signals, reportP);
  const cursor = cursorAt(t, cursorKeys);
  const cursorOpacity = interpolate(t, [a.dragStart - 0.2, a.dragStart + 0.2], [0, 1], clamp) * (1 - Math.max(pipeline, signals, reportP));
  const carrying = t < a.dropAt + 0.25 ? <FileChip opacity={interpolate(t, [a.dropAt, a.dropAt + 0.25], [1, 0], clamp)} scale={interpolate(t, [a.dropAt - 0.2, a.dropAt + 0.25], [1, 0.6], clamp)} /> : null;
  const url = t < a.dropAt + 0.2 ? "127.0.0.1:8787" : `127.0.0.1:8787${manifest.auditPath}`;
  const download = {
    visible: interpolate(t, [a.clickMarkdown + 0.1, a.clickMarkdown + 0.4], [0, 1], clamp),
    progress: interpolate(t, [a.clickMarkdown + 0.2, a.clickMarkdown + 0.9], [0, 1], { ...clamp, easing: ease }),
    name: manifest.report?.file.replace("download/", "") ?? "",
    size: `${Math.round((manifest.report?.bytes ?? 0) / 1024)} KB`,
  };
  const flag = interpolate(t, [a.flagCaption, a.flagCaption + 0.6, a.exportIn - 0.3, a.exportIn], [0, 1, 1, 0], clamp);

  return (
    <AbsoluteFill>
      <Stage />
      <AbsoluteFill
        style={{
          transformOrigin: "0 0",
          transform: `translate(${tx}px, ${ty}px) scale(${cam.z})`,
        }}
      >
        <AbsoluteFill
          style={{
            opacity: enterP,
            transform: `perspective(2200px) translateY(${(1 - enterP) * 140}px) rotateX(${(1 - enterP) * 16}deg) scale(${0.8 + enterP * 0.2})`,
            filter: dim > 0 ? `blur(${dim * 7}px) brightness(${1 - dim * 0.45})` : undefined,
          }}
        >
          <BrowserWindow url={url} download={download}>
            {screen.previous ? <Shot file={screen.previous} /> : null}
            <Shot file={screen.file} style={{ opacity: screen.mix ?? 1 }} />
            {t >= a.results - 0.6 && t < a.scrollPage ? <ResultsReveal t={t - a.results} /> : null}
            {t > a.dragStart - 0.2 && t < a.dropAt + 0.5 && t >= dragHover - 0.1 ? (
              <div style={{ position: "absolute", left: zone.x - 6, top: zone.y - 6, width: zone.width + 12, height: zone.height + 12, borderRadius: 18, boxShadow: `0 0 0 3px ${C.accent}55`, opacity: interpolate(t, [dragHover, dragHover + 0.3, a.dropAt, a.dropAt + 0.4], [0, 1, 1, 0], clamp) }} />
            ) : null}
            {t >= a.askIn && t < a.scrollReviewer + 0.4 ? <VoiceLayer t={t} /> : null}
            <Cursor x={cursor.x} y={cursor.y} since={cursor.since} carrying={carrying} opacity={cursorOpacity} />
          </BrowserWindow>
        </AbsoluteFill>
      </AbsoluteFill>
      {pipeline > 0 ? (
        <AbsoluteFill style={{ opacity: pipeline }}>
          <PipelineOverlay t={t - a.pipelineIn} />
        </AbsoluteFill>
      ) : null}
      {signals > 0 ? (
        <AbsoluteFill style={{ opacity: signals }}>
          <SignalsOverlay t={t - a.signalsIn} />
        </AbsoluteFill>
      ) : null}
      {reportP > 0 ? (
        <AbsoluteFill style={{ opacity: reportP }}>
          <ReportOverlay t={t - a.reportIn} text={report.text} />
        </AbsoluteFill>
      ) : null}
      {flag > 0 ? (
        <div
          style={{
            position: "absolute",
            right: 70,
            top: 110,
            width: 560,
            padding: "26px 30px",
            borderRadius: 18,
            background: "rgba(10,22,18,0.9)",
            border: "1px solid rgba(217,196,154,0.3)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
            opacity: flag,
            transform: `translateY(${(1 - flag) * 20}px)`,
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: 3, color: C.gold }}>REVIEWER IN CONTROL</div>
          <div style={{ fontFamily: SERIF, fontSize: 36, lineHeight: 1.18, color: C.ivory, marginTop: 12 }}>A flag is a prompt for review, not proof that a claim is false.</div>
        </div>
      ) : null}
      <Chapter t={t} />
      <IllustrationBadge t={t} />
    </AbsoluteFill>
  );
};
