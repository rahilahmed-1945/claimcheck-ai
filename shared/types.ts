/**
 * Shared domain types for ClaimCheck AI.
 * These are used by both the Express API and the React client.
 */

export const ENGINE_VERSION = "0.1.0";

export type FindingCategory =
  | "supported"
  | "partially_supported"
  | "potentially_unsupported"
  | "potential_contradiction"
  | "needs_review";

export const FINDING_CATEGORIES: FindingCategory[] = [
  "potential_contradiction",
  "potentially_unsupported",
  "partially_supported",
  "needs_review",
  "supported",
];

export type Confidence = "high" | "moderate" | "low";
export type CheckOutcome = "flagged" | "passed" | "inconclusive" | "not_applicable";

export interface CheckRun {
  id: string;
  label: string;
  outcome: CheckOutcome;
  detail: string;
}

export interface EvidenceRef {
  id: string;
  kind: "sentence" | "table_row" | "metadata";
  quote: string;
  page: number;
  sectionTitle: string;
  relation: "supports" | "conflicts" | "context";
  /** Character offset into the normalized extracted document text, when known. */
  offset: number | null;
  note?: string;
}

export interface NumericComparison {
  metric: string;
  claimValue: string;
  evidenceValue: string;
  claimPage: number;
  evidencePage: number;
  evidenceKind: "sentence" | "table_row";
  delta: string;
}

export interface AuditClaim {
  text: string;
  sectionTitle: string;
  sectionCanonical: string;
  page: number;
  offset: number;
}

export interface Finding {
  id: string;
  category: FindingCategory;
  title: string;
  claim: AuditClaim;
  rationale: string;
  confidence: Confidence;
  checks: CheckRun[];
  evidence: EvidenceRef[];
  numericComparisons: NumericComparison[];
  searchScope: {
    sentencesChecked: number;
    tableRowsChecked: number;
  };
  limitations: string[];
}

export interface SectionInfo {
  id: string;
  title: string;
  canonical: string;
  level: number;
  pageStart: number;
  pageEnd: number;
  wordCount: number;
  auditable: boolean;
}

export interface PageText {
  number: number;
  width: number;
  height: number;
  text: string;
  lineCount: number;
}

export interface TableInfo {
  id: string;
  label: string;
  caption: string;
  page: number;
  sectionTitle: string;
  header: string[];
  rows: string[][];
  reliable: boolean;
  reason?: string;
}

export interface CaptionInfo {
  kind: "table" | "figure";
  label: string;
  page: number;
}

/**
 * Aggregate statistics about an extraction. Deliberately holds no document
 * content: no section titles, table cells, or captions (see server/src/privacy.ts).
 */
export interface ExtractionInfo {
  pageCount: number;
  charCount: number;
  wordCount: number;
  pagesWithText: number;
  textDensity: "good" | "sparse";
  bodyFontSize: number;
  extractionMs: number;
  sectionCount: number;
  auditableSectionCount: number;
  tableCount: number;
  reliableTableCount: number;
  captionCount: number;
  warnings: string[];
}

/** The extracted paper. Exists only in memory while an audit runs; never stored or served. */
export interface AuditedDocument {
  text: string;
  pages: PageText[];
  sections: SectionInfo[];
  tables: TableInfo[];
  captions: CaptionInfo[];
}

export interface AuditSummary {
  claimsAudited: number;
  evidenceLinks: number;
  byCategory: Record<FindingCategory, number>;
  tablesDetected: number;
  tablesParsedReliably: number;
}

export type AuditStatus = "queued" | "processing" | "complete" | "failed";

export interface AuditErrorPayload {
  code: string;
  title: string;
  message: string;
  recovery: string[];
  detail?: string;
}

export interface AuditTimings {
  extractionMs: number;
  auditMs: number;
  totalMs: number;
}

export interface AuditRecord {
  id: string;
  filename: string;
  fileSize: number;
  fileHash: string | null;
  status: AuditStatus;
  stage: string;
  stageDetail: string;
  progress: number;
  createdAt: string;
  completedAt: string | null;
  engineVersion: string;
  error: AuditErrorPayload | null;
  extraction: ExtractionInfo | null;
  findings: Finding[];
  summary: AuditSummary | null;
  limitations: string[];
  timings: AuditTimings | null;
  /** Always null: the source document is not retained after the audit completes. */
  document: AuditedDocument | null;
}

export interface AuditListItem {
  id: string;
  filename: string;
  fileSize: number;
  status: AuditStatus;
  stage: string;
  stageDetail: string;
  progress: number;
  createdAt: string;
  completedAt: string | null;
  errorTitle: string | null;
  summary: AuditSummary | null;
  pageCount: number | null;
  engineVersion: string;
}

export interface BackendInfo {
  ok: boolean;
  engineVersion: string;
  mode: "local";
  limits: {
    maxFileBytes: number;
    maxPages: number;
    processingTimeoutMs: number;
  };
  persistence: {
    kind: string;
    location: string;
    note: string;
  };
  /** True when CLAIMCHECK_ADMIN_TOKEN is set: listing all reports and deleting need the token. */
  adminProtected: boolean;
  sampleAvailable: boolean;
}

export interface AuditListResponse {
  audits: AuditListItem[];
  total?: number;
}

export interface EvaluationTotals {
  cases: number;
  expectedFindings: number;
  findings: number;
  matchedFindings: number;
  exactCategoryMatches: number;
  unexpectedFindings: number;
  correctPredictions: number;
  evidenceTraceFailures: number;
  assertionFailures: number;
  claimSelectionRecall: number;
  exactCategoryAccuracy: number;
  strictPrecision: number;
  runtimeMs: number;
}

export interface EvaluationCategoryMetric {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  expected: number;
  predicted: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface EvaluationCaseSummary {
  id: string;
  title: string;
  purpose: string;
  pages: number;
  words: number;
  tables: number;
  reliableTables: number;
  findings: number;
  expectedFindings: number;
  matchedFindings: number;
  correctCategories: number;
  findingsWithoutExpectation: number;
  evidenceTraceFailures: number;
  failures: number;
  actualByCategory: Record<FindingCategory, number>;
  expectedByCategory: Record<FindingCategory, number>;
}

export interface EvaluationSummary {
  generatedAt: string;
  engineVersion: string;
  corpusVersion: string;
  note: string;
  totals: EvaluationTotals;
  perCategory: Record<FindingCategory, EvaluationCategoryMetric>;
  cases: EvaluationCaseSummary[];
}

export interface UploadResponse {
  auditId: string;
}

export const STAGES: {
  id: string;
  label: string;
  description: string;
}[] = [
  { id: "queued", label: "Queued", description: "Waiting for the processing worker." },
  { id: "validating", label: "Validating", description: "Checking the PDF structure and readable pages." },
  { id: "extracting", label: "Extracting text", description: "Reading selectable text and layout positions page by page." },
  { id: "structuring", label: "Mapping structure", description: "Detecting sections, tables, and captions." },
  { id: "claims", label: "Identifying claims", description: "Selecting auditable statements from the paper." },
  { id: "evidence", label: "Searching evidence", description: "Comparing claims with reported numbers and results." },
  { id: "report", label: "Building report", description: "Assembling traceable findings and the downloadable report." },
  { id: "complete", label: "Complete", description: "The audit report is ready to inspect." },
];
