/**
 * Captures the real ClaimCheck answer to the spoken question used in the
 * animated voice-input scene. Opens the audit recorded by capture.mjs, asks
 * the question through the real input and Ask button, and saves screenshots,
 * element rectangles, and the answer text into manifest.voice.
 *
 *   node scripts/capture-voice.mjs [baseUrl]
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:8801";
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "capture");
const MANIFEST = path.join(OUT, "manifest.json");
const CHROME = path.join(ROOT, "node_modules", ".remotion", "chrome-headless-shell", "win64", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
export const QUESTION =
  "What evidence supports this finding? Show me the relevant passage and page number, and explain whether further review is needed.";

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: manifest.viewport });
const page = await browser.newPage();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rect = (fnSource) =>
  page.evaluate((src) => {
    const el = new Function(`return (${src})`)()();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }, fnSource);
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 90 });
  console.log(`shot ${name}`);
  return `${name}.jpg`;
};

await page.goto(`${BASE}${manifest.auditPath}`, { waitUntil: "networkidle0" });
await page.waitForFunction(() => /AUDIT SUMMARY/i.test(document.body.innerText));
await page.evaluateHandle("document.fonts.ready");
await sleep(500);
// Same framing as the main capture: page scrolled so the list and detail panel fill the view.
await page.evaluate(() => window.scrollTo(0, 330));
await page.evaluate(() => {
  const panel = document.querySelector(".detail-panel");
  const ask = [...panel.querySelectorAll("button")].find((b) => b.innerText.trim().startsWith("Ask about this finding"));
  panel.scrollTop += ask.getBoundingClientRect().top - panel.getBoundingClientRect().top - 140;
});
await sleep(300);
await page.evaluate(() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim().startsWith("Ask about this finding")).click());
await sleep(400);

const input = `() => document.querySelector("input[placeholder^='e.g. Why is this']")`;
const voice = {
  question: QUESTION,
  selectedFinding: await page.evaluate(() => (document.querySelector(".detail-panel").innerText.match(/Reported accuracy differs across sections/) ? "F-001" : null)),
  base: await shot("voice-base"),
  input: await rect(input),
  ask: await rect(`() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "Ask")`),
  finding: await rect(`() => [...document.querySelectorAll(".findings-list > *")].find((el) => el.innerText.includes("F-001"))`),
};

// Real input events, then the real Ask button.
await page.focus("input[placeholder^='e.g. Why is this']");
await page.keyboard.type(QUESTION);
voice.typed = await shot("voice-typed");
await page.evaluate(() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "Ask").click());
await sleep(500);
voice.answer = await shot("voice-answer");

// Scroll the panel so the whole answer is in view, as a user would.
const answerBox = () =>
  [...document.querySelectorAll(".detail-panel *")].find((el) => /assembled from the finding's audit record/i.test(el.innerText ?? "") && el.children.length > 1 && el.innerText.length < 1600);
voice.answerText = await page.evaluate((src) => new Function(`return (${src})`)()()?.innerText ?? null, answerBox.toString());
const from = await page.evaluate(() => document.querySelector(".detail-panel").scrollTop);
const delta = await page.evaluate((src) => {
  const box = new Function(`return (${src})`)()();
  const panel = document.querySelector(".detail-panel");
  return Math.max(0, Math.round(box.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom + 40));
}, answerBox.toString());
const files = [];
for (let i = 0; i < 30; i++) {
  const t = i / 29;
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  await page.evaluate((v) => (document.querySelector(".detail-panel").scrollTop = v), from + delta * e);
  const file = `voice-scroll-${String(i).padStart(3, "0")}.jpg`;
  await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 88 });
  files.push(file);
}
manifest.sequences["voice-scroll"] = { frames: files.length, files };
voice.answerBoxEnd = await rect(answerBox.toString());
voice.findingEnd = await rect(`() => [...document.querySelectorAll(".findings-list > *")].find((el) => el.innerText.includes("F-001"))`);
voice.inputEnd = await rect(input);

// Continue the same session so later scenes show this question, not an earlier one:
// scroll to the reviewer workspace, record a decision, return to the top for export.
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
async function sequence(name, frames, apply) {
  const list = [];
  for (let i = 0; i < frames; i++) {
    await page.evaluate(apply, ease(i / (frames - 1)));
    const file = `${name}-${String(i).padStart(3, "0")}.jpg`;
    await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 88 });
    list.push(file);
  }
  manifest.sequences[name] = { frames: list.length, files: list };
}
const reviewer = await page.evaluate(() => {
  const panel = document.querySelector(".detail-panel");
  const confirmed = [...panel.querySelectorAll("button")].find((b) => b.innerText.trim() === "Confirmed issue");
  return { from: panel.scrollTop, to: Math.min(panel.scrollTop + confirmed.getBoundingClientRect().top - panel.getBoundingClientRect().top - 300, panel.scrollHeight - panel.clientHeight) };
});
await sequence("voice-scroll-reviewer", 40, new Function("e", `document.querySelector(".detail-panel").scrollTop = ${reviewer.from} + ${reviewer.to - reviewer.from} * e;`));
voice.confirmed = await rect(`() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "Confirmed issue")`);
await page.evaluate(() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "Confirmed issue").click());
await sleep(500);
voice.reviewed = await shot("voice-reviewed");
const top = await page.evaluate(() => window.scrollY);
await sequence("voice-scroll-top", 24, new Function("e", `window.scrollTo(0, ${top} * (1 - e));`));
voice.markdown = await rect(`() => [...document.querySelectorAll("a")].find((link) => /report\\.md/.test(link.href))`);
voice.export = await shot("voice-export");
manifest.voice = voice;
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ ...voice, answerText: voice.answerText?.slice(0, 600) }, null, 2));
await browser.close();
