/**
 * Scene timing, driven by the measured length of each narration line so the
 * picture, captions, and voice stay in sync. All times are in seconds.
 */
import narration from "./narration.json";
import voice from "./voice-durations.json";

export const FPS = 30;
export const f = (seconds: number) => Math.round(seconds * FPS);

const d = voice.durations as Record<string, number>;
export const lineText = Object.fromEntries(narration.map((line) => [line.id, line.text])) as Record<string, string>;

/** Global start time of every narration line. */
export const SCENES = {
  problem: { start: 0, length: 0.6 + d.problem1 + 0.5 + d.problem2 + 0.7 },
  reveal: { start: 0, length: 1.0 + d.reveal + 1.3 },
  app: { start: 0, length: 0 },
  close: { start: 0, length: 0.7 + d.close + 1.8 },
};
SCENES.reveal.start = SCENES.problem.start + SCENES.problem.length;
SCENES.app.start = SCENES.reveal.start + SCENES.reveal.length;

/** App-relative times (seconds from the start of the app segment). */
const a = {} as Record<string, number>;
a.drop = 0.7;
a.dragStart = 1.6;
a.dropAt = Math.max(4.6, a.drop + d.drop - 1.2);
a.processingEnd = a.dropAt + 2.0;
a.pipelineIn = a.processingEnd + 0.1;
a.process = a.pipelineIn + 0.35;
a.pipelineOut = a.process + d.process + 0.8;
a.results = a.pipelineOut + 0.4;
a.signalsIn = a.results + d.results + 0.45;
a.signals = a.signalsIn + 0.25;
a.signalsOut = a.signals + d.signals + 0.6;
// Inspection.
a.inspect = a.signalsOut + 0.3;
a.scroll = a.inspect + 0.3;
a.scrollPage = a.inspect + 0.6; // 36 frames
a.scrollList = a.scrollPage + 36 / FPS + 0.3; // 84 frames
a.clickF009 = Math.max(a.scrollList + 84 / FPS + 1.2, a.scroll + d.scroll + 0.2);
a.supported = a.clickF009 + 0.15;
a.listUp = a.supported + d.supported + 0.35; // 36 frames
a.clickF001 = a.listUp + 36 / FPS + 0.6;
a.contradiction = a.clickF001 + 0.2;
a.scrollDetail = a.contradiction + 2.4; // 66 frames
a.clickDocument = a.contradiction + d.contradiction + 0.3;
a.document = a.clickDocument + 0.25;
// Animated voice-input illustration (Wispr Flow), then the real answer.
a.askIn = a.document + d.document + 0.5;
a.voice1 = a.askIn + 0.3;
a.listenStart = a.askIn + 0.9;
a.wordsStart = a.askIn + 1.2;
a.wordsEnd = a.voice1 + d.voice1 - 0.2;
a.listenEnd = a.wordsEnd + 0.25;
a.clickAsk = a.wordsEnd + 0.55;
a.voice2 = a.clickAsk + 0.3;
a.voiceScroll = a.clickAsk + 0.45; // 30 frames
a.connect = a.voiceScroll + 30 / FPS + 0.2;
a.reviewer = Math.max(a.voice2 + d.voice2 + 0.35, a.connect + 3.2);
a.scrollReviewer = a.reviewer + 0.2; // 40 frames
a.clickConfirmed = a.scrollReviewer + 40 / FPS + 0.8;
a.flagCaption = a.clickConfirmed + 0.4;
a.exportIn = a.reviewer + d.reviewer + 0.7;
a.export = a.exportIn + 0.2;
a.scrollTop = a.exportIn; // 24 frames
a.clickMarkdown = a.scrollTop + 24 / FPS + 0.7;
a.reportIn = a.clickMarkdown + 1.1;
a.appEnd = Math.max(a.export + d.export + 1.4, a.reportIn + 3.4);
export const APP = a;

SCENES.app.length = a.appEnd;
SCENES.close.start = SCENES.app.start + SCENES.app.length;

export const TOTAL_SECONDS = SCENES.close.start + SCENES.close.length;

/** Global start time for each narration line. */
export const LINES: { id: string; start: number; duration: number }[] = [
  { id: "problem1", start: SCENES.problem.start + 0.6 },
  { id: "problem2", start: SCENES.problem.start + 0.6 + d.problem1 + 0.5 },
  { id: "reveal", start: SCENES.reveal.start + 1.0 },
  { id: "drop", start: SCENES.app.start + a.drop },
  { id: "process", start: SCENES.app.start + a.process },
  { id: "results", start: SCENES.app.start + a.results + 0.3 },
  { id: "signals", start: SCENES.app.start + a.signals },
  { id: "scroll", start: SCENES.app.start + a.scroll },
  { id: "supported", start: SCENES.app.start + a.supported },
  { id: "contradiction", start: SCENES.app.start + a.contradiction },
  { id: "document", start: SCENES.app.start + a.document },
  { id: "voice1", start: SCENES.app.start + a.voice1 },
  { id: "voice2", start: SCENES.app.start + a.voice2 },
  { id: "reviewer", start: SCENES.app.start + a.reviewer },
  { id: "export", start: SCENES.app.start + a.export },
  { id: "close", start: SCENES.close.start + 0.7 },
].map((line) => ({ ...line, duration: d[line.id] }));
