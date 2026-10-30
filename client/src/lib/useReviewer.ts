/**
 * Reviewer workspace — per-finding notes and dispositions.
 *
 * Persisted in localStorage keyed by audit ID so notes survive page refreshes
 * and server restarts. The backend has no reviewer-state schema, so all state
 * lives in the browser. This is appropriate for a single-user local tool.
 */
import { useCallback, useEffect, useState } from "react";

export type ReviewDisposition =
  | "to_review"
  | "confirmed_issue"
  | "false_positive"
  | "resolved";

export interface ReviewerState {
  disposition: ReviewDisposition;
  note: string;
  updatedAt: string; // ISO timestamp
}

type AuditReviewMap = Record<string, ReviewerState>; // key: findingId

const STORAGE_KEY_PREFIX = "claimcheck_reviewer_";

function storageKey(auditId: string): string {
  return `${STORAGE_KEY_PREFIX}${auditId}`;
}

function loadFromStorage(auditId: string): AuditReviewMap {
  try {
    const raw = localStorage.getItem(storageKey(auditId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as AuditReviewMap;
    }
  } catch {
    // Corrupt storage — start fresh.
  }
  return {};
}

function saveToStorage(auditId: string, map: AuditReviewMap): void {
  try {
    localStorage.setItem(storageKey(auditId), JSON.stringify(map));
  } catch {
    // Storage quota exceeded or not available — silent fail.
  }
}

export const DISPOSITION_META: Record<
  ReviewDisposition,
  { label: string; shortLabel: string; className: string; description: string }
> = {
  to_review: {
    label: "To review",
    shortLabel: "Review",
    className: "disposition-review",
    description: "This finding has not yet been manually reviewed.",
  },
  confirmed_issue: {
    label: "Confirmed issue",
    shortLabel: "Issue",
    className: "disposition-issue",
    description: "A reviewer has confirmed this as a genuine concern.",
  },
  false_positive: {
    label: "False positive",
    shortLabel: "FP",
    className: "disposition-fp",
    description: "A reviewer has determined this is not a real concern.",
  },
  resolved: {
    label: "Resolved",
    shortLabel: "Done",
    className: "disposition-resolved",
    description: "This finding has been addressed or acknowledged.",
  },
};

export const DISPOSITION_ORDER: ReviewDisposition[] = [
  "to_review",
  "confirmed_issue",
  "false_positive",
  "resolved",
];

export interface UseReviewerResult {
  /** Get the reviewer state for a specific finding. */
  getState: (findingId: string) => ReviewerState;
  /** Update the disposition for a finding. */
  setDisposition: (findingId: string, disposition: ReviewDisposition) => void;
  /** Update the note for a finding. */
  setNote: (findingId: string, note: string) => void;
  /** True when any finding in this audit has been annotated. */
  hasAnnotations: boolean;
  /** Count of findings by disposition. */
  countByDisposition: Record<ReviewDisposition, number>;
  /** The full map, useful for export. */
  reviewMap: AuditReviewMap;
  /** Clear all reviewer state for this audit. */
  clearAll: () => void;
}

export function useReviewer(auditId: string, findingIds: string[]): UseReviewerResult {
  const [reviewMap, setReviewMap] = useState<AuditReviewMap>(() =>
    loadFromStorage(auditId),
  );

  // Re-load if auditId changes (navigating between audits).
  useEffect(() => {
    setReviewMap(loadFromStorage(auditId));
  }, [auditId]);

  const persist = useCallback(
    (next: AuditReviewMap) => {
      setReviewMap(next);
      saveToStorage(auditId, next);
    },
    [auditId],
  );

  const getState = useCallback(
    (findingId: string): ReviewerState => {
      return (
        reviewMap[findingId] ?? {
          disposition: "to_review",
          note: "",
          updatedAt: "",
        }
      );
    },
    [reviewMap],
  );

  const setDisposition = useCallback(
    (findingId: string, disposition: ReviewDisposition) => {
      const current = reviewMap[findingId] ?? { disposition: "to_review", note: "", updatedAt: "" };
      persist({
        ...reviewMap,
        [findingId]: { ...current, disposition, updatedAt: new Date().toISOString() },
      });
    },
    [reviewMap, persist],
  );

  const setNote = useCallback(
    (findingId: string, note: string) => {
      const current = reviewMap[findingId] ?? { disposition: "to_review", note: "", updatedAt: "" };
      persist({
        ...reviewMap,
        [findingId]: { ...current, note, updatedAt: new Date().toISOString() },
      });
    },
    [reviewMap, persist],
  );

  const clearAll = useCallback(() => {
    try {
      localStorage.removeItem(storageKey(auditId));
    } catch {
      // ignore
    }
    setReviewMap({});
  }, [auditId]);

  const countByDisposition: Record<ReviewDisposition, number> = {
    to_review: 0,
    confirmed_issue: 0,
    false_positive: 0,
    resolved: 0,
  };

  let hasAnnotations = false;
  for (const id of findingIds) {
    const state = reviewMap[id];
    const disposition: ReviewDisposition = state?.disposition ?? "to_review";
    countByDisposition[disposition] += 1;
    if (state && (state.note.trim() || state.disposition !== "to_review")) {
      hasAnnotations = true;
    }
  }

  return {
    getState,
    setDisposition,
    setNote,
    hasAnnotations,
    countByDisposition,
    reviewMap,
    clearAll,
  };
}
