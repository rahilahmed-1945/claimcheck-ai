import type { Confidence, FindingCategory } from "@shared/types";
import { CATEGORY_META, CONFIDENCE_META } from "../lib/categories";

export function CategoryBadge({
  category,
  short = false,
}: {
  category: FindingCategory;
  short?: boolean;
}) {
  const meta = CATEGORY_META[category];
  return (
    <span className={`badge ${meta.className}`}>
      <span className="badge-dot" aria-hidden="true" />
      {short ? meta.shortLabel : meta.label}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const meta = CONFIDENCE_META[confidence];
  return (
    <span className={`confidence confidence-${confidence}`} title={meta.detail}>
      <span className="confidence-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {meta.label}
    </span>
  );
}

export function StatusBadge({
  status,
}: {
  status: "queued" | "processing" | "complete" | "failed";
}) {
  const labels: Record<typeof status, string> = {
    queued: "Queued",
    processing: "In progress",
    complete: "Complete",
    failed: "Failed",
  };
  return <span className={`status-badge status-${status}`}>{labels[status]}</span>;
}
