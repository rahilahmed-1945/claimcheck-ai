import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { STAGES, type AuditErrorPayload, type AuditRecord } from "@shared/types";
import { formatBytes, formatDuration } from "../lib/format";
import { Icon } from "./Icon";
import { ProcessingNotice } from "./ProcessingNotice";

function elapsedLabel(started: string, now: number): string {
  const startedAt = new Date(started).getTime();
  if (Number.isNaN(startedAt)) return "—";
  return formatDuration(Math.max(0, now - startedAt));
}

interface ProcessingViewProps {
  audit: AuditRecord;
  connectionIssue?: AuditErrorPayload | null;
  onRetry?: () => void;
}

export function ProcessingView({ audit, connectionIssue, onRetry }: ProcessingViewProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const currentIndex = Math.max(
    0,
    STAGES.findIndex((stage) => stage.id === audit.stage || (audit.stage === "queued" && stage.id === "queued")),
  );
  const currentStage = STAGES[currentIndex];
  const displayProgress = Math.max(2, audit.progress);

  return (
    <div className="page page-narrow processing-page">
      {connectionIssue && (
        <div className="connection-banner" role="alert">
          <Icon name="alert" size={16} />
          <span>
            <strong>Connection interrupted.</strong> {connectionIssue.message} Retrying…
          </span>
          {onRetry && (
            <button type="button" className="text-link" onClick={onRetry}>
              Retry now
            </button>
          )}
        </div>
      )}

      <div className="processing-topline">
        <span className="eyebrow">
          <span className="eyebrow-dot" aria-hidden="true" />
          Audit in progress
        </span>
        <Link to="/reports" className="text-link">
          Back to reports <Icon name="arrowRight" size={14} />
        </Link>
      </div>

      <header className="page-header processing-header">
        <h1>Auditing your paper</h1>
        <p className="lede">
          ClaimCheck is reading the document, mapping its structure, and comparing auditable statements
          against the evidence it can extract. This may take a moment for longer papers.
        </p>
      </header>

      <div className="processing-grid">
        <section className="card processing-card" aria-live="polite" aria-busy="true">
          <div className="file-strip">
            <span className="file-strip-icon">
              <Icon name="file" size={19} />
            </span>
            <div className="file-strip-copy">
              <strong>{audit.filename}</strong>
              <span>
                {formatBytes(audit.fileSize)} · started {elapsedLabel(audit.createdAt, now)} ago
              </span>
            </div>
            <span className="live-label">
              <span className="live-dot" aria-hidden="true" />
              Live
            </span>
          </div>

          <div className="progress-block">
            <div className="progress-meta">
              <span>{currentStage?.label ?? "Processing"}</span>
              <span className="mono">{displayProgress}%</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={displayProgress}
              aria-label="Audit progress"
            >
              <span className="progress-fill" style={{ width: `${displayProgress}%` }} />
            </div>
            <p className="progress-detail">
              {audit.stageDetail || currentStage?.description || "Working…"}
            </p>
          </div>

          <ol className="stage-list">
            {STAGES.filter((stage) => stage.id !== "complete").map((stage, index) => {
              const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "pending";
              return (
                <li key={stage.id} className={`stage stage-${state}`}>
                  <span className="stage-marker" aria-hidden="true">
                    {state === "done" ? (
                      <Icon name="check" size={13} />
                    ) : state === "active" ? (
                      <span className="stage-pulse" />
                    ) : (
                      <span className="stage-idle" />
                    )}
                  </span>
                  <div className="stage-copy">
                    <strong>{stage.label}</strong>
                    <span>
                      {state === "active" && audit.stageDetail ? audit.stageDetail : stage.description}
                    </span>
                  </div>
                  {state === "active" && <span className="stage-working">Working</span>}
                  {state === "done" && <span className="stage-done-label">Done</span>}
                </li>
              );
            })}
          </ol>

          <p className="processing-footnote">
            <Icon name="info" size={14} />
            You can leave this page. Processing continues on the local server and the report will
            appear under Reports.
          </p>
        </section>

        <aside className="processing-aside">
          <div className="card quiet-card">
            <span className="card-kicker">Running checks</span>
            <ul className="check-list">
              <li>
                <Icon name="file" size={16} />
                <span>Can the PDF be opened, and is there enough selectable text?</span>
              </li>
              <li>
                <Icon name="layers" size={16} />
                <span>Which sections, captions, and tables can be reliably reconstructed?</span>
              </li>
              <li>
                <Icon name="search" size={16} />
                <span>Which statements make auditable numeric, statistical, or scope claims?</span>
              </li>
              <li>
                <Icon name="scale" size={16} />
                <span>Do those claims agree with other passages and reported values?</span>
              </li>
            </ul>
          </div>
          <ProcessingNotice />
        </aside>
      </div>

    </div>
  );
}
