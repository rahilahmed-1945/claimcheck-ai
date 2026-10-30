/**
 * Stated-change arithmetic, symbol-bound value consistency, and the scope
 * check's own-work gate. These checks are domain-agnostic: they apply to any
 * paper that writes "from A to B (+C)" or "ρ = 0.314", not only ML benchmarks.
 */
import assert from "node:assert/strict";
import test from "node:test";
import PDFDocument from "pdfkit";
import { extractStatedChanges, extractSymbolValues, roundedEqual } from "../server/src/audit/text.js";
import { extractPdf } from "../server/src/pdf/extract.js";
import { runAudit } from "../server/src/audit/engine.js";

test("extractStatedChanges accepts consistent changes within rounding", () => {
  const [change] = extractStatedChanges("Under the revised schedule the index rises from 48.0 to 59.7 (ΔYI = +11.7).");
  assert.ok(change);
  assert.equal(change.consistent, true);
  // 71.24 → 74.46 rounded to one decimal can legitimately be reported as +3.3.
  assert.equal(extractStatedChanges("BLEU improves from 71.2 to 74.5 (+3.2).")[0]?.consistent, true);
});

test("extractStatedChanges flags a change that rounding cannot explain", () => {
  const [change] = extractStatedChanges("BLEU improves from 27.3 to 28.9 (+1.1) over the baseline.");
  assert.ok(change);
  assert.equal(change.consistent, false);
  assert.ok(Math.abs(change.computed - 1.6) < 1e-9);
});

test("extractStatedChanges skips ambiguous relative percentage changes", () => {
  assert.deepEqual(extractStatedChanges("Accuracy rose from 80% to 90% (+12.5%)."), []);
  assert.deepEqual(extractStatedChanges("Adoption increased from 21% to 47%."), []);
});

test("extractSymbolValues reads notation but not prose or tuples", () => {
  const symbols = extractSymbolValues("std(yT) = 0.182 gives ρ = 0.314, and θ = (0.45, 0.20) is a profile.");
  assert.deepEqual(symbols.map((value) => [value.symbol, value.value]), [["std(yT)", 0.182], ["ρ", 0.314]]);
  assert.deepEqual(extractSymbolValues("The gain is 5 and the rate = 3 overall."), []);
  assert.deepEqual(extractSymbolValues("The effect was significant (p = 0.03)."), [], "p-values are left to the statistical check");
  assert.equal(extractSymbolValues("ΔYI is +11.7 under the revised schedule.")[0]?.value, 11.7);
});

test("roundedEqual compares at the precision of the less precise value", () => {
  assert.equal(roundedEqual({ value: 0.314, decimals: 3 }, { value: 0.31, decimals: 2 }), true);
  assert.equal(roundedEqual({ value: 0.314, decimals: 3 }, { value: 0.32, decimals: 2 }), false);
});

function paperPdf(results: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 72 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const heading = (title: string) => doc.moveDown(0.6).font("Times-Bold").fontSize(12).text(title).moveDown(0.2);
    const body = (text: string) => doc.font("Times-Roman").fontSize(10.5).text(text, { align: "left" });
    doc.font("Times-Bold").fontSize(18).text("A Controlled Scenario Study of Irrigation Scheduling Rules");
    heading("Abstract");
    body(
      "We describe a simulation framework for irrigation scheduling rules and demonstrate it on one controlled scenario. The framework is specified formally and its outputs are traceable to their inputs.",
    );
    heading("1 Introduction");
    body(
      "Irrigation scheduling rules are rarely simulated before adoption. This paper specifies a framework in which a schedule is encoded, evaluated by field sites and scored before a decision is taken.",
    );
    heading("2 Methods");
    body(
      "Each schedule is encoded by a water cost k and a risk r. The baseline scenario sets k = 0.55 for the schedule under study. Sites evaluate the schedule with fixed sensitivities.",
    );
    heading("3 Results");
    for (const sentence of results) body(sentence);
    heading("4 Conclusion");
    body("The scenario demonstrates feasibility and traceability. Whether the framework improves real decisions remains to be established.");
    doc.end();
  });
}

test("an inconsistent stated change is a potential contradiction with traceable evidence", async () => {
  const extracted = await extractPdf(
    await paperPdf([
      "Under the revised schedule the yield index rises from 48.0 to 59.7 (+12.7) over eight seasons.",
      "The valley site moves to abstention when the schedule is staggered.",
    ]),
  );
  const audit = runAudit(extracted, Date.now());
  const finding = audit.findings.find((candidate) => candidate.claim.text.includes("rises from 48.0 to 59.7"));
  assert.ok(finding, "stated-change sentence should be audited");
  assert.equal(finding.category, "potential_contradiction");
  assert.equal(finding.checks.find((check) => check.id === "arithmetic_consistency")?.outcome, "flagged");
  const conflict = finding.evidence.find((ref) => ref.relation === "conflicts");
  assert.ok(conflict && conflict.offset !== null);
  assert.equal(extracted.text.slice(conflict.offset, conflict.offset + conflict.quote.length), conflict.quote);
});

test("a symbol reported with a different value elsewhere is never a contradiction", async () => {
  const extracted = await extractPdf(
    await paperPdf([
      "Re-running the scenario with k = 0.35 raises the adoption share to 0.70 and moves the valley site to abstention.",
      "At k = 0.25 the valley site adopts and the adoption share rises to 0.85.",
    ]),
  );
  const audit = runAudit(extracted, Date.now());
  assert.ok(audit.findings.length > 0, "the scenario sentences should be audited");
  for (const finding of audit.findings) {
    assert.notEqual(finding.category, "potential_contradiction", `unexpected contradiction: ${finding.claim.text}`);
  }
});

test("a superlative about something other than the authors' work is not a scope claim", async () => {
  const extracted = await extractPdf(
    await paperPdf([
      "For the southern site the water saving contributes only 0.052 whereas the labour cost contributes 0.171 and the burden 0.364 (0.229 fixed), so a staggered schedule with lower cost is the most effective adjustment.",
    ]),
  );
  const audit = runAudit(extracted, Date.now());
  assert.ok(audit.findings.some((finding) => finding.claim.text.includes("most effective adjustment")), "sentence should be audited");
  for (const finding of audit.findings) {
    assert.ok(!finding.checks.some((check) => check.id === "scope_check"), `scope check ran on: ${finding.claim.text}`);
  }
});
