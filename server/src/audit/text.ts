/** Deterministic text and numeric utilities used by the audit engine. */

export interface NumericFact {
  raw: string;
  value: number;
  unit: "percent" | "fraction" | "number" | "pvalue";
  metric: string | null;
  metricKey: string | null;
  index: number;
  kind: "metric" | "pvalue";
  operator?: string;
}

export interface TextContext {
  splits: Set<string>;
  datasets: Set<string>;
  languagePairs: Set<string>;
  mentionsOurs: boolean;
  mentionsBaseline: boolean;
  mentionsCondition: boolean;
}

const METRIC_TERMS: { key: string; label: string; pattern: RegExp }[] = [
  { key: "accuracy", label: "accuracy", pattern: /\b(top-?\d+\s+)?accurac(?:y|ies)\b/gi },
  { key: "precision", label: "precision", pattern: /\bprecision\b/gi },
  { key: "recall", label: "recall", pattern: /\brecall\b/gi },
  { key: "f1", label: "F1", pattern: /\b(?:macro[- ]?)?f1(?:[- ]?score)?\b/gi },
  { key: "auc", label: "AUC", pattern: /\b(?:roc[- ]?)?au(?:c|roc)\b/gi },
  { key: "auprc", label: "AUPRC", pattern: /\bauprc\b/gi },
  { key: "bleu", label: "BLEU", pattern: /\bbleu\b/gi },
  { key: "rouge", label: "ROUGE", pattern: /\brouge(?:-?[lL12])?\b/gi },
  { key: "meteor", label: "METEOR", pattern: /\bmeteor\b/gi },
  { key: "wer", label: "WER", pattern: /\bwer\b/gi },
  { key: "cer", label: "CER", pattern: /\bcer\b/gi },
  { key: "perplexity", label: "perplexity", pattern: /\bperplexity\b/gi },
  { key: "mae", label: "MAE", pattern: /\bmae\b/gi },
  { key: "rmse", label: "RMSE", pattern: /\brmse\b/gi },
  { key: "r2", label: "R\u00b2", pattern: /\br\s?2\b|\br\u00b2\b/gi },
  { key: "iou", label: "IoU", pattern: /\b(?:m)?iou\b/gi },
  { key: "map", label: "mAP", pattern: /\bm(?:ean average precision|ap)\b|\bmap\b/gi },
  { key: "sensitivity", label: "sensitivity", pattern: /\bsensitivity\b/gi },
  { key: "specificity", label: "specificity", pattern: /\bspecificity\b/gi },
  { key: "error_rate", label: "error rate", pattern: /\berror rate\b/gi },
  { key: "loss", label: "loss", pattern: /\b(?:training|test|validation)?\s*loss\b/gi },
  { key: "exact_match", label: "exact match", pattern: /\bexact[- ]match\b/gi },
  { key: "pass_at_1", label: "pass@1", pattern: /\bpass@1\b/gi },
  { key: "bertscore", label: "BERTScore", pattern: /\bbert[- ]?score\b/gi },
  { key: "cider", label: "CIDEr", pattern: /\bcider\b/gi },
  { key: "spice", label: "SPICE", pattern: /\bspice\b/gi },
  { key: "ndcg", label: "nDCG", pattern: /\bndcg(?:@\d+)?\b/gi },
  { key: "mrr", label: "MRR", pattern: /\bmrr\b/gi },
  { key: "hit_at_k", label: "Hit@k", pattern: /\bhit@\d+\b/gi },
  { key: "throughput", label: "throughput", pattern: /\bthroughput\b/gi },
  { key: "latency", label: "latency", pattern: /\blatency\b/gi },
  { key: "speedup", label: "speedup", pattern: /\bspeedup\b/gi },
  { key: "compression", label: "compression ratio", pattern: /\bcompression ratio\b/gi },
];

const METRIC_BY_KEY = new Map(METRIC_TERMS.map((term) => [term.key, term.label]));

export function metricLabel(key: string | null): string {
  if (!key) return "value";
  return METRIC_BY_KEY.get(key) ?? key;
}

export function canonicalMetricName(text: string): { key: string; label: string } | null {
  for (const term of METRIC_TERMS) {
    term.pattern.lastIndex = 0;
    if (term.pattern.test(text)) return { key: term.key, label: term.label };
  }
  return null;
}

function nearestMetric(text: string, numberStart: number, numberEnd: number): {
  key: string;
  label: string;
  distance: number;
} | null {
  let best: { key: string; label: string; distance: number } | null = null;
  for (const term of METRIC_TERMS) {
    term.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = term.pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const distance = start >= numberEnd ? start - numberEnd : numberStart - end;
      if (distance < 0) continue;
      // Wider window (56 chars) to catch patterns like "accuracy of 94.1%"
      if (distance > 56) continue;
      const connector =
        start >= numberEnd
          ? text.slice(numberEnd, start)
          : text.slice(end, numberStart);
      if (
        !/^[\s,;:=()]*(?:(?:scores?|values?|results?) of|of|at|is|was|were|reaches?|reached|to|equals?|:)?[\s,;:=()]*$/i.test(
          connector,
        )
      ) {
        continue;
      }
      if (!best || distance < best.distance) {
        best = { key: term.key, label: term.label, distance };
      }
    }
  }
  return best;
}

const DELTA_PREFIX_RE =
  /\b(?:by|over|more than|less than|up to|at least|gain|gains|gained|improvement|improved|increase[ds]?|decrease[ds]?|reduction|reduces?|drop|rise|delta|difference|margin|lead of|absolute gain)\b[^.;]{0,28}$/i;
// "reduces BLEU to 26.1" reports the resulting absolute value; it is not a delta.
const ABSOLUTE_CHANGE_PREFIX_RE =
  /\b(?:reduc\w*|increas\w*|improv\w*|drop\w*|rise\w*|declin\w*|decreas\w*)\b[^.;]{0,32}\bto\s*$/i;
// A value followed by "BLEU worse" or "points lower" is a margin, not a score.
const DELTA_SUFFIX_RE =
  /^\s*(?:[A-Za-z][A-Za-z0-9-]*\s+){0,3}(?:worse|better|higher|lower|more|less|improvement|gain|drop|increase|decrease|behind|ahead)\b/i;

const NUMBER_RE = /(?<![\[\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?)(%|percent\b|percentage points?\b|pp\b)?/gi;
const P_VALUE_RE = /\bp\s*(<|>|=|≤|≥)\s*(0?\.\d+)/gi;

export function extractNumericFacts(text: string): NumericFact[] {
  const facts: NumericFact[] = [];
  const pValueRanges: { start: number; end: number }[] = [];

  P_VALUE_RE.lastIndex = 0;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = P_VALUE_RE.exec(text)) !== null) {
    const operator = pMatch[1] ?? "=";
    const numeric = Number(pMatch[2]);
    if (!Number.isFinite(numeric)) continue;
    facts.push({
      raw: pMatch[0],
      value: numeric,
      unit: "pvalue",
      metric: "p-value",
      metricKey: "pvalue",
      index: pMatch.index,
      kind: "pvalue",
      operator,
    });
    pValueRanges.push({ start: pMatch.index, end: pMatch.index + pMatch[0].length });
  }

  // Pre-pass: identify true numeric ranges / confidence intervals so that
  // their constituent numbers are not extracted as independent metric facts.
  //
  // Rules:
  //  1. Dash / en-dash separators: "5-95%", "5–95%", "0.05–0.95"
  //     These are unambiguous ranges. Always suppress.
  //  2. "to" / "and" separators: only suppress if the two numbers are
  //     *directly adjacent* (gap ≤ 5 chars excluding the separator word).
  //     "18% in round 1 to 42%" must NOT be suppressed because there are
  //     intervening words between the numbers.
  //  3. "between X% and Y%" form: suppress when X and Y are both bare
  //     numbers immediately adjacent to the separator.
  //
  // Statistical context cues (CI, percentile, credible interval) are NOT
  // required; the adjacency constraint is sufficient.
  const intervalRanges: { start: number; end: number }[] = [];

  // Form 1: dash/en-dash separator (numbers must be directly adjacent)
  // e.g. "5-95%", "5–95 percent", "0.05–0.95"
  const dashIntervalRe = /\b(\d+(?:\.\d+)?)\s*[\u2013\u2014-]\s*(\d+(?:\.\d+)?)\s*(%|percent\b|percentage points?\b)/gi;
  dashIntervalRe.lastIndex = 0;
  let intervalMatch: RegExpExecArray | null;
  while ((intervalMatch = dashIntervalRe.exec(text)) !== null) {
    intervalRanges.push({ start: intervalMatch.index, end: intervalMatch.index + intervalMatch[0].length });
  }

  // Form 2: "to" / "and" separator, but only when both numbers are directly
  // adjacent to the separator word (no intervening noun phrases).
  // Pattern: NUMBER SPACES? ("to"|"and") SPACES? NUMBER PERCENT
  // The gap between the first number's end and the separator must be ≤ 1 space.
  // Additional guard: value1 < value2 (a CI always runs low→high).
  // "23% to 11%" is a decreasing trend, not an interval, so it must not be suppressed.
  const toIntervalRe = /\b(\d+(?:\.\d+)?)(%?)\s{0,2}\b(?:to|and)\b\s{0,2}(\d+(?:\.\d+)?)\s*(%|percent\b|percentage points?\b)/gi;
  toIntervalRe.lastIndex = 0;
  while ((intervalMatch = toIntervalRe.exec(text)) !== null) {
    const firstHasPercent = (intervalMatch[2] ?? "") === "%";
    const fullMatch = intervalMatch[0];
    const val1 = Number(intervalMatch[1]);
    const val2 = Number(intervalMatch[3]);
    // Only suppress if val1 < val2 (lower→upper bound pattern)
    // AND the first number has % OR the gap is short (directly adjacent).
    const gapLen = fullMatch.replace(/\d+(?:\.\d+)?/g, "").length;
    if (val1 < val2 && (firstHasPercent || (gapLen <= 5 && val1 >= 2))) {
      intervalRanges.push({ start: intervalMatch.index, end: intervalMatch.index + fullMatch.length });
    }
  }

  // Form 3: "between X% and Y%" or "between X and Y%"
  const betweenRe = /\bbetween\s+(\d+(?:\.\d+)?)(%?)\s{0,2}(?:and|to)\s{0,2}(\d+(?:\.\d+)?)\s*(%|percent)?/gi;
  betweenRe.lastIndex = 0;
  while ((intervalMatch = betweenRe.exec(text)) !== null) {
    const firstHasPercent = (intervalMatch[2] ?? "") === "%";
    const lastHasPercent = !!(intervalMatch[4]);
    if (firstHasPercent || lastHasPercent) {
      intervalRanges.push({ start: intervalMatch.index, end: intervalMatch.index + intervalMatch[0].length });
    }
  }

  NUMBER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMBER_RE.exec(text)) !== null) {
    const numericText = (match[1] ?? "").replace(/,/g, "");
    const value = Number(numericText);
    if (!Number.isFinite(value)) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (pValueRanges.some((range) => start >= range.start && start < range.end)) continue;
    // Skip numbers that are part of a probability/confidence interval range (e.g. "5-95%").
    if (intervalRanges.some((range) => start >= range.start && start < range.end)) continue;
    // Skip section-reference numbers like "Section 4.1", "Sec. 4.2", "§4.3".
    // These appear in parenthetical cross-references and are not metric values.
    const shortPrefix = text.slice(Math.max(0, start - 16), start);
    if (/(?:section|sec\.|§)\s*$/i.test(shortPrefix)) continue;
    // Skip DOI-style decimals like "10.1038" or "10.3390" — these are bibliographic.
    if (!match[2] && /^10\.\d{4,}$/.test(match[1] ?? "")) continue;

    const unitRaw = (match[2] ?? "").toLowerCase();
    const isPercent = unitRaw.startsWith("%") || unitRaw.startsWith("percent") || unitRaw.startsWith("percentage") || unitRaw === "pp";
    const prefix = text.slice(Math.max(0, start - 48), start);
    const suffix = text.slice(end, end + 42);
    // A difference or gain is not an absolute metric value and must not be compared to one.
    const isDelta =
      !ABSOLUTE_CHANGE_PREFIX_RE.test(prefix) &&
      (DELTA_PREFIX_RE.test(prefix) || DELTA_SUFFIX_RE.test(suffix));
    if (isDelta) continue;
    const metric = nearestMetric(text, start, end);

    // Standalone four-digit years are usually bibliographic or temporal, not results.
    if (
      !isPercent &&
      !metric &&
      Number.isInteger(value) &&
      value >= 1900 &&
      value <= 2100 &&
      match[1]?.length === 4
    ) {
      continue;
    }

    // Bare small integers (section numbers, counts) without a metric are not auditable values.
    // A decimal-formatted score such as 41.0 is a reported value, not a count, so keep it.
    if (!isPercent && !metric && Number.isInteger(value) && !match[1]?.includes(".")) continue;

    const fraction = metric !== null && !isPercent && value > 0 && value <= 1;
    facts.push({
      raw: match[0].trim(),
      value,
      unit: isPercent ? "percent" : fraction ? "fraction" : "number",
      metric: metric?.label ?? null,
      metricKey: metric?.key ?? null,
      index: start,
      kind: "metric",
    });
  }

  return facts.sort((a, b) => a.index - b.index);
}

export function normalizeToPercent(fact: NumericFact): number | null {
  if (fact.kind === "pvalue") return null;
  if (fact.unit === "percent") return fact.value;
  if (fact.unit === "fraction") return fact.value * 100;
  if (fact.metricKey && fact.value > 0 && fact.value <= 1) return fact.value * 100;
  return fact.value;
}

export function valuesEquivalent(a: NumericFact, b: NumericFact): boolean | null {
  const left = normalizeToPercent(a);
  const right = normalizeToPercent(b);
  if (left === null || right === null) return null;
  const tolerance = Math.max(0.2, Math.min(1, Math.abs(left) * 0.005));
  return Math.abs(left - right) <= tolerance;
}

export function formatPercentValue(fact: NumericFact): string {
  // Show the value as reported. F1-like fractions are not silently turned into percentages.
  if (fact.unit === "percent") return `${formatNumber(fact.value)}%`;
  return fact.raw;
}

export function formatDelta(a: NumericFact, b: NumericFact): string {
  const left = normalizeToPercent(a);
  const right = normalizeToPercent(b);
  if (left === null || right === null) return "not comparable";
  if (a.unit === "percent" || b.unit === "percent") {
    const bothPercent = a.unit === "percent" && b.unit === "percent";
    const delta = bothPercent ? Math.abs(a.value - b.value) : Math.abs(left - right);
    return `${formatNumber(delta)} percentage points${bothPercent ? "" : " (normalized)"}`;
  }
  const rawDelta = Math.abs(a.value - b.value);
  const unit = a.metricKey === "f1" ? "F1 points" : "reported units";
  return `${formatNumber(rawDelta)} ${unit}`;
}

export function datasetDisplayName(name: string): string {
  const labels: Record<string, string> = {
    claimbench: "ClaimBench",
    imagenet: "ImageNet",
    "cifar-10": "CIFAR-10",
    "cifar-100": "CIFAR-100",
    mnist: "MNIST",
    "fashion-mnist": "Fashion-MNIST",
    "sst-2": "SST-2",
    "sst-5": "SST-5",
    "conll-2003": "CoNLL-2003",
    squad: "SQuAD",
    glue: "GLUE",
    superglue: "SuperGLUE",
    mmlu: "MMLU",
    hellaswag: "HellaSwag",
    boolq: "BoolQ",
    wmt14: "WMT14",
    iwslt: "IWSLT",
    librispeech: "LibriSpeech",
    coco: "COCO",
    ade20k: "ADE20K",
    "pascal voc": "Pascal VOC",
    wikitext: "WikiText",
  };
  return labels[name.toLowerCase()] ?? name;
}

export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

const SPLIT_TERMS: { canonical: string; pattern: RegExp }[] = [
  { canonical: "test", pattern: /\b(test(?:ing)?|held[- ]out|holdout)\b/gi },
  { canonical: "validation", pattern: /\b(validation|val|development|dev)\b/gi },
  { canonical: "train", pattern: /\b(train(?:ing)?)\b/gi },
  { canonical: "cross-validation", pattern: /\b(cross[- ]validation|\d+-fold)\b/gi },
];

const KNOWN_DATASETS = [
  "imagenet",
  "cifar-10",
  "cifar-100",
  "mnist",
  "fashion-mnist",
  "sst-2",
  "sst-5",
  "conll-2003",
  "squad",
  "glue",
  "superglue",
  "mmlu",
  "hellaswag",
  "boolq",
  "wmt14",
  "iwslt",
  "librispeech",
  "coco",
  "ade20k",
  "pascal voc",
  "wikitext",
  "ptb",
  "claimbench",
  "ms-coco",
  "voc2012",
  "cityscapes",
  "kinetics",
  "openimages",
  "cc3m",
  "laion",
];

export function extractContext(text: string, focusStart = 0, focusEnd = text.length): TextContext {
  const splits = new Set<string>();
  for (const term of SPLIT_TERMS) {
    term.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = term.pattern.exec(text)) !== null) {
      splits.add(term.canonical);
    }
  }

  const datasets = new Set<string>();
  const lower = text.toLowerCase();
  for (const dataset of KNOWN_DATASETS) {
    if (lower.includes(dataset)) datasets.add(dataset);
  }
  const datasetPattern = /\b([A-Z][A-Za-z]*[-\u2013]\d+[A-Za-z]?)\b/g;
  let datasetMatch: RegExpExecArray | null;
  while ((datasetMatch = datasetPattern.exec(text)) !== null) {
    if (datasetMatch[1]) datasets.add(datasetMatch[1].toLowerCase());
  }

  // Translation directions are a distinct experimental condition even when the
  // benchmark name (e.g. WMT 2014) is identical.
  const languagePairs = new Set<string>();
  const languagePairPattern =
    /\b(english|german|french|spanish|italian|portuguese|dutch|russian|chinese|japanese|korean|arabic|hindi|turkish|finnish|swedish|czech|polish|vietnamese|thai|indonesian)\s*(?:[-\u2013\u2014]\s*)?(?:to|\u2192|->)\s*(?:[-\u2013\u2014]\s*)?(english|german|french|spanish|italian|portuguese|dutch|russian|chinese|japanese|korean|arabic|hindi|turkish|finnish|swedish|czech|polish|vietnamese|thai|indonesian)\b/gi;
  let pairMatch: RegExpExecArray | null;
  while ((pairMatch = languagePairPattern.exec(text)) !== null) {
    const from = pairMatch[1]?.toLowerCase();
    const to = pairMatch[2]?.toLowerCase();
    if (from && to && from !== to) languagePairs.add(`${from}\u2192${to}`);
  }
  const hyphenPairPattern =
    /\b(english|german|french|spanish|italian|portuguese|dutch|russian|chinese|japanese|korean|arabic|hindi|turkish|finnish|swedish|czech|polish|vietnamese|thai|indonesian)\s*[-\u2013\u2014]\s*(english|german|french|spanish|italian|portuguese|dutch|russian|chinese|japanese|korean|arabic|hindi|turkish|finnish|swedish|czech|polish|vietnamese|thai|indonesian)\b/gi;
  while ((pairMatch = hyphenPairPattern.exec(text)) !== null) {
    const from = pairMatch[1]?.toLowerCase();
    const to = pairMatch[2]?.toLowerCase();
    if (from && to && from !== to) languagePairs.add(`${from}\u2192${to}`);
  }

  const windowStart = Math.max(0, focusStart - 120);
  const windowEnd = Math.min(text.length, focusEnd + 120);
  const window = text.slice(windowStart, windowEnd);

  return {
    splits,
    datasets,
    languagePairs,
    mentionsOurs: /\b(our|proposed|this (?:paper|work|study)|the model|the framework|the approach)\b/i.test(window),
    mentionsBaseline: /\bbaseline\b|\bcompeting (?:method|model)s?\b|\bprevious (?:method|work)s?\b/i.test(window),
    mentionsCondition:
      /\b(ablation|ablated|remov(?:e|es|ed|ing)|without|variant|reduced|only when|no retrieval|w\/o|under this condition|in this setting)\b/i.test(
        window,
      ),
  };
}

export function contextAsymmetry(
  claimContext: TextContext,
  evidenceContext: TextContext,
): string | null {
  const dimensions: {
    label: string;
    left: Set<string>;
    right: Set<string>;
  }[] = [
    { label: "dataset", left: claimContext.datasets, right: evidenceContext.datasets },
    { label: "data split", left: claimContext.splits, right: evidenceContext.splits },
    { label: "language pair", left: claimContext.languagePairs, right: evidenceContext.languagePairs },
  ];
  for (const dimension of dimensions) {
    if ((dimension.left.size === 0) !== (dimension.right.size === 0)) {
      return `Only one passage identifies a ${dimension.label}, so the differing values were not treated as a contradiction.`;
    }
  }
  return null;
}

export function contextsComparable(
  claimContext: TextContext,
  evidenceContext: TextContext,
): { comparable: boolean; reason?: string } {
  if (claimContext.splits.size > 0 && evidenceContext.splits.size > 0) {
    const overlap = [...claimContext.splits].some((split) => evidenceContext.splits.has(split));
    if (!overlap) {
      return {
        comparable: false,
        reason: `The claim refers to ${[...claimContext.splits].join("/")} data while the evidence refers to ${[...evidenceContext.splits].join("/")} data.`,
      };
    }
  }
  if (claimContext.datasets.size > 0 && evidenceContext.datasets.size > 0) {
    const overlap = [...claimContext.datasets].some((dataset) => evidenceContext.datasets.has(dataset));
    if (!overlap) {
      return {
        comparable: false,
        reason: `The claim concerns ${[...claimContext.datasets].join(", ")} while the evidence concerns ${[...evidenceContext.datasets].join(", ")}.`,
      };
    }
  }
  if (claimContext.languagePairs.size > 0 && evidenceContext.languagePairs.size > 0) {
    const overlap = [...claimContext.languagePairs].some((pair) => evidenceContext.languagePairs.has(pair));
    if (!overlap) {
      return {
        comparable: false,
        reason: `The claim reports a ${[...claimContext.languagePairs].join("/")} result while the evidence reports ${[...evidenceContext.languagePairs].join("/")}.`,
      };
    }
  }
  if (claimContext.mentionsCondition !== evidenceContext.mentionsCondition) {
    return {
      comparable: false,
      reason:
        "One passage describes an ablation, variant, or conditional setting while the other reports a main result. The values are not directly comparable.",
    };
  }
  return { comparable: true };
}

const STOPWORDS = new Set(
  `a an and are as at be been being both but by can could did do does for from had has have how if in into is it its may might more most much must no not of on only or other our out over said same should so some such than that the their them then there these they this those through to under up use used using very was we were what when where which while who will with within would you your also all any each per via across between during however therefore thus furthermore moreover although whereas because about above after again against among before below further here once own too s t don now`.split(
    /\s+/,
  ),
);

export function contentTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/\[[0-9,\s-]+\]/g, " ")
    .replace(/[^a-z0-9%.-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
  return new Set(
    tokens.map((token) => {
      if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
      if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
      if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
      return token;
    }),
  );
}

export function lexicalSimilarity(a: string, b: string): number {
  const left = contentTokens(a);
  const right = contentTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function containsCitation(text: string): boolean {
  return /\[\s*\d+(?:\s*[,\u2013-]\s*\d+)*\s*\]/.test(text) || /\([A-Z][A-Za-z-]+(?:\s+et al\.)?,?\s+(?:19|20)\d{2}[a-z]?\)/.test(text);
}

export function isStatisticalClaim(text: string): boolean {
  // "Significant improvements in efficiency" is ordinary prose, not a
  // statistical-significance assertion. Require explicit statistical framing.
  return (
    /\bstatistically significant(?:ly)?\b/i.test(text) ||
    /\bsignificant(?:ly)?\s+(?:better|higher|lower|worse|improved|reduced|outperform\w*|difference)\b/i.test(text) ||
    /\bsignificant difference\b/i.test(text)
  );
}

export function containsStatisticalEvidence(text: string): boolean {
  return (
    /\bp\s*(?:<|>|=|\u2264|\u2265)\s*0?\.\d+/i.test(text) ||
    /\b(?:confidence interval|credible interval|\bCI\b)\b/i.test(text) ||
    /\b(?:t-test|wilcoxon|mann[- ]whitney|anova|kruskal[- ]wallis|chi[- ]squared|bootstrap|permutation test|effect size|cohen'?s d)\b/i.test(text) ||
    /\bstandard (?:deviation|error)\b/i.test(text) ||
    /\b(?:error bars?|\u00b1)\b/i.test(text)
  );
}

export function extractReferencedObjects(text: string): { kind: "table" | "figure"; label: string }[] {
  const results: { kind: "table" | "figure"; label: string }[] = [];
  const regex = /\b(Table|Figure|Fig\.)\s+([0-9]+[A-Za-z]?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const label = String(match[2]).toUpperCase();
    const kind = (match[1] ?? "").toLowerCase().startsWith("fig") ? "figure" : "table";
    if (!results.some((entry) => entry.kind === kind && entry.label === label)) {
      results.push({ kind, label });
    }
  }
  return results;
}

export function isUniversalClaim(text: string): boolean {
  return (
    /\b(outperform(?:s|ed|ing)?|superior to|better than|beats?)\s+(?:all|every|each)\b/i.test(text) ||
    /\b(?:all|every)\s+(?:of the\s+)?(?:baselines?|competing methods?|competitors?|existing methods?|prior methods?)\b/i.test(text) ||
    /\bstate[- ]of[- ]the[- ]art\b|\bSOTA\b|\bbest[- ]performing\b|\buniversally\b|\bmost (?:reliable|effective|accurate)\b/i.test(text) ||
    /\bgeneraliz(?:e|es|ed|ing)\s+(?:across|to)\s+(?:all|any|unseen)\b/i.test(text) ||
    /\ball domains?\b/i.test(text)
  );
}

export function isBroadGeneralization(text: string): boolean {
  return (
    /\bgeneraliz(?:e|es|ed|ing)\s+(?:across|to)\s+(?:all|any|unseen)\b/i.test(text) ||
    /\ball domains?\b|\bany domain\b/i.test(text) ||
    /\bworks? (?:for|on) (?:all|any)\b/i.test(text)
  );
}

export function shorten(text: string, max = 120): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}\u2026`;
}

// ---------------------------------------------------------------------------
// Methodology audit helpers (Objective 4)
// ---------------------------------------------------------------------------

/**
 * Checks whether the given body of text contains a dataset size or sample count
 * description (e.g. "1,234 samples", "N = 500", "a dataset of 10,000 examples").
 */
export function mentionsDatasetSize(text: string): boolean {
  return (
    /\b(?:N|n)\s*=\s*\d[\d,]*/i.test(text) ||
    /\b\d[\d,]*\s+(?:samples?|examples?|instances?|records?|images?|sentences?|documents?|patients?|subjects?|participants?|observations?)\b/i.test(text) ||
    /\bdataset\s+(?:of|with|contains?|consisting of)\s+\d/i.test(text) ||
    /\btraining\s+(?:set|split|partition)\s+(?:of|with|contains?)\s+\d/i.test(text) ||
    /\b(?:collected|annotated|gathered|curated)\s+\d[\d,]*\b/i.test(text)
  );
}

/**
 * Checks whether the given text describes evaluation metrics used in the experiment.
 */
export function mentionsEvaluationMetrics(text: string): boolean {
  return METRIC_TERMS.some((term) => {
    term.pattern.lastIndex = 0;
    return term.pattern.test(text);
  });
}

/**
 * Checks whether the text mentions train/test splitting or cross-validation.
 */
export function mentionsTrainTestSplit(text: string): boolean {
  return (
    /\b(?:train(?:ing)?|test(?:ing)?|validation|val|development|dev|held[- ]out|holdout)\s+(?:set|split|partition|fold)\b/i.test(text) ||
    /\bcross[- ]validat/i.test(text) ||
    /\b\d+[- ]fold\b/i.test(text) ||
    /\btraining\s+and\s+(?:test|eval|validation)/i.test(text)
  );
}

/**
 * Checks whether the text reports hyperparameters or implementation details.
 */
export function mentionsHyperparameters(text: string): boolean {
  return (
    /\b(?:learning rate|lr|batch size|epoch|hidden (?:size|units|dim)|dropout|weight decay|optimizer|adam|sgd|momentum|scheduler|warmup|temperature|lambda|regularization|kernel size|number of layers|num_layers|hidden_dim|embedding size|attention heads?)\b/i.test(text)
  );
}

/**
 * Checks whether the text mentions baseline or comparison methods.
 */
export function mentionsBaselinesText(text: string): boolean {
  return (
    /\b(?:baseline|baselines|compared? (?:to|with|against)|comparison methods?|competing methods?|prior methods?|existing methods?|state-of-the-art methods?|SOTA methods?|previous (?:work|method)|prior work|reference system)\b/i.test(text)
  );
}

/**
 * Checks whether the text mentions reproducibility information.
 */
export function mentionsReproducibility(text: string): boolean {
  return (
    /\b(?:code|implementation|repository|github|released|publicly available|open[- ]source|reproducib\w*|replicat\w*)\b/i.test(text)
  );
}

/**
 * Returns the number of distinct numeric citation bracket groups in text.
 * e.g. "[1]", "[2, 3]", "[4\u20136]" each count as one group.
 */
export function countNumericCitations(text: string): number {
  let count = 0;
  const regex = /\[\s*\d+(?:\s*[,\u2013-]\s*\d+)*\s*\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) count += 1;
  return count;
}

/**
 * Returns true when the text contains causal language that may not be
 * warranted by correlational or observational evidence.
 */
export function containsCausalLanguage(text: string): boolean {
  return /\b(?:causes?|caused by|leads? to|results? in|due to|because of|enables?|prevents?|drives?|induces?|produces?|gives? rise to)\b/i.test(text);
}

/**
 * Returns true when the text contains language that suggests universal
 * applicability beyond the studied conditions.
 */
export function containsUniversalApplicability(text: string): boolean {
  return (
    /\b(?:always|never|in all cases?|universally|for any|for all|regardless of|independent of|across all|in every)\b/i.test(text) ||
    /\b(?:any dataset|any domain|any language|any task|any setting|in general)\b/i.test(text)
  );
}

// ---------------------------------------------------------------------------
// Citation / reference local-document checks (Objective 6)
// ---------------------------------------------------------------------------

/**
 * Extracts all citation markers from a passage.
 * Returns numeric keys like ["1", "2"] and author-year keys like ["Smith 2020"].
 */
export function extractCitationKeys(text: string): string[] {
  const keys: string[] = [];
  // Numeric: [1], [2,3], [4\u20136]
  const numRe = /\[\s*(\d+)(?:\s*[,\u2013-]\s*(\d+))*\s*\]/g;
  let match: RegExpExecArray | null;
  while ((match = numRe.exec(text)) !== null) {
    const bracketed = match[0].replace(/[\[\]]/g, "");
    const nums = bracketed.split(/[,\u2013-]/).map((s) => s.trim()).filter(Boolean);
    // For ranges like 4\u20136, expand
    if (nums.length === 2) {
      const a = parseInt(nums[0]!, 10);
      const b = parseInt(nums[1]!, 10);
      if (!isNaN(a) && !isNaN(b) && b > a && b - a < 20) {
        for (let i = a; i <= b; i++) keys.push(String(i));
        continue;
      }
    }
    for (const n of nums) if (n) keys.push(n);
  }
  // Author-year: (Smith et al., 2020) or (Jones 2019)
  const authorRe = /\(([A-Z][A-Za-z-]+(?:\s+et al\.?)?,?\s+(?:19|20)\d{2}[a-z]?)\)/g;
  while ((match = authorRe.exec(text)) !== null) {
    if (match[1]) keys.push(match[1].trim());
  }
  return [...new Set(keys)];
}

/**
 * Parse a references section text and return a map from citation key to reference text.
 * Handles numeric [1] Author... formats.
 */
export function parseReferenceList(refText: string): Map<string, string> {
  const result = new Map<string, string>();
  // Numeric references: "[1] Author..."
  const numRe = /\[(\d+)\]\s+([^\[]{5,}?)(?=\[\d+\]|$)/gs;
  let match: RegExpExecArray | null;
  while ((match = numRe.exec(refText)) !== null) {
    if (match[1] && match[2]) result.set(match[1].trim(), match[2].trim());
  }
  return result;
}

/**
 * Result of a citation consistency check within the extracted document.
 */
export interface CitationIssues {
  /** Citation keys used in-text but not found in references section. */
  unusedInReferences: string[];
  /** Reference keys defined but never cited in body. */
  uncitedReferences: string[];
  /** Whether a references section was detected at all. */
  hasReferencesSection: boolean;
}

/**
 * Checks citation consistency within extracted document text.
 */
export function checkCitationConsistency(bodyText: string, refText: string | null): CitationIssues {
  const hasReferencesSection = refText !== null && refText.trim().length > 20;
  if (!hasReferencesSection) {
    return { unusedInReferences: [], uncitedReferences: [], hasReferencesSection: false };
  }
  const bodyCitations = new Set(extractCitationKeys(bodyText));
  const refMap = parseReferenceList(refText!);
  const refKeys = new Set(refMap.keys());

  const unusedInReferences = [...bodyCitations].filter((key) => !refKeys.has(key));
  const uncitedReferences = [...refKeys].filter((key) => !bodyCitations.has(key));
  return { unusedInReferences, uncitedReferences, hasReferencesSection: true };
}

// ---------------------------------------------------------------------------
// Symbol-bound values and stated changes
// ---------------------------------------------------------------------------

/** A value bound to a named symbol in the text, e.g. "ρ = 0.314" or "ΔYI = +11.7". */
export interface SymbolValue {
  symbol: string;
  value: number;
  decimals: number;
  /** The value exactly as written ("+11.7", "0.30"). */
  valueText: string;
  raw: string;
  index: number;
  end: number;
}

const SIGNED_NUMBER = String.raw`[+\u2212-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const SYMBOL_VALUE_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.])((?:[\u0394\u2206])?[\p{L}][\p{L}\p{N}]{0,5}(?:\([^()=]{1,16}\))?)\s*(=|\bis\b)\s*(${SIGNED_NUMBER})(?!\d|\.\d|\s*,\s*\d)`,
  "gu",
);
const SYMBOL_STOPWORDS = new Set(["a", "p", "an", "it", "this", "that", "which", "there", "value", "score", "result", "total"]);

function parseSigned(raw: string): { value: number; decimals: number } {
  const normalized = raw.replace(/\u2212/g, "-");
  const decimals = normalized.includes(".") ? normalized.split(".")[1]!.length : 0;
  return { value: Number(normalized), decimals };
}

function normalizeSymbol(symbol: string): string {
  return symbol.replace(/\u2206/g, "\u0394").replace(/\s+/g, "");
}

/**
 * Values explicitly assigned to a symbol. "is" binds only for symbols that are
 * clearly notation (Greek or Δ-prefixed), so prose like "the gain is 5" is skipped.
 */
export function extractSymbolValues(text: string): SymbolValue[] {
  const values: SymbolValue[] = [];
  for (const match of text.matchAll(SYMBOL_VALUE_RE)) {
    const symbol = normalizeSymbol(match[1] ?? "");
    const binder = match[2] ?? "=";
    if (!symbol || SYMBOL_STOPWORDS.has(symbol.toLowerCase())) continue;
    const notation = /[\u0370-\u03ff\u0394]/u.test(symbol);
    if (binder === "is" && !notation) continue;
    // Multi-letter lowercase words ("rate = 3") are prose, not notation, unless Greek.
    if (/^[a-z]{3,}$/.test(symbol) && !notation) continue;
    const { value, decimals } = parseSigned(match[3] ?? "");
    if (!Number.isFinite(value)) continue;
    const index = match.index ?? 0;
    values.push({ symbol, value, decimals, valueText: match[3] ?? "", raw: match[0], index, end: index + match[0].length });
  }
  return values;
}

/** Two reported values agree when they are equal up to the precision of the less precise one. */
export function roundedEqual(a: { value: number; decimals: number }, b: { value: number; decimals: number }): boolean {
  const precision = Math.min(a.decimals, b.decimals);
  return Math.abs(a.value - b.value) <= 0.5 * 10 ** -precision + 1e-9;
}

/** "rises from 48.0 to 59.7 (ΔYI = +11.7)": endpoints plus an explicitly stated signed change. */
export interface StatedChange {
  from: number;
  to: number;
  delta: number;
  /** Endpoints and change exactly as written. */
  fromText: string;
  toText: string;
  deltaText: string;
  computed: number;
  tolerance: number;
  consistent: boolean;
  raw: string;
  index: number;
  end: number;
}

const STATED_CHANGE_RE = new RegExp(
  String.raw`\bfrom\s+(${SIGNED_NUMBER})(\s?%)?\s+to\s+(${SIGNED_NUMBER})(\s?%)?[^.;()]{0,40}?\(\s*(?:[^()=]{1,20}=\s*)?([+\u2212-](?:\d+(?:\.\d+)?|\.\d+))(\s?%|\s?pp\b|\s?percentage points?)?\s*\)`,
  "giu",
);

/**
 * Only explicit, signed, parenthesised changes are checked. A "%" change next
 * to percentage endpoints is skipped: it may be relative rather than absolute.
 */
export function extractStatedChanges(text: string): StatedChange[] {
  const changes: StatedChange[] = [];
  for (const match of text.matchAll(STATED_CHANGE_RE)) {
    const endpointsPercent = Boolean(match[2] || match[4]);
    const deltaUnit = (match[6] ?? "").trim().toLowerCase();
    if (endpointsPercent && deltaUnit === "%") continue;
    if (!endpointsPercent && deltaUnit) continue;
    const from = parseSigned(match[1] ?? "");
    const to = parseSigned(match[3] ?? "");
    const delta = parseSigned(match[5] ?? "");
    if (![from.value, to.value, delta.value].every(Number.isFinite)) continue;
    const computed = to.value - from.value;
    // Each endpoint may be rounded by half a unit in its last place, and so may the change.
    const endpointDecimals = Math.max(from.decimals, to.decimals);
    const tolerance = 10 ** -endpointDecimals + 0.5 * 10 ** -delta.decimals + 1e-9;
    const index = match.index ?? 0;
    changes.push({
      from: from.value,
      to: to.value,
      delta: delta.value,
      fromText: match[1] ?? "",
      toText: match[3] ?? "",
      deltaText: match[5] ?? "",
      computed,
      tolerance,
      consistent: Math.abs(computed - delta.value) <= tolerance,
      raw: match[0],
      index,
      end: index + match[0].length,
    });
  }
  return changes;
}
