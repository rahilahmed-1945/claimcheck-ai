/**
 * Table-cell evidence for claims without a named metric.
 *
 * Valid links: the claim identifies the row (label or abbreviation) and states
 * a specific value that appears in exactly one cell of the referenced rows,
 * with any bound symbol agreeing with the column header.
 *
 * Misleading links that must be rejected: a matching number with no row
 * reference, low-information values ("0.30"), a symbol naming a different
 * column, values that occur in several referenced rows, a different named
 * table, and unreliable tables.
 */
import assert from "node:assert/strict";
import test from "node:test";
import PDFDocument from "pdfkit";
import type { ParsedTable } from "../server/src/pdf/extract.js";
import { claimMentionsRow, matchTableCells, specificNumbers, symbolMatchesHeader } from "../server/src/audit/tables.js";
import { extractPdf } from "../server/src/pdf/extract.js";
import { runAudit } from "../server/src/audit/engine.js";

const HEADER = ["Site", "w i", "Cost", "r i 0", "r i T", "Adopt"];
const ROWS = [
  ["COA", ".30", ".142", ".726", ".681", "yes"],
  ["SOU", ".90", ".364", ".213", ".297", "no"],
  ["NOR", ".20", ".117", ".903", ".846", "yes"],
  ["HIG", ".40", ".186", ".641", ".612", "yes"],
  ["VAL", ".70", ".347", ".418", ".455", "no"],
  ["DLT", ".40", ".204", ".641", ".633", "yes"],
];

function table(overrides: Partial<ParsedTable["info"]> = {}): ParsedTable {
  const cells = [HEADER, ...ROWS];
  return {
    info: {
      id: "table-5-2-0",
      label: "2",
      caption: "Table 2: Site parameters and adoption trace.",
      page: 5,
      sectionTitle: "Field Scenario",
      header: HEADER,
      rows: cells,
      reliable: true,
      ...overrides,
    },
    rowQuotes: cells.map((row) => row.join(" ")),
    cells,
  };
}

const supported = (claim: string, tables = [table()]) =>
  matchTableCells(claim, tables).supports.map((match) => `${match.rowLabel}/${match.header}=${match.cellText}`);

test("links a specific value to the row the claim names", () => {
  assert.deepEqual(supported("The northern site is strongly in favour (r0 = 0.903)."), ["NOR/r i 0=.903"]);
  assert.deepEqual(supported("For the southern site the cost is 0.364, mostly labour."), ["SOU/Cost=.364"]);
  assert.deepEqual(
    supported("The southern and valley sites are opposed (0.213, 0.418)."),
    ["SOU/r i 0=.213", "VAL/r i 0=.418"],
  );
  // Exact row labels work as well as abbreviations.
  assert.deepEqual(supported("VAL starts at 0.418 before the first season."), ["VAL/r i 0=.418"]);
});

test("accepts a two-significant-digit value only when a symbol confirms the column", () => {
  const custom = table({ header: ["Site", "w i", "Cost", "r i 0", "r i T", "Adopt"] });
  custom.cells = [HEADER, ["NOR", ".20", ".117", ".25", ".846", "yes"]];
  assert.deepEqual(supported("The northern site starts at r0 = 0.25.", [custom]), ["NOR/r i 0=.25"]);
  assert.deepEqual(supported("The northern site starts at 0.25.", [custom]), []);
});

test("rejects a matching number when the claim names no row", () => {
  assert.deepEqual(supported("Overall adoption reached 0.903 after the second season."), []);
  assert.deepEqual(supported("The cost term equals 0.364 in this setting."), []);
});

test("rejects low-information values even when the row is named", () => {
  // ".30" (COA, w i) is a one-significant-digit value; parameter tables are full of them.
  assert.deepEqual(supported("The coastal site has a water weight of 0.30."), []);
  // "12" has two significant digits, so it stays a candidate that still needs a confirmed column.
  assert.deepEqual(specificNumbers("water weights 0.30–0.50 and 12 seasons").map((number) => number.text), ["12"]);
});

test("rejects a cell whose column contradicts the symbol bound to the number", () => {
  // 0.903 is NOR's r⁰, not rᵀ. Row and column are both explicit and the table
  // reports .846 for rᵀ, so this is a conflict, never support.
  const result = matchTableCells("The northern site ends at rT = 0.903.", [table()]);
  assert.deepEqual(result.supports, []);
  assert.deepEqual(result.conflicts.map((match) => `${match.rowLabel}/${match.header}=${match.cellText}`), ["NOR/r i T=.846"]);
});

test("rejects a value that occurs in more than one referenced row", () => {
  // .641 is HIG's r⁰ and DLT's r⁰ ("delta" does not abbreviate to DLT, so name it directly).
  assert.deepEqual(supported("The HIG and DLT sites both start at 0.641."), []);
  assert.deepEqual(supported("The highland site starts at 0.641."), ["HIG/r i 0=.641"]);
});

test("respects an explicitly named table and skips unreliable tables", () => {
  assert.deepEqual(supported("As Table 3 shows, the northern site is at 0.903."), []);
  assert.deepEqual(supported("As Table 2 shows, the northern site is at 0.903."), ["NOR/r i 0=.903"]);
  assert.deepEqual(supported("The northern site is at 0.903.", [table({ reliable: false })]), []);
});

test("does not report a conflict when the row is ambiguous", () => {
  const result = matchTableCells("The southern and northern sites end at rT = 0.500.", [table()]);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.supports, []);
});

test("row and notation helpers", () => {
  assert.equal(claimMentionsRow("the northern site", "NOR"), true);
  assert.equal(claimMentionsRow("the northern policy", "SOU"), false);
  assert.equal(claimMentionsRow("an EN dash", "EN"), true);
  assert.equal(claimMentionsRow("as in Field Station [1] here", "Field Station [1],[2]"), true);
  assert.equal(symbolMatchesHeader("r0", "r i 0"), true);
  assert.equal(symbolMatchesHeader("rT", "r i 0"), false);
  assert.equal(symbolMatchesHeader("r0", "Cost"), false);
});

// ---------------------------------------------------------------------------
// End to end: extractor + engine on a generated PDF with a gap-separated table
// ---------------------------------------------------------------------------

function scenarioPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 72 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const heading = (title: string) => doc.moveDown(0.6).font("Times-Bold").fontSize(12).text(title, 72).moveDown(0.2);
    const body = (text: string) => doc.font("Times-Roman").fontSize(10.5).text(text, 72);
    doc.font("Times-Bold").fontSize(18).text("Field Sites in a Controlled Irrigation Scenario");
    heading("Abstract");
    body("We describe a field-site model for irrigation scheduling decisions and demonstrate it on one controlled scenario with six sites.");
    heading("1 Introduction");
    body("Irrigation rules are rarely simulated before adoption. This paper specifies sites whose initial adoption follows from their water and cost sensitivity.");
    heading("2 Results");
    body("Table 2 lists the site parameters and the resulting initial adoption for each site.");
    doc.moveDown(0.5);
    doc.font("Times-Bold").fontSize(9.5).text("Table 2: Site parameters and initial adoption.", 72);
    const columns = [72, 160, 250, 340];
    let y = doc.y + 6;
    doc.font("Times-Bold").fontSize(9.5);
    ["Site", "Sensitivity", "Cost", "Adoption"].forEach((cell, index) => doc.text(cell, columns[index]!, y, { lineBreak: false }));
    doc.font("Times-Roman");
    for (const row of [
      ["COA", "0.30", "0.142", "0.726"],
      ["SOU", "0.90", "0.364", "0.213"],
      ["NOR", "0.20", "0.117", "0.903"],
    ]) {
      y += 14;
      row.forEach((cell, index) => doc.text(cell, columns[index]!, y, { lineBreak: false }));
    }
    doc.y = y + 24;
    body("The northern site is strongly in favour with an initial adoption of 0.903, while the southern site is opposed.");
    body("Overall uptake in the comparison run reached 0.903 after the second season.");
    heading("3 Conclusion");
    body("The scenario demonstrates feasibility and traceability. Whether the framework improves real decisions remains to be established.");
    doc.end();
  });
}

test("end to end: a restated table value is supported by the table row, a coincidental one is not", async () => {
  const extracted = await extractPdf(await scenarioPdf());
  const table2 = extracted.tables.find((candidate) => candidate.label === "2");
  assert.ok(table2?.reliable, `Table 2 should be reliable: ${table2?.reason ?? "missing"}`);

  const audit = runAudit(extracted, Date.now());
  const linked = audit.findings.find((finding) => finding.claim.text.startsWith("The northern site is strongly in favour"));
  assert.ok(linked, `restating sentence should be audited; got ${audit.findings.map((f) => f.claim.text.slice(0, 40)).join(" | ")}`);
  assert.equal(linked.category, "supported");
  const ref = linked.evidence.find((evidence) => evidence.relation === "supports");
  assert.equal(ref?.kind, "table_row");
  assert.match(ref?.note ?? "", /row “NOR”, column “Adoption”: 0\.903/);
  assert.ok(ref && ref.offset !== null && extracted.text.slice(ref.offset, ref.offset + ref.quote.length) === ref.quote);
  assert.equal(linked.checks.find((check) => check.id === "table_cell_match")?.outcome, "passed");

  const coincidental = audit.findings.find((finding) => finding.claim.text.startsWith("Overall uptake"));
  if (coincidental) {
    assert.ok(
      !coincidental.evidence.some((evidence) => evidence.kind === "table_row"),
      "a number with no row reference must not cite the table",
    );
    assert.notEqual(coincidental.category, "supported");
  }
});
