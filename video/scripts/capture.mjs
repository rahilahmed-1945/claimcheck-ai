/**
 * Captures the REAL ClaimCheck AI interface for the explainer video.
 *
 * Drives a running production instance (default http://127.0.0.1:8801) with
 * headless Chrome. It uploads the actual synthetic sample PDF through the real
 * drop handler, waits for the real audit, scrolls the real results, opens real
 * findings, asks the real Q&A panel, records a reviewer decision, and downloads
 * the real Markdown report.
 *
 * Scrolling and typing are recorded as frame sequences: every frame is a real
 * screenshot taken after the browser applied that scroll position or keystroke,
 * so the video replays genuine rendering, not a pan over a still image. The
 * cursor is drawn later in the video; its targets are the element rectangles
 * recorded here (CSS px, viewport coordinates, 1440×900 viewport).
 *
 *   node scripts/capture.mjs [baseUrl]
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:8801";
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "capture");
const SAMPLE = path.resolve(ROOT, "..", "samples", "claimcheck-demo-paper.pdf");
const CHROME = path.join(ROOT, "node_modules", ".remotion", "chrome-headless-shell", "win64", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

fs.mkdirSync(OUT, { recursive: true });
for (const entry of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, entry), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const manifest = { base: BASE, viewport: VIEWPORT, capturedAt: new Date().toISOString(), shots: {}, sequences: {} };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: VIEWPORT });
const page = await browser.newPage();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Viewport rectangle of the first element matching a predicate source string. */
async function rectOf(fnSource) {
  return page.evaluate((src) => {
    const el = new Function(`return (${src})`)()();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }, fnSource);
}
const button = (label, exact = true) =>
  `() => [...document.querySelectorAll("button, a")].find((b) => ${exact ? `b.innerText.trim() === ${JSON.stringify(label)}` : `b.innerText.trim().startsWith(${JSON.stringify(label)})`})`;
const card = (id) => `() => [...document.querySelectorAll(".findings-list button, .findings-list li, .findings-list article")].find((el) => el.innerText.includes(${JSON.stringify(id)}))`;

async function shot(name, extra = {}) {
  const file = `${name}.jpg`;
  await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 90 });
  manifest.shots[name] = { file, ...extra };
  console.log(`shot ${name}`);
}

/** Record a frame sequence; apply(t) mutates the page for t in [0, 1]. */
async function sequence(name, frames, apply) {
  const files = [];
  for (let i = 0; i < frames; i++) {
    const t = frames === 1 ? 1 : i / (frames - 1);
    await page.evaluate(apply, t);
    const file = `${name}-${String(i).padStart(3, "0")}.jpg`;
    await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 88 });
    files.push(file);
  }
  manifest.sequences[name] = { frames: files.length, files };
  console.log(`sequence ${name}: ${files.length} frames`);
}

// --- Home and drop ---------------------------------------------------------
await page.goto(BASE, { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");
await sleep(400);
await shot("home", { dropzone: await rectOf(`() => document.querySelector(".dropzone")`) });

const pdfBase64 = fs.readFileSync(SAMPLE).toString("base64");
await page.evaluate(() => {
  const zone = document.querySelector(".dropzone");
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(4)], "claimcheck-demo-paper.pdf", { type: "application/pdf" }));
  zone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
  zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await sleep(250);
await shot("dragover", { dropzone: await rectOf(`() => document.querySelector(".dropzone")`) });

await page.evaluate((b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const zone = document.querySelector(".dropzone");
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], "claimcheck-demo-paper.pdf", { type: "application/pdf" }));
  zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
}, pdfBase64);
const processing = [];
for (let i = 0; i < 60; i++) {
  const text = await page.evaluate(() => document.body.innerText);
  if (/AUDIT SUMMARY/i.test(text)) break;
  const file = `processing-${String(i).padStart(2, "0")}.jpg`;
  await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 90 });
  const stage = (text.match(/(Queued|Validating|Extracting text|Mapping structure|Identifying claims|Searching evidence|Building report)\n[^\n]*\n?\s*WORKING/) || [])[1] ?? null;
  processing.push({ file, auditing: /Auditing your paper/.test(text), stage, percent: (text.match(/(\d+)%/) || [])[1] ?? null });
  await sleep(40);
}
manifest.processing = processing;
console.log(`processing frames: ${processing.length}`);

await page.waitForFunction(() => /AUDIT SUMMARY/i.test(document.body.innerText), { timeout: 30000 });
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(700);
manifest.auditPath = await page.evaluate(() => location.pathname);
const findingRects = async () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".findings-list > *")].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: (el.innerText.match(/F-\d{3}/) || [""])[0], x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    }),
  );
await shot("results", { findings: await findingRects(), list: await rectOf(`() => document.querySelector(".findings-list")`) });

// --- Scroll the real results page, then the real findings list -------------
const maxWindow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
const maxList = await page.evaluate(() => document.querySelector(".findings-list").scrollHeight - document.querySelector(".findings-list").clientHeight);
manifest.scroll = { maxWindow, maxList };
await sequence("scroll-page", 36, new Function("t", `window.scrollTo(0, ${maxWindow} * (${ease.toString()})(t));`));
await sequence("scroll-list", 84, new Function("t", `document.querySelector(".findings-list").scrollTop = ${maxList} * (${ease.toString()})(t);`));
manifest.shots["scroll-list-end"] = { findings: await findingRects() };

// Open F-009 (the real "supported" finding) from the bottom of the list.
const f009 = await rectOf(card("F-009"));
await page.evaluate(new Function(`(${card("F-009")})().click()`));
await sleep(500);
await shot("f009", { click: f009 });

// Scroll the list back up and open F-001 (the real potential contradiction).
// Also bring the page back up so the top of the list (F-001) is on screen when clicked.
await sequence("scroll-list-up", 36, new Function("t", `const e = (${ease.toString()})(t); document.querySelector(".findings-list").scrollTop = ${maxList} * (1 - e); window.scrollTo(0, ${maxWindow} - (${maxWindow} - 330) * e);`));
const f001 = await rectOf(card("F-001"));
await page.evaluate(new Function(`(${card("F-001")})().click()`));
await sleep(500);
await shot("f001", { click: f001 });

// Scroll the real detail panel down to the numeric trace and evidence.
const detailTarget = await page.evaluate(() => {
  const panel = document.querySelector(".detail-panel");
  const heading = [...panel.querySelectorAll("*")].find((el) => /^EVIDENCE LOCATED/i.test(el.innerText ?? "") && el.children.length < 4);
  const top = heading.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
  return Math.min(top - 360, panel.scrollHeight - panel.clientHeight);
});
await sequence("scroll-detail", 66, new Function("t", `document.querySelector(".detail-panel").scrollTop = ${detailTarget} * (${ease.toString()})(t);`));
const viewInDocument = await rectOf(`() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "View in document")`);
manifest.shots["scroll-detail-end"] = { viewInDocument, numeric: await rectOf(`() => [...document.querySelectorAll(".detail-panel *")].find((el) => /^NUMERIC TRACE/i.test(el.innerText ?? "") && el.children.length < 4)`) };

// Real "View in document": evidence highlighted in the extracted text.
await page.evaluate(() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "View in document").click());
await sleep(900);
await shot("document", { click: viewInDocument, mark: await rectOf(`() => document.querySelector("mark, .highlight, [data-highlight]")`) });

// Back to the findings tab (F-001 stays selected), then the real Q&A panel.
const findingsTab = await rectOf(`() => [...document.querySelectorAll("button, [role=tab]")].find((b) => /^Findings/.test(b.innerText.trim()))`);
await page.evaluate(() => [...document.querySelectorAll("button, [role=tab]")].find((b) => /^Findings/.test(b.innerText.trim())).click());
await sleep(600);
await page.evaluate(() => {
  const panel = document.querySelector(".detail-panel");
  const ask = [...panel.querySelectorAll("button")].find((b) => b.innerText.trim().startsWith("Ask about this finding"));
  panel.scrollTop += ask.getBoundingClientRect().top - panel.getBoundingClientRect().top - 140;
});
await sleep(300);
const askToggle = await rectOf(`() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim().startsWith("Ask about this finding"))`);
await shot("ask-closed", { findingsTab, click: askToggle });
await page.evaluate(() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim().startsWith("Ask about this finding")).click());
await sleep(400);
const askInput = await rectOf(`() => document.querySelector("input[placeholder^='e.g. Why is this']")`);
await shot("ask-open", { click: askInput });

// Type the question one keystroke per frame (real input events).
const question = "What evidence was found for this finding?";
await page.focus("input[placeholder^='e.g. Why is this']");
const typed = [];
for (let i = 0; i < question.length; i++) {
  await page.keyboard.type(question[i]);
  if (i % 2 === 1 || i === question.length - 1) {
    const file = `type-${String(typed.length).padStart(3, "0")}.jpg`;
    await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 88 });
    typed.push(file);
  }
}
manifest.sequences.type = { frames: typed.length, files: typed };
const askButton = await rectOf(`() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "Ask")`);
await page.evaluate(() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "Ask").click());
await sleep(500);
await shot("answer", { click: askButton });
const answerFrom = await page.evaluate(() => document.querySelector(".detail-panel").scrollTop);
await sequence("scroll-answer", 36, new Function("t", `document.querySelector(".detail-panel").scrollTop = ${answerFrom} + 380 * (${ease.toString()})(t);`));

// Scroll to the real reviewer workspace and record a decision.
const reviewerTarget = await page.evaluate(() => {
  const panel = document.querySelector(".detail-panel");
  const confirmed = [...panel.querySelectorAll("button")].find((b) => b.innerText.trim() === "Confirmed issue");
  return { from: panel.scrollTop, to: Math.min(panel.scrollTop + confirmed.getBoundingClientRect().top - panel.getBoundingClientRect().top - 300, panel.scrollHeight - panel.clientHeight) };
});
await sequence("scroll-reviewer", 40, new Function("t", `document.querySelector(".detail-panel").scrollTop = ${reviewerTarget.from} + (${reviewerTarget.to - reviewerTarget.from}) * (${ease.toString()})(t);`));
const confirmed = await rectOf(`() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "Confirmed issue")`);
await page.evaluate(() => [...document.querySelectorAll(".detail-panel button")].find((b) => b.innerText.trim() === "Confirmed issue").click());
await sleep(500);
await shot("reviewed", { click: confirmed });

// --- Real Markdown export --------------------------------------------------
const downloads = path.join(OUT, "download");
fs.mkdirSync(downloads, { recursive: true });
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
const scrollStart = await page.evaluate(() => window.scrollY);
await sequence("scroll-top", 24, new Function("t", `window.scrollTo(0, ${scrollStart} * (1 - (${ease.toString()})(t)));`));
const markdown = await rectOf(`() => [...document.querySelectorAll("a")].find((link) => /report\\.md/.test(link.href))`);
await shot("export", { click: markdown });
await page.evaluate(() => [...document.querySelectorAll("a")].find((link) => /report\.md/.test(link.href)).click());
for (let i = 0; i < 60 && !fs.readdirSync(downloads).some((f) => f.endsWith(".md")); i++) await sleep(100);
const report = fs.readdirSync(downloads).find((f) => f.endsWith(".md"));
manifest.report = report ? { file: `download/${report}`, bytes: fs.statSync(path.join(downloads, report)).size } : null;
console.log(report ? `downloaded ${report}` : "DOWNLOAD FAILED");

manifest.audit = await page.evaluate(async (p) => (await fetch(`/api${p}`)).json(), manifest.auditPath);
delete manifest.audit.document;
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
await browser.close();
