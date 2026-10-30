/**
 * Scoring engine predictions against human annotations.
 *
 * Matching: a prediction and an annotated claim refer to the same sentence when
 * they are on the same page and their normalized text overlaps strongly
 * (containment, or token Jaccard ≥ 0.6). Matching is one-to-one, best first.
 *
 * Only pages listed in `pagesReviewed` are scored. Predictions there that match
 * no annotated sentence are "unannotated" and reported, not counted, because
 * the annotator did not judge them either way.
 */
import { CLAIM_LABELS, type AnnotatedClaim, type ClaimLabel, type PaperAnnotation, type PaperPrediction, type PredictedClaim } from "./schema.js";

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function textOverlap(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) return 1;
  const tokensA = new Set(left.split(" "));
  const tokensB = new Set(right.split(" "));
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared / (tokensA.size + tokensB.size - shared);
}

export const MATCH_THRESHOLD = 0.6;

export interface ClaimMatch {
  annotation: AnnotatedClaim;
  prediction: PredictedClaim;
  overlap: number;
}

export function matchClaims(annotation: PaperAnnotation, prediction: PaperPrediction) {
  const reviewed = new Set(annotation.pagesReviewed);
  const predictions = prediction.claims.filter((claim) => reviewed.has(claim.page));
  const candidates: ClaimMatch[] = [];
  for (const annotated of annotation.claims) {
    for (const predicted of predictions) {
      if (predicted.page !== annotated.page) continue;
      const overlap = textOverlap(annotated.text, predicted.text);
      if (overlap >= MATCH_THRESHOLD) candidates.push({ annotation: annotated, prediction: predicted, overlap });
    }
  }
  candidates.sort((a, b) => b.overlap - a.overlap);
  const usedAnnotations = new Set<AnnotatedClaim>();
  const usedPredictions = new Set<PredictedClaim>();
  const matches: ClaimMatch[] = [];
  for (const candidate of candidates) {
    if (usedAnnotations.has(candidate.annotation) || usedPredictions.has(candidate.prediction)) continue;
    usedAnnotations.add(candidate.annotation);
    usedPredictions.add(candidate.prediction);
    matches.push(candidate);
  }
  return {
    matches,
    unmatchedAnnotations: annotation.claims.filter((claim) => !usedAnnotations.has(claim)),
    unannotatedPredictions: predictions.filter((claim) => !usedPredictions.has(claim)),
    outOfScopePredictions: prediction.claims.length - predictions.length,
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface Proportion {
  value: number | null;
  numerator: number;
  denominator: number;
  /** 95% Wilson score interval; null when the denominator is zero. */
  ci95: [number, number] | null;
}

export function wilson(numerator: number, denominator: number, z = 1.959964): Proportion {
  if (denominator === 0) return { value: null, numerator, denominator, ci95: null };
  const p = numerator / denominator;
  const z2 = z * z;
  const centre = (p + z2 / (2 * denominator)) / (1 + z2 / denominator);
  const half = (z * Math.sqrt((p * (1 - p)) / denominator + z2 / (4 * denominator * denominator))) / (1 + z2 / denominator);
  return { value: p, numerator, denominator, ci95: [Math.max(0, centre - half), Math.min(1, centre + half)] };
}

export function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/** Deterministic PRNG so bootstrap intervals are reproducible. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimum number of papers before a paper-level bootstrap interval is reported. */
export const MIN_PAPERS_FOR_BOOTSTRAP = 5;

/**
 * Percentile bootstrap over papers (claims within a paper are not independent).
 * Returns null with fewer than MIN_PAPERS_FOR_BOOTSTRAP papers.
 */
export function bootstrapByPaper<T>(papers: T[], statistic: (sample: T[]) => number | null, resamples = 2000, seed = 20261029): [number, number] | null {
  if (papers.length < MIN_PAPERS_FOR_BOOTSTRAP) return null;
  const random = mulberry32(seed);
  const values: number[] = [];
  for (let iteration = 0; iteration < resamples; iteration += 1) {
    const sample = Array.from({ length: papers.length }, () => papers[Math.floor(random() * papers.length)]!);
    const value = statistic(sample);
    if (value !== null && Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.floor(q * values.length)))]!;
  return [at(0.025), at(0.975)];
}

// ---------------------------------------------------------------------------
// Per-paper counts and aggregate metrics
// ---------------------------------------------------------------------------

export interface PaperCounts {
  paperId: string;
  auditableClaims: number;
  negativeItems: number;
  detected: number;
  falsePositives: number;
  unannotatedPredictions: number;
  outOfScopePredictions: number;
  /** label → { tp, fp, fn } over auditable claims (missed claims count as fn for their true label). */
  perLabel: Record<ClaimLabel, { tp: number; fp: number; fn: number }>;
  exactLabelMatches: number;
  abstentions: number;
  localizationEvaluated: number;
  localizationCorrect: number;
  numeric: { tp: number; fp: number; fn: number };
  referenceIssues: { tp: number; fp: number; fn: number };
  citationIssuesAnnotated: number;
}

const NUMERIC_CHECKS = new Set(["number_consistency", "arithmetic_consistency", "table_cell_match", "table_alignment"]);

function localizationCorrect(annotated: AnnotatedClaim, predicted: PredictedClaim): boolean | null {
  const expected = (annotated.evidence ?? []).filter((evidence) => evidence.relation !== "context");
  const offered = predicted.evidence.filter((evidence) => evidence.kind !== "metadata" && evidence.relation !== "context");
  if (expected.length === 0 || offered.length === 0) return null;
  return offered.some((evidence) =>
    expected.some((target) => target.page === evidence.page && textOverlap(target.quote, evidence.quote) >= 0.5),
  );
}

export function scorePaper(annotation: PaperAnnotation, prediction: PaperPrediction): PaperCounts {
  const { matches, unmatchedAnnotations, unannotatedPredictions, outOfScopePredictions } = matchClaims(annotation, prediction);
  const perLabel = Object.fromEntries(CLAIM_LABELS.map((label) => [label, { tp: 0, fp: 0, fn: 0 }])) as PaperCounts["perLabel"];
  const counts: PaperCounts = {
    paperId: annotation.paperId,
    auditableClaims: annotation.claims.filter((claim) => claim.auditable).length,
    negativeItems: annotation.claims.filter((claim) => !claim.auditable).length,
    detected: 0,
    falsePositives: 0,
    unannotatedPredictions: unannotatedPredictions.length,
    outOfScopePredictions,
    perLabel,
    exactLabelMatches: 0,
    abstentions: 0,
    localizationEvaluated: 0,
    localizationCorrect: 0,
    numeric: { tp: 0, fp: 0, fn: 0 },
    referenceIssues: { tp: 0, fp: 0, fn: 0 },
    citationIssuesAnnotated: annotation.claims.filter((claim) => claim.issues?.includes("citation_issue")).length,
  };

  for (const { annotation: annotated, prediction: predicted } of matches) {
    const numericFlagged = predicted.label === "contradicted" && predicted.flaggedChecks.some((check) => NUMERIC_CHECKS.has(check));
    const numericTruth = annotated.issues?.includes("numerical_inconsistency") ?? false;
    if (numericFlagged && numericTruth) counts.numeric.tp += 1;
    else if (numericFlagged) counts.numeric.fp += 1;
    else if (numericTruth) counts.numeric.fn += 1;

    if (!annotated.auditable) {
      counts.falsePositives += 1;
      continue;
    }
    counts.detected += 1;
    if (predicted.label === "needs_review") counts.abstentions += 1;
    const truth = annotated.label!;
    if (predicted.label === truth) {
      counts.exactLabelMatches += 1;
      perLabel[truth].tp += 1;
    } else {
      perLabel[predicted.label].fp += 1;
      perLabel[truth].fn += 1;
    }
    const located = localizationCorrect(annotated, predicted);
    if (located !== null) {
      counts.localizationEvaluated += 1;
      if (located) counts.localizationCorrect += 1;
    }
  }
  for (const missed of unmatchedAnnotations) {
    if (!missed.auditable) continue;
    perLabel[missed.label!].fn += 1;
    if (missed.issues?.includes("numerical_inconsistency")) counts.numeric.fn += 1;
  }

  // Missing table/figure references are the only reference issues the engine reports.
  const predictedMissing = prediction.claims.filter((claim) => claim.flaggedChecks.includes("reference_traceability"));
  const annotatedMissing = (annotation.referenceIssues ?? []).filter((issue) => issue.kind === "missing_table" || issue.kind === "missing_figure");
  const usedPredictions = new Set<PredictedClaim>();
  for (const issue of annotatedMissing) {
    const pattern = new RegExp(`\\b${issue.kind === "missing_table" ? "table" : "fig(?:ure|\\.)"}\\s*${issue.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const hit = predictedMissing.find((claim) => !usedPredictions.has(claim) && pattern.test(claim.text));
    if (hit) {
      usedPredictions.add(hit);
      counts.referenceIssues.tp += 1;
    } else {
      counts.referenceIssues.fn += 1;
    }
  }
  counts.referenceIssues.fp = predictedMissing.length - usedPredictions.size;
  return counts;
}

export interface BenchmarkMetrics {
  papers: number;
  claimDetection: { precision: Proportion; recall: Proportion; f1: number | null; f1Ci95: [number, number] | null };
  falsePositiveRate: Proportion;
  exactLabelAccuracy: Proportion;
  perLabel: Record<ClaimLabel, { precision: Proportion; recall: Proportion; f1: number | null; support: number }>;
  macroF1: number | null;
  evidenceLocalization: Proportion;
  coverage: Proportion;
  decisiveCoverage: Proportion;
  abstentionRate: Proportion;
  numericalInconsistency: { precision: Proportion; recall: Proportion; f1: number | null };
  referenceIssues: { precision: Proportion; recall: Proportion; f1: number | null };
  citationIssues: { annotated: number; scored: false; reason: string };
  unannotatedPredictions: number;
  outOfScopePredictions: number;
}

const sum = (papers: PaperCounts[], pick: (paper: PaperCounts) => number) => papers.reduce((total, paper) => total + pick(paper), 0);

function detectionF1(papers: PaperCounts[]): number | null {
  const detected = sum(papers, (paper) => paper.detected);
  const precision = wilson(detected, detected + sum(papers, (paper) => paper.falsePositives)).value;
  const recall = wilson(detected, sum(papers, (paper) => paper.auditableClaims)).value;
  return f1(precision, recall);
}

export function aggregate(papers: PaperCounts[]): BenchmarkMetrics {
  const detected = sum(papers, (paper) => paper.detected);
  const falsePositives = sum(papers, (paper) => paper.falsePositives);
  const auditable = sum(papers, (paper) => paper.auditableClaims);
  const precision = wilson(detected, detected + falsePositives);
  const recall = wilson(detected, auditable);
  const perLabel = Object.fromEntries(
    CLAIM_LABELS.map((label) => {
      const tp = sum(papers, (paper) => paper.perLabel[label].tp);
      const fp = sum(papers, (paper) => paper.perLabel[label].fp);
      const fn = sum(papers, (paper) => paper.perLabel[label].fn);
      const labelPrecision = wilson(tp, tp + fp);
      const labelRecall = wilson(tp, tp + fn);
      return [label, { precision: labelPrecision, recall: labelRecall, f1: f1(labelPrecision.value, labelRecall.value), support: tp + fn }];
    }),
  ) as BenchmarkMetrics["perLabel"];
  const supported = CLAIM_LABELS.filter((label) => perLabel[label].support > 0);
  const labelF1s = supported.map((label) => perLabel[label].f1 ?? 0);
  const pairMetric = (pick: (paper: PaperCounts) => { tp: number; fp: number; fn: number }) => {
    const tp = sum(papers, (paper) => pick(paper).tp);
    const p = wilson(tp, tp + sum(papers, (paper) => pick(paper).fp));
    const r = wilson(tp, tp + sum(papers, (paper) => pick(paper).fn));
    return { precision: p, recall: r, f1: f1(p.value, r.value) };
  };
  const abstentions = sum(papers, (paper) => paper.abstentions);
  return {
    papers: papers.length,
    claimDetection: { precision, recall, f1: f1(precision.value, recall.value), f1Ci95: bootstrapByPaper(papers, detectionF1) },
    falsePositiveRate: wilson(falsePositives, sum(papers, (paper) => paper.negativeItems)),
    exactLabelAccuracy: wilson(sum(papers, (paper) => paper.exactLabelMatches), detected),
    perLabel,
    macroF1: labelF1s.length > 0 ? labelF1s.reduce((a, b) => a + b, 0) / labelF1s.length : null,
    evidenceLocalization: wilson(sum(papers, (paper) => paper.localizationCorrect), sum(papers, (paper) => paper.localizationEvaluated)),
    coverage: recall,
    decisiveCoverage: wilson(detected - abstentions, auditable),
    abstentionRate: wilson(abstentions, detected),
    numericalInconsistency: pairMetric((paper) => paper.numeric),
    referenceIssues: pairMetric((paper) => paper.referenceIssues),
    citationIssues: {
      annotated: sum(papers, (paper) => paper.citationIssuesAnnotated),
      scored: false,
      reason: "The engine does not emit bibliography or citation-list findings, so citation issues are recorded but not scored.",
    },
    unannotatedPredictions: sum(papers, (paper) => paper.unannotatedPredictions),
    outOfScopePredictions: sum(papers, (paper) => paper.outOfScopePredictions),
  };
}
