/**
 * Real-paper benchmark tooling: schema validation, the paper-level split,
 * matching, and metric arithmetic.
 *
 * The annotation used here is a small hand-written TEST FIXTURE defined in
 * this file to check the arithmetic. It is not a benchmark annotation and its
 * numbers are not real-paper results.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { blindTemplateRows, evaluateSplit } from "../benchmark/cli.js";
import { parseCsv, toCsv } from "../benchmark/lib/csv.js";
import { assignSplit, loadManifest, MANIFEST_SCHEMA, type BenchmarkManifest } from "../benchmark/lib/manifest.js";
import { aggregate, bootstrapByPaper, scorePaper, textOverlap, wilson } from "../benchmark/lib/metrics.js";
import { claimsFromReview, PROPOSAL_SCHEMA, reviewSheetRows, validateProposals } from "../benchmark/lib/review.js";
import {
  ANNOTATION_SCHEMA,
  PREDICTION_SCHEMA,
  SchemaError,
  validateAnnotation,
  type PaperAnnotation,
  type PaperPrediction,
} from "../benchmark/lib/schema.js";
import { extractPdf } from "../server/src/pdf/extract.js";

const SHA = "a".repeat(64);

function annotationFixture(): PaperAnnotation {
  return {
    schema: ANNOTATION_SCHEMA,
    source: "human",
    paperId: "fixture-paper",
    paperSha256: SHA,
    annotators: [{ id: "reviewer-1", kind: "human" }],
    adjudication: { method: "single", date: "2026-10-29" },
    pagesReviewed: [1, 2],
    claims: [
      {
        id: "A",
        text: "The model reaches 91.2% accuracy on the held-out test set.",
        page: 1,
        auditable: true,
        label: "supported",
        evidence: [{ page: 2, quote: "Ours 91.2 88.0", relation: "supports", tableLabel: "1" }],
      },
      {
        id: "B",
        text: "Accuracy rises from 80.0 to 85.0 (+6.0) with the new loss.",
        page: 1,
        auditable: true,
        label: "contradicted",
        issues: ["numerical_inconsistency"],
        evidence: [{ page: 1, quote: "Accuracy rises from 80.0 to 85.0 (+6.0) with the new loss.", relation: "contradicts" }],
      },
      { id: "C", text: "The method generalizes to all clinical domains without retraining.", page: 2, auditable: true, label: "unsupported", issues: ["overreach"] },
      { id: "D", text: "We thank the anonymous reviewers for 3 helpful rounds of comments.", page: 2, auditable: false },
      { id: "E", text: "Latency figures depend on hardware we could not fully control.", page: 2, auditable: true, label: "needs_review" },
    ],
    referenceIssues: [{ kind: "missing_table", label: "4" }],
  };
}

function predictionFixture(): PaperPrediction {
  const claim = (text: string, page: number, label: PaperPrediction["claims"][number]["label"], extra: Partial<PaperPrediction["claims"][number]> = {}) => ({
    findingId: `F-${text.slice(0, 4)}`,
    text,
    page,
    section: "Results",
    category: label,
    label,
    confidence: "moderate",
    flaggedChecks: [],
    evidence: [],
    ...extra,
  });
  return {
    schema: PREDICTION_SCHEMA,
    source: "engine",
    paperId: "fixture-paper",
    paperSha256: SHA,
    engineVersion: "test",
    generatedAt: "2026-10-29T00:00:00Z",
    claims: [
      claim("The model reaches 91.2% accuracy on the held-out test set.", 1, "supported", {
        evidence: [{ page: 2, quote: "Ours 91.2 88.0", relation: "supports", kind: "table_row" }],
      }),
      claim("Accuracy rises from 80.0 to 85.0 (+6.0) with the new loss.", 1, "contradicted", {
        flaggedChecks: ["arithmetic_consistency"],
        evidence: [{ page: 3, quote: "unrelated passage on another page", relation: "conflicts", kind: "sentence" }],
      }),
      claim("We thank the anonymous reviewers for 3 helpful rounds of comments.", 2, "needs_review"),
      claim("Latency figures depend on hardware we could not fully control.", 2, "needs_review"),
      claim("As shown in Table 4, inference is fast.", 2, "unsupported", { flaggedChecks: ["reference_traceability"] }),
      claim("A sentence on page 5, which nobody reviewed.", 5, "supported"),
    ],
  };
}

test("Wilson intervals match known values and handle empty denominators", () => {
  const interval = wilson(8, 10);
  assert.ok(interval.ci95);
  assert.ok(Math.abs(interval.ci95[0] - 0.4902) < 1e-3 && Math.abs(interval.ci95[1] - 0.9433) < 1e-3, JSON.stringify(interval.ci95));
  assert.deepEqual(wilson(0, 0), { value: null, numerator: 0, denominator: 0, ci95: null });
});

test("the paper-level split is deterministic, stable, and about 30% test", () => {
  assert.equal(assignSplit("paper-one"), assignSplit("paper-one"));
  const ids = Array.from({ length: 2000 }, (_, index) => `paper-${index}`);
  const testShare = ids.filter((id) => assignSplit(id) === "test").length / ids.length;
  assert.ok(testShare > 0.27 && testShare < 0.33, `test share ${testShare}`);
});

test("the manifest refuses papers moved between splits and regression cases used as benchmark papers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claimcheck-manifest-"));
  const base = (papers: BenchmarkManifest["papers"]): BenchmarkManifest => ({
    schema: MANIFEST_SCHEMA,
    split: { method: "hash", salt: "claimcheck-benchmark-v1", testFraction: 0.3 },
    papers,
    regressionCases: [{ id: "regression-case", role: "regression-only", description: "", sha256: null, localPathEnv: "X" }],
  });
  const paper = (id: string, split: "dev" | "test") => ({
    id, title: "t", sourceUrl: "https://example.org", license: "CC-BY-4.0", licenseCheckedBy: "r", sha256: SHA, split, pages: 1, addedAt: "2026-10-29",
  });
  const moved = path.join(dir, "moved.json");
  const wrong = assignSplit("paper-x") === "dev" ? "test" : "dev";
  fs.writeFileSync(moved, JSON.stringify(base([paper("paper-x", wrong)])));
  assert.throws(() => loadManifest(moved), /Do not move papers between splits/);
  const overlap = path.join(dir, "overlap.json");
  fs.writeFileSync(overlap, JSON.stringify(base([paper("regression-case", assignSplit("regression-case"))])));
  assert.throws(() => loadManifest(overlap), /must not also be a benchmark paper/);
  // The committed manifest is valid and keeps the private manuscript out of every split.
  const committed = loadManifest();
  assert.ok(committed.regressionCases.some((entry) => entry.id === "private-regression-pdf"));
  assert.ok(!committed.papers.some((entry) => entry.id === "private-regression-pdf"));
});

test("annotations must be human-authored and match the paper hash", () => {
  assert.doesNotThrow(() => validateAnnotation(annotationFixture(), SHA));
  const reject = (mutate: (doc: Record<string, unknown>) => void, pattern: RegExp) => {
    const doc = structuredClone(annotationFixture()) as unknown as Record<string, unknown>;
    mutate(doc);
    assert.throws(() => validateAnnotation(doc, SHA), (error: unknown) => error instanceof SchemaError && pattern.test(error.message));
  };
  reject((doc) => ((doc.annotators as { kind: string }[])[0]!.kind = "model"), /kind must be "human"/);
  reject((doc) => (doc.source = "engine"), /source must be "human"/);
  reject((doc) => ((doc.claims as { label?: string }[])[0]!.label = undefined), /label must be one of/);
  reject((doc) => ((doc.claims as { label?: string }[])[3]!.label = "supported"), /not auditable/);
  reject((doc) => (doc.paperSha256 = "b".repeat(64)), /does not match the manifest/);
  assert.throws(() => validateAnnotation(predictionFixture(), SHA), /predictions can never be used as ground truth/);
});

test("scoring counts detection, false positives, labels, localization, abstention, and issues", () => {
  const counts = scorePaper(annotationFixture(), predictionFixture());
  assert.equal(counts.auditableClaims, 4);
  assert.equal(counts.detected, 3, "A, B and E are detected; C is missed");
  assert.equal(counts.falsePositives, 1, "D is not a claim");
  assert.equal(counts.unannotatedPredictions, 1, "the Table 4 sentence was not annotated");
  assert.equal(counts.outOfScopePredictions, 1, "page 5 was not reviewed");
  assert.equal(counts.exactLabelMatches, 3);
  assert.equal(counts.abstentions, 1);
  assert.deepEqual([counts.localizationCorrect, counts.localizationEvaluated], [1, 2], "B cites the wrong page");
  assert.deepEqual(counts.numeric, { tp: 1, fp: 0, fn: 0 });
  assert.deepEqual(counts.referenceIssues, { tp: 1, fp: 0, fn: 0 });
  assert.deepEqual(counts.perLabel.unsupported, { tp: 0, fp: 0, fn: 1 });

  const metrics = aggregate([counts]);
  assert.equal(metrics.claimDetection.precision.value, 0.75);
  assert.equal(metrics.claimDetection.recall.value, 0.75);
  assert.equal(metrics.claimDetection.f1, 0.75);
  assert.equal(metrics.claimDetection.f1Ci95, null, "one paper is too few for a bootstrap interval");
  assert.equal(metrics.falsePositiveRate.value, 1);
  assert.equal(metrics.decisiveCoverage.value, 0.5);
  assert.equal(metrics.abstentionRate.value, 1 / 3);
  assert.equal(metrics.evidenceLocalization.value, 0.5);
  assert.equal(metrics.citationIssues.scored, false);
});

test("bootstrap intervals are reproducible and need at least five papers", () => {
  const values = [0.2, 0.4, 0.6, 0.8, 1.0];
  const mean = (sample: number[]) => sample.reduce((a, b) => a + b, 0) / sample.length;
  assert.equal(bootstrapByPaper(values.slice(0, 4), mean), null);
  const first = bootstrapByPaper(values, mean);
  assert.deepEqual(first, bootstrapByPaper(values, mean));
  assert.ok(first && first[0] < 0.6 && first[1] > 0.6);
});

test("matching is tolerant to extraction differences but not to different sentences", () => {
  assert.equal(textOverlap("ΔYI rises from 48.0 to 59.7 (ΔYI = +11.7).", "ΔYI rises from 48.0 to 59.7 (ΔYI = +11.7)"), 1);
  assert.ok(textOverlap("The model reaches 91.2% accuracy.", "Training took three days on eight GPUs.") < 0.2);
});

test("CSV export round-trips commas, quotes, newlines, and Unicode", () => {
  const rows = [{ claim_id: "s0001", text: 'He said "r0 = 0.903", then\nstopped, ΔYI −0.13', label: "" }];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test("the evaluator reports awaiting-annotation without labels and refuses predictions as labels", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claimcheck-bench-"));
  const dirs = { annotations: path.join(dir, "annotations"), predictions: path.join(dir, "predictions") };
  fs.mkdirSync(dirs.annotations);
  fs.mkdirSync(dirs.predictions);
  const id = "fixture-paper";
  const manifest: BenchmarkManifest = {
    schema: MANIFEST_SCHEMA,
    split: { method: "hash", salt: "claimcheck-benchmark-v1", testFraction: 0.3 },
    papers: [{ id, title: "t", sourceUrl: "https://example.org", license: "CC-BY-4.0", licenseCheckedBy: "r", sha256: SHA, split: assignSplit(id), pages: 5, addedAt: "2026-10-29" }],
    regressionCases: [],
  };
  const split = manifest.papers[0]!.split;

  const empty = evaluateSplit(split, dirs, manifest);
  assert.equal(empty.status, "awaiting_human_annotation");
  assert.equal(empty.metrics, null);

  fs.writeFileSync(path.join(dirs.annotations, `${id}.json`), JSON.stringify(predictionFixture()));
  assert.throws(() => evaluateSplit(split, dirs, manifest), /predictions can never be used as ground truth/);

  fs.writeFileSync(path.join(dirs.annotations, `${id}.json`), JSON.stringify(annotationFixture()));
  assert.throws(() => evaluateSplit(split, dirs, manifest), /Missing predictions/);
  fs.writeFileSync(path.join(dirs.predictions, `${id}.json`), JSON.stringify(predictionFixture()));
  const scored = evaluateSplit(split, dirs, manifest);
  assert.equal(scored.status, "scored");
  assert.equal(scored.metrics?.claimDetection.recall.value, 0.75);
});

test("the annotation template is blind: sentences and locations only, no engine output", async () => {
  const extracted = await extractPdf(fs.readFileSync(path.join(process.cwd(), "samples", "claimcheck-demo-paper.pdf")));
  const rows = blindTemplateRows(extracted);
  assert.equal(rows.length, extracted.sentences.length);
  for (const row of rows) {
    assert.ok(Number(row.page) >= 1 && row.text);
    for (const field of ["auditable", "label", "issues", "evidence_quote", "evidence_relation"]) assert.equal(row[field], "");
    assert.ok(!("category" in row) && !("confidence" in row), "template must not carry predictions");
  }
});

test("the evaluator flags a split as incomplete and records label provenance", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claimcheck-bench-"));
  const dirs = { annotations: path.join(dir, "annotations"), predictions: path.join(dir, "predictions") };
  fs.mkdirSync(dirs.annotations);
  fs.mkdirSync(dirs.predictions);
  const id = "fixture-paper";
  const split = assignSplit(id);
  // A second paper in the same split that nobody has labelled yet.
  let other = "unlabelled-0";
  for (let i = 1; assignSplit(other) !== split; i++) other = `unlabelled-${i}`;
  const entry = (paperId: string) => ({ id: paperId, title: "t", sourceUrl: "https://example.org", license: "CC-BY-4.0", licenseCheckedBy: "r", sha256: SHA, split, pages: 5, addedAt: "2026-10-30" });
  const manifest: BenchmarkManifest = { schema: MANIFEST_SCHEMA, split: { method: "hash", salt: "claimcheck-benchmark-v1", testFraction: 0.3 }, papers: [entry(id), entry(other)], regressionCases: [] };
  fs.writeFileSync(path.join(dirs.annotations, `${id}.json`), JSON.stringify(annotationFixture()));
  fs.writeFileSync(path.join(dirs.predictions, `${id}.json`), JSON.stringify(predictionFixture()));
  const report = evaluateSplit(split, dirs, manifest);
  assert.equal(report.complete, false);
  assert.match(report.note, /INCOMPLETE/);
  assert.deepEqual(report.labelProvenance, [{ paperId: id, method: "blind", scope: "full_pages" }]);
});

test("AI proposals are never labels until a person approves or amends them", () => {
  const templateIds = new Set(["s0001", "s0002", "s0003", "s0004"]);
  const proposals = {
    schema: PROPOSAL_SCHEMA,
    source: "ai",
    paperId: "fixture-paper",
    paperSha256: SHA,
    generator: { kind: "ai", name: "assistant-model", date: "2026-10-30" },
    items: [
      { claimId: "s0001", auditable: true, label: "supported", evidence: [{ page: 2, quote: "Ours 91.2", relation: "supports" }], rationale: "Table 1 row Ours." },
      { claimId: "s0002", auditable: true, label: "supported", rationale: "Looks consistent." },
      { claimId: "s0003", auditable: false, rationale: "Acknowledgement." },
      { claimId: "s0004", auditable: true, label: "unsupported", rationale: "No evidence found." },
    ],
  };
  assert.ok(validateProposals(proposals, SHA, templateIds));
  // Engine output, human annotations, and ClaimCheck-named generators are refused as proposals.
  assert.throws(() => validateProposals(predictionFixture(), SHA, templateIds), /engine cannot propose its own ground truth/);
  assert.throws(() => validateProposals(annotationFixture(), SHA, templateIds), /not a proposal file/);
  assert.throws(() => validateProposals({ ...proposals, generator: { kind: "ai", name: "ClaimCheck engine", date: "x" } }, SHA, templateIds), /ClaimCheck output/);
  assert.throws(() => validateProposals({ ...proposals, items: [{ ...proposals.items[0], claimId: "s9999" }] }, SHA, templateIds), /not in the blind template/);

  const template = [...templateIds].map((claim_id, index) => ({ claim_id, page: "1", section: "Results", text: `Sentence ${index + 1}.` }));
  const sheet = reviewSheetRows(template, validateProposals(proposals, SHA, templateIds));
  assert.equal(sheet.length, 4);
  assert.equal(sheet[0]!.proposed_label, "supported");
  assert.equal(sheet[0]!.decision, "", "the decision is left for the reviewer");
  assert.equal(sheet[0]!.label, "", "proposals are not copied into the label columns");

  sheet[0]!.decision = "approve";
  sheet[1]!.decision = "amend";
  sheet[1]!.auditable = "yes";
  sheet[1]!.label = "partially_supported";
  sheet[2]!.decision = "reject";
  // sheet[3] left blank: unreviewed.
  const review = claimsFromReview(parseCsv(toCsv(sheet)));
  assert.deepEqual(review.problems, []);
  assert.deepEqual(review.decisions, { approved: 1, amended: 1, rejected: 1, unreviewed: 1 });
  assert.deepEqual(review.claims.map((claim) => [claim.id, claim.label, claim.review]), [
    ["s0001", "supported", "approved"],
    ["s0002", "partially_supported", "amended"],
  ]);
  assert.equal(review.claims[0]!.evidence?.[0]?.quote, "Ours 91.2");

  const annotation = validateAnnotation({
    ...annotationFixture(),
    claims: review.claims,
    provenance: { method: "ai_assisted_review", scope: "subset", proposalGenerator: "assistant-model", decisions: review.decisions },
  });
  assert.equal(annotation.provenance?.method, "ai_assisted_review");
  // A reviewed claim cannot be passed off as blind annotation, and every assisted claim needs a decision.
  assert.throws(() => validateAnnotation({ ...annotationFixture(), claims: review.claims }), /only allowed when provenance.method/);
  assert.throws(
    () => validateAnnotation({ ...annotationFixture(), provenance: { method: "ai_assisted_review", scope: "subset", proposalGenerator: "assistant-model" } }),
    /must record the reviewer's decision/,
  );

  // Approving while also editing the label columns is ambiguous and refused.
  const ambiguous = sheet.map((row) => ({ ...row }));
  ambiguous[0]!.label = "contradicted";
  assert.match(claimsFromReview(ambiguous).problems.join(" "), /use "amend"/);
});
