/**
 * AI-assisted review: proposals in, human decisions out.
 *
 * An AI assistant may propose labels for a manageable subset of a paper's
 * sentences to speed up annotation. Proposals are NOT labels. They live in
 * benchmark/proposals/ under their own schema, and a sentence becomes a label
 * only when a named person marks the row `approve` (the proposal is right as
 * written) or `amend` (the person's own values replace it) in the review
 * sheet. `reject` and blank rows are dropped and counted.
 *
 * ClaimCheck's own output can never be a proposal: the engine is what the
 * benchmark measures, so proposals from it would bias the labels toward it.
 */
import {
  ANNOTATION_SCHEMA,
  CLAIM_LABELS,
  ISSUE_TAGS,
  PREDICTION_SCHEMA,
  type AnnotatedClaim,
  type AnnotatedEvidence,
  type ClaimLabel,
  type IssueTag,
} from "./schema.js";

export const PROPOSAL_SCHEMA = "claimcheck-proposal/v1";

export interface ProposedItem {
  /** claim_id from the blind template (e.g. s0042). */
  claimId: string;
  auditable: boolean;
  label?: ClaimLabel;
  issues?: IssueTag[];
  evidence?: AnnotatedEvidence[];
  /** Why the assistant proposed this, so the reviewer can check the reasoning against the PDF. */
  rationale: string;
}

export interface PaperProposals {
  schema: typeof PROPOSAL_SCHEMA;
  source: "ai";
  paperId: string;
  paperSha256: string;
  generator: { kind: "ai"; name: string; date: string };
  items: ProposedItem[];
}

export const REVIEW_DECISIONS = ["approve", "amend", "reject"] as const;

export class ProposalError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid proposal file:\n- ${problems.join("\n- ")}`);
    this.name = "ProposalError";
  }
}

const isString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function validateProposals(input: unknown, expectedSha256: string, templateIds: Set<string>): PaperProposals {
  const doc = input as Partial<PaperProposals>;
  const schema = (input as { schema?: unknown } | null)?.schema;
  if (!doc || typeof doc !== "object") throw new ProposalError(["not a JSON object"]);
  if (schema === PREDICTION_SCHEMA) throw new ProposalError(["this is ClaimCheck engine output; the engine cannot propose its own ground truth"]);
  if (schema === ANNOTATION_SCHEMA) throw new ProposalError(["this is a human annotation file, not a proposal file"]);
  const problems: string[] = [];
  if (doc.schema !== PROPOSAL_SCHEMA) problems.push(`schema must be "${PROPOSAL_SCHEMA}"`);
  if (doc.source !== "ai") problems.push('source must be "ai"');
  if (doc.paperSha256 !== expectedSha256) problems.push("paperSha256 does not match the manifest");
  if (doc.generator?.kind !== "ai" || !isString(doc.generator?.name)) problems.push("generator must be { kind: \"ai\", name, date }");
  else if (/claimcheck/i.test(doc.generator.name)) problems.push("ClaimCheck output cannot be used as proposals");
  if (!Array.isArray(doc.items) || doc.items.length === 0) problems.push("items must be a non-empty array");
  const seen = new Set<string>();
  (doc.items ?? []).forEach((item, index) => {
    const at = `items[${index}]`;
    if (!templateIds.has(item?.claimId)) problems.push(`${at}.claimId "${item?.claimId}" is not in the blind template`);
    if (seen.has(item?.claimId)) problems.push(`${at}.claimId "${item.claimId}" is duplicated`);
    seen.add(item?.claimId);
    if (typeof item?.auditable !== "boolean") problems.push(`${at}.auditable must be true or false`);
    if (item?.auditable && !CLAIM_LABELS.includes(item.label as ClaimLabel)) problems.push(`${at}.label must be one of ${CLAIM_LABELS.join(", ")}`);
    if (item?.auditable === false && item.label) problems.push(`${at} is not auditable, so it must not have a label`);
    for (const issue of item?.issues ?? []) if (!ISSUE_TAGS.includes(issue)) problems.push(`${at}.issues contains unknown tag "${issue}"`);
    if (!isString(item?.rationale)) problems.push(`${at}.rationale is required`);
  });
  if (problems.length > 0) throw new ProposalError(problems);
  return doc as PaperProposals;
}

/** Review-sheet rows: one per proposed sentence, proposal beside empty decision and amendment columns. */
export function reviewSheetRows(templateRows: Record<string, string>[], proposals: PaperProposals): Record<string, string>[] {
  const byId = new Map(templateRows.map((row) => [row.claim_id, row]));
  return proposals.items.map((item) => {
    const row = byId.get(item.claimId)!;
    const evidence = item.evidence?.[0];
    return {
      claim_id: item.claimId,
      page: row.page ?? "",
      section: row.section ?? "",
      text: row.text ?? "",
      proposed_auditable: item.auditable ? "yes" : "no",
      proposed_label: item.label ?? "",
      proposed_issues: (item.issues ?? []).join("; "),
      proposed_evidence_page: evidence ? String(evidence.page) : "",
      proposed_evidence_quote: evidence?.quote ?? "",
      proposed_evidence_relation: evidence?.relation ?? "",
      proposal_rationale: item.rationale,
      decision: "",
      auditable: "",
      label: "",
      issues: "",
      evidence_page: "",
      evidence_quote: "",
      evidence_relation: "",
      notes: "",
    };
  });
}

/** Turn one set of label columns (blind or amended) into a claim. Shared with the blind import. */
export function rowToClaim(row: Record<string, string>, prefix = ""): AnnotatedClaim | null {
  const field = (name: string) => (row[`${prefix}${name}`] ?? "").trim();
  const decision = field("auditable").toLowerCase();
  if (!decision) return null;
  const auditable = ["yes", "y", "true", "1"].includes(decision);
  const claim: AnnotatedClaim = { id: row.claim_id ?? "", text: row.text ?? "", page: Number(row.page), auditable };
  if (row.section) claim.section = row.section;
  if (auditable) claim.label = field("label") as ClaimLabel;
  const issues = field("issues").split(/[;,]/).map((issue) => issue.trim()).filter(Boolean) as IssueTag[];
  if (issues.length > 0) claim.issues = issues;
  if (field("evidence_quote")) {
    claim.evidence = [
      {
        page: Number(field("evidence_page")),
        quote: field("evidence_quote"),
        relation: (field("evidence_relation") || "supports") as AnnotatedEvidence["relation"],
      },
    ];
  }
  if (row.notes?.trim()) claim.notes = row.notes.trim();
  return claim;
}

/** Apply reviewer decisions. Only approved and amended rows become claims. */
export function claimsFromReview(rows: Record<string, string>[]) {
  const decisions = { approved: 0, amended: 0, rejected: 0, unreviewed: 0 };
  const claims: AnnotatedClaim[] = [];
  const problems: string[] = [];
  for (const row of rows) {
    const decision = (row.decision ?? "").trim().toLowerCase();
    const amendedFilled = ["auditable", "label", "issues", "evidence_page", "evidence_quote", "evidence_relation"].some((name) => (row[name] ?? "").trim());
    if (!decision) {
      decisions.unreviewed++;
      continue;
    }
    if (!REVIEW_DECISIONS.includes(decision as (typeof REVIEW_DECISIONS)[number])) {
      problems.push(`${row.claim_id}: decision must be approve, amend, reject, or blank`);
      continue;
    }
    if (decision === "reject") {
      decisions.rejected++;
      continue;
    }
    if (decision === "approve") {
      if (amendedFilled) {
        problems.push(`${row.claim_id}: approved rows must leave the amendment columns empty; use "amend" to change the proposal`);
        continue;
      }
      const claim = rowToClaim(row, "proposed_");
      if (claim) claims.push({ ...claim, review: "approved" });
      decisions.approved++;
      continue;
    }
    const claim = rowToClaim(row);
    if (!claim) {
      problems.push(`${row.claim_id}: amended rows need at least the auditable column`);
      continue;
    }
    claims.push({ ...claim, review: "amended" });
    decisions.amended++;
  }
  return { claims, decisions, problems };
}
