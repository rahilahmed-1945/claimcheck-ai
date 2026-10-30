/**
 * Report-generation tests.
 *
 * Reports must be built from a completed audit record, retain evidence
 * quotations and limitations, and never include the full extracted text.
 */
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { EVALUATION_CASES, buildCasePdf } from "../evaluation/corpus.js";
import { extractPdf } from "../server/src/pdf/extract.js";
import { runAudit } from "../server/src/audit/engine.js";
import { buildJsonReport, buildMarkdownReport, reportFilename } from "../server/src/report.js";
import { ENGINE_VERSION, type AuditRecord } from "../shared/types.js";

let record: AuditRecord;

before(async () => {
  const testCase = EVALUATION_CASES.find((candidate) => candidate.id === "numeric-core");
  assert.ok(testCase);
  const document = await extractPdf(await buildCasePdf(testCase));
  const audit = runAudit(document, Date.now());
  record = {
    id: "audit-report-fixture",
    filename: "Nimbus numeric fixture.pdf",
    fileSize: 12345,
    fileHash: "a".repeat(64),
    status: "complete",
    stage: "complete",
    stageDetail: "Audit report ready.",
    progress: 100,
    createdAt: "2026-01-02T03:04:05.000Z",
    completedAt: "2026-01-02T03:04:06.000Z",
    engineVersion: ENGINE_VERSION,
    error: null,
    extraction: {
      pageCount: document.pageCount,
      charCount: document.charCount,
      wordCount: document.wordCount,
      pagesWithText: document.pagesWithText,
      textDensity: "good",
      bodyFontSize: document.bodyFontSize,
      extractionMs: document.extractionMs,
      sections: document.sections,
      tables: document.tables,
      captions: document.captions,
      warnings: document.warnings,
    },
    findings: audit.findings,
    summary: audit.summary,
    limitations: audit.limitations,
    timings: { extractionMs: document.extractionMs, auditMs: audit.auditMs, totalMs: 2 },
    document: {
      text: document.text,
      pages: document.pages,
      sections: document.sections,
      tables: document.tables,
      captions: document.captions,
    },
  };
});

test("builds a Markdown report with classifications, evidence, and limitations", () => {
  const markdown = buildMarkdownReport(record);

  assert.match(markdown, /^# ClaimCheck AI audit report/);
  assert.match(markdown, /not a verdict on research validity/);
  assert.match(markdown, /## Classification summary/);
  for (const label of [
    "Potential contradiction",
    "Potentially unsupported",
    "Partially supported",
    "Needs review",
    "Supported",
  ]) {
    assert.ok(markdown.includes(label), `missing classification ${label}`);
  }
  assert.match(markdown, /The extracted evidence appears inconsistent with the claim/);

  const contradiction = record.findings.find((finding) => finding.category === "potential_contradiction");
  assert.ok(contradiction, "fixture must contain a contradiction");
  assert.ok(markdown.includes(contradiction.claim.text), "report must include the audited claim");
  const quote = contradiction.evidence.find((reference) => reference.kind === "table_row")?.quote;
  assert.ok(quote, "fixture must include table evidence");
  assert.ok(markdown.includes(quote), "report must include the evidence quotation");

  for (const limitation of record.limitations.slice(0, 2)) {
    assert.ok(markdown.includes(limitation), "report must retain audit limitations");
  }
  assert.match(markdown, /no language model was used/);
});

test("builds a machine-readable JSON report without the full document text", () => {
  const raw = buildJsonReport(record);
  const parsed = JSON.parse(raw) as {
    product: string;
    reportFormatVersion: number;
    engineVersion: string;
    document: { filename: string; sha256: string | null };
    audit: { summary: unknown; findings: typeof record.findings; limitations: string[] };
    documentTextIncluded: boolean;
  };

  assert.equal(parsed.product, "ClaimCheck AI");
  assert.equal(parsed.reportFormatVersion, 1);
  assert.equal(parsed.engineVersion, ENGINE_VERSION);
  assert.equal(parsed.document.filename, record.filename);
  assert.equal(parsed.document.sha256, record.fileHash);
  assert.equal(parsed.documentTextIncluded, false);
  assert.equal(parsed.audit.findings.length, record.findings.length);
  assert.ok(parsed.audit.limitations.length > 0);
  assert.ok(!raw.includes(record.document!.text), "JSON reports must not embed the full extracted text");

  for (const finding of parsed.audit.findings) {
    for (const reference of finding.evidence) {
      if (reference.kind !== "metadata") assert.ok(reference.page >= 1);
      assert.ok(reference.quote.length > 0);
    }
  }
});

test("rejects report generation for an incomplete audit", () => {
  const incomplete: AuditRecord = { ...record, status: "failed", document: null };
  assert.throws(() => buildMarkdownReport(incomplete), /not complete/);
  assert.throws(() => buildJsonReport(incomplete), /not complete/);
});

test("uses a stable, filesystem-safe report filename", () => {
  assert.equal(reportFilename(record, "md"), "claimcheck-nimbus-numeric-fixture-2026-01-02.md");
  assert.equal(reportFilename(record, "json"), "claimcheck-nimbus-numeric-fixture-2026-01-02.json");
});
