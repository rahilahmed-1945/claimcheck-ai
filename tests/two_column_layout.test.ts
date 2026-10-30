/**
 * Regression tests for two-column layout extraction.
 *
 * The fixture is generated deterministically with pdfkit and reproduces the
 * layout defects found while testing two-column papers:
 *  - left and right column lines at the same height were merged into one line;
 *  - a compact table (cell gaps of ~13pt) inside a column was read as prose and
 *    its values bled into neighbouring sentences;
 *  - superscripts in a table header formed fragment lines ("0 T") that became
 *    section headings;
 *  - numbered list items with bold run-in labels became section headings;
 *  - a small-font caption wrapped below its table leaked into the prose;
 *  - a wrapped two-line heading produced a one-word section;
 *  - a right-column author block on page 1 was appended to the abstract.
 *
 * Assertions check structure and provenance, not one paper's audit output.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import PDFDocument from "pdfkit";
import { detectPageLayout, extractPdf, type RawItem } from "../server/src/pdf/extract.js";
import { runAudit } from "../server/src/audit/engine.js";

const LEFT = 72;
const RIGHT = 324;
const COLUMN = 217;

const ABSTRACT_SENTENCE =
  "Seasonal planning methods struggle to anticipate the long-term consequences of irrigation schedule options.";
const INTRO_SENTENCE =
  "Water boards must balance yield, cost and conservation objectives when they evaluate a proposed schedule.";
const RESULTS_SENTENCE =
  "The northern site is strongly in favour of the schedule, while the southern site remains opposed.";
const AFTER_TABLE_SENTENCE =
  "Under the revised schedule the yield index rises from 48.0 to 59.7 (+11.7) over eight seasons.";
const LIST_LABEL = "Intake Layer:";
const CAPTION_TAIL = "adoption decision for each of the six field sites";

const TABLE_ROWS = [
  ["COA", ".30", ".50", ".370", ".726", "yes"],
  ["SOU", ".90", ".30", ".050", ".213", "no"],
  ["NOR", ".20", ".30", ".641", ".903", "yes"],
  ["DLT", ".40", ".50", ".370", ".668", "yes"],
  ["HIG", ".40", ".60", ".330", ".641", "yes"],
  ["VAL", ".70", ".40", ".230", ".418", "no"],
];
const COLUMN_X = [74, 100, 124, 148, 176, 204];

function filler(topic: string, count: number): string {
  const sentences = [
    `The ${topic} is described with explicit parameters so that every later step can be reproduced.`,
    `Each component of the ${topic} is documented in the released prototype and its configuration files.`,
    `Reviewers can trace how the ${topic} transforms its inputs into the reported quantities.`,
    `The ${topic} is evaluated on a controlled scenario rather than on observational data.`,
  ];
  return Array.from({ length: count }, (_, index) => sentences[index % sentences.length]).join(" ");
}

function twoColumnPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    // Page 1: full-width title, author blocks in both columns, abstract left, introduction right.
    doc.addPage();
    doc.font("Times-Bold").fontSize(20).text("A Layered Simulation Framework for Irrigation Scheduling", 72, 60, {
      width: 468,
      align: "center",
    });
    doc.font("Times-Roman").fontSize(9);
    doc.text("First Author, Department of Planning, Example Institute", LEFT, 130, { width: COLUMN });
    doc.text("Second Author, Department of Planning, Example Institute", RIGHT, 130, { width: COLUMN });
    doc.text("Third Author, Department of Hydrology, Example Institute", RIGHT, 160, { width: COLUMN });

    doc.font("Times-Bold").fontSize(11).text("Abstract", LEFT, 220, { lineBreak: false });
    doc.font("Times-Roman").fontSize(10).text(`${ABSTRACT_SENTENCE} ${filler("framework", 6)}`, LEFT, 238, {
      width: COLUMN,
      align: "justify",
    });
    doc.font("Times-Bold").fontSize(11).text("1 Introduction", RIGHT, 216, { lineBreak: false });
    doc.font("Times-Roman").fontSize(10).text(`${INTRO_SENTENCE} ${filler("simulation model", 6)}`, RIGHT, 234, {
      width: COLUMN,
      align: "justify",
    });

    // Page 2: results with a compact table in the left column; list items and conclusion right.
    doc.addPage();
    doc.font("Times-Bold").fontSize(11).text("2 Worked Irrigation Scenario", LEFT, 72, { lineBreak: false });
    doc.font("Times-Roman").fontSize(10).text(`${RESULTS_SENTENCE} ${filler("site model", 2)}`, LEFT, 90, {
      width: COLUMN,
    });

    let y = 210;
    doc.font("Times-Bold").fontSize(7);
    ["Site", "w", "ρ", "Utility", "r", "Adopt"].forEach((cell, index) => {
      doc.text(cell, COLUMN_X[index]!, y, { lineBreak: false });
    });
    // Superscript on the "r" header cell, as in r⁰, raised ~0.4em (typical typesetting).
    doc.fontSize(4.6).text("0", COLUMN_X[4]! + 4.2, y - 1.2, { lineBreak: false });
    doc.font("Times-Roman").fontSize(7);
    for (const row of TABLE_ROWS) {
      y += 11.9;
      row.forEach((cell, index) => doc.text(cell, COLUMN_X[index]!, y, { lineBreak: false }));
    }
    doc.font("Times-Roman").fontSize(8).text(
      `Table 2: Site parameters (water and cost sensitivity), utility, initial adoption and ${CAPTION_TAIL}.`,
      LEFT,
      y + 16,
      { width: COLUMN },
    );
    doc.font("Times-Roman").fontSize(10).text(`${AFTER_TABLE_SENTENCE} ${filler("yield model", 2)}`, LEFT, y + 50, {
      width: COLUMN,
    });

    doc.font("Times-Bold").fontSize(11).text("2.1 Field Site Model and Adoption", RIGHT, 72, { lineBreak: false });
    doc.text("Protocol", RIGHT, 84, { lineBreak: false });
    doc.font("Times-Roman").fontSize(10).text(filler("adoption protocol", 2), RIGHT, 102, { width: COLUMN });

    let listY = 200;
    for (const [number, label, rest] of [
      ["1.", LIST_LABEL, "operators submit schedules, stored with text and metadata."],
      ["2.", "Forecast Layer:", "a model maps the schedule text to yield, cost and risk."],
    ] as const) {
      doc.font("Times-Roman").fontSize(10).text(`${number} `, RIGHT + 18, listY, { continued: true, width: COLUMN - 18 });
      doc.font("Times-Bold").text(`${label} `, { continued: true });
      doc.font("Times-Roman").text(rest);
      listY += 40;
    }

    doc.font("Times-Bold").fontSize(11).text("3 Conclusion", RIGHT, 320, { lineBreak: false });
    doc.font("Times-Roman").fontSize(10).text(
      "Whether the framework improves real decisions remains to be established in a field study.",
      RIGHT,
      338,
      { width: COLUMN },
    );
    doc.end();
  });
}

let cached: Promise<Awaited<ReturnType<typeof extractPdf>>> | null = null;
function extracted() {
  cached ??= twoColumnPdf().then((pdf) => extractPdf(pdf));
  return cached;
}

test("reads each column of a two-column page separately", async () => {
  const doc = await extracted();
  const texts = doc.sentences.map((sentence) => sentence.text);
  assert.ok(texts.includes(ABSTRACT_SENTENCE), `left-column sentence was not kept intact:\n${texts.slice(0, 4).join("\n")}`);
  assert.ok(texts.includes(INTRO_SENTENCE), "right-column sentence was not kept intact");
  assert.ok(texts.includes(RESULTS_SENTENCE), "page-2 left-column sentence was not kept intact");
});

test("assigns column text to the right sections, including the page-1 author block", async () => {
  const doc = await extracted();
  const sectionOf = (text: string) => doc.sentences.find((sentence) => sentence.text === text)?.sectionCanonical;
  assert.equal(sectionOf(ABSTRACT_SENTENCE), "abstract");
  assert.equal(sectionOf(INTRO_SENTENCE), "introduction");
  assert.equal(sectionOf(RESULTS_SENTENCE), "results");
  const abstractText = doc.sentences.filter((sentence) => sentence.sectionCanonical === "abstract").map((s) => s.text).join(" ");
  assert.doesNotMatch(abstractText, /Second Author|Third Author/, "right-column author block leaked into the abstract");
});

test("keeps compact table values out of prose sentences", async () => {
  const doc = await extracted();
  for (const sentence of doc.sentences) {
    assert.doesNotMatch(sentence.text, /\.726|\.903|\.641/, `table values leaked into prose: "${sentence.text}"`);
    assert.doesNotMatch(sentence.text, /\bCOA\b.*\bSOU\b/, `table row labels leaked into prose: "${sentence.text}"`);
  }
});

test("reconstructs a compact table with its header, rows, and page", async () => {
  const doc = await extracted();
  const table = doc.tables.find((candidate) => candidate.label === "2");
  assert.ok(table, `expected Table 2, found ${doc.tables.map((t) => t.label).join(", ") || "none"}`);
  assert.equal(table.page, 2);
  assert.equal(table.reliable, true, table.reason);
  assert.equal(table.header.length, 6, `header: ${table.header.join(" | ")}`);
  assert.equal(table.header[0], "Site");
  assert.match(table.header[4] ?? "", /^r\s?0$/, "superscript should stay in its header cell");
  const northern = table.rows.find((row) => row[0] === "NOR");
  assert.deepEqual(northern, ["NOR", ".20", ".30", ".641", ".903", "yes"]);
  assert.equal(table.rows.length, 1 + TABLE_ROWS.length);
});

test("does not turn superscripts, run-in list labels, or captions into sections", async () => {
  const doc = await extracted();
  const titles = doc.sections.map((section) => section.title);
  assert.ok(!titles.some((title) => /^[\d\sA-Z]{1,4}$/.test(title)), `fragment heading in ${titles.join(" | ")}`);
  assert.ok(!titles.some((title) => title.includes(LIST_LABEL)), `list item became a heading: ${titles.join(" | ")}`);
  assert.ok(!titles.includes("Protocol"), "wrapped heading line became its own section");
  assert.ok(
    titles.includes("2.1 Field Site Model and Adoption Protocol"),
    `wrapped heading was not merged: ${titles.join(" | ")}`,
  );
  assert.ok(
    doc.sentences.some((sentence) => sentence.text.includes("operators submit schedules")),
    "list item text should remain auditable prose",
  );
  assert.ok(!doc.sentences.some((sentence) => sentence.text.includes(CAPTION_TAIL)), "wrapped caption leaked into prose");
  const caption = doc.tables.find((table) => table.label === "2")?.caption ?? "";
  assert.ok(caption.includes(CAPTION_TAIL), `caption continuation was not merged: ${caption}`);
});

test("keeps page provenance for column sentences", async () => {
  const doc = await extracted();
  const page = (text: string) => doc.sentences.find((sentence) => sentence.text === text)?.page;
  assert.equal(page(INTRO_SENTENCE), 1);
  assert.equal(page(RESULTS_SENTENCE), 2);
  for (const sentence of doc.sentences) {
    assert.equal(doc.text.slice(sentence.startOffset, sentence.endOffset), sentence.text, "sentence offsets must map to document text");
  }
});

test("treats a page without a clean gutter as a single column", () => {
  const items: RawItem[] = [];
  for (let line = 0; line < 40; line += 1) {
    // Full-width justified lines cross the page centre.
    items.push({ str: "x".repeat(90), x: 72, y: 700 - line * 12, width: 468, height: 10, fontName: "Times-Roman" });
  }
  assert.equal(detectPageLayout(items, 612).gutter, null);
});

test("checks the arithmetic of an explicitly stated change", async () => {
  const doc = await extracted();
  const audit = runAudit(doc, Date.now());
  const finding = audit.findings.find((candidate) => candidate.claim.text.startsWith("Under the revised schedule"));
  assert.equal(finding?.claim.text, AFTER_TABLE_SENTENCE);
  assert.ok(finding, `expected the stated-change sentence to be audited; got ${audit.findings.map((f) => f.claim.text.slice(0, 40)).join(" | ")}`);
  const check = finding.checks.find((candidate) => candidate.id === "arithmetic_consistency");
  assert.equal(check?.outcome, "passed", check?.detail);
  assert.notEqual(finding.category, "potential_contradiction");
});

// ---------------------------------------------------------------------------
// Optional local regression on a private PDF. Nothing about that document is
// stored here: the test only runs when CLAIMCHECK_REGRESSION_PDF points to a
// file, and it asserts structure, not content.
// ---------------------------------------------------------------------------

const PRIVATE_PDF = process.env.CLAIMCHECK_REGRESSION_PDF;

test("optional private PDF: sections recovered and tables reconstructed consistently", { skip: !(PRIVATE_PDF && fs.existsSync(PRIVATE_PDF)) && "CLAIMCHECK_REGRESSION_PDF not set" }, async () => {
  const doc = await extractPdf(fs.readFileSync(PRIVATE_PDF!));
  for (const table of doc.tables.filter((candidate) => candidate.reliable)) {
    for (const row of table.rows) assert.equal(row.length, table.header.length, `Table ${table.label} row misaligned`);
  }
  const titles = doc.sections.map((section) => section.title);
  assert.ok(!titles.some((title) => /^\d+\.\s/.test(title)), "list item heading");
  assert.ok(!titles.some((title) => !/[A-Za-z]{3,}/.test(title)), "fragment heading");
  for (const canonical of ["abstract", "introduction", "conclusion"]) {
    assert.ok(doc.sections.some((section) => section.canonical === canonical), `missing ${canonical} section`);
  }
  for (const sentence of doc.sentences) {
    assert.equal(doc.text.slice(sentence.startOffset, sentence.endOffset), sentence.text);
  }
});
