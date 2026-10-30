import { Link, useParams } from "react-router-dom";
import type { AuditErrorPayload } from "@shared/types";
import { AuditWorkspace } from "../components/AuditWorkspace";
import { ErrorPanel } from "../components/ErrorPanel";
import { Icon } from "../components/Icon";
import { ProcessingView } from "../components/ProcessingView";
import { formatBytes, formatDate } from "../lib/format";
import { useAudit } from "../lib/useAudit";

function LoadingAudit() {
  return (
    <div className="page loading-page" aria-busy="true" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <p>Loading the audit record…</p>
    </div>
  );
}

const NOT_FOUND: AuditErrorPayload = {
  code: "NOT_FOUND",
  title: "Audit not found",
  message: "This audit does not exist in the local store. It may have been deleted.",
  recovery: ["Return to the reports list.", "Upload the paper to create a new audit."],
};

export function AuditPage() {
  const { id } = useParams<{ id: string }>();
  const { audit, loading, error, connectionIssue, retry } = useAudit(id);

  if (loading && !audit) return <LoadingAudit />;

  if (!audit) {
    return (
      <div className="page page-narrow">
        <div className="workspace-topline">
          <Link to="/reports" className="breadcrumb-link">
            <Icon name="chevronLeft" size={14} /> All reports
          </Link>
        </div>
        <ErrorPanel
          error={error ?? NOT_FOUND}
          actions={
            <>
              {connectionIssue && (
                <button type="button" className="button button-primary button-sm" onClick={retry}>
                  <Icon name="refresh" size={14} /> Retry connection
                </button>
              )}
              <Link to="/reports" className="button button-secondary button-sm">
                Back to reports
              </Link>
              <Link to="/" className="button button-ghost button-sm">
                New audit
              </Link>
            </>
          }
        />
      </div>
    );
  }

  if (audit.status === "failed") {
    return (
      <div className="page page-narrow failed-page">
        <div className="workspace-topline">
          <Link to="/reports" className="breadcrumb-link">
            <Icon name="chevronLeft" size={14} /> All reports
          </Link>
          <Link to="/" className="button button-primary button-sm">
            <Icon name="plus" size={14} /> New audit
          </Link>
        </div>
        <header className="audit-header">
          <span className="eyebrow">
            <span className="eyebrow-dot is-failed" aria-hidden="true" />
            Audit failed
          </span>
          <h1>{audit.filename}</h1>
          <div className="audit-meta">
            <span>{formatDate(audit.createdAt)}</span>
            <span>{formatBytes(audit.fileSize)}</span>
            <span className="mono">Engine {audit.engineVersion}</span>
          </div>
        </header>
        <ErrorPanel
          error={
            audit.error ?? {
              code: "AUDIT_FAILED",
              title: "The audit could not be completed",
              message: "No audit report was saved.",
              recovery: ["Upload the paper again.", "Try a shorter text-based PDF."],
            }
          }
          actions={
            <>
              <Link to="/" className="button button-primary button-sm">
                <Icon name="upload" size={14} /> Upload another PDF
              </Link>
              <Link to="/reports" className="button button-secondary button-sm">
                Back to reports
              </Link>
            </>
          }
        />
        <div className="failed-note">
          <Icon name="info" size={15} />
          <p>
            No findings were generated or displayed for this document. ClaimCheck does not show
            partial results as a finished audit, because incomplete extraction can produce
            misleading findings.
          </p>
        </div>
      </div>
    );
  }

  if (audit.status === "complete") {
    if (!audit.document || !audit.summary) {
      return (
        <div className="page page-narrow">
          <ErrorPanel
            error={{
              code: "INCOMPLETE_RECORD",
              title: "This report record is incomplete",
              message:
                "The audit is marked complete, but its stored document or summary is missing. This can happen after manual database changes.",
              recovery: ["Upload the paper again to create a new audit."],
            }}
            actions={
              <Link to="/" className="button button-primary button-sm">
                New audit
              </Link>
            }
          />
        </div>
      );
    }
    return <AuditWorkspace audit={audit} key={audit.id} />;
  }

  return (
    <ProcessingView
      audit={audit}
      connectionIssue={connectionIssue}
      onRetry={retry}
    />
  );
}
