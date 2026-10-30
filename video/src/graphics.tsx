import React from "react";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame } from "remotion";
import manifest from "../public/capture/manifest.json";
import { C, MONO, SANS, SERIF } from "./theme";
import { FPS } from "./timeline";
import { clamp, ease, easeOut, Stage } from "./ui";

const audit = manifest.audit;
const finding = (id: string) => audit.findings.find((item) => item.id === id)!;

/** Fade/slide helper: 0→1 over `dur` seconds starting at `at`. */
const enter = (t: number, at: number, dur = 0.6) => interpolate(t, [at, at + dur], [0, 1], { ...clamp, easing: easeOut });

// --- Logo mark (the application's own mark: document with a check) ----------
export const LogoMark: React.FC<{ size: number; draw?: number }> = ({ size, draw = 1 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <defs>
      <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1d7a69" />
        <stop offset="1" stopColor="#0d4c41" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#mark)" />
    <rect x="2.5" y="2.5" width="59" height="59" rx="14.5" fill="none" stroke="rgba(255,255,255,0.18)" />
    <path
      d="M22 15h14l9 9v23a3 3 0 0 1-3 3H22a3 3 0 0 1-3-3V18a3 3 0 0 1 3-3z M36 15v9h9"
      fill="none"
      stroke="#f4f1e9"
      strokeWidth="3"
      strokeLinejoin="round"
      strokeDasharray="140"
      strokeDashoffset={140 * (1 - draw)}
    />
    <path d="M25.5 35.5l5 5 9-10" fill="none" stroke="#f4f1e9" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" strokeDashoffset={30 * (1 - Math.max(0, draw * 2 - 1))} />
  </svg>
);

// --- Scene 1: the problem --------------------------------------------------------
const PAPER_LINES: { text?: string; tag?: string; color?: string; w?: number }[] = [
  { w: 0.92 }, { w: 0.86 },
  { text: "ARC achieves 98.2% accuracy and a macro-F1 of 0.89.", tag: "CLAIM", color: C.gold },
  { w: 0.9 }, { w: 0.7 },
  { text: "a statistically significant improvement over both baselines", tag: "STATISTIC", color: "#c98d74" },
  { w: 0.94 }, { w: 0.82 },
  { text: "As shown in Table 4, inference latency remains below 20 ms", tag: "REFERENCE", color: "#8fb3c9" },
  { w: 0.88 }, { w: 0.6 },
];

export const ProblemScene: React.FC<{ secondLineAt: number }> = ({ secondLineAt }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const paperIn = enter(t, 0.1, 1.2);
  const camera = interpolate(t, [0, 12], [1.04, 1.0], clamp);
  const question = enter(t, secondLineAt + 0.4, 0.8);
  const scan = interpolate(t, [secondLineAt + 0.6, secondLineAt + 4.6], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill>
      <Stage />
      <AbsoluteFill style={{ transform: `scale(${camera})` }}>
        {/* Paper */}
        <div
          style={{
            position: "absolute",
            left: 190,
            top: 120,
            width: 720,
            height: 860,
            borderRadius: 10,
            background: "linear-gradient(180deg, #f7f3ea, #ece6d8)",
            boxShadow: "0 50px 120px rgba(0,0,0,0.6)",
            transform: `perspective(1600px) rotateY(${12 - paperIn * 6}deg) rotateX(${4 - paperIn * 2}deg) translateY(${(1 - paperIn) * 60}px)`,
            opacity: paperIn,
            padding: "64px 64px",
            fontFamily: SERIF,
            color: C.ink,
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>Adaptive Retrieval for Low-Resource Clinical Text Classification</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.muted, marginTop: 14, letterSpacing: 2 }}>SYNTHETIC TEST PAPER · CLAIMCHECK SAMPLE</div>
          <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 16 }}>
            {PAPER_LINES.map((line, index) => {
              if (!line.text) {
                return <div key={index} style={{ height: 11, width: `${(line.w ?? 1) * 100}%`, borderRadius: 6, background: "rgba(28,37,33,0.13)" }} />;
              }
              const tagIndex = PAPER_LINES.filter((l) => l.text).indexOf(line);
              const lit = enter(t, 1.2 + tagIndex * 0.9, 0.5);
              return (
                <div key={index} style={{ position: "relative", fontFamily: SANS, fontSize: 21, lineHeight: 1.35 }}>
                  <span style={{ background: `linear-gradient(90deg, ${line.color}55 ${lit * 100}%, transparent ${lit * 100}%)`, padding: "2px 4px", borderRadius: 4 }}>{line.text}</span>
                  <div
                    style={{
                      position: "absolute",
                      right: -190,
                      top: 2,
                      fontFamily: MONO,
                      fontSize: 15,
                      letterSpacing: 2,
                      color: line.color,
                      opacity: lit,
                      transform: `translateX(${(1 - lit) * -20}px)`,
                    }}
                  >
                    ── {line.tag}
                  </div>
                </div>
              );
            })}
            {/* Real Table 2 from the sample paper. */}
            <div style={{ marginTop: 6, opacity: enter(t, 3.9, 0.5) }}>
              <div style={{ fontFamily: SANS, fontSize: 15, color: C.muted, marginBottom: 6 }}>{audit.extraction.tables[0].caption}</div>
              <div style={{ border: "1px solid rgba(28,37,33,0.25)", borderRadius: 6, overflow: "hidden", fontFamily: MONO, fontSize: 16 }}>
                {audit.extraction.tables[0].rows.map((row, r) => (
                  <div key={r} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", padding: "6px 12px", background: r === 0 ? "rgba(28,37,33,0.08)" : r === 1 ? `${C.gold}40` : "transparent", borderTop: r ? "1px solid rgba(28,37,33,0.12)" : "none" }}>
                    {row.map((cell, c) => (
                      <span key={c}>{cell}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ position: "absolute", left: 742, top: 712, fontFamily: MONO, fontSize: 15, letterSpacing: 2, color: C.gold, opacity: enter(t, 3.9, 0.5) }}>── TABLE</div>
          {/* Reviewer's scan line moving down the page, slowly. */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 60 + scan * 720, height: 2, background: `linear-gradient(90deg, transparent, ${C.accent}, transparent)`, opacity: question * (1 - scan * 0.6) }} />
        </div>
        {/* Right column text */}
        <div style={{ position: "absolute", left: 1150, top: 300, width: 640, color: C.ivory }}>
          <div style={{ fontFamily: MONO, fontSize: 16, letterSpacing: 4, color: C.gold, opacity: enter(t, 0.6) }}>THE REVIEW PROBLEM</div>
          <div style={{ fontFamily: SERIF, fontSize: 66, lineHeight: 1.05, marginTop: 22, letterSpacing: -1 }}>
            {["Claims.", "Statistics.", "Tables.", "References."].map((word, i) => (
              <div key={word} style={{ opacity: enter(t, 0.8 + i * 0.6), transform: `translateY(${(1 - enter(t, 0.8 + i * 0.6)) * 24}px)` }}>
                {word}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 40, fontFamily: SERIF, fontStyle: "italic", fontSize: 40, lineHeight: 1.2, color: "#d8d1c0", opacity: question, transform: `translateY(${(1 - question) * 20}px)` }}>
            Does the paper's own evidence actually support them?
          </div>
          <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 14, opacity: enter(t, secondLineAt + 2.2) }}>
            <div style={{ width: 220, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
              <div style={{ width: `${scan * 38}%`, height: "100%", background: C.gold }} />
            </div>
            <span style={{ fontFamily: MONO, fontSize: 15, color: "#b9b3a4", letterSpacing: 1 }}>checking by hand, line by line</span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// --- Scene 2: reveal ---------------------------------------------------------------
export const RevealScene: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const markIn = enter(t, 0.15, 1.1);
  const draw = interpolate(t, [0.3, 1.6], [0, 1], { ...clamp, easing: ease });
  const title = "ClaimCheck AI";
  const tagline = enter(t, 1.9, 0.9);
  const rule = interpolate(t, [2.2, 3.4], [0, 1], { ...clamp, easing: ease });
  const sweep = interpolate(t, [0.6, 2.6], [-0.3, 1.3], clamp);
  return (
    <AbsoluteFill>
      <Stage hue="warm" />
      <AbsoluteFill style={{ background: `radial-gradient(700px 380px at 50% 46%, rgba(29,122,105,${0.22 * markIn}), transparent 70%)` }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${interpolate(t, [0, 8], [1.03, 1], clamp)})` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34, marginTop: -60 }}>
          <div style={{ opacity: markIn, transform: `scale(${0.7 + markIn * 0.3})`, filter: `blur(${(1 - markIn) * 8}px) drop-shadow(0 20px 40px rgba(0,0,0,0.5))` }}>
            <LogoMark size={150} draw={draw} />
          </div>
          <div style={{ position: "relative", fontFamily: SERIF, fontSize: 132, color: C.ivory, letterSpacing: -2, fontWeight: 500, overflow: "hidden", paddingBottom: 10 }}>
            {title.split("").map((ch, i) => {
              const p = enter(t, 0.55 + i * 0.045, 0.7);
              return (
                <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 50}px)`, whiteSpace: "pre", color: i >= 11 ? C.gold : undefined }}>
                  {ch}
                </span>
              );
            })}
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(100deg, transparent ${sweep * 100 - 12}%, rgba(255,255,255,0.35) ${sweep * 100}%, transparent ${sweep * 100 + 12}%)`, mixBlendMode: "overlay" }} />
          </div>
        </div>
        <div style={{ height: 1, width: 640 * rule, background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)`, marginTop: 26 }} />
        <div style={{ marginTop: 26, fontFamily: SERIF, fontStyle: "italic", fontSize: 50, color: "#e4dccb", opacity: tagline, transform: `translateY(${(1 - tagline) * 16}px)`, letterSpacing: -0.3 }}>
          Research claims deserve evidence.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// --- Glass panel used for overlays over the app ------------------------------------
const Glass: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      background: "linear-gradient(180deg, rgba(14,30,25,0.92), rgba(9,20,17,0.94))",
      border: "1px solid rgba(217,196,154,0.18)",
      borderRadius: 22,
      boxShadow: "0 40px 100px rgba(0,0,0,0.55)",
      color: C.ivory,
      ...style,
    }}
  >
    {children}
  </div>
);

// --- Scene 3b: what the extractor builds (real numbers from this audit) ---------------
export const PipelineOverlay: React.FC<{ t: number }> = ({ t }) => {
  const sections = audit.extraction.sections.filter((s) => s.wordCount > 0 && s.level === 1 && s.canonical !== "front").map((s) => s.title);
  const table = audit.extraction.tables[0];
  const steps = [
    { label: "PDF", value: `${audit.extraction.pageCount} pages`, detail: `${audit.extraction.wordCount} words of selectable text` },
    { label: "STRUCTURE", value: `${audit.extraction.sections.length} sections`, detail: "headings, captions, reading order" },
    { label: "TABLES", value: `Table ${table.label} rebuilt`, detail: `${table.rows.length - 1} rows × ${table.header.length} columns` },
    { label: "CLAIMS", value: `${audit.summary.claimsAudited} to audit`, detail: "sentences with checkable numbers or scope" },
  ];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Glass style={{ width: 1500, padding: "46px 56px 50px" }}>
        <div style={{ fontFamily: MONO, fontSize: 15, letterSpacing: 4, color: C.gold }}>WHAT CLAIMCHECK EXTRACTED FROM THIS PDF</div>
        <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginTop: 34 }}>
          {steps.map((step, i) => {
            const p = enter(t, 0.3 + i * 0.85, 0.7);
            const link = interpolate(t, [0.75 + i * 0.85, 1.25 + i * 0.85], [0, 1], { ...clamp, easing: ease });
            return (
              <React.Fragment key={step.label}>
                <div style={{ flex: 1, opacity: p, transform: `translateY(${(1 - p) * 26}px)` }}>
                  <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: 3, color: "#9fb8ae" }}>{`0${i + 1}  ${step.label}`}</div>
                  <div style={{ fontFamily: SERIF, fontSize: 46, marginTop: 10, letterSpacing: -0.6 }}>{step.value}</div>
                  <div style={{ fontFamily: SANS, fontSize: 18, color: "#b9b3a4", marginTop: 8 }}>{step.detail}</div>
                </div>
                {i < steps.length - 1 ? (
                  <div style={{ width: 70, display: "flex", alignItems: "center" }}>
                    <div style={{ height: 1, width: `${link * 100}%`, background: `linear-gradient(90deg, ${C.gold}, rgba(217,196,154,0.2))` }} />
                  </div>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 28, marginTop: 40 }}>
          <div style={{ flex: 1.2, opacity: enter(t, 1.4) }}>
            <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: 3, color: "#7f948b", marginBottom: 12 }}>SECTIONS FOUND</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {sections.map((title, i) => (
                <span key={title} style={{ fontFamily: SANS, fontSize: 18, padding: "7px 14px", borderRadius: 999, border: "1px solid rgba(159,184,174,0.35)", background: "rgba(29,122,105,0.16)", opacity: enter(t, 1.5 + i * 0.12, 0.4) }}>
                  {title}
                </span>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, opacity: enter(t, 2.2) }}>
            <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: 3, color: "#7f948b", marginBottom: 12 }}>{`TABLE ${table.label} · PAGE ${table.page}`}</div>
            <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(217,196,154,0.25)", fontFamily: MONO, fontSize: 17 }}>
              {table.rows.map((row, r) => (
                <div key={r} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", padding: "8px 14px", background: r === 0 ? "rgba(217,196,154,0.14)" : "transparent", borderTop: r ? "1px solid rgba(217,196,154,0.12)" : "none", opacity: enter(t, 2.3 + r * 0.2, 0.4) }}>
                  {row.map((cell, c) => (
                    <span key={c} style={{ color: r === 0 ? C.gold : C.ivory }}>{cell}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Glass>
    </AbsoluteFill>
  );
};

// --- Scene 4b: three kinds of signal, each a real finding from this audit -------------
export const SignalsOverlay: React.FC<{ t: number }> = ({ t }) => {
  const f4 = finding("F-004");
  const f1 = finding("F-001");
  const f3 = finding("F-003");
  const cards = [
    {
      kind: "MISSING EVIDENCE",
      color: "#d9a54f",
      id: f4.id,
      where: `${f4.claim.sectionTitle} · p. ${f4.claim.page}`,
      quote: f4.claim.text,
      verdict: f4.title,
      icon: (
        <svg width="54" height="54" viewBox="0 0 54 54">
          <rect x="9" y="7" width="36" height="40" rx="5" fill="none" stroke="#d9a54f" strokeWidth="2.4" strokeDasharray="5 5" />
          <path d="M21 22a6 6 0 1 1 8 5.6c-1.4.6-2 1.6-2 3V32" fill="none" stroke="#d9a54f" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="27" cy="38" r="1.7" fill="#d9a54f" />
        </svg>
      ),
    },
    {
      kind: "NUMBERS DISAGREE ACROSS SECTIONS",
      color: "#e07a6a",
      id: f1.id,
      where: "Abstract p. 1  vs  Table 2 p. 2",
      quote: null,
      verdict: f1.title,
      icon: (
        <svg width="54" height="54" viewBox="0 0 54 54">
          <path d="M12 21h30M12 33h30" stroke="#e07a6a" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M33 12L21 42" stroke="#e07a6a" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      kind: "REACHES BEYOND THE EXPERIMENTS",
      color: "#9fbcd6",
      id: f3.id,
      where: `${f3.claim.sectionTitle} · p. ${f3.claim.page}`,
      quote: f3.claim.text,
      verdict: f3.title,
      icon: (
        <svg width="54" height="54" viewBox="0 0 54 54">
          <rect x="8" y="14" width="24" height="26" rx="4" fill="none" stroke="#9fbcd6" strokeWidth="2.4" />
          <path d="M20 27h26M40 21l6 6-6 6" fill="none" stroke="#9fbcd6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 1640 }}>
        <div style={{ fontFamily: MONO, fontSize: 15, letterSpacing: 4, color: C.gold, opacity: enter(t, 0) }}>SIGNALS, NOT VERDICTS · ALL FROM THIS AUDIT</div>
        <div style={{ display: "flex", gap: 26, marginTop: 22 }}>
          {cards.map((card, i) => {
            const p = enter(t, 0.25 + i * 1.7, 0.75);
            const focus = interpolate(t, [0.25 + i * 1.7, 0.6 + i * 1.7, 1.6 + i * 1.7, 2.1 + i * 1.7], [0, 1, 1, 0.55], clamp);
            return (
              <Glass
                key={card.kind}
                style={{
                  flex: 1,
                  padding: "30px 30px 32px",
                  opacity: p,
                  transform: `translateY(${(1 - p) * 40}px) scale(${0.97 + focus * 0.03})`,
                  borderColor: `${card.color}${focus > 0.6 ? "88" : "33"}`,
                  minHeight: 360,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  {card.icon}
                  <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: 2.5, color: card.color, lineHeight: 1.4 }}>{card.kind}</div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 14, color: "#8f9c96", marginTop: 26 }}>{`${card.id} · ${card.where}`}</div>
                {card.quote ? (
                  <div style={{ fontFamily: SERIF, fontSize: 28, lineHeight: 1.3, marginTop: 12, color: "#efe9dc" }}>“{card.quote}”</div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 18 }}>
                    <div>
                      <div style={{ fontFamily: MONO, fontSize: 13, color: "#8f9c96" }}>ABSTRACT</div>
                      <div style={{ fontFamily: SERIF, fontSize: 64, color: "#efe9dc" }}>98.2%</div>
                    </div>
                    <div style={{ fontFamily: SERIF, fontSize: 52, color: card.color, marginTop: 14 }}>≠</div>
                    <div>
                      <div style={{ fontFamily: MONO, fontSize: 13, color: "#8f9c96" }}>TABLE 2</div>
                      <div style={{ fontFamily: SERIF, fontSize: 64, color: card.color }}>94.1%</div>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.1)", fontFamily: SANS, fontSize: 19, color: "#cfc8b8" }}>{card.verdict}</div>
              </Glass>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// --- Scene 7b: the real downloaded report ----------------------------------------------
export const ReportOverlay: React.FC<{ t: number; text: string }> = ({ t, text }) => {
  const p = enter(t, 0, 0.9);
  const lines = text.split("\n").slice(0, 60);
  const scroll = interpolate(t, [1.2, 5.5], [0, 520], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: 1000,
          height: 900,
          marginTop: 40,
          borderRadius: 16,
          background: "#fffdf7",
          boxShadow: "0 50px 120px rgba(0,0,0,0.6)",
          overflow: "hidden",
          opacity: p,
          transform: `perspective(1800px) translateY(${(1 - p) * 120}px) rotateX(${(1 - p) * 10}deg) scale(${0.92 + p * 0.08})`,
          position: "relative",
        }}
      >
        <div style={{ height: 52, display: "flex", alignItems: "center", padding: "0 26px", gap: 12, background: "#f1ede2", borderBottom: "1px solid #ddd6c7", fontFamily: SANS, fontSize: 16, color: C.muted }}>
          <svg width="18" height="20" viewBox="0 0 18 20">
            <path d="M3 1h8l5 5v11a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="none" stroke={C.accent} strokeWidth="1.6" />
          </svg>
          <span style={{ color: C.ink, fontWeight: 500 }}>{manifest.report?.file.replace("download/", "")}</span>
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 13 }}>{`${Math.round((manifest.report?.bytes ?? 0) / 1024)} KB · Markdown`}</span>
        </div>
        <div style={{ position: "absolute", top: 52, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
        <div style={{ padding: "34px 54px", transform: `translateY(${-scroll}px)`, fontFamily: SANS, color: C.ink }}>
          {lines.map((line, i) => {
            const clean = line.replace(/\*\*/g, "");
            if (line.startsWith("# ")) return <div key={i} style={{ fontFamily: SERIF, fontSize: 46, marginBottom: 18, letterSpacing: -0.5 }}>{clean.slice(2)}</div>;
            if (line.startsWith("## ")) return <div key={i} style={{ fontFamily: SERIF, fontSize: 32, margin: "26px 0 10px" }}>{clean.slice(3)}</div>;
            if (line.startsWith("### ")) return <div key={i} style={{ fontFamily: SERIF, fontSize: 26, margin: "20px 0 8px", color: C.danger }}>{clean.slice(4)}</div>;
            if (line.startsWith("|")) {
              if (/^\|\s*-/.test(line)) return null;
              const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 160px", fontFamily: MONO, fontSize: 17, padding: "6px 0", borderBottom: "1px solid #ebe5d8" }}>
                  {cells.map((cell, c) => (
                    <span key={c} style={{ textAlign: c ? "right" : "left" }}>{cell}</span>
                  ))}
                </div>
              );
            }
            if (!line.trim()) return <div key={i} style={{ height: 10 }} />;
            return <div key={i} style={{ fontSize: 19, lineHeight: 1.5, color: line.startsWith("**") ? C.ink : "#3d4642" }}>{clean}</div>;
          })}
        </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// --- Scene 8: close ----------------------------------------------------------------------
export const CloseScene: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const markIn = enter(t, 0.1, 1.0);
  const words = ["Evidence first.", "Uncertainty stated.", "Nothing invented."];
  return (
    <AbsoluteFill>
      <Stage hue="warm" />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", marginTop: -40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 26, opacity: markIn, transform: `scale(${0.94 + markIn * 0.06})` }}>
          <LogoMark size={104} />
          <div style={{ fontFamily: SERIF, fontSize: 96, color: C.ivory, letterSpacing: -1.5, fontWeight: 500 }}>
            ClaimCheck <span style={{ color: C.gold }}>AI</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 30, marginTop: 40, fontFamily: SERIF, fontStyle: "italic", fontSize: 44, color: "#e4dccb" }}>
          {words.map((word, i) => {
            const p = enter(t, 0.9 + i * 0.75, 0.7);
            return (
              <span key={word} style={{ opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
                {word}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 46, fontFamily: MONO, fontSize: 17, letterSpacing: 3, color: "#9fb8ae", opacity: enter(t, 3.4, 0.8) }}>
          TRACEABLE AUDITS FOR RESEARCH PAPERS · UPLOAD · INSPECT · EXPORT
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#000", opacity: interpolate(t, [5.6, 7.2], [0, 1], clamp) }} />
    </AbsoluteFill>
  );
};

export const reportFile = staticFile(`capture/${manifest.report?.file ?? ""}`);
