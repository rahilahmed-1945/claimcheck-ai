/**
 * Deterministic evaluation runner.
 *
 * This exercises the actual PDF extractor and audit engine used by the
 * application. It does not call a model, a network service, or the HTTP API.
 * The corpus is synthetic and explicit; its metrics are regression signals for
 * this engine, not claims about performance on the scientific literature.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_VERSION, type AuditRecord, type Finding, type FindingCategory } from "../shared/types.js";
import { buildJsonReport, buildMarkdownReport } from "../server/src/report.js";
import { sanitizeExtraction } from "../server/src/privacy.js";
import { extractPdf } from "../server/src/pdf/extract.js";
import { runAudit } from "../server/src/audit/engine.js";
import {
  CATEGORY_ORDER,
  EVALUATION_CASES,
  buildCasePdf,
  claimMatches,
  type EvaluationCase,
  type ExpectedFinding,
} from "./corpus.js";

interface CheckFailure {
  caseId: string;
  claim: string;
  message: string;
}

interface CaseResult {
  id: string;
  title: string;
  purpose: string;
  pages: number;
  words: number;
  chars: number;
  tables: number;
  reliableTables: number;
  findings: number;
  expectedFindings: number;
  matchedFindings: number;
  correctCategories: number;
  findingsWithoutExpectation: number;
  evidenceTraceFailures: number;
  failures: CheckFailure[];
  actual: {
    id: string;
    category: FindingCategory;
    title: string;
    claim: string;
    section: string;
    page: number;
  }[];
  expectedByCategory: Record<FindingCategory, number>;
  actualByCategory: Record<FindingCategory, number>;
}

const args = new Set(process.argv.slice(2));
const WRITE_RESULTS = args.has("--write") || args.has("--json");
const PUBLISH_SUMMARY = args.has("--publish");
const CORPUS_VERSION = crypto
  .createHash("sha256")
  .update(JSON.stringify(EVALUATION_CASES))
  .digest("hex")
  .slice(0, 12);

function emptyCounts(): Record<FindingCategory, number> {
  return {
    supported: 0,
    partially_supported: 0,
    potentially_unsupported: 0,
    potential_contradiction: 0,
    needs_review: 0,
  };
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Compare a trace value by magnitude, not by formatting. "92%" and "92.0%"
 * describe the same reported value; the assertion is about which number was
 * traced, not how the engine chose to print it.
 */
function sameReportedValue(actual: string, expected: string): boolean {
  const parse = (value: string): number | null => {
    const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const left = parse(actual);
  const right = parse(expected);
  if (left !== null && right !== null) return Math.abs(left - right) <= 0.005;
  return normalize(actual) === normalize(expected);
}

function normalizedLower(value: string): string {
  return normalize(value).toLowerCase();
}

function sentenceFromDocument(text: string, offset: number | null, quote: string): boolean {
  if (offset !== null && offset >= 0) {
    if (normalize(text.slice(offset, offset + quote.length)) === normalize(quote)) return true;
  }
  return text.includes(quote) || normalize(text).includes(normalize(quote));
}

function traceEvidence(
  caseId: string,
  findings: Finding[],
  documentText: string,
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const finding of findings) {
    if (finding.claim.offset >= 0) {
      const claimSlice = documentText.slice(
        finding.claim.offset,
        finding.claim.offset + finding.claim.text.length,
      );
      if (normalize(claimSlice) !== normalize(finding.claim.text) && !documentText.includes(finding.claim.text)) {
        failures.push({
          caseId,
          claim: finding.claim.text,
          message: `Claim offset ${finding.claim.offset} does not map to the claim text.`,
        });
      }
    }
    for (const evidence of finding.evidence) {
      if (evidence.kind === "metadata") continue;
      if (!sentenceFromDocument(documentText, evidence.offset, evidence.quote)) {
        failures.push({
          caseId,
          claim: finding.claim.text,
          message: `Evidence quote is not present in the extracted document: “${evidence.quote.slice(0, 120)}”`,
        });
      }
      if (evidence.page < 1) {
        failures.push({
          caseId,
          claim: finding.claim.text,
          message: `Textual evidence has no valid page: “${evidence.quote.slice(0, 80)}”`,
        });
      }
    }
    for (const comparison of finding.numericComparisons) {
      if (!comparison.metric || !comparison.claimValue || !comparison.evidenceValue) {
        failures.push({
          caseId,
          claim: finding.claim.text,
          message: "Numeric comparison is missing a metric or value.",
        });
      }
    }
  }
  return failures;
}

function checkExtraction(testCase: EvaluationCase, extracted: Awaited<ReturnType<typeof extractPdf>>): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const expected = testCase.extraction;
  const fail = (message: string) =>
    failures.push({ caseId: testCase.id, claim: "—", message });

  if (extracted.pageCount < expected.minPages) {
    fail(`Expected at least ${expected.minPages} page(s), extracted ${extracted.pageCount}.`);
  }
  if (expected.minWords !== undefined && extracted.wordCount < expected.minWords) {
    fail(`Expected at least ${expected.minWords} words, extracted ${extracted.wordCount}.`);
  }
  if (expected.maxWords !== undefined && extracted.wordCount > expected.maxWords) {
    fail(`Expected at most ${expected.maxWords} words, extracted ${extracted.wordCount}.`);
  }
  if (expected.sectionTitles) {
    const titles = new Set(extracted.sections.map((section) => normalizedLower(section.title)));
    for (const title of expected.sectionTitles) {
      if (!titles.has(normalizedLower(title))) {
        fail(`Missing expected section “${title}”. Found: ${extracted.sections.map((section) => section.title).join(" | ")}`);
      }
    }
  }
  if (expected.minTables !== undefined && extracted.tables.length < expected.minTables) {
    fail(`Expected at least ${expected.minTables} table(s), extracted ${extracted.tables.length}.`);
  }
  if (expected.reliableTables !== undefined) {
    const reliable = extracted.tables.filter((table) => table.reliable).length;
    if (reliable < expected.reliableTables) {
      fail(`Expected at least ${expected.reliableTables} reliable table(s), extracted ${reliable}.`);
    }
  }
  if (expected.unreliableTables !== undefined) {
    const unreliable = extracted.tables.filter((table) => !table.reliable).length;
    if (unreliable < expected.unreliableTables) {
      fail(`Expected at least ${expected.unreliableTables} unreliable table(s), extracted ${unreliable}.`);
    }
  }
  for (const warning of expected.warningsInclude ?? []) {
    if (!extracted.warnings.some((candidate) => candidate.includes(warning))) {
      fail(`Missing extraction warning containing “${warning}”. Found: ${extracted.warnings.join(" | ") || "none"}`);
    }
  }
  return failures;
}

function checkFinding(
  testCase: EvaluationCase,
  expected: ExpectedFinding,
  finding: Finding | null,
  extractedText: string,
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const fail = (message: string) =>
    failures.push({ caseId: testCase.id, claim: expected.claimIncludes, message });

  if (!finding) {
    fail(`No selected claim matched “${expected.claimIncludes}”.`);
    return failures;
  }

  if (finding.category !== expected.category) {
    fail(`Expected category ${expected.category}, got ${finding.category}.`);
  }
  if (expected.forbiddenCategories?.includes(finding.category)) {
    fail(`Category ${finding.category} is explicitly forbidden for this claim.`);
  }
  for (const phrase of expected.rationaleIncludes ?? []) {
    if (!normalizedLower(finding.rationale).includes(normalizedLower(phrase))) {
      fail(`Rationale does not contain “${phrase}”.`);
    }
  }
  for (const phrase of expected.evidenceIncludes ?? []) {
    if (!finding.evidence.some((evidence) => normalizedLower(evidence.quote).includes(normalizedLower(phrase)))) {
      fail(`No retained evidence contains “${phrase}”.`);
    }
  }
  for (const expectedCheck of expected.checks ?? []) {
    const actual = finding.checks.find((check) => check.id === expectedCheck.id);
    if (!actual) {
      fail(`Missing check “${expectedCheck.id}”.`);
    } else if (actual.outcome !== expectedCheck.outcome) {
      fail(`Check “${expectedCheck.id}” expected ${expectedCheck.outcome}, got ${actual.outcome}.`);
    }
  }
  for (const expectedNumeric of expected.numeric ?? []) {
    const actual = finding.numericComparisons.find(
      (comparison) => comparison.metric.toLowerCase() === expectedNumeric.metric.toLowerCase(),
    );
    if (!actual) {
      fail(`Missing numeric trace for ${expectedNumeric.metric}.`);
      continue;
    }
    if (!sameReportedValue(actual.claimValue, expectedNumeric.claimValue)) {
      fail(
        `Numeric trace for ${expectedNumeric.metric} has claim value ${actual.claimValue}, expected ${expectedNumeric.claimValue}.`,
      );
    }
    if (!sameReportedValue(actual.evidenceValue, expectedNumeric.evidenceValue)) {
      fail(
        `Numeric trace for ${expectedNumeric.metric} has evidence value ${actual.evidenceValue}, expected ${expectedNumeric.evidenceValue}.`,
      );
    }
    if (expectedNumeric.evidenceKind && actual.evidenceKind !== expectedNumeric.evidenceKind) {
      fail(
        `Numeric trace for ${expectedNumeric.metric} has evidence kind ${actual.evidenceKind}, expected ${expectedNumeric.evidenceKind}.`,
      );
    }
  }
  if (finding.claim.text && !sentenceFromDocument(extractedText, finding.claim.offset, finding.claim.text)) {
    fail("Claim text cannot be traced back to the extracted document.");
  }
  return failures;
}

function buildRecord(
  testCase: EvaluationCase,
  extracted: Awaited<ReturnType<typeof extractPdf>>,
  result: ReturnType<typeof runAudit>,
): AuditRecord {
  return {
    id: `eval-${testCase.id}`,
    filename: `${testCase.paper?.id ?? testCase.id}.pdf`,
    fileSize: 0,
    fileHash: null,
    status: "complete",
    stage: "complete",
    stageDetail: "Evaluation fixture.",
    progress: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    engineVersion: "eval",
    error: null,
    extraction: sanitizeExtraction({ ...extracted, textDensity: extracted.charCount < 2500 ? "sparse" : "good" }),
    findings: result.findings,
    summary: result.summary,
    limitations: result.limitations,
    timings: {
      extractionMs: extracted.extractionMs,
      auditMs: result.auditMs,
      totalMs: extracted.extractionMs + result.auditMs,
    },
    // Stored records never carry the source document; reports must work without it.
    document: null,
  };
}

function checkReport(
  testCase: EvaluationCase,
  extracted: Awaited<ReturnType<typeof extractPdf>>,
  result: ReturnType<typeof runAudit>,
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const fail = (message: string) =>
    failures.push({ caseId: testCase.id, claim: "—", message });
  try {
    const record = buildRecord(testCase, extracted, result);
    const markdown = buildMarkdownReport(record);
    const json = buildJsonReport(record);
    if (!markdown.includes("# ClaimCheck AI audit report")) {
      fail("Markdown report is missing its title.");
    }
    if (markdown.length < 500) fail("Markdown report is unexpectedly short.");
    const parsed = JSON.parse(json) as { audit?: { findings?: unknown[] }; documentTextIncluded?: boolean };
    if (!Array.isArray(parsed.audit?.findings)) {
      fail("JSON report does not contain a findings array.");
    }
    if (parsed.documentTextIncluded !== false) {
      fail("JSON report should not claim to include full document text.");
    }
    for (const finding of result.findings) {
      for (const evidence of finding.evidence) {
        if (
          evidence.kind !== "metadata" &&
          !markdown.includes(evidence.quote.slice(0, Math.min(60, evidence.quote.length)))
        ) {
          fail(`Markdown report is missing an evidence quotation from ${finding.id}.`);
        }
      }
    }
  } catch (error) {
    fail(`Report generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return failures;
}

function computeCategoryMetrics(results: DetailedCaseResult[]) {
  const metrics: Record<
    FindingCategory,
    { truePositive: number; falsePositive: number; falseNegative: number; expected: number; predicted: number; precision: number; recall: number; f1: number }
  > = Object.fromEntries(
    CATEGORY_ORDER.map((category) => [
      category,
      { truePositive: 0, falsePositive: 0, falseNegative: 0, expected: 0, predicted: 0, precision: 0, recall: 0, f1: 0 },
    ]),
  ) as ReturnType<typeof computeCategoryMetrics>;

  // The case result retains aggregate counts; individual category precision is
  // computed from the actual and expected distributions plus matched claims.
  for (const result of results) {
    for (const category of CATEGORY_ORDER) {
      metrics[category].expected += result.expectedByCategory[category];
      metrics[category].predicted += result.actualByCategory[category];
    }
    for (const finding of result.actual) {
      const expected = result.expectedForClaim.get(normalizedLower(finding.claim));
      if (expected && expected.category === finding.category) {
        metrics[finding.category].truePositive += 1;
      } else {
        metrics[finding.category].falsePositive += 1;
      }
    }
    for (const expected of result.expectedDetails) {
      const key = [...result.expectedForClaim.entries()].find(([, value]) => value === expected)?.[0];
      const finding = key ? result.matchedByClaim.get(key) : null;
      if (!finding || finding.category !== expected.category) {
        metrics[expected.category].falseNegative += 1;
      }
    }
  }

  for (const category of CATEGORY_ORDER) {
    const entry = metrics[category];
    entry.precision = entry.predicted === 0 ? 0 : entry.truePositive / entry.predicted;
    entry.recall = entry.expected === 0 ? 0 : entry.truePositive / entry.expected;
    entry.f1 =
      entry.precision + entry.recall === 0
        ? 0
        : (2 * entry.precision * entry.recall) / (entry.precision + entry.recall);
  }
  return metrics;
}

interface DetailedCaseResult extends CaseResult {
  expectedDetails: ExpectedFinding[];
  matchedByClaim: Map<string, Finding>;
  expectedForClaim: Map<string, ExpectedFinding>;
}

async function runCase(testCase: EvaluationCase): Promise<DetailedCaseResult> {
  const pdf = await buildCasePdf(testCase);
  const extracted = await extractPdf(pdf);
  const auditStarted = Date.now();
  const result = runAudit(extracted, auditStarted);
  const failures = [
    ...checkExtraction(testCase, extracted),
    ...traceEvidence(testCase.id, result.findings, extracted.text),
    ...checkReport(testCase, extracted, result),
  ];

  const expectedDetails: ExpectedFinding[] = testCase.expected;
  const matchedByClaim = new Map<string, Finding>();
  const expectedForClaim = new Map<string, ExpectedFinding>();
  const foundClaimKeys = new Set<string>();
  let matchedFindings = 0;
  let correctCategories = 0;

  for (const expected of expectedDetails) {
    const matches = result.findings.filter((finding) => claimMatches(finding.claim.text, expected.claimIncludes));
    if (matches.length > 1) {
      failures.push({
        caseId: testCase.id,
        claim: expected.claimIncludes,
        message: `Expected claim matched ${matches.length} findings; the fixture is ambiguous.`,
      });
    }
    const finding = matches[0] ?? null;
    const key = normalizedLower(finding?.claim.text ?? expected.claimIncludes);
    if (finding) {
      matchedByClaim.set(key, finding);
      expectedForClaim.set(key, expected);
      foundClaimKeys.add(key);
      matchedFindings += 1;
      if (finding.category === expected.category) correctCategories += 1;
    }
    failures.push(...checkFinding(testCase, expected, finding, extracted.text));
  }

  const unexpected = result.findings.filter((finding) => !foundClaimKeys.has(normalizedLower(finding.claim.text)));
  for (const finding of unexpected) {
    failures.push({
      caseId: testCase.id,
      claim: finding.claim.text,
      message: `Unexpected finding: “${finding.title}” (${finding.category}). Add it to the fixture ground truth or adjust claim selection.`,
    });
  }

  if (testCase.forbiddenClaimIncludes) {
    for (const phrase of testCase.forbiddenClaimIncludes) {
      const selected = result.findings.find((finding) => claimMatches(finding.claim.text, phrase));
      if (selected) {
        failures.push({
          caseId: testCase.id,
          claim: phrase,
          message: `Claim should not be selected: “${selected.claim.text}”.`,
        });
      }
    }
  }

  const expectedByCategory = emptyCounts();
  for (const expected of expectedDetails) expectedByCategory[expected.category] += 1;
  const actualByCategory = emptyCounts();
  for (const finding of result.findings) actualByCategory[finding.category] += 1;

  return {
    id: testCase.id,
    title: testCase.title,
    purpose: testCase.purpose,
    pages: extracted.pageCount,
    words: extracted.wordCount,
    chars: extracted.charCount,
    tables: extracted.tables.length,
    reliableTables: extracted.tables.filter((table) => table.reliable).length,
    findings: result.findings.length,
    expectedFindings: expectedDetails.length,
    matchedFindings,
    correctCategories,
    findingsWithoutExpectation: unexpected.length,
    evidenceTraceFailures: failures.filter((failure) => failure.message.includes("Evidence quote") || failure.message.includes("Claim text") || failure.message.includes("Claim offset")).length,
    failures,
    actual: result.findings.map((finding) => ({
      id: finding.id,
      category: finding.category,
      title: finding.title,
      claim: finding.claim.text,
      section: finding.claim.sectionTitle,
      page: finding.claim.page,
    })),
    expectedByCategory,
    actualByCategory,
    expectedDetails,
    matchedByClaim,
    expectedForClaim,
  };
}

function printReport(results: DetailedCaseResult[]) {
  const totalExpected = results.reduce((sum, result) => sum + result.expectedFindings, 0);
  const totalMatched = results.reduce((sum, result) => sum + result.matchedFindings, 0);
  const totalCorrect = results.reduce((sum, result) => sum + result.correctCategories, 0);
  const totalFindings = results.reduce((sum, result) => sum + result.findings, 0);
  const totalUnexpected = results.reduce((sum, result) => sum + result.findingsWithoutExpectation, 0);
  const totalEvidenceFailures = results.reduce((sum, result) => sum + result.evidenceTraceFailures, 0);
  const totalFailures = results.reduce((sum, result) => sum + result.failures.length, 0);
  const precision = totalFindings === 0 ? 1 : totalCorrect / totalFindings;
  const recall = totalExpected === 0 ? 1 : totalMatched / totalExpected;
  const exact = totalExpected === 0 ? 1 : totalCorrect / totalExpected;

  console.log("");
  console.log("ClaimCheck evaluation corpus");
  console.log("Synthetic fixtures only. Metrics describe this deterministic engine on this corpus, not the literature.");
  console.log("");
  console.log("case                      pages  words  tables  findings  truth  matched  exact  unexpected  trace-fail  status");
  for (const result of results) {
    const status = result.failures.length === 0 ? "PASS" : "FAIL";
    console.log(
      `${result.id.padEnd(25)} ${String(result.pages).padStart(5)} ${String(result.words).padStart(6)} ${String(result.reliableTables).padStart(7)} ${String(result.findings).padStart(9)} ${String(result.expectedFindings).padStart(6)} ${String(result.matchedFindings).padStart(8)} ${String(result.correctCategories).padStart(6)} ${String(result.findingsWithoutExpectation).padStart(11)} ${String(result.evidenceTraceFailures).padStart(11)}  ${status}`,
    );
  }

  console.log("");
  console.log(`Claim selection recall: ${recall.toFixed(3)} (${totalMatched}/${totalExpected})`);
  console.log(`Exact category accuracy: ${exact.toFixed(3)} (${totalCorrect}/${totalExpected})`);
  console.log(`Strict finding precision: ${precision.toFixed(3)} (${totalCorrect}/${totalFindings})`);
  console.log(`Evidence trace failures: ${totalEvidenceFailures}`);
  console.log(`Assertion failures: ${totalFailures}`);

  if (totalUnexpected > 0) {
    console.log("");
    console.log("Unannotated findings:");
    for (const result of results) {
      for (const finding of result.actual) {
        if (!result.matchedByClaim.has(normalizedLower(finding.claim))) {
          console.log(`- [${result.id}] ${finding.category} · ${finding.claim.slice(0, 120)}`);
        }
      }
    }
  }

  if (totalFailures > 0) {
    console.log("");
    console.log("Failures:");
    for (const result of results) {
      for (const failure of result.failures) {
        console.log(`- [${failure.caseId}] ${failure.claim.slice(0, 90)} — ${failure.message}`);
      }
    }
  }

  const metrics = computeCategoryMetrics(results);
  console.log("");
  console.log("Per-category strict precision / recall / F1:");
  for (const category of CATEGORY_ORDER) {
    const entry = metrics[category];
    console.log(
      `${category.padEnd(24)} ${entry.precision.toFixed(3)} / ${entry.recall.toFixed(3)} / ${entry.f1.toFixed(3)}  (truth ${entry.expected}, predicted ${entry.predicted})`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    corpusVersion: CORPUS_VERSION,
    note: "Synthetic corpus only; not an estimate of performance on external papers.",
    totals: {
      cases: results.length,
      expectedFindings: totalExpected,
      findings: totalFindings,
      matchedFindings: totalMatched,
      exactCategoryMatches: totalCorrect,
      unexpectedFindings: totalUnexpected,
      correctPredictions: totalCorrect,
      evidenceTraceFailures: totalEvidenceFailures,
      assertionFailures: totalFailures,
      claimSelectionRecall: recall,
      exactCategoryAccuracy: exact,
      strictPrecision: precision,
      runtimeMs: 0,
    },
    perCategory: metrics,
    cases: results.map((result) => ({
      id: result.id,
      title: result.title,
      purpose: result.purpose,
      pages: result.pages,
      words: result.words,
      chars: result.chars,
      tables: result.tables,
      reliableTables: result.reliableTables,
      findings: result.findings,
      expectedFindings: result.expectedFindings,
      matchedFindings: result.matchedFindings,
      correctCategories: result.correctCategories,
      findingsWithoutExpectation: result.findingsWithoutExpectation,
      evidenceTraceFailures: result.evidenceTraceFailures,
      actualByCategory: result.actualByCategory,
      expectedByCategory: result.expectedByCategory,
      failures: result.failures,
      actual: result.actual,
    })),
  };
}

async function main() {
  const started = Date.now();
  const results: DetailedCaseResult[] = [];
  for (const testCase of EVALUATION_CASES) {
    results.push(await runCase(testCase));
  }
  const report = printReport(results);
  report.totals.runtimeMs = Date.now() - started;

  if (WRITE_RESULTS) {
    const outDir = path.join(process.cwd(), "evaluation", "results");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("");
    console.log(`Wrote ${path.relative(process.cwd(), path.join(outDir, "latest.json"))}`);
  }

  if (PUBLISH_SUMMARY) {
    if (report.totals.assertionFailures > 0) {
      console.error("\nThe corpus has failures, so evaluation/summary.json was not updated.");
    } else {
      const summary = {
        generatedAt: report.generatedAt,
        engineVersion: report.engineVersion,
        corpusVersion: report.corpusVersion,
        note: report.note,
        totals: report.totals,
        perCategory: report.perCategory,
        cases: report.cases.map((testCase) => ({
          id: testCase.id,
          title: testCase.title,
          purpose: testCase.purpose,
          pages: testCase.pages,
          words: testCase.words,
          tables: testCase.tables,
          reliableTables: testCase.reliableTables,
          findings: testCase.findings,
          expectedFindings: testCase.expectedFindings,
          matchedFindings: testCase.matchedFindings,
          correctCategories: testCase.correctCategories,
          findingsWithoutExpectation: testCase.findingsWithoutExpectation,
          evidenceTraceFailures: testCase.evidenceTraceFailures,
          failures: testCase.failures.length,
          actualByCategory: testCase.actualByCategory,
          expectedByCategory: testCase.expectedByCategory,
        })),
      };
      const summaryPath = path.join(process.cwd(), "evaluation", "summary.json");
      fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
      console.log(`Published ${path.relative(process.cwd(), summaryPath)}`);
    }
  }

  if (report.totals.assertionFailures > 0) {
    process.exitCode = 1;
  }
}

await main();
