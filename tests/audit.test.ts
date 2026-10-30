/**
 * Audit-engine regression tests.
 *
 * Ground truth is taken from the independently annotated corpus, but these
 * tests assert the rules directly: classifications, numeric traces, context
 * guards, margin exclusion, and evidence/offset integrity. None of the tests
 * depend on one document's exact numbers being hardcoded into the engine.
 */
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { EVALUATION_CASES, buildCasePdf, claimMatches } from "../evaluation/corpus.js";
import { extractPdf } from "../server/src/pdf/extract.js";
import { runAudit } from "../server/src/audit/engine.js";
import type { Finding } from "../shared/types.js";

type Extracted = Awaited<ReturnType<typeof extractPdf>>;
type AuditResult = ReturnType<typeof runAudit>;

const extracted = new Map<string, Extracted>();
const audits = new Map<string, AuditResult>();

before(async () => {
  for (const id of ["numeric-core", "context-guards", "task-guard", "margin-vs-score", "unreliable-table"]) {
    const testCase = EVALUATION_CASES.find((candidate) => candidate.id === id);
    assert.ok(testCase, `missing fixture ${id}`);
    const pdf = await buildCasePdf(testCase);
    const document = await extractPdf(pdf);
    extracted.set(id, document);
    audits.set(id, runAudit(document, Date.now()));
  }
});

function findingsFor(caseId: string, phrase: string): Finding[] {
  const audit = audits.get(caseId);
  assert.ok(audit, `audit ${caseId} was not prepared`);
  return audit.findings.filter((finding) => claimMatches(finding.claim.text, phrase));
}

function singleFinding(caseId: string, phrase: string): Finding {
  const matches = findingsFor(caseId, phrase);
  assert.equal(matches.length, 1, `expected exactly one claim matching “${phrase}”, got ${matches.length}`);
  return matches[0]!;
}

test("classifies a table-versus-abstract numerical conflict with a traceable comparison", () => {
  const finding = singleFinding("numeric-core", "Nimbus achieves 97.4% accuracy and 0.91 macro-F1");

  assert.equal(finding.category, "potential_contradiction");
  const accuracy = finding.numericComparisons.find((comparison) => comparison.metric === "accuracy");
  assert.ok(accuracy, "expected an accuracy comparison");
  assert.equal(accuracy.claimValue, "97.4%");
  assert.equal(accuracy.evidenceValue, "94.1%");
  assert.equal(accuracy.evidenceKind, "table_row");
  assert.match(finding.rationale, /Table 2/);

  const tableEvidence = finding.evidence.find((reference) => reference.kind === "table_row");
  assert.ok(tableEvidence, "expected table-row evidence");
  assert.match(tableEvidence.quote, /94\.1/);
});

test("supports a repeated value and keeps the evidence quote traceable", () => {
  const finding = singleFinding("context-guards", "On WMT14 English-to-German, Astra reports 28.4 BLEU");
  const document = extracted.get("context-guards")!;

  assert.equal(finding.category, "supported");
  const comparison = finding.numericComparisons.find((entry) => entry.metric === "BLEU");
  assert.ok(comparison, "expected a BLEU trace");
  assert.equal(comparison.evidenceValue, "28.4");
  assert.equal(comparison.delta, "0");
  assert.ok(finding.evidence.length > 0);
  for (const reference of finding.evidence) {
    assert.ok(reference.quote.length > 0);
    assert.ok(document.text.includes(reference.quote), `quote not present in document: ${reference.quote}`);
  }
});

test("does not compare results from incompatible tasks, datasets, or splits", () => {
  const iwslt = singleFinding("context-guards", "On IWSLT English-to-German, Astra reports 30.1 BLEU");
  assert.notEqual(iwslt.category, "potential_contradiction");
  assert.equal(iwslt.category, "potentially_unsupported");
  assert.equal(iwslt.numericComparisons.length, 0, "a different benchmark must not produce a numeric trace");

  const validation = singleFinding("context-guards", "On the validation split, Astra reports 32.5 BLEU");
  assert.notEqual(validation.category, "potential_contradiction");

  const french = singleFinding("task-guard", "On WMT14 English-to-French, Lumen reports 41.1 BLEU");
  assert.notEqual(french.category, "potential_contradiction");
  assert.equal(french.numericComparisons.length, 0);
});

test("excludes score margins from absolute-score comparisons", () => {
  const audit = audits.get("margin-vs-score")!;
  assert.ok(audit.findings.length > 0);
  assert.equal(
    audit.findings.filter((finding) => claimMatches(finding.claim.text, "improves accuracy over the strongest baseline by 3.1 percentage points")).length,
    0,
    "a margin sentence must not become an audit claim",
  );
  for (const finding of audit.findings) {
    for (const comparison of finding.numericComparisons) {
      assert.notEqual(comparison.claimValue, "3.1", "a margin must not be traced as an absolute score");
    }
  }
});

test("does not use an unreliable table as supporting or conflicting evidence", () => {
  const finding = singleFinding("unreliable-table", "On ClaimBench, Kite reaches 0.95 AUC");

  assert.equal(finding.category, "potentially_unsupported");
  assert.equal(finding.numericComparisons.length, 0);
  assert.equal(
    finding.evidence.some((reference) => reference.kind === "table_row"),
    false,
    "an unreliable table row must not be cited",
  );
});

test("produces all five classifications on the annotated corpus", () => {
  const audit = audits.get("numeric-core")!;
  const categories = new Set(audit.findings.map((finding) => finding.category));
  assert.deepEqual(
    [...categories].sort(),
    ["needs_review", "partially_supported", "potential_contradiction", "potentially_unsupported", "supported"],
  );

  const ambiguous = singleFinding("numeric-core", "Nimbus is better than Baseline A and consistent with prior work");
  assert.equal(ambiguous.category, "needs_review");
});

test("keeps every claim and evidence quote anchored to the extracted document", () => {
  for (const [caseId, audit] of audits) {
    const document = extracted.get(caseId)!;
    for (const finding of audit.findings) {
      assert.equal(
        document.text.slice(finding.claim.offset, finding.claim.offset + finding.claim.text.length),
        finding.claim.text,
        `claim offset does not map back to the document in ${caseId}`,
      );
      for (const reference of finding.evidence) {
        if (reference.kind === "metadata") {
          assert.equal(reference.page, 0, "document-level metadata evidence is not page-anchored");
          continue;
        }
        assert.ok(reference.page >= 1, "textual evidence must have a real page");
        assert.ok(reference.offset !== null, `textual evidence without an offset in ${caseId}`);
        assert.equal(
          document.text.slice(reference.offset, reference.offset + reference.quote.length),
          reference.quote,
          `evidence offset does not match its quote in ${caseId}`,
        );
      }
    }
  }
});

test("does not emit findings for a qualitative paper with no checkable claims", () => {
  const quiet = EVALUATION_CASES.find((candidate) => candidate.id === "quiet-paper");
  assert.ok(quiet);
  return (async () => {
    const document = await extractPdf(await buildCasePdf(quiet));
    const audit = runAudit(document, Date.now());
    assert.equal(audit.findings.length, 0);
    assert.equal(audit.summary.claimsAudited, 0);
  })();
});
