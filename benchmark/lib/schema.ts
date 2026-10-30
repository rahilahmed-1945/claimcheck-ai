/**
 * Real-paper benchmark: annotation schema v1 and its validator.
 *
 * Annotations are written by people. A file is accepted only when every
 * annotator is declared `kind: "human"`, the file says `source: "human"`, and
 * the paper hash matches the manifest. Engine output is a different schema
 * (`claimcheck-prediction/v1`) and is rejected here, so predictions can never
 * be scored as ground truth.
 */
export const ANNOTATION_SCHEMA = "claimcheck-annotation/v1";
export const PREDICTION_SCHEMA = "claimcheck-prediction/v1";

/** Human label for an auditable claim, judged against the paper itself. */
export const CLAIM_LABELS = ["supported", "partially_supported", "contradicted", "unsupported", "needs_review"] as const;
export type ClaimLabel = (typeof CLAIM_LABELS)[number];

export const ISSUE_TAGS = [
  "numerical_inconsistency",
  "citation_issue",
  "reference_issue",
  "overreach",
  "statistical_reporting",
] as const;
export type IssueTag = (typeof ISSUE_TAGS)[number];

export const REFERENCE_ISSUE_KINDS = [
  "missing_table",
  "missing_figure",
  "uncited_reference",
  "missing_bibliography_entry",
  "malformed_reference",
] as const;
export type ReferenceIssueKind = (typeof REFERENCE_ISSUE_KINDS)[number];

export interface AnnotatedEvidence {
  page: number;
  quote: string;
  relation: "supports" | "contradicts" | "context";
  tableLabel?: string;
}

export interface AnnotatedClaim {
  id: string;
  /** Sentence text as it appears in the PDF (or the template's extracted text). */
  text: string;
  page: number;
  section?: string;
  /** false marks a sentence the annotator judged not to be an auditable claim (a negative item). */
  auditable: boolean;
  label?: ClaimLabel;
  issues?: IssueTag[];
  evidence?: AnnotatedEvidence[];
  notes?: string;
  /** Set only for AI-assisted review: whether the reviewer approved the proposal as written or amended it. */
  review?: "approved" | "amended";
}

/**
 * How the labels were produced. Absent means blind human annotation. With
 * "ai_assisted_review", an AI proposed labels for a subset of sentences and a
 * person approved or amended each one before it was imported; rejected and
 * unreviewed proposals are not labels. Scope "subset" means only the proposed
 * sentences were judged, so recall is measured over that subset only.
 */
export interface LabelProvenance {
  method: "blind" | "ai_assisted_review";
  scope: "full_pages" | "subset";
  proposalGenerator?: string;
  decisions?: { approved: number; amended: number; rejected: number; unreviewed: number };
}

export interface AnnotatedReferenceIssue {
  kind: ReferenceIssueKind;
  label: string;
  page?: number;
  notes?: string;
}

export interface Annotator {
  id: string;
  kind: "human";
  expertise?: string;
}

export interface PaperAnnotation {
  schema: typeof ANNOTATION_SCHEMA;
  source: "human";
  paperId: string;
  paperSha256: string;
  annotators: Annotator[];
  adjudication: { method: "single" | "consensus" | "adjudicated"; date: string };
  /** Pages the annotators reviewed completely. Claims elsewhere are unscored. */
  pagesReviewed: number[];
  claims: AnnotatedClaim[];
  referenceIssues?: AnnotatedReferenceIssue[];
  provenance?: LabelProvenance;
  notes?: string;
}

export class SchemaError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid annotation file:\n- ${problems.join("\n- ")}`);
    this.name = "SchemaError";
  }
}

const isString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isPage = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;

/** Validate a parsed annotation file. Throws SchemaError listing every problem. */
export function validateAnnotation(input: unknown, expectedSha256?: string): PaperAnnotation {
  const problems: string[] = [];
  const doc = input as Partial<PaperAnnotation> & { schema?: unknown };
  if (!doc || typeof doc !== "object") throw new SchemaError(["not a JSON object"]);
  if ((input as { schema?: unknown }).schema === PREDICTION_SCHEMA) {
    throw new SchemaError(["this is an engine prediction file; predictions can never be used as ground truth"]);
  }
  if (doc.schema !== ANNOTATION_SCHEMA) problems.push(`schema must be "${ANNOTATION_SCHEMA}"`);
  if (doc.source !== "human") problems.push('source must be "human"');
  if (!isString(doc.paperId)) problems.push("paperId is required");
  if (!/^[0-9a-f]{64}$/.test(String(doc.paperSha256 ?? ""))) problems.push("paperSha256 must be a SHA-256 hex digest");
  if (expectedSha256 && doc.paperSha256 !== expectedSha256) problems.push("paperSha256 does not match the manifest");
  if (!Array.isArray(doc.annotators) || doc.annotators.length === 0) {
    problems.push("at least one annotator is required");
  } else {
    doc.annotators.forEach((annotator, index) => {
      if (!isString(annotator?.id)) problems.push(`annotators[${index}].id is required`);
      if (annotator?.kind !== "human") problems.push(`annotators[${index}].kind must be "human"`);
    });
  }
  if (!doc.adjudication || !["single", "consensus", "adjudicated"].includes(doc.adjudication.method)) {
    problems.push("adjudication.method must be single, consensus, or adjudicated");
  }
  if (!Array.isArray(doc.pagesReviewed) || !doc.pagesReviewed.every(isPage)) problems.push("pagesReviewed must list page numbers");
  if (!Array.isArray(doc.claims)) {
    problems.push("claims must be an array");
  } else {
    const ids = new Set<string>();
    doc.claims.forEach((claim, index) => {
      const at = `claims[${index}]`;
      if (!isString(claim?.id)) problems.push(`${at}.id is required`);
      else if (ids.has(claim.id)) problems.push(`${at}.id "${claim.id}" is duplicated`);
      else ids.add(claim.id);
      if (!isString(claim?.text)) problems.push(`${at}.text is required`);
      if (!isPage(claim?.page)) problems.push(`${at}.page must be a page number`);
      if (typeof claim?.auditable !== "boolean") problems.push(`${at}.auditable must be true or false`);
      if (claim?.auditable && !CLAIM_LABELS.includes(claim.label as ClaimLabel)) {
        problems.push(`${at}.label must be one of ${CLAIM_LABELS.join(", ")}`);
      }
      if (claim?.auditable === false && claim.label) problems.push(`${at} is not auditable, so it must not have a label`);
      for (const issue of claim?.issues ?? []) {
        if (!ISSUE_TAGS.includes(issue)) problems.push(`${at}.issues contains unknown tag "${issue}"`);
      }
      if (claim?.review !== undefined && !["approved", "amended"].includes(claim.review)) {
        problems.push(`${at}.review must be approved or amended`);
      }
      if (claim?.review && doc.provenance?.method !== "ai_assisted_review") {
        problems.push(`${at}.review is only allowed when provenance.method is "ai_assisted_review"`);
      }
      (claim?.evidence ?? []).forEach((evidence, evidenceIndex) => {
        if (!isPage(evidence?.page) || !isString(evidence?.quote) || !["supports", "contradicts", "context"].includes(evidence?.relation)) {
          problems.push(`${at}.evidence[${evidenceIndex}] needs page, quote, and relation`);
        }
      });
    });
  }
  for (const [index, issue] of (doc.referenceIssues ?? []).entries()) {
    if (!REFERENCE_ISSUE_KINDS.includes(issue?.kind) || !isString(issue?.label)) {
      problems.push(`referenceIssues[${index}] needs a known kind and a label`);
    }
  }
  if (doc.provenance !== undefined) {
    const provenance = doc.provenance;
    if (!["blind", "ai_assisted_review"].includes(provenance?.method)) problems.push("provenance.method must be blind or ai_assisted_review");
    if (!["full_pages", "subset"].includes(provenance?.scope)) problems.push("provenance.scope must be full_pages or subset");
    if (provenance?.method === "ai_assisted_review") {
      if (!isString(provenance.proposalGenerator)) problems.push("provenance.proposalGenerator is required for AI-assisted review");
      if (Array.isArray(doc.claims) && doc.claims.some((claim) => !claim?.review)) {
        problems.push("every claim in an AI-assisted review must record the reviewer's decision (approved or amended)");
      }
    }
  }
  if (problems.length > 0) throw new SchemaError(problems);
  return doc as PaperAnnotation;
}

/** Engine findings mapped onto the human label vocabulary. */
export const CATEGORY_TO_LABEL: Record<string, ClaimLabel> = {
  supported: "supported",
  partially_supported: "partially_supported",
  potential_contradiction: "contradicted",
  potentially_unsupported: "unsupported",
  needs_review: "needs_review",
};

export interface PredictedEvidence {
  page: number;
  quote: string;
  relation: "supports" | "conflicts" | "context";
  kind: "sentence" | "table_row" | "metadata";
}

export interface PredictedClaim {
  findingId: string;
  text: string;
  page: number;
  section: string;
  category: string;
  label: ClaimLabel;
  confidence: string;
  /** Check ids that were flagged (e.g. arithmetic_consistency, table_cell_match, reference_traceability). */
  flaggedChecks: string[];
  evidence: PredictedEvidence[];
}

export interface PaperPrediction {
  schema: typeof PREDICTION_SCHEMA;
  source: "engine";
  paperId: string;
  paperSha256: string;
  engineVersion: string;
  generatedAt: string;
  claims: PredictedClaim[];
}
