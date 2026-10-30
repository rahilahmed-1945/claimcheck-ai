/**
 * Real-paper benchmark command line.
 *
 *   npm run benchmark -- add <pdf> --id <id> --title <t> --url <u> --license <spdx> --license-checked-by <name>
 *   npm run benchmark -- template <id>            blind annotation template (JSON + CSV), no engine output
 *   npm run benchmark -- review-sheet <id>        AI proposals (benchmark/proposals/<id>.json) beside empty human decision columns
 *   npm run benchmark -- import <id> <csv> --annotator <id> [--annotator <id>] --method single|consensus|adjudicated [--reviewed]
 *   npm run benchmark -- predict [<id>...]        run the engine; writes benchmark/predictions/
 *   npm run benchmark -- evaluate [--split dev|test] [--confirm-held-out]
 *
 * PDFs live in benchmark/papers/<id>.pdf and are never committed. Human
 * annotations live in benchmark/annotations/<id>.json. Predictions are
 * regenerated and gitignored.
 */
import fs from "node:fs";
import path from "node:path";
import { ENGINE_VERSION } from "../shared/types.js";
import { extractPdf } from "../server/src/pdf/extract.js";
import { runAudit } from "../server/src/audit/engine.js";
import { parseCsv, toCsv } from "./lib/csv.js";
import {
  ANNOTATIONS_DIR,
  BENCHMARK_DIR,
  PAPERS_DIR,
  PREDICTIONS_DIR,
  TEMPLATES_DIR,
  assignSplit,
  loadManifest,
  saveManifest,
  sha256File,
  type BenchmarkPaper,
  type Split,
} from "./lib/manifest.js";
import { aggregate, scorePaper, type BenchmarkMetrics } from "./lib/metrics.js";
import { claimsFromReview, reviewSheetRows, rowToClaim, validateProposals, type PaperProposals } from "./lib/review.js";
import {
  ANNOTATION_SCHEMA,
  CATEGORY_TO_LABEL,
  PREDICTION_SCHEMA,
  validateAnnotation,
  type AnnotatedClaim,
  type LabelProvenance,
  type PaperAnnotation,
  type PaperPrediction,
} from "./lib/schema.js";

const RESULTS_DIR = path.join(BENCHMARK_DIR, "results");
const PROPOSALS_DIR = path.join(BENCHMARK_DIR, "proposals");

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
function options(args: string[], name: string): string[] {
  return args.flatMap((arg, index) => (arg === `--${name}` && args[index + 1] ? [args[index + 1]!] : []));
}
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
const paperPdf = (id: string) => path.join(PAPERS_DIR, `${id}.pdf`);

async function add(args: string[]) {
  const source = args[0];
  const id = option(args, "id");
  const required = { title: option(args, "title"), url: option(args, "url"), license: option(args, "license"), checkedBy: option(args, "license-checked-by") };
  if (!source || !id || Object.values(required).some((value) => !value)) {
    fail("Usage: add <pdf> --id <id> --title <title> --url <source url> --license <licence> --license-checked-by <name>");
  }
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) fail("The id must be 3–64 lowercase letters, digits, or hyphens.");
  const manifest = loadManifest();
  if (manifest.papers.some((paper) => paper.id === id) || manifest.regressionCases.some((entry) => entry.id === id)) {
    fail(`${id} is already in the manifest.`);
  }
  fs.mkdirSync(PAPERS_DIR, { recursive: true });
  fs.copyFileSync(source, paperPdf(id));
  const extracted = await extractPdf(fs.readFileSync(paperPdf(id)));
  const paper: BenchmarkPaper = {
    id,
    title: required.title!,
    sourceUrl: required.url!,
    license: required.license!,
    licenseCheckedBy: required.checkedBy!,
    sha256: sha256File(paperPdf(id)),
    split: assignSplit(id, manifest.split.salt, manifest.split.testFraction),
    pages: extracted.pageCount,
    addedAt: new Date().toISOString().slice(0, 10),
  };
  manifest.papers.push(paper);
  saveManifest(manifest);
  console.log(`Added ${id} (${paper.pages} pages) to the ${paper.split} split.`);
}

/** Blind template rows: every extracted sentence, with page and section, and empty label fields. */
export function blindTemplateRows(extracted: Awaited<ReturnType<typeof extractPdf>>): Record<string, string>[] {
  return extracted.sentences.map((sentence, index) => ({
    claim_id: `s${String(index + 1).padStart(4, "0")}`,
    page: String(sentence.page),
    section: sentence.sectionTitle,
    text: sentence.text,
    auditable: "",
    label: "",
    issues: "",
    evidence_page: "",
    evidence_quote: "",
    evidence_relation: "",
    notes: "",
  }));
}

async function template(args: string[]) {
  const id = args[0] ?? fail("Usage: template <id>");
  const paper = loadManifest().papers.find((entry) => entry.id === id) ?? fail(`${id} is not in the manifest.`);
  const rows = blindTemplateRows(await extractPdf(fs.readFileSync(paperPdf(id))));
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEMPLATES_DIR, `${id}.csv`), toCsv(rows));
  fs.writeFileSync(
    path.join(TEMPLATES_DIR, `${id}.json`),
    `${JSON.stringify(
      {
        schema: ANNOTATION_SCHEMA,
        source: "human",
        paperId: id,
        paperSha256: paper.sha256,
        annotators: [],
        adjudication: { method: "single", date: "" },
        pagesReviewed: [],
        claims: rows.map((row) => ({ id: row.claim_id, text: row.text, page: Number(row.page), section: row.section, auditable: null })),
        referenceIssues: [],
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote blind templates for ${id}: ${rows.length} sentences in benchmark/templates/${id}.csv and .json.`);
  console.log("They contain no engine output. Fill them in by reading the PDF, not the ClaimCheck report.");
}

function importCsv(args: string[]) {
  const [id, csvPath] = args;
  const annotators = options(args, "annotator");
  const method = option(args, "method") as PaperAnnotation["adjudication"]["method"] | undefined;
  const reviewed = args.includes("--reviewed");
  if (!id || !csvPath || annotators.length === 0 || !method) {
    fail("Usage: import <id> <filled.csv> --annotator <id> [--annotator <id>] --method single|consensus|adjudicated [--reviewed]");
  }
  const paper = loadManifest().papers.find((entry) => entry.id === id) ?? fail(`${id} is not in the manifest.`);
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  let claims: AnnotatedClaim[];
  let provenance: LabelProvenance = { method: "blind", scope: "full_pages" };
  if (reviewed) {
    const proposals = readProposals(paper);
    const review = claimsFromReview(rows);
    if (review.problems.length > 0) fail(["The review sheet has problems:", ...review.problems].join("\n- "));
    claims = review.claims;
    provenance = { method: "ai_assisted_review", scope: "subset", proposalGenerator: proposals.generator.name, decisions: review.decisions };
    const d = review.decisions;
    console.log(`Review decisions: ${d.approved} approved, ${d.amended} amended, ${d.rejected} rejected, ${d.unreviewed} not yet reviewed.`);
  } else {
    if (rows.some((row) => "decision" in row)) fail("This looks like a review sheet. Import it with --reviewed.");
    claims = rows.map((row) => rowToClaim(row)).filter((claim): claim is AnnotatedClaim => claim !== null);
  }
  const pages = new Set(claims.map((claim) => claim.page));
  const annotation = validateAnnotation(
    {
      schema: ANNOTATION_SCHEMA,
      source: "human",
      paperId: id,
      paperSha256: paper.sha256,
      annotators: annotators.map((annotator) => ({ id: annotator, kind: "human" })),
      adjudication: { method, date: new Date().toISOString().slice(0, 10) },
      pagesReviewed: [...pages].sort((a, b) => a - b),
      claims,
      provenance,
    },
    paper.sha256,
  );
  fs.mkdirSync(ANNOTATIONS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ANNOTATIONS_DIR, `${id}.json`), `${JSON.stringify(annotation, null, 2)}\n`);
  console.log(`Imported ${claims.length} human-labelled sentences for ${id} (pages ${annotation.pagesReviewed.join(", ")}).`);
}

function readProposals(paper: BenchmarkPaper): PaperProposals {
  const proposalPath = path.join(PROPOSALS_DIR, `${paper.id}.json`);
  const templatePath = path.join(TEMPLATES_DIR, `${paper.id}.csv`);
  if (!fs.existsSync(proposalPath)) fail(`No proposals at benchmark/proposals/${paper.id}.json.`);
  if (!fs.existsSync(templatePath)) fail(`Run "npm run benchmark -- template ${paper.id}" first.`);
  const templateIds = new Set(parseCsv(fs.readFileSync(templatePath, "utf8")).map((row) => row.claim_id ?? ""));
  return validateProposals(JSON.parse(fs.readFileSync(proposalPath, "utf8")), paper.sha256, templateIds);
}

/** Review sheet: AI proposals beside empty decision columns, for a person to approve, amend, or reject. */
function reviewSheet(args: string[]) {
  const id = args[0] ?? fail("Usage: review-sheet <id>");
  const paper = loadManifest().papers.find((entry) => entry.id === id) ?? fail(`${id} is not in the manifest.`);
  const proposals = readProposals(paper);
  const templateRows = parseCsv(fs.readFileSync(path.join(TEMPLATES_DIR, `${id}.csv`), "utf8"));
  const rows = reviewSheetRows(templateRows, proposals);
  fs.writeFileSync(path.join(TEMPLATES_DIR, `${id}.review.csv`), toCsv(rows));
  console.log(`Wrote ${rows.length} proposals for review to benchmark/templates/${id}.review.csv.`);
  console.log('Set "decision" to approve, amend (and fill the label columns), or reject, checking each row against the PDF.');
  console.log("Proposals are not labels: only approved and amended rows are imported, with the reviewer named.");
}

async function predict(args: string[]) {
  const manifest = loadManifest();
  const papers = args.length > 0 ? manifest.papers.filter((paper) => args.includes(paper.id)) : manifest.papers;
  if (papers.length === 0) {
    console.log("No benchmark papers are registered yet. Add one with `npm run benchmark -- add`.");
    return;
  }
  fs.mkdirSync(PREDICTIONS_DIR, { recursive: true });
  for (const paper of papers) {
    if (!fs.existsSync(paperPdf(paper.id))) {
      console.warn(`Skipping ${paper.id}: benchmark/papers/${paper.id}.pdf is missing.`);
      continue;
    }
    if (sha256File(paperPdf(paper.id)) !== paper.sha256) fail(`${paper.id}: the PDF does not match the manifest hash.`);
    const extracted = await extractPdf(fs.readFileSync(paperPdf(paper.id)));
    const audit = runAudit(extracted, Date.now());
    const prediction: PaperPrediction = {
      schema: PREDICTION_SCHEMA,
      source: "engine",
      paperId: paper.id,
      paperSha256: paper.sha256,
      engineVersion: ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      claims: audit.findings.map((finding) => ({
        findingId: finding.id,
        text: finding.claim.text,
        page: finding.claim.page,
        section: finding.claim.sectionTitle,
        category: finding.category,
        label: CATEGORY_TO_LABEL[finding.category]!,
        confidence: finding.confidence,
        flaggedChecks: finding.checks.filter((check) => check.outcome === "flagged").map((check) => check.id),
        evidence: finding.evidence.map((evidence) => ({ page: evidence.page, quote: evidence.quote, relation: evidence.relation, kind: evidence.kind })),
      })),
    };
    fs.writeFileSync(path.join(PREDICTIONS_DIR, `${paper.id}.json`), `${JSON.stringify(prediction, null, 2)}\n`);
    console.log(`Predicted ${paper.id}: ${prediction.claims.length} findings.`);
  }
}

export interface EvaluationReport {
  status: "awaiting_human_annotation" | "scored";
  split: Split;
  engineVersion: string;
  papersInSplit: number;
  annotatedPapers: string[];
  /** False while some papers in the split have no human annotation: the scores then cover only part of it. */
  complete: boolean;
  /** How each paper's labels were made: blind human annotation, or human review of AI proposals. */
  labelProvenance: { paperId: string; method: LabelProvenance["method"]; scope: LabelProvenance["scope"] }[];
  metrics: BenchmarkMetrics | null;
  note: string;
}

export function evaluateSplit(split: Split, dirs = { annotations: ANNOTATIONS_DIR, predictions: PREDICTIONS_DIR }, manifest = loadManifest()): EvaluationReport {
  const papers = manifest.papers.filter((paper) => paper.split === split);
  const annotated = papers.filter((paper) => fs.existsSync(path.join(dirs.annotations, `${paper.id}.json`)));
  if (annotated.length === 0) {
    return {
      status: "awaiting_human_annotation",
      split,
      engineVersion: ENGINE_VERSION,
      papersInSplit: papers.length,
      annotatedPapers: [],
      complete: false,
      labelProvenance: [],
      metrics: null,
      note: "No human annotations exist for this split. No real-paper metrics are reported.",
    };
  }
  const labelProvenance: EvaluationReport["labelProvenance"] = [];
  const counts = annotated.map((paper) => {
    const annotation = validateAnnotation(JSON.parse(fs.readFileSync(path.join(dirs.annotations, `${paper.id}.json`), "utf8")), paper.sha256);
    const provenance = annotation.provenance ?? { method: "blind", scope: "full_pages" };
    labelProvenance.push({ paperId: paper.id, method: provenance.method, scope: provenance.scope });
    const predictionPath = path.join(dirs.predictions, `${paper.id}.json`);
    if (!fs.existsSync(predictionPath)) throw new Error(`Missing predictions for ${paper.id}. Run \`npm run benchmark -- predict\` first.`);
    const prediction = JSON.parse(fs.readFileSync(predictionPath, "utf8")) as PaperPrediction;
    if (prediction.schema !== PREDICTION_SCHEMA || prediction.paperSha256 !== paper.sha256) {
      throw new Error(`Predictions for ${paper.id} are stale or not engine output. Regenerate them.`);
    }
    return scorePaper(annotation, prediction);
  });
  return {
    status: "scored",
    split,
    engineVersion: ENGINE_VERSION,
    papersInSplit: papers.length,
    annotatedPapers: annotated.map((paper) => paper.id),
    complete: annotated.length === papers.length,
    labelProvenance,
    metrics: aggregate(counts),
    note: [
      `Scored ${annotated.length} of ${papers.length} paper${papers.length === 1 ? "" : "s"} in this split.`,
      annotated.length < papers.length ? "INCOMPLETE: the other papers have no human labels yet, so these numbers cover part of the split only." : "",
      labelProvenance.some((entry) => entry.scope === "subset")
        ? "Some labels come from human review of AI-proposed subsets: recall and false-positive rate there are measured over the reviewed sentences only."
        : "",
      "Intervals are 95% Wilson intervals; F1 intervals need at least 5 papers.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

const pct = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`);
const withCi = (proportion: { value: number | null; numerator: number; denominator: number; ci95: [number, number] | null }) =>
  `${pct(proportion.value)} (${proportion.numerator}/${proportion.denominator}${proportion.ci95 ? `, 95% CI ${pct(proportion.ci95[0])}–${pct(proportion.ci95[1])}` : ""})`;

function printReport(report: EvaluationReport) {
  console.log(`Real-paper benchmark · split ${report.split} · engine ${report.engineVersion}`);
  console.log(`Papers in split: ${report.papersInSplit} · human-annotated: ${report.annotatedPapers.length}${report.complete ? "" : " (incomplete)"}`);
  for (const entry of report.labelProvenance) console.log(`  ${entry.paperId}: ${entry.method === "blind" ? "blind human labels" : "human-reviewed AI proposals"} (${entry.scope})`);
  if (!report.metrics) {
    console.log(`\nSTATUS: AWAITING HUMAN ANNOTATION\n${report.note}`);
    return;
  }
  const m = report.metrics;
  console.log(`\nClaim detection   precision ${withCi(m.claimDetection.precision)}`);
  console.log(`                  recall    ${withCi(m.claimDetection.recall)}`);
  console.log(`                  F1        ${pct(m.claimDetection.f1)}${m.claimDetection.f1Ci95 ? ` (paper bootstrap 95% CI ${pct(m.claimDetection.f1Ci95[0])}–${pct(m.claimDetection.f1Ci95[1])})` : " (too few papers for an interval)"}`);
  console.log(`False-positive rate on non-claims ${withCi(m.falsePositiveRate)}`);
  console.log(`Exact label accuracy (detected)   ${withCi(m.exactLabelAccuracy)}`);
  console.log(`Evidence localization             ${withCi(m.evidenceLocalization)}`);
  console.log(`Coverage ${withCi(m.coverage)} · decisive coverage ${withCi(m.decisiveCoverage)} · abstention ${withCi(m.abstentionRate)}`);
  console.log("\nPer label            precision   recall      F1      support");
  for (const [label, metric] of Object.entries(m.perLabel)) {
    console.log(`${label.padEnd(20)} ${pct(metric.precision.value).padEnd(11)} ${pct(metric.recall.value).padEnd(11)} ${pct(metric.f1).padEnd(7)} ${metric.support}`);
  }
  console.log(`Macro F1 (labels with support): ${pct(m.macroF1)}`);
  console.log(`Numerical inconsistency  P ${withCi(m.numericalInconsistency.precision)}  R ${withCi(m.numericalInconsistency.recall)}`);
  console.log(`Missing table/figure     P ${withCi(m.referenceIssues.precision)}  R ${withCi(m.referenceIssues.recall)}`);
  console.log(`Citation issues: ${m.citationIssues.annotated} annotated, not scored. ${m.citationIssues.reason}`);
  console.log(`Unannotated predictions on reviewed pages: ${m.unannotatedPredictions} · predictions on unreviewed pages: ${m.outOfScopePredictions}`);
  console.log(`\n${report.note}`);
}

function evaluate(args: string[]) {
  const split = (option(args, "split") ?? "dev") as Split;
  if (split !== "dev" && split !== "test") fail("--split must be dev or test.");
  if (split === "test" && !args.includes("--confirm-held-out")) {
    fail("The test split is held out. Score it only for a final, frozen engine version, and pass --confirm-held-out.");
  }
  const report = evaluateSplit(split);
  printReport(report);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${split}.json`), `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`);
}

const isMain = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("benchmark/cli.ts");
if (isMain) {
  const [command, ...rest] = process.argv.slice(2);
  const commands: Record<string, (args: string[]) => unknown> = { add, template, "review-sheet": reviewSheet, import: importCsv, predict, evaluate };
  const handler = command ? commands[command] : undefined;
  if (!handler) fail("Commands: add, template, review-sheet, import, predict, evaluate");
  await handler(rest);
}
