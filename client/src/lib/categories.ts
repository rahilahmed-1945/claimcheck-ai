import type {
  Confidence,
  FindingCategory,
  Finding,
  AuditSummary,
} from "@shared/types";

export interface CategoryMeta {
  key: FindingCategory;
  label: string;
  shortLabel: string;
  definition: string;
  className: string;
}

export const CATEGORY_META: Record<FindingCategory, CategoryMeta> = {
  supported: {
    key: "supported",
    label: "Supported",
    shortLabel: "Supported",
    definition:
      "The available evidence appears to support the claim. This is not proof that the claim is universally true.",
    className: "cat-supported",
  },
  partially_supported: {
    key: "partially_supported",
    label: "Partially supported",
    shortLabel: "Partial",
    definition:
      "Some aspects of the claim are supported, but other aspects are not adequately established by the available evidence.",
    className: "cat-partial",
  },
  potentially_unsupported: {
    key: "potentially_unsupported",
    label: "Potentially unsupported",
    shortLabel: "Unsupported",
    definition:
      "The system could not locate sufficient supporting evidence in the accessible document. This does not prove that the claim is false.",
    className: "cat-unsupported",
  },
  potential_contradiction: {
    key: "potential_contradiction",
    label: "Potential contradiction",
    shortLabel: "Contradiction",
    definition:
      "The extracted evidence appears inconsistent with the claim. The exact evidence is shown with every finding.",
    className: "cat-contradiction",
  },
  needs_review: {
    key: "needs_review",
    label: "Needs review",
    shortLabel: "Needs review",
    definition:
      "The claim or available evidence is too ambiguous, incomplete, or unreliable for a confident classification. This is preferred over an unjustified conclusion.",
    className: "cat-review",
  },
};

export const CATEGORY_ORDER: FindingCategory[] = [
  "potential_contradiction",
  "potentially_unsupported",
  "partially_supported",
  "needs_review",
  "supported",
];

export const CONFIDENCE_META: Record<Confidence, { label: string; detail: string }> = {
  high: {
    label: "High confidence",
    detail: "A directly comparable value or reference could be traced in the extracted document.",
  },
  moderate: {
    label: "Moderate confidence",
    detail: "The finding rests on a traceable match, but some context or interpretation remains uncertain.",
  },
  low: {
    label: "Low confidence",
    detail: "Evidence was limited, ambiguous, or absent. Treat this as a prompt to review, not a conclusion.",
  },
};

export function emptySummary(): AuditSummary {
  return {
    claimsAudited: 0,
    evidenceLinks: 0,
    byCategory: {
      supported: 0,
      partially_supported: 0,
      potentially_unsupported: 0,
      potential_contradiction: 0,
      needs_review: 0,
    },
    tablesDetected: 0,
    tablesParsedReliably: 0,
  };
}

export function findingMatches(finding: Finding, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    finding.title.toLowerCase().includes(needle) ||
    finding.claim.text.toLowerCase().includes(needle) ||
    finding.rationale.toLowerCase().includes(needle) ||
    finding.claim.sectionTitle.toLowerCase().includes(needle) ||
    finding.evidence.some((evidence) => evidence.quote.toLowerCase().includes(needle))
  );
}
