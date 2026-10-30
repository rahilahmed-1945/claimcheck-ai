import type {
  AuditSummary,
  CheckRun,
  EvidenceRef,
  Finding,
  FindingCategory,
  NumericComparison,
} from "../../../shared/types.js";
import type { ExtractedDocument, ParsedTable, Sentence } from "../pdf/extract.js";
import {
  canonicalMetricName,
  containsCitation,
  containsStatisticalEvidence,
  containsCausalLanguage,
  containsUniversalApplicability,
  contentTokens,
  contextAsymmetry,
  contextsComparable,
  datasetDisplayName,
  extractContext,
  extractNumericFacts,
  extractReferencedObjects,
  extractStatedChanges,
  extractSymbolValues,
  formatDelta,
  formatPercentValue,
  isBroadGeneralization,
  isStatisticalClaim,
  isUniversalClaim,
  lexicalSimilarity,
  mentionsBaselinesText,
  mentionsDatasetSize,
  mentionsEvaluationMetrics,
  mentionsHyperparameters,
  mentionsReproducibility,
  mentionsTrainTestSplit,
  metricLabel,
  normalizeToPercent,
  roundedEqual,
  shorten,
  valuesEquivalent,
  type NumericFact,
  type StatedChange,
  type SymbolValue,
  type TextContext,
} from "./text.js";
import { matchTableCells, type CellMatch } from "./tables.js";

interface CorpusItem {
  id: string;
  kind: "sentence" | "table_row";
  text: string;
  page: number;
  sectionId: string;
  sectionTitle: string;
  sectionCanonical: string;
  offset: number | null;
  facts: NumericFact[];
  context: TextContext;
  tableLabel?: string;
  tableReliable?: boolean;
  method?: string;
  isOursRow?: boolean;
  isBaselineRow?: boolean;
  similarity?: number;
}

interface ClaimCandidate {
  sentence: Sentence;
  score: number;
  facts: NumericFact[];
}

const MAX_CLAIMS = 40;
const SEVERITY_ORDER: Record<FindingCategory, number> = {
  potential_contradiction: 0,
  potentially_unsupported: 1,
  partially_supported: 2,
  needs_review: 3,
  supported: 4,
};

function evidenceId(prefix: string, itemId: string, index: number): string {
  return `${prefix}-${itemId}-${index}`;
}

function isOursLabel(label: string): boolean {
  return /\b(ours?|our (?:method|model|approach|system)|proposed|this (?:paper|work|method)|claimcheck)\b/i.test(label);
}

function isBaselineLabel(label: string): boolean {
  return /\b(baseline|prior|previous|existing|competing|competitor)\b/i.test(label);
}

function tableRowItems(extracted: ExtractedDocument): CorpusItem[] {
  const items: CorpusItem[] = [];
  for (const table of extracted.parsedTables) {
    const header = table.info.header;
    for (let rowIndex = 1; rowIndex < table.cells.length; rowIndex += 1) {
      const cells = table.cells[rowIndex];
      const quote = table.rowQuotes[rowIndex];
      if (!cells || !quote) continue;
      const method = cells[0] ?? "";
      const facts: NumericFact[] = [];
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
        const cell = cells[cellIndex] ?? "";
        if (!/\d/.test(cell)) continue;
        const headerMetric = canonicalMetricName(header[cellIndex] ?? "");
        const cellFacts = extractNumericFacts(cell);
        for (const fact of cellFacts) {
          facts.push({
            ...fact,
            metricKey: fact.metricKey ?? headerMetric?.key ?? null,
            metric: fact.metric ?? headerMetric?.label ?? null,
          });
        }
      }
      const offset = extracted.text.indexOf(quote);
      items.push({
        id: table.info.id + "-r" + rowIndex,
        kind: "table_row",
        text: quote,
        page: table.info.page,
        sectionId: "",
        sectionTitle: table.info.sectionTitle,
        sectionCanonical: "results",
        offset: offset >= 0 ? offset : null,
        facts,
        context: extractContext(`${table.info.caption} ${cells.join(" ")}`),
        tableLabel: table.info.label,
        tableReliable: table.info.reliable,
        method,
        isOursRow: isOursLabel(method),
        isBaselineRow: isBaselineLabel(method),
      });
    }
  }
  return items;
}

function buildCorpus(extracted: ExtractedDocument): CorpusItem[] {
  const sentences: CorpusItem[] = extracted.sentences.map((sentence, index) => ({
    id: `s-${index}`,
    kind: "sentence",
    text: sentence.text,
    page: sentence.page,
    sectionId: sentence.sectionId,
    sectionTitle: sentence.sectionTitle,
    sectionCanonical: sentence.sectionCanonical,
    offset: sentence.startOffset,
    facts: extractNumericFacts(sentence.text),
    context: extractContext(sentence.text),
  }));
  return [...sentences, ...tableRowItems(extracted)];
}

function mergeContexts(left: TextContext, right: TextContext): TextContext {
  return {
    splits: new Set([...left.splits, ...right.splits]),
    datasets: new Set([...left.datasets, ...right.datasets]),
    languagePairs: new Set([...left.languagePairs, ...right.languagePairs]),
    mentionsOurs: left.mentionsOurs || right.mentionsOurs,
    mentionsBaseline: left.mentionsBaseline || right.mentionsBaseline,
    mentionsCondition: left.mentionsCondition || right.mentionsCondition,
  };
}

function sectionWeight(canonical: string): number {
  switch (canonical) {
    case "abstract":
      return 0.7;
    case "conclusion":
      return 0.6;
    case "results":
    case "discussion":
      return 0.5;
    case "introduction":
      return 0.3;
    case "methods":
      return 0.2;
    case "appendix":
      return 0.1;
    case "subsection":
      return 0.3;
    default:
      return 0.15;
  }
}

function addressesOwnWork(sentence: Sentence): boolean {
  const text = sentence.text;
  if (/\b(our|we|this (?:paper|work|study)|the proposed)\b/i.test(text)) return true;
  if (
    ["discussion", "conclusion"].includes(sentence.sectionCanonical) &&
    /\b(achiev\w*|establish\w*|outperform\w*|generaliz\w*|demonstrat\w*|gains?|results?|findings?|should)\b/i.test(text)
  ) {
    return true;
  }
  return /\b(?:the|this)\s+(?:model|method|approach|framework|system|classifier)\b/i.test(text);
}

function scoreClaim(
  sentence: Sentence,
  captions: ExtractedDocument["captions"],
  tables: ParsedTable[] = [],
): number {
  const text = sentence.text;
  if (text.length < 25 || text.length > 700) return 0;
  // Caption lines are not claims. A prose sentence such as “Table 5 reports…”
  // is still a traceable reference and must remain eligible for auditing.
  if (/^(figure|table|fig\.)\s+\d+\s*[.:]/i.test(text)) return 0;
  if (/^(we|the authors)\s+(thank|acknowledge)/i.test(text)) return 0;

  const facts = extractNumericFacts(text);
  const metricFacts = facts.filter((fact) => fact.kind === "metric");
  const hasMetric = metricFacts.some((fact) => fact.metricKey !== null);
  const hasQuant = metricFacts.length > 0;
  const hasPValue = facts.some((fact) => fact.kind === "pvalue");
  const referenced = extractReferencedObjects(text);

  const resultCue =
    /\b(achiev\w*|reach\w*|obtain\w*|report\w*|improv\w*|outperform\w*|surpass\w*|exceed\w*|yield\w*|gain\w*|reduc\w*|increase\w*|ris(?:e|es|ing)|rose|fall(?:s|ing)?|fell|drop(?:s|ped)?|grow(?:s|n)?|grew|higher|lower|better|worse|decline\w*)\b/i.test(
      text,
    );
  const comparative =
    /\b(outperform\w*|surpass\w*|better than|worse than|superior|inferior|higher than|lower than|more accurate|less accurate|faster|slower|compare[sd]? (?:with|to|against))\b/i.test(
      text,
    );
  const statistical = isStatisticalClaim(text);
  const universal = isUniversalClaim(text);
  const broad = isBroadGeneralization(text);
  const scopeCue = (universal || broad) && addressesOwnWork(sentence);

  const hasUnlabeledPercent = doesHaveUnlabeledPercent(facts);
  if (!hasQuant && !hasPValue && !statistical && !scopeCue && !comparative && referenced.length === 0 && !hasUnlabeledPercent) {
    return 0;
  }

  const procedural =
    /^(we|the authors|this (?:paper|study))\s+(use|used|uses|train|trained|trains|split|splits|collected|collect|recruited|recruit|conducted|conduct|implement|implemented|follow|followed)\b/i.test(
      text,
    );
  if (procedural && !resultCue && !comparative && !scopeCue && !statistical) return 0;

  let score = 0;
  if (hasMetric) score += 3;
  if (hasUnlabeledPercent && !hasMetric) score += 1.5;
  if (hasPValue) score += 2;
  if (resultCue && hasQuant) score += 1;
  if (resultCue && hasUnlabeledPercent && !hasQuant) score += 1.5;
  // Multiple non-metric numeric values with a result cue = quantitative prose claim
  // (e.g. index values, scores, probabilities without a metric label).
  if (resultCue && !hasMetric && metricFacts.length >= 2) score += 1.2;
  if (comparative) score += 2;
  // An explicitly stated change ("from 48.0 to 59.7 (+11.7)") is directly checkable.
  if (extractStatedChanges(text).length > 0) score += 2;
  // A sentence that restates a value from an identified table row is directly
  // checkable, even without a metric name (row labels and values must agree).
  if (!hasMetric && matchTableCells(text, tables).supports.length > 0) score += 2;
  if (statistical) score += 2.2;
  if (scopeCue) score += 2;
  if (scopeCue && broad) score += 0.5;
  // A prose reference only becomes auditable when it points at an object the
  // extractor could not locate. “Table 2 reports…” is otherwise metadata.
  const missingReference = referenced.some(
    (reference) =>
      !captions.some((caption) => caption.kind === reference.kind && caption.label === reference.label),
  );
  if (referenced.length > 0 && missingReference) score += 2;

  // Sentences packed with too many *labeled* metric values are often table-like rows.
  // Apply the penalty only to named-metric facts; unlabeled index values
  // legitimately appear in dense quantitative prose.
  if (metricFacts.filter((f) => f.metricKey !== null).length > 6) score -= 1;

  return score + sectionWeight(sentence.sectionCanonical);
}

function doesHaveUnlabeledPercent(facts: NumericFact[]): boolean {
  return facts.some((fact) => fact.kind === "metric" && fact.unit === "percent");
}

function selectClaims(extracted: ExtractedDocument): ClaimCandidate[] {
  const scored: ClaimCandidate[] = [];
  for (const sentence of extracted.sentences) {
    const score = scoreClaim(sentence, extracted.captions, extracted.parsedTables);
    if (score < 2.5) continue;
    scored.push({ sentence, score, facts: extractNumericFacts(sentence.text) });
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, MAX_CLAIMS);
  selected.sort((a, b) => a.sentence.startOffset - b.sentence.startOffset);
  return selected;
}

function makeEvidenceRef(
  item: CorpusItem,
  relation: EvidenceRef["relation"],
  prefix: string,
  index: number,
  note?: string,
): EvidenceRef {
  return {
    id: evidenceId(prefix, item.id, index),
    kind: item.kind,
    quote: item.text,
    page: item.page,
    sectionTitle: item.sectionTitle,
    relation,
    offset: item.offset,
    ...(note ? { note } : {}),
  };
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function formatSigned(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)}`;
}

function metadataEvidence(
  prefix: string,
  quote: string,
  note: string,
  page = 0,
): EvidenceRef {
  return {
    id: `${prefix}-metadata`,
    kind: "metadata",
    quote,
    page,
    sectionTitle: "Document structure",
    relation: "context",
    offset: null,
    note,
  };
}

interface Match {
  item: CorpusItem;
  fact: NumericFact;
  similarity: number;
}

function chooseBest(matches: Match[]): Match | null {
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => {
    const tableA = a.item.kind === "table_row" && a.item.tableReliable ? 1 : 0;
    const tableB = b.item.kind === "table_row" && b.item.tableReliable ? 1 : 0;
    if (tableA !== tableB) return tableB - tableA;
    return b.similarity - a.similarity;
  })[0]!;
}

interface TableMethodTarget {
  item: CorpusItem;
  aliases: string[];
}

function buildMethodTargets(corpus: CorpusItem[]): TableMethodTarget[] {
  const targets: TableMethodTarget[] = [];
  for (const item of corpus) {
    if (item.kind !== "table_row" || !item.tableReliable || !item.method) continue;
    const cleaned = item.method.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    if (cleaned.length <= 2) continue;
    if (/^(method|model|system|ours?)$/i.test(cleaned)) continue;
    targets.push({ item, aliases: [cleaned] });
  }
  return targets;
}

function methodTargetForFact(
  fact: NumericFact,
  text: string,
  targets: TableMethodTarget[],
): CorpusItem | null {
  let best: { item: CorpusItem; distance: number } | null = null;
  for (const target of targets) {
    for (const alias of target.aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const distance = start >= fact.index ? start - fact.index : fact.index - end;
        if (distance > 160) continue;
        if (!best || distance < best.distance) best = { item: target.item, distance };
      }
    }
  }
  return best?.item ?? null;
}

function countBaselines(extracted: ExtractedDocument, resultsText: string): {
  labels: string[];
  rows: CorpusItem[];
} {
  const labels = new Set<string>();
  const rows: CorpusItem[] = [];
  const corpus = tableRowItems(extracted);
  for (const item of corpus) {
    if (!item.tableReliable || !item.isBaselineRow) continue;
    const method = (item.method ?? "").trim();
    if (!method) continue;
    const key = method.toLowerCase();
    labels.add(method);
    if (!rows.some((row) => (row.method ?? "").toLowerCase() === key)) rows.push(item);
  }
  const regex = /\bbaseline\s+([A-Z][A-Za-z0-9-]{0,20}|[0-9]{1,2})\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(resultsText)) !== null) {
    const label = match[1]?.trim();
    if (label && label.length > 0) labels.add(`Baseline ${label}`);
  }
  return { labels: [...labels], rows };
}

function countDatasets(resultsText: string): string[] {
  return [...extractContext(resultsText).datasets];
}

function resultsText(extracted: ExtractedDocument): string {
  return extracted.sentences
    .filter((sentence) =>
      ["results", "discussion", "conclusion", "abstract", "methods", "experiments"].includes(
        sentence.sectionCanonical,
      ),
    )
    .map((sentence) => sentence.text)
    .join(" ");
}

interface ClaimEvaluation {
  claim: Sentence;
  facts: NumericFact[];
  category: FindingCategory;
  title: string;
  rationale: string;
  confidence: Finding["confidence"];
  checks: CheckRun[];
  evidence: EvidenceRef[];
  comparisons: NumericComparison[];
  limitations: string[];
  primaryIssue: string;
}

function evaluateClaim(
  claim: Sentence,
  corpus: CorpusItem[],
  extracted: ExtractedDocument,
  index: number,
): ClaimEvaluation {
  const facts = extractNumericFacts(claim.text);
  const metricFacts = facts.filter((fact) => fact.kind === "metric");
  const namedMetricFacts = metricFacts.filter((fact) => fact.metricKey && fact.metricKey !== "pvalue");
  const claimContext = extractContext(claim.text);
  const claimIsOurs = claimContext.mentionsOurs || /\bour\b|\bwe\b/i.test(claim.text);
  const results = resultsText(extracted);
  const baselines = countBaselines(extracted, results);
  const datasets = countDatasets(results);
  const methodTargets = buildMethodTargets(corpus);
  const factTargets = new Map<NumericFact, CorpusItem | null>();
  for (const fact of namedMetricFacts) {
    factTargets.set(fact, methodTargetForFact(fact, claim.text, methodTargets));
  }
  const sourceItems = corpus.filter(
    (item) => !(item.kind === "sentence" && item.offset === claim.startOffset),
  );

  const checks: CheckRun[] = [];
  const evidence: EvidenceRef[] = [];
  const comparisons: NumericComparison[] = [];
  const limitations: string[] = [
    "A classification describes the relationship between this sentence and the extracted document. It is not a judgment about the research itself.",
  ];

  const supportMatches: Match[] = [];
  const conflictMatches: Match[] = [];
  const contextMatches: Match[] = [];
  const unlocatedMetrics: string[] = [];
  const conflictingFacts: { claimFact: NumericFact; match: Match }[] = [];
  const supportingFacts: { claimFact: NumericFact; match: Match }[] = [];
  const contextReasons: string[] = [];

  for (const item of sourceItems) {
    const similarity = lexicalSimilarity(claim.text, item.text);
    item.similarity = similarity;

    if (
      item.kind === "sentence" &&
      item.sectionId === claim.sectionId
    ) {
      // Same-section passages can support a claim, but are not used to declare a contradiction.
    }

    for (const claimFact of namedMetricFacts) {
      for (const evidenceFact of item.facts) {
        if (evidenceFact.kind !== "metric") continue;
        if (evidenceFact.metricKey !== claimFact.metricKey) continue;
        if (item.kind === "table_row" && !item.tableReliable) continue;
        const claimTarget = factTargets.get(claimFact) ?? null;
        if (item.kind === "table_row") {
          // Only compare a value with the row whose method is named near that value.
          if (claimTarget ? item.id !== claimTarget.id : !item.isOursRow) continue;
        } else if (claimTarget) {
          const evidenceTarget = methodTargetForFact(evidenceFact, item.text, methodTargets);
          if (evidenceTarget && evidenceTarget.id !== claimTarget.id) continue;
        }

        const claimCtx = extractContext(claim.text, claimFact.index, claimFact.index + claimFact.raw.length);
        const localEvidenceCtx = extractContext(
          item.text,
          evidenceFact.index,
          evidenceFact.index + evidenceFact.raw.length,
        );
        // A table row's value is only meaningful alongside its caption. Without
        // the caption, different benchmark tables look like one experiment.
        const evidenceCtx =
          item.kind === "table_row" ? mergeContexts(localEvidenceCtx, item.context) : localEvidenceCtx;
        const comparability = contextsComparable(claimCtx, evidenceCtx);
        if (!comparability.comparable) {
          if (comparability.reason && !contextReasons.includes(comparability.reason)) {
            contextReasons.push(comparability.reason);
          }
          continue;
        }

        if (item.context.mentionsBaseline && !item.context.mentionsOurs && claimIsOurs) continue;

        const equivalent = valuesEquivalent(claimFact, evidenceFact);
        if (equivalent === null) continue;

        if (equivalent) {
          supportingFacts.push({ claimFact, match: { item, fact: evidenceFact, similarity } });
        } else {
          if (
            item.kind === "sentence" &&
            item.sectionId === claim.sectionId
          ) {
            continue;
          }
          if (item.kind === "sentence" && similarity < 0.06) continue;
          // A conflict is only useful if both passages describe the same
          // evaluation condition. If only one names a dataset, split, or
          // language pair, the difference is unexplained rather than a conflict.
          // Table captions are the authoritative context for a row. A claim
          // beside a table need not repeat “test split” in the same sentence.
          const asymmetry = item.kind === "sentence" ? contextAsymmetry(claimCtx, evidenceCtx) : null;
          if (asymmetry) {
            if (!contextReasons.includes(asymmetry)) contextReasons.push(asymmetry);
            continue;
          }
          conflictingFacts.push({ claimFact, match: { item, fact: evidenceFact, similarity } });
        }
      }
    }

    if (similarity >= 0.08) {
      const overlapFacts = namedMetricFacts.some((claimFact) =>
        item.facts.some(
          (evidenceFact) =>
            evidenceFact.kind === "metric" && evidenceFact.metricKey === claimFact.metricKey,
        ),
      );
      const score =
        similarity * 5 +
        (overlapFacts ? 1.5 : 0) +
        (item.kind === "table_row" ? 0.4 : 0) +
        (claim.sectionCanonical === "abstract" && ["results", "discussion"].includes(item.sectionCanonical) ? 0.8 : 0) +
        (claim.sectionCanonical === "conclusion" && item.sectionCanonical === "results" ? 0.6 : 0);
      // Context evidence threshold is intentionally lower than the numeric-match threshold.
      // These items are only used when no direct numeric support/conflict was found, and
      // they are explicitly labelled "context" — not "supports" — in the output.
      if (score >= 0.5) contextMatches.push({ item, fact: item.facts[0] ?? ({} as NumericFact), similarity });
    }
  }

  // Deduplicate by item and choose the strongest matches for each claim fact.
  const uniqueItems = (matches: Match[]) => {
    const seen = new Set<string>();
    return matches.filter((match) => {
      if (seen.has(match.item.id)) return false;
      seen.add(match.item.id);
      return true;
    });
  };

  const normalizedKey = (fact: NumericFact) => {
    const value = normalizeToPercent(fact);
    return `${fact.metricKey}|${value === null ? fact.raw : Math.round(value * 1000) / 1000}`;
  };
  const tableSupportedClaimKeys = new Set(
    supportingFacts
      .filter((entry) => entry.match.item.kind === "table_row" && entry.match.item.tableReliable)
      .map((entry) => normalizedKey(entry.claimFact)),
  );
  const effectiveConflicts = conflictingFacts.filter(
    (entry) => !tableSupportedClaimKeys.has(normalizedKey(entry.claimFact)),
  );
  const suppressedConflicts = conflictingFacts.length - effectiveConflicts.length;

  const sortedConflictFacts = [...effectiveConflicts].sort((a, b) => {
    const tableA = a.match.item.kind === "table_row" ? 1 : 0;
    const tableB = b.match.item.kind === "table_row" ? 1 : 0;
    if (tableA !== tableB) return tableB - tableA;
    return b.match.similarity - a.match.similarity;
  });
  const sortedSupportingFacts = [...supportingFacts].sort((a, b) => {
    const tableA = a.match.item.kind === "table_row" ? 1 : 0;
    const tableB = b.match.item.kind === "table_row" ? 1 : 0;
    if (tableA !== tableB) return tableB - tableA;
    return b.match.similarity - a.match.similarity;
  });

  // Keep the same table-first priority as the rationale and numeric trace so
  // the displayed quotations are the evidence actually being described.
  const uniqueConflict = uniqueItems(sortedConflictFacts.map((entry) => entry.match));
  const uniqueSupport = uniqueItems(sortedSupportingFacts.map((entry) => entry.match));
  const uniqueConflictItems = uniqueConflict.slice(0, 2);
  const uniqueSupportItems = uniqueSupport.slice(0, 2);

  const bestConflict = chooseBest(effectiveConflicts.map((entry) => entry.match));
  const supportedMetricKeys = new Set(
    supportingFacts.map((entry) => entry.claimFact.metricKey).filter((key): key is string => Boolean(key)),
  );
  const conflictMetricKeys = new Set(
    effectiveConflicts.map((entry) => entry.claimFact.metricKey).filter((key): key is string => Boolean(key)),
  );
  for (const fact of namedMetricFacts) {
    if (!supportedMetricKeys.has(fact.metricKey!) && !conflictMetricKeys.has(fact.metricKey!)) {
      unlocatedMetrics.push(metricLabel(fact.metricKey));
    }
  }
  const uniqueUnlocated = [...new Set(unlocatedMetrics)];

  for (const match of uniqueConflictItems) {
    evidence.push(
      makeEvidenceRef(
        match.item,
        "conflicts",
        `c${index}`,
        evidence.length,
        match.item.kind === "table_row"
          ? `Value reported in Table ${match.item.tableLabel ?? "?"} for “${match.item.method ?? "row"}”.`
          : undefined,
      ),
    );
  }

  for (const match of uniqueSupportItems) {
    evidence.push(
      makeEvidenceRef(
        match.item,
        "supports",
        `c${index}`,
        evidence.length,
        match.item.kind === "table_row"
          ? `Value reported in Table ${match.item.tableLabel ?? "?"} for “${match.item.method ?? "row"}”.`
          : undefined,
      ),
    );
  }

  // Stated changes ("from 48.0 to 59.7 (+11.7)") are checked arithmetically.
  // The claim itself is the evidence: endpoints and change are in one sentence.
  const statedChanges = extractStatedChanges(claim.text);
  const arithmeticConflicts = statedChanges.filter((change) => !change.consistent);
  const consistentChanges = statedChanges.filter((change) => change.consistent);
  const selfRef = (relation: EvidenceRef["relation"], note: string): EvidenceRef => ({
    id: evidenceId(`c${index}-arith`, "self", evidence.length),
    kind: "sentence",
    quote: claim.text,
    page: claim.page,
    sectionTitle: claim.sectionTitle,
    relation,
    offset: claim.startOffset,
    note,
  });
  const describeChange = (change: StatedChange) =>
    `${change.toText} − ${change.fromText} = ${formatSigned(change.computed)}; stated change ${change.deltaText}`;
  if (statedChanges.length > 0) {
    checks.push({
      id: "arithmetic_consistency",
      label: "Stated change arithmetic",
      outcome: arithmeticConflicts.length > 0 ? "flagged" : "passed",
      detail: statedChanges.map(describeChange).join(". ") + ".",
    });
    if (!bestConflict) {
      const shown = arithmeticConflicts[0] ?? consistentChanges[0]!;
      evidence.push(
        selfRef(
          arithmeticConflicts.length > 0 ? "conflicts" : "supports",
          `Computed from the endpoints stated in this sentence: ${describeChange(shown)}.`,
        ),
      );
    }
  }

  // Values bound to a symbol ("ρ = 0.314", "ΔYI = +11.7") are compared with the
  // same symbol elsewhere. Agreement up to the stated precision is consistency
  // evidence. A different value is never called a contradiction: parametric
  // papers legitimately vary a symbol across scenarios ("k = 0.55" vs "k = 0.35").
  const symbolFacts = namedMetricFacts.length === 0 ? extractSymbolValues(claim.text) : [];
  const symbolMatches: { fact: SymbolValue; other: SymbolValue; item: CorpusItem }[] = [];
  const symbolDifferences: { fact: SymbolValue; other: SymbolValue; item: CorpusItem }[] = [];
  for (const fact of symbolFacts) {
    for (const item of sourceItems) {
      if (item.kind !== "sentence") continue;
      for (const other of extractSymbolValues(item.text)) {
        if (other.symbol !== fact.symbol) continue;
        (roundedEqual(fact, other) ? symbolMatches : symbolDifferences).push({ fact, other, item });
      }
    }
  }
  const matchedSymbols = new Set(symbolMatches.map((entry) => entry.fact));
  if (symbolFacts.length > 0) {
    checks.push({
      id: "symbol_consistency",
      label: "Stated value consistency",
      outcome: matchedSymbols.size > 0 ? "passed" : "inconclusive",
      detail:
        matchedSymbols.size > 0
          ? `${[...matchedSymbols].map((fact) => `${fact.symbol} = ${fact.valueText}`).join(", ")} agrees with another passage up to the reported precision.`
          : "No other passage reports the same symbol with a value to compare.",
    });
    const shownItems = new Set<string>();
    for (const entry of symbolMatches) {
      if (shownItems.has(entry.item.id) || shownItems.size >= 2) continue;
      shownItems.add(entry.item.id);
      evidence.push(
        makeEvidenceRef(
          entry.item,
          "supports",
          `c${index}-sym`,
          evidence.length,
          `Reports ${entry.other.symbol} = ${entry.other.valueText}, which agrees with ${entry.fact.valueText} up to the reported precision.`,
        ),
      );
    }
    const unmatchedDifference = symbolDifferences.find((entry) => !matchedSymbols.has(entry.fact));
    if (unmatchedDifference) {
      evidence.push(
        makeEvidenceRef(
          unmatchedDifference.item,
          "context",
          `c${index}-symdiff`,
          evidence.length,
          `Reports ${unmatchedDifference.other.symbol} = ${unmatchedDifference.other.valueText} in another passage. This may be a different scenario or parameter setting, so it is not treated as a contradiction.`,
        ),
      );
      limitations.push(
        `${unmatchedDifference.fact.symbol} is reported with a different value elsewhere (${unmatchedDifference.other.valueText}, page ${unmatchedDifference.item.page}). Symbols can legitimately take different values in different scenarios; confirm which setting each passage describes.`,
      );
    }
  }
  // Table cells for values without a named metric. A cell is cited only when the
  // claim identifies its row (and, if a symbol is bound, its column); see tables.ts.
  const cellMatches =
    namedMetricFacts.length === 0 && !bestConflict
      ? matchTableCells(claim.text, extracted.parsedTables)
      : { supports: [], conflicts: [] };
  const describeCell = (match: CellMatch) =>
    `Table ${match.table.info.label}, row “${match.rowLabel}”, column “${match.header}”: ${match.cellText}`;
  const cellRef = (match: CellMatch, relation: EvidenceRef["relation"], note: string) => {
    const item = corpus.find((candidate) => candidate.id === `${match.table.info.id}-r${match.rowIndex}`);
    // One quote per row and relation; the check detail lists every matched cell.
    if (item && !evidence.some((ref) => ref.quote === item.text && ref.relation === relation)) {
      evidence.push(makeEvidenceRef(item, relation, `c${index}-cell${match.columnIndex}`, evidence.length, note));
    }
  };
  for (const match of cellMatches.conflicts.slice(0, 2)) {
    cellRef(
      match,
      "conflicts",
      `${describeCell(match)}. The claim reports ${match.number.text} for the same row and column.`,
    );
  }
  for (const match of cellMatches.supports.slice(0, 3)) {
    cellRef(
      match,
      "supports",
      `${describeCell(match)}, matching ${match.number.text} in the claim${match.columnConfirmed ? " (row and column both identified)" : " (row identified by the claim; column inferred from the unique matching value)"}.`,
    );
  }
  if (cellMatches.supports.length > 0 || cellMatches.conflicts.length > 0) {
    checks.push({
      id: "table_cell_match",
      label: "Table cell trace",
      outcome: cellMatches.conflicts.length > 0 ? "flagged" : "passed",
      detail: [
        ...cellMatches.supports.map((match) => `${match.number.text} → ${describeCell(match)}`),
        ...cellMatches.conflicts.map((match) => `${match.number.text} ≠ ${describeCell(match)}`),
      ].join("; ") + ".",
    });
  }

  // Numbers in the claim that one of the checks above actually accounted for.
  const accountedSpans = [
    ...consistentChanges.map((change) => [change.index, change.end] as const),
    ...[...matchedSymbols].map((fact) => [fact.index, fact.end] as const),
    ...cellMatches.supports.map((match) => [match.number.index, match.number.end] as const),
  ];
  const unaccountedNumbers = metricFacts.filter(
    (fact) => !accountedSpans.some(([start, end]) => fact.index >= start && fact.index < end),
  );

  // Add context matches as evidence when numeric check found no direct support/conflict.
  // This ensures evidence links are not zero for domain papers lacking ML-metric vocabulary.
  // IMPORTANT: unreliable table rows must never be cited as evidence of any kind.
  if (evidence.length === 0 && contextMatches.length > 0) {
    const topContext = [...contextMatches]
      .filter((m) => !(m.item.kind === "table_row" && !m.item.tableReliable))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);
    for (const match of topContext) {
      evidence.push(
        makeEvidenceRef(
          match.item,
          "context",
          `c${index}`,
          evidence.length,
          "Passage is lexically related to the claim but no identical metric value was traced.",
        ),
      );
    }
  }

  const comparisonKeys = new Set<string>();
  const addComparison = (claimFact: NumericFact, match: Match, delta: string) => {
    const key = [
      claimFact.metricKey,
      normalizedKey(claimFact),
      normalizedKey(match.fact),
      delta,
    ].join("|");
    if (comparisonKeys.has(key) || comparisons.length >= 3) return;
    comparisonKeys.add(key);
    comparisons.push({
      metric: metricLabel(claimFact.metricKey),
      claimValue: formatPercentValue(claimFact),
      evidenceValue: formatPercentValue(match.fact),
      claimPage: claim.page,
      evidencePage: match.item.page,
      evidenceKind: match.item.kind,
      delta,
    });
  };
  for (const entry of sortedConflictFacts) {
    addComparison(entry.claimFact, entry.match, formatDelta(entry.claimFact, entry.match.fact));
  }
  for (const entry of sortedSupportingFacts) {
    addComparison(entry.claimFact, entry.match, "0");
  }

  const anySupport = uniqueSupportItems.length > 0;
  const allMetricsLocated = namedMetricFacts.length > 0 && uniqueUnlocated.length === 0 && !bestConflict;
  const someMetricsLocated = namedMetricFacts.length > 0 && (anySupport || bestConflict !== null);

  const numericCheck = (() => {
    if (namedMetricFacts.length === 0) {
      return {
        outcome: "not_applicable" as const,
        detail:
          metricFacts.length > 0
            ? "A numeric value was located, but no metric label could be associated confidently."
            : "No labelled metric value was stated in this sentence.",
      };
    }
    if (bestConflict) {
      return {
        outcome: "flagged" as const,
        detail: `A different value was reported for ${metricLabel(bestConflict.fact.metricKey)}${bestConflict.item.tableLabel ? ` in Table ${bestConflict.item.tableLabel}` : ""}.`,
      };
    }
    if (anySupport) {
      return {
        outcome: "passed" as const,
        detail: `${supportedMetricKeys.size} labelled metric value${supportedMetricKeys.size === 1 ? "" : "s"} matched another extracted passage or table row.`,
      };
    }
    return {
      outcome: "inconclusive" as const,
      detail: "No comparable statement or table value with the same metric was located.",
    };
  })();

  if (namedMetricFacts.length > 0) {
    checks.push({
      id: "number_consistency",
      label: "Numeric consistency",
      outcome: numericCheck.outcome,
      detail: numericCheck.detail,
    });
  }

  const cellTraced = cellMatches.supports.length > 0 || cellMatches.conflicts.length > 0;
  const tableSupport =
    cellTraced || [...uniqueSupportItems, ...uniqueConflictItems].some((match) => match.item.kind === "table_row");
  const tableFlagged = Boolean(bestConflict) || cellMatches.conflicts.length > 0;
  if (extracted.tables.length > 0) {
    checks.push({
      id: "table_alignment",
      label: "Table alignment",
      outcome: tableSupport ? (tableFlagged ? "flagged" : "passed") : "inconclusive",
      detail: tableSupport
        ? tableFlagged
          ? "A comparable value in a reconstructed table row conflicts with the claim."
          : "The claim was compared with a reconstructed table row."
        : "No reliably reconstructed table row with the same metric was available for this claim.",
    });
  }

  // Missing table/figure references are traceable and do not rely on semantic interpretation.
  const references = extractReferencedObjects(claim.text);
  const availableCaptions = extracted.captions;
  const missingReferences: { kind: "table" | "figure"; label: string }[] = [];
  for (const reference of references) {
    const found = availableCaptions.some(
      (caption) => caption.kind === reference.kind && caption.label === reference.label,
    );
    if (!found) missingReferences.push(reference);
  }
  if (references.length > 0) {
    const locatedLabels = availableCaptions.map((caption) => `${caption.kind === "table" ? "Table" : "Figure"} ${caption.label}`);
    checks.push({
      id: "reference_traceability",
      label: "Reference traceability",
      outcome: missingReferences.length > 0 ? "flagged" : "passed",
      detail:
        missingReferences.length > 0
          ? `The document's extracted captions do not include ${missingReferences.map((reference) => `${reference.kind === "table" ? "Table" : "Figure"} ${reference.label}`).join(", ")}.`
          : `Every referenced object was located among extracted captions (${locatedLabels.join(", ")}).`,
    });
    if (missingReferences.length > 0) {
      const missing = missingReferences[0]!;
      evidence.unshift(
        metadataEvidence(
          `c${index}-missing`,
          `Captions located in the extracted document: ${locatedLabels.length > 0 ? locatedLabels.join(", ") : "none"}.`,
          `The claim points to ${missing.kind === "table" ? "Table" : "Figure"} ${missing.label}, which was not located.`,
          0,
        ),
      );
    }
  }

  const statisticalClaim = isStatisticalClaim(claim.text);
  let statisticalGap = false;
  let statisticalUncertain = false;
  let statisticalEvidenceItem: CorpusItem | null = null;
  if (statisticalClaim) {
    const documentHasStats = containsStatisticalEvidence(extracted.text);
    const nearbyStats = sourceItems.find(
      (item) =>
        containsStatisticalEvidence(item.text) &&
        ["sentence", "table_row"].includes(item.kind) &&
        (item.similarity ?? 0) >= 0.08,
    );
    if (nearbyStats) statisticalEvidenceItem = nearbyStats;
    if (!documentHasStats) {
      statisticalGap = true;
      checks.push({
        id: "statistical_support",
        label: "Statistical support",
        outcome: "flagged",
        detail:
          "No p-value, confidence interval, named statistical test, or effect size was located in the extracted text.",
      });
    } else {
      statisticalUncertain = true;
      checks.push({
        id: "statistical_support",
        label: "Statistical support",
        outcome: "inconclusive",
        detail: nearbyStats
          ? "A statistical result was located near this claim, but phase one does not verify that it belongs to the same comparison."
          : "Statistical reporting exists elsewhere in the document, but no matching passage was located for this claim.",
      });
      if (nearbyStats) {
        evidence.push(makeEvidenceRef(nearbyStats, "context", `c${index}-stat`, evidence.length));
      }
    }
  }

  // Superlatives about something other than the authors' work ("a staggered schedule
  // is the most effective adjustment") are not scope claims about the method.
  const ownWork = addressesOwnWork(claim);
  const universal = isUniversalClaim(claim.text) && ownWork;
  const broad = isBroadGeneralization(claim.text) && ownWork;
  let scopeGap = false;
  let scopeLimited = false;
  let scopeDetail = "";
  if (universal || broad) {
    if (broad) {
      const datasetNames = datasets.map(datasetDisplayName).join(", ");
      if (datasets.length < 2) {
        scopeGap = true;
        scopeDetail = `The claim generalizes broadly, while the audited text references ${datasets.length === 0 ? "no clearly identifiable evaluation datasets" : `${datasets.length} evaluation dataset${datasets.length === 1 ? "" : "s"} (${datasetNames})`}.`;
      } else {
        scopeLimited = true;
        scopeDetail = `The document references ${datasets.length} evaluation datasets (${datasetNames}), but universal generalization is broader than an in-paper audit can establish.`;
      }
    } else {
      if (baselines.labels.length < 2) {
        scopeGap = true;
        scopeDetail = `The claim uses universal comparison language, but only ${baselines.labels.length} baseline comparison${baselines.labels.length === 1 ? "" : "s"} could be located.`;
      } else {
        scopeLimited = true;
        scopeDetail = `The document reports ${baselines.labels.length} baseline comparisons (${baselines.labels.slice(0, 5).join(", ")}). The claim may hold for those, but universal wording cannot be established from the paper alone.`;
      }
    }
    checks.push({
      id: "scope_check",
      label: "Claim scope",
      outcome: scopeGap ? "flagged" : "inconclusive",
      detail: scopeDetail,
    });
    if ((scopeGap || scopeLimited) && broad) {
      const datasetItem = sourceItems.find(
        (item) => item.context.datasets.size > 0 && item.sectionCanonical !== "abstract",
      );
      if (datasetItem) {
        if (!evidence.some((ref) => ref.quote === datasetItem.text)) {
          evidence.push(
            makeEvidenceRef(datasetItem, "context", `c${index}-scope`, evidence.length, "The evaluation scope located in the document."),
          );
        }
      } else {
        evidence.push(
          metadataEvidence(
            `c${index}-scope`,
            datasets.length > 0
              ? `Evaluation dataset references located: ${datasets.map(datasetDisplayName).join(", ")}.`
              : "No evaluation dataset names were identified in the extracted results or discussion text.",
            "Dataset references are used here only to gauge the scope of the reported experiments.",
          ),
        );
      }
    }
    if (scopeGap && !broad && baselines.rows.length === 0) {
      evidence.push(
        metadataEvidence(
          `c${index}-scope`,
          `Baseline labels located in reconstructed tables: ${baselines.labels.length > 0 ? baselines.labels.join(", ") : "none"}.`,
          "The scope check uses method labels and baseline mentions only.",
        ),
      );
    }
    if (baselines.rows.length > 0 && !broad) {
      for (const row of baselines.rows.slice(0, 2)) {
        if (evidence.some((ref) => ref.quote === row.text)) continue;
        evidence.push(
          makeEvidenceRef(row, "context", `c${index}-base`, evidence.length, "A reported comparison used to gauge the claim's scope."),
        );
      }
    }
  }

  if (uniqueUnlocated.length > 0) {
    limitations.push(
      `No same-metric evidence was located for: ${uniqueUnlocated.join(", ")}. A missing match is not evidence that the value is wrong.`,
    );
  }
  if (contextReasons.length > 0) {
    limitations.push(
      bestConflict
        ? `Other nearby passages described a different experimental context and were excluded from this comparison. ${contextReasons[0]}`
        : `A different experimental context was detected: ${contextReasons[0]} Values were not treated as directly comparable.`,
    );
  }
  if (bestConflict) {
    limitations.push(
      "Different datasets, evaluation splits, methods, or rounding conventions can produce legitimate numerical differences. Confirm the surrounding context in the PDF.",
    );
  }
  if (suppressedConflicts > 0) {
    limitations.push(
      "A conflicting passage was located in another section, but this claim matches a reliably reconstructed table row. The conflicting statement is audited separately rather than counted against this claim.",
    );
  }
  if (evidence.some((ref) => ref.kind === "table_row")) {
    limitations.push(
      "Table rows were reconstructed heuristically from text positions. Verify column alignment against the PDF before acting on a table-based finding.",
    );
  }
  if (!anySupport && namedMetricFacts.length > 0) {
    limitations.push(
      "Evidence retrieval is lexical and numeric. A supporting passage phrased very differently may have been missed.",
    );
  }
  limitations.push(
    "Phase one audits only this document. It does not validate the underlying experiment, inspect code or data, or verify external citations.",
  );

  let category: FindingCategory;
  let title: string;
  let rationale: string;
  let confidence: Finding["confidence"];
  let primaryIssue: string;

  if (bestConflict) {
    const conflictSeen = new Set<string>();
    const conflictEntries = sortedConflictFacts.filter((entry) => {
      const key = [
        entry.claimFact.metricKey,
        normalizedKey(entry.claimFact),
        normalizedKey(entry.match.fact),
      ].join("|");
      if (conflictSeen.has(key)) return false;
      conflictSeen.add(key);
      return true;
    });
    const primaryEntry =
      conflictEntries.find((entry) => entry.match.item.id === bestConflict.item.id) ??
      conflictEntries[0]!;
    const claimFact = primaryEntry.claimFact;
    const metric = metricLabel(claimFact.metricKey);
    const claimValue = formatPercentValue(claimFact);
    const location = (entry: { match: Match }) =>
      entry.match.item.kind === "table_row"
        ? `Table ${entry.match.item.tableLabel ?? "?"} on page ${entry.match.item.page}${entry.match.item.method ? ` (row “${entry.match.item.method}”)` : ""}`
        : `${entry.match.item.sectionTitle} on page ${entry.match.item.page}`;

    category = "potential_contradiction";
    title = `Reported ${metric} differs across sections`;
    confidence = primaryEntry.match.item.kind === "table_row" ? "high" : "moderate";
    primaryIssue = "numeric_conflict";

    const extras = conflictEntries
      .filter((entry) => entry !== primaryEntry)
      .slice(0, 2)
      .map(
        (entry) =>
          ` The same claim also reports ${metricLabel(entry.claimFact.metricKey)} of ${formatPercentValue(
            entry.claimFact,
          )}, while ${location(entry)} reports ${formatPercentValue(entry.match.fact)}.`,
      )
      .join("");

    rationale = `The claim reports ${claimValue} for ${metric} in ${claim.sectionTitle}. ${location(
      primaryEntry,
    )} reports ${formatPercentValue(primaryEntry.match.fact)} for the same metric. The values differ by ${formatDelta(
      claimFact,
      primaryEntry.match.fact,
    )}.${extras} The compared passages did not explicitly name different datasets, splits, or conditions, so this is recorded as a potential contradiction for review, not a proven error.`;
  } else if (arithmeticConflicts.length > 0) {
    const change = arithmeticConflicts[0]!;
    category = "potential_contradiction";
    title = "Stated change does not match its endpoints";
    confidence = "moderate";
    primaryIssue = "arithmetic_conflict";
    rationale = `The sentence reports a change from ${change.fromText} to ${change.toText}, which is ${formatSigned(change.computed)}, but states the change as ${change.deltaText}. The difference exceeds what rounding of the reported values can explain (tolerance ±${formatNumber(change.tolerance)}). This may be a typo, a relative rather than absolute change, or values taken from different runs; confirm against the source analysis.`;
    limitations.push("Only explicitly stated, signed changes in the same sentence are checked. The engine does not know whether the authors intended a relative change.");
  } else if (missingReferences.length > 0) {
    const missing = missingReferences[0]!;
    category = anySupport ? "partially_supported" : "potentially_unsupported";
    title = `Referenced ${missing.kind === "table" ? "Table" : "Figure"} ${missing.label} was not located`;
    confidence = availableCaptions.length > 0 ? "high" : "low";
    primaryIssue = "missing_reference";
    rationale = `The statement points to ${missing.kind === "table" ? "Table" : "Figure"} ${missing.label}. The extracted document contains ${
      availableCaptions.length > 0
        ? `captions for ${availableCaptions.map((caption) => `${caption.kind === "table" ? "Table" : "Figure"} ${caption.label}`).join(", ")}`
        : "no table or figure captions"
    }, but not the referenced object. The evidence may be missing, in material that could not be extracted, or in an appendix; phase one did not infer its contents.`;
  } else if (statisticalGap) {
    category = anySupport ? "partially_supported" : "potentially_unsupported";
    title = "Significance is asserted without a reported statistical test";
    confidence = "moderate";
    primaryIssue = "statistical_gap";
    rationale = `The claim describes a statistically significant result, but no p-value, confidence interval, named statistical test, or effect size was located in the extracted document. This is not proof that the result is non-significant: the analysis may be missing from the text, reported elsewhere, or expressed in a form the deterministic extractor did not recognize.${
      anySupport ? " The numeric value itself was located in the document." : ""
    }`;
  } else if (scopeGap) {
    category = anySupport ? "partially_supported" : "potentially_unsupported";
    title = broad ? "Generalization extends beyond the located experiments" : "Universal wording is broader than the reported comparisons";
    confidence = "moderate";
    primaryIssue = "scope_gap";
    rationale = `${scopeDetail} This finding concerns the relationship between the wording and the evidence in this paper, not whether the method works. ${
      anySupport ? "The numerical result in the claim was located separately." : ""
    }`;
  } else if (scopeLimited) {
    category = "partially_supported";
    title = "Claim scope exceeds what the reported comparisons can establish";
    confidence = "moderate";
    primaryIssue = "scope_limited";
    rationale = `${scopeDetail} The numerical comparisons may be accurate, but the absolute wording is stronger than the in-paper evidence. This is a wording and scope concern rather than a numerical contradiction.`;
  } else if (claimContext.mentionsCondition && !anySupport) {
    category = "needs_review";
    title = "Conditional or ablation result needs contextual review";
    confidence = "low";
    primaryIssue = "conditional_context";
    rationale = `This statement reports a result from an ablation, variant, or conditional setting. The audit did not treat the value as directly comparable to the paper's main reported result, and no matching value was located elsewhere. This is a request for manual review, not a finding that the value is wrong.`;
  } else if (namedMetricFacts.length > 0) {
    if (allMetricsLocated) {
      category = "supported";
      const supportedNames = [...supportedMetricKeys].map((key) => metricLabel(key));
      title = `${supportedNames.join(" and ")} ${supportedNames.length > 1 ? "values" : "value"} traced to extracted evidence`;
      confidence = uniqueSupportItems.some((match) => match.item.kind === "table_row") ? "high" : "moderate";
      primaryIssue = "numeric_support";
      const first = uniqueSupportItems[0];
      const supportSeen = new Set<string>();
      const supportDetails = sortedSupportingFacts
        .filter((entry) => {
          const key = normalizedKey(entry.claimFact);
          if (supportSeen.has(key)) return false;
          supportSeen.add(key);
          return true;
        })
        .slice(0, 3)
        .map(
          (entry) =>
            `${metricLabel(entry.claimFact.metricKey)} of ${formatPercentValue(entry.claimFact)}`,
        );
      rationale = `The claim reports ${supportDetails.join(" and ")}. The same ${
        supportDetails.length > 1 ? "values appear" : "value appears"
      } in ${
        first?.item.kind === "table_row"
          ? `Table ${first.item.tableLabel ?? "?"} on page ${first.item.page}`
          : `${first?.item.sectionTitle ?? "another section"}, page ${first?.item.page ?? claim.page}`
      }. This is internal consistency evidence only: it shows that the paper reports the same value in two places, not that the experiment is valid.`;
    } else if (anySupport) {
      category = "partially_supported";
      title = "Only part of the numeric claim is supported by extracted evidence";
      confidence = "moderate";
      primaryIssue = "partial_support";
      const supported = [...supportedMetricKeys].map((key) => metricLabel(key));
      rationale = `At least one reported value was traced to another passage or table row (${supported.join(", ")}), but ${
        uniqueUnlocated.length > 0
          ? `no matching evidence was located for ${uniqueUnlocated.join(", ")}.`
          : "not every stated value could be matched."
      } A missing match is not proof that the number is wrong; it means the supporting result was not located in the accessible text.`;
    } else {
      category = "potentially_unsupported";
      title = "No supporting evidence located for this numeric claim";
      confidence = "low";
      primaryIssue = "no_support";
      rationale = `No other sentence or reliably reconstructed table row in the accessible document reported ${namedMetricFacts
        .map((fact) => `${metricLabel(fact.metricKey)} at ${formatPercentValue(fact)}`)
        .join(", ")}. The search checked ${sourceItems.length} extracted passages and table rows. This means the supporting result was not located; the evidence may be absent, poorly extracted, phrased differently, or outside the audited document. It is not proof that the claim is false.`;
    }
  } else if (cellMatches.conflicts.length > 0) {
    const match = cellMatches.conflicts[0]!;
    category = "potential_contradiction";
    title = `Value differs from Table ${match.table.info.label}`;
    confidence = "moderate";
    primaryIssue = "table_cell_conflict";
    rationale = `The claim reports ${match.number.text} and identifies both the row (“${match.rowLabel}”) and the column (“${match.header}”) of Table ${match.table.info.label}, which reports ${match.cellText}. The values differ beyond the reported precision. The table may describe a different run or the sentence may contain a typo; confirm against the PDF, since the table was reconstructed from text positions.`;
  } else if (matchedSymbols.size > 0 || consistentChanges.length > 0 || cellMatches.supports.length > 0) {
    const traced = [
      ...consistentChanges.map((change) => `the stated change ${change.deltaText} (from ${change.fromText} to ${change.toText}) is arithmetically consistent`),
      ...[...matchedSymbols].map((fact) => `${fact.symbol} = ${fact.valueText} agrees with another passage`),
      ...cellMatches.supports.map((match) => `${match.number.text} matches Table ${match.table.info.label} (row “${match.rowLabel}”, column “${match.header}”)`),
    ];
    const complete = unaccountedNumbers.length === 0;
    category = complete ? "supported" : "partially_supported";
    title = complete ? "Reported values are internally consistent" : "Some reported values are internally consistent";
    confidence = "moderate";
    primaryIssue = complete ? "internal_consistency" : "partial_consistency";
    rationale = `In this sentence, ${traced.join("; ")}.${
      complete
        ? ""
        : ` ${unaccountedNumbers.length} other value${unaccountedNumbers.length === 1 ? " was" : "s were"} not traced (${unaccountedNumbers.slice(0, 4).map((fact) => fact.raw.trim()).join(", ")}); a missing trace is not evidence that they are wrong.`
    } This is internal consistency evidence only: it shows the paper's numbers agree with each other, not that the analysis or model behind them is valid.`;
  } else if (metricFacts.length > 0) {
    category = "needs_review";
    title = "Numeric claim cannot be mapped to a named metric";
    confidence = "low";
    primaryIssue = "unmapped_number";
    rationale = `A numeric value was found, but no metric label could be associated with it confidently. The audit deliberately does not compare unlabelled numbers across sections, because different measures, denominators, and rounding rules can make them non-comparable.`;
  } else if (containsCitation(claim.text)) {
    category = "needs_review";
    title = "Reliance on external citation cannot be verified";
    confidence = "low";
    primaryIssue = "citation_reliance";
    rationale = `The statement relies on cited literature or external work. Phase one does not fetch or verify external sources. The presence of a citation is not treated as evidence that the associated claim is correct, and a missing citation would not by itself prove it false.`;
    checks.push({
      id: "citation_support",
      label: "Citation support",
      outcome: "inconclusive",
      detail: "External references are outside the scope of this audit and were not retrieved.",
    });
  } else {
    category = "needs_review";
    title = "Qualitative statement requires manual interpretation";
    confidence = "low";
    primaryIssue = "qualitative";
    rationale = `This is a qualitative or interpretive statement rather than a checkable reported value. Phase one can retrieve nearby passages lexically, but it does not have a semantic entailment model, so it cannot determine whether those passages justify the statement.`;
  }

  // Context-only evidence is added for non-numeric findings, where a nearby passage helps
  // orientation. It is never used to justify a numeric support or conflict classification.
  const contextBlocked = new Set([
    "numeric_conflict",
    "missing_reference",
    "numeric_support",
    "partial_support",
    "no_support",
    "conditional_context",
    "scope_gap",
    "scope_limited",
    "arithmetic_conflict",
    "internal_consistency",
    "partial_consistency",
    "table_cell_conflict",
  ]);
  if (!contextBlocked.has(primaryIssue) && evidence.length === 0) {
    const contextMatch = contextMatches.find(
      (match) => !evidence.some((ref) => ref.quote === match.item.text),
    );
    if (contextMatch) {
      evidence.push(makeEvidenceRef(contextMatch.item, "context", `c${index}`, evidence.length));
    }
  }

  const retrievalOutcome: CheckRun["outcome"] =
    evidence.some((ref) => ref.relation === "supports" || ref.relation === "conflicts")
      ? "passed"
      : "inconclusive";
  checks.unshift({
    id: "evidence_retrieval",
    label: "Evidence retrieval",
    outcome: retrievalOutcome,
    detail:
      evidence.length > 0
        ? `${evidence.length} traceable passage${evidence.length === 1 ? "" : "s"} or table row${evidence.length === 1 ? "" : "s"} retained.`
        : `No candidate evidence passed the retrieval threshold (${sourceItems.length} passages checked).`,
  });

  if (someMetricsLocated) {
    limitations.push("A matched value does not establish that the underlying experiment, analysis, or interpretation is correct.");
  }

  return {
    claim,
    facts,
    category,
    title,
    rationale,
    confidence,
    checks,
    evidence: evidence.slice(0, 5),
    comparisons: comparisons.slice(0, 3),
    limitations: [...new Set(limitations)].slice(0, 5),
    primaryIssue,
  };
}

// ---------------------------------------------------------------------------
// Methodology gap audit (Objective 4)
// ---------------------------------------------------------------------------

interface MethodologyGaps {
  missingDatasetDescription: boolean;
  missingBaselines: boolean;
  missingEvaluationMetrics: boolean;
  missingTrainTestSplit: boolean;
  missingHyperparameters: boolean;
  missingReproducibility: boolean;
  checks: CheckRun[];
  limitations: string[];
}

function auditMethodologyGaps(extracted: ExtractedDocument): MethodologyGaps {
  const allText = extracted.sentences.map((sentence) => sentence.text).join(" ");
  const methodText = extracted.sentences
    .filter((sentence) => ["methods", "results", "experiments"].includes(sentence.sectionCanonical))
    .map((sentence) => sentence.text)
    .join(" ");

  const hasDatasetDesc = mentionsDatasetSize(allText);
  const hasBaselines = mentionsBaselinesText(allText);
  const hasMetrics = mentionsEvaluationMetrics(allText);
  const hasSplit = mentionsTrainTestSplit(allText);
  const hasHyperparams = mentionsHyperparameters(methodText);
  const hasReproducibility = mentionsReproducibility(allText);

  // Only report gaps that are relevant to papers reporting experimental results.
  // A paper must have numeric claims to be considered an empirical study.
  const hasNumericClaims = extracted.sentences.some(
    (sentence) => extractNumericFacts(sentence.text).some((fact) => fact.kind === "metric" && fact.metricKey !== null),
  );

  const checks: CheckRun[] = [];
  const limitations: string[] = [];

  if (!hasNumericClaims) {
    return { missingDatasetDescription: false, missingBaselines: false, missingEvaluationMetrics: false, missingTrainTestSplit: false, missingHyperparameters: false, missingReproducibility: false, checks, limitations };
  }

  checks.push({
    id: "methodology_dataset",
    label: "Dataset description",
    outcome: hasDatasetDesc ? "passed" : "inconclusive",
    detail: hasDatasetDesc
      ? "The extracted text mentions dataset sizes or sample counts."
      : "No explicit dataset size or sample count description was located in the extracted text. This may be reported in a section that could not be extracted.",
  });

  checks.push({
    id: "methodology_baselines",
    label: "Baseline comparison",
    outcome: hasBaselines ? "passed" : "inconclusive",
    detail: hasBaselines
      ? "The extracted text mentions baseline or comparison methods."
      : "No explicit baseline or comparison method description was located. This is a reporting gap, not proof of methodological error.",
  });

  checks.push({
    id: "methodology_metrics",
    label: "Evaluation metrics",
    outcome: hasMetrics ? "passed" : "inconclusive",
    detail: hasMetrics
      ? "At least one recognized evaluation metric was identified in the extracted text."
      : "No recognized evaluation metric name was located in the extracted text.",
  });

  checks.push({
    id: "methodology_split",
    label: "Train/test split",
    outcome: hasSplit ? "passed" : "inconclusive",
    detail: hasSplit
      ? "The extracted text describes train/test or validation splits."
      : "No explicit train/test or validation split description was found. This is not proof of data leakage.",
  });

  if (!hasReproducibility) {
    limitations.push(
      "No explicit code release, repository link, or reproducibility statement was located in the extracted text. This does not prove that the work is unreproducible.",
    );
  }

  return {
    missingDatasetDescription: !hasDatasetDesc,
    missingBaselines: !hasBaselines,
    missingEvaluationMetrics: !hasMetrics,
    missingTrainTestSplit: !hasSplit,
    missingHyperparameters: !hasHyperparams,
    missingReproducibility: !hasReproducibility,
    checks,
    limitations,
  };
}

// ---------------------------------------------------------------------------
// Conclusion overreach detection (Objective 5)
// ---------------------------------------------------------------------------

function buildConclusionOverreachFindings(
  extracted: ExtractedDocument,
  corpus: CorpusItem[],
  startingIndex: number,
): Finding[] {
  const conclusionSentences = extracted.sentences.filter(
    (sentence) => sentence.sectionCanonical === "conclusion",
  );
  const findings: Finding[] = [];

  for (const sentence of conclusionSentences) {
    const hasCausal = containsCausalLanguage(sentence.text);
    const hasUniversal = containsUniversalApplicability(sentence.text);
    if (!hasCausal && !hasUniversal) continue;

    // Avoid duplicating findings already produced by the main claim evaluator.
    const alreadySelected = corpus.some(
      (item) => item.kind === "sentence" && item.offset === sentence.startOffset,
    );
    if (alreadySelected) continue;

    // Only flag if the sentence makes a substantive claim about own work.
    if (!addressesOwnWork(sentence)) continue;

    const index = startingIndex + findings.length;
    const id = `F-${String(index + 1).padStart(3, "0")}`;

    const checks: CheckRun[] = [
      {
        id: "evidence_retrieval",
        label: "Evidence retrieval",
        outcome: "inconclusive",
        detail: "Conclusion overreach candidates are assessed heuristically; no evidence was retrieved.",
      },
    ];

    if (hasCausal && !hasUniversal) {
      checks.push({
        id: "scope_check",
        label: "Claim scope",
        outcome: "inconclusive",
        detail: "The conclusion uses causal language. Observational or ablation evidence does not establish causation.",
      });
    }
    if (hasUniversal) {
      checks.push({
        id: "scope_check",
        label: "Claim scope",
        outcome: "inconclusive",
        detail: "The conclusion asserts universal applicability. This cannot be confirmed from a single paper's experiments.",
      });
    }

    const limitations = [
      "A classification describes the relationship between this sentence and the extracted document. It is not a judgment about the research itself.",
      "Causal and universal language detection is heuristic. The sentence may be appropriately hedged in context.",
      "Phase one audits only this document. It does not validate the underlying experiment, inspect code or data, or verify external citations.",
    ];

    const title = hasCausal
      ? "Conclusion uses causal language that may exceed experimental evidence"
      : "Conclusion asserts universal applicability beyond the studied conditions";

    const rationale = hasCausal
      ? `The conclusion contains causal language ("${sentence.text.slice(0, 80)}…"). Observational, correlational, or ablation evidence does not by itself establish a causal mechanism. This is a candidate for reviewer attention, not a definitive finding of scientific error.`
      : `The conclusion claims universal applicability ("${sentence.text.slice(0, 80)}…"). The study scope in this paper may not support claims that apply in all cases, domains, or settings. This is a candidate for reviewer attention.`;

    findings.push({
      id,
      category: "needs_review",
      title,
      claim: {
        text: sentence.text,
        sectionTitle: sentence.sectionTitle,
        sectionCanonical: sentence.sectionCanonical,
        page: sentence.page,
        offset: sentence.startOffset,
      },
      rationale,
      confidence: "low",
      checks,
      evidence: [],
      numericComparisons: [],
      searchScope: {
        sentencesChecked: 0,
        tableRowsChecked: 0,
      },
      limitations,
    });
  }

  return findings;
}

export function runAudit(
  extracted: ExtractedDocument,
  startedAt: number,
  onPhase?: (phase: "claims" | "evidence", claims: number) => void,
): {
  findings: Finding[];
  summary: AuditSummary;
  limitations: string[];
  auditMs: number;
} {
  const auditStarted = Date.now();
  const corpus = buildCorpus(extracted);
  const claims = selectClaims(extracted);
  onPhase?.("claims", claims.length);
  onPhase?.("evidence", claims.length);
  const findings: Finding[] = claims.map((candidate, index) => {
    const evaluation = evaluateClaim(candidate.sentence, corpus, extracted, index);
    return {
      id: `F-${String(index + 1).padStart(3, "0")}`,
      category: evaluation.category,
      title: evaluation.title,
      claim: {
        text: candidate.sentence.text,
        sectionTitle: candidate.sentence.sectionTitle,
        sectionCanonical: candidate.sentence.sectionCanonical,
        page: candidate.sentence.page,
        offset: candidate.sentence.startOffset,
      },
      rationale: evaluation.rationale,
      confidence: evaluation.confidence,
      checks: evaluation.checks,
      evidence: evaluation.evidence,
      numericComparisons: evaluation.comparisons,
      searchScope: {
        sentencesChecked: Math.max(0, extracted.sentences.length - 1),
        tableRowsChecked: corpus.filter((item) => item.kind === "table_row").length,
      },
      limitations: evaluation.limitations,
    };
  });

  // Conclusion overreach pass: detect causal or universal language in conclusions
  // that was not already selected by the main claim evaluator.
  const selectedOffsets = new Set(findings.map((finding) => finding.claim.offset));
  const overreachCandidates = buildConclusionOverreachFindings(extracted, corpus, findings.length);
  for (const candidate of overreachCandidates) {
    if (!selectedOffsets.has(candidate.claim.offset)) {
      findings.push(candidate);
      selectedOffsets.add(candidate.claim.offset);
    }
  }

  findings.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.category] - SEVERITY_ORDER[b.category];
    if (severity !== 0) return severity;
    return a.claim.offset - b.claim.offset;
  });

  // Re-number findings after sort and deduplication.
  for (let i = 0; i < findings.length; i++) {
    findings[i]!.id = `F-${String(i + 1).padStart(3, "0")}`;
  }

  const byCategory: AuditSummary["byCategory"] = {
    supported: 0,
    partially_supported: 0,
    potentially_unsupported: 0,
    potential_contradiction: 0,
    needs_review: 0,
  };
  for (const finding of findings) byCategory[finding.category] += 1;

  const evidenceLinks = findings.reduce(
    (sum, finding) => sum + finding.evidence.filter((ref) => ref.relation !== "context").length,
    0,
  );

  // Methodology gap audit: run once per document, not per claim.
  const methodologyGaps = auditMethodologyGaps(extracted);
  const methodologyLimitations = methodologyGaps.limitations;

  const limitations = [
    "Only selectable text and table values that could be extracted from the uploaded PDF are audited. Image-only pages are not processed, and OCR is not implemented.",
    "Numeric comparisons are limited to recognized metric labels. Counts, training times, dataset sizes, and unlabelled values are not compared in phase one.",
    "Table rows are reconstructed from text positions. Column alignment can be wrong in complex, multi-page, or borderless tables; verify against the PDF.",
    "Evidence retrieval is lexical and numeric. Paraphrased support may be missed, and a retrieved passage is not proof of semantic entailment.",
    "The five classifications describe the relationship between a sentence and the accessible document. They are not verdicts on research validity, integrity, or author intent.",
    "External literature and citations are not fetched or verified. A citation is never treated as proof, and a missing citation is never treated as disproof.",
    "Documents are processed only on this server. The uploaded PDF and its extracted text are held in memory during processing and are not stored; only findings, summaries, and aggregate statistics are kept. No external AI or document service is called.",
    ...methodologyLimitations,
  ];

  return {
    findings,
    summary: {
      claimsAudited: findings.length,
      evidenceLinks,
      byCategory,
      tablesDetected: extracted.tables.length,
      tablesParsedReliably: extracted.tables.filter((table) => table.reliable).length,
    },
    limitations,
    auditMs: Date.now() - auditStarted,
  };
}

export { shorten };
