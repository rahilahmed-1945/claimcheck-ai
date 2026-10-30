import type { CheckOutcome, EvidenceRef, Finding } from "@shared/types";
import { CATEGORY_META, CONFIDENCE_META } from "../lib/categories";
import type { ReviewerState, ReviewDisposition } from "../lib/useReviewer";
import { CategoryBadge, ConfidenceBadge } from "./Badges";
import { Icon } from "./Icon";
import { ReviewerPanel } from "./ReviewerPanel";
import { VoicePanel } from "./VoicePanel";

const RELATION_LABEL: Record<EvidenceRef["relation"], string> = {
  supports: "Supports",
  conflicts: "Conflicts",
  context: "Context",
};

const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  flagged: "Flagged",
  passed: "Passed",
  inconclusive: "Inconclusive",
  not_applicable: "Not applicable",
};

function OutcomeIcon({ outcome }: { outcome: CheckOutcome }) {
  if (outcome === "flagged") return <Icon name="alert" size={14} />;
  if (outcome === "passed") return <Icon name="check" size={14} />;
  return <Icon name="info" size={14} />;
}

interface FindingDetailProps {
  finding: Finding;
  onViewInDocument: (page: number, quote: string) => void;
  reviewerState: ReviewerState;
  onDispositionChange: (disposition: ReviewDisposition) => void;
  onNoteChange: (note: string) => void;
}

export function FindingDetail({
  finding,
  onViewInDocument,
  reviewerState,
  onDispositionChange,
  onNoteChange,
}: FindingDetailProps) {
  const meta = CATEGORY_META[finding.category];
  return (
    <article className="finding-detail" aria-label="Finding detail">
      <header className="finding-detail-head">
        <div className="finding-badges">
          <CategoryBadge category={finding.category} />
          <ConfidenceBadge confidence={finding.confidence} />
        </div>
        <h2>{finding.title}</h2>
        <p className="finding-definition">{meta.definition}</p>
      </header>

      <section className="detail-block claim-block">
        <div className="detail-label-row">
          <span className="detail-label">Claim under audit</span>
          <span className="location-chip">
            {finding.claim.sectionTitle} · p. {finding.claim.page}
          </span>
        </div>
        <blockquote className="claim-quote">{finding.claim.text}</blockquote>
        <button
          type="button"
          className="text-link text-link-sm"
          onClick={() => onViewInDocument(finding.claim.page, finding.claim.text)}
        >
          <Icon name="eye" size={14} /> View claim in document
        </button>
      </section>

      <section className="detail-block">
        <span className="detail-label">Why this classification</span>
        <p className="rationale">{finding.rationale}</p>
      </section>

      {finding.numericComparisons.length > 0 && (
        <section className="detail-block">
          <span className="detail-label">Numeric trace</span>
          <div className="comparison-stack">
            {finding.numericComparisons.map((comparison, index) => {
              const matches = comparison.delta === "0";
              return (
                <div
                  className={`comparison-card ${matches ? "comparison-match" : "comparison-diff"}`}
                  key={`${comparison.metric}-${index}`}
                >
                  <div className="comparison-top">
                    <span className="comparison-metric">{comparison.metric}</span>
                    <span className={`delta-chip ${matches ? "delta-match" : "delta-diff"}`}>
                      {matches ? "Same value" : `Δ ${comparison.delta}`}
                    </span>
                  </div>
                  <div className="comparison-values">
                    <div>
                      <span className="value-label">Claim · p. {comparison.claimPage}</span>
                      <span className="value-number">{comparison.claimValue}</span>
                    </div>
                    <span className="comparison-arrow" aria-hidden="true">
                      <Icon name="arrowRight" size={16} />
                    </span>
                    <div>
                      <span className="value-label">
                        {comparison.evidenceKind === "table_row" ? "Table" : "Text"} · p.{" "}
                        {comparison.evidencePage}
                      </span>
                      <span className="value-number">{comparison.evidenceValue}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="detail-caveat">
            <Icon name="info" size={12} />
            Values may legitimately differ because of datasets, splits, metrics, or rounding. Check
            the surrounding context before treating a difference as an error.
          </p>
        </section>
      )}

      <section className="detail-block">
        <span className="detail-label">Checks run</span>
        <ul className="check-results">
          {finding.checks.map((check) => (
            <li key={check.id} className={`check-result outcome-${check.outcome}`}>
              <span className="check-outcome-icon">
                <OutcomeIcon outcome={check.outcome} />
              </span>
              <div>
                <span className="check-result-head">
                  {check.label}
                  <em>{OUTCOME_LABEL[check.outcome]}</em>
                </span>
                <p>{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="detail-block">
        <div className="detail-label-row">
          <span className="detail-label">Evidence located</span>
          <span className="mono subtle">{finding.evidence.length} retained</span>
        </div>
        {finding.evidence.length === 0 ? (
          <div className="no-evidence">
            <Icon name="search" size={17} />
            <div>
              <strong>No qualifying evidence was located</strong>
              <p>
                The extraction and retrieval passes did not find a passage or table row that met the
                threshold. This is not evidence that the claim is false; the support may be absent,
                poorly extracted, or phrased differently.
              </p>
            </div>
          </div>
        ) : (
          <ol className="evidence-list">
            {finding.evidence.map((evidence) => (
              <li key={evidence.id} className={`evidence-item relation-${evidence.relation}`}>
                <div className="evidence-head">
                  <span className={`relation-chip relation-${evidence.relation}`}>
                    {RELATION_LABEL[evidence.relation]}
                  </span>
                  <span className="evidence-location">
                    {evidence.kind === "table_row"
                      ? "Table row · "
                      : evidence.kind === "metadata"
                        ? "Document structure · "
                        : ""}
                    {evidence.page > 0 ? `${evidence.sectionTitle} · p. ${evidence.page}` : evidence.sectionTitle}
                  </span>
                  {evidence.page > 0 && (
                    <button
                      type="button"
                      className="text-link text-link-sm evidence-view"
                      onClick={() => onViewInDocument(evidence.page, evidence.quote)}
                    >
                      View in document <Icon name="arrowRight" size={13} />
                    </button>
                  )}
                </div>
                <blockquote>{evidence.quote}</blockquote>
                {evidence.note && <p className="evidence-note">{evidence.note}</p>}
              </li>
            ))}
          </ol>
        )}
        <p className="search-scope">
          <Icon name="search" size={12} />
          Compared against {finding.searchScope.sentencesChecked} extracted sentences and{" "}
          {finding.searchScope.tableRowsChecked} reconstructed table rows.
        </p>
      </section>

      <section className="detail-block limits-block">
        <span className="detail-label">Interpretation limits</span>
        <ul className="limits-list">
          {finding.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
        <p className="confidence-explainer">
          <strong>{CONFIDENCE_META[finding.confidence].label}:</strong>{" "}
          {CONFIDENCE_META[finding.confidence].detail}
        </p>
      </section>

      <VoicePanel finding={finding} />

      <ReviewerPanel
        findingId={finding.id}
        state={reviewerState}
        onDispositionChange={onDispositionChange}
        onNoteChange={onNoteChange}
      />

      <footer className="finding-footer">
        <Icon name="scale" size={15} />
        This finding is a prompt for review, not a conclusion about the research. Interpret it
        together with the quoted evidence and the limits above.
      </footer>
    </article>
  );
}
