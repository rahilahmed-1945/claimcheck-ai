import { useState } from "react";
import { Link } from "react-router-dom";
import type { AuditErrorPayload } from "@shared/types";
import { ApiError, deleteAudit } from "../lib/api";
import { CATEGORY_META, CATEGORY_ORDER } from "../lib/categories";
import { formatBytes, formatDate, plural, relativeTime } from "../lib/format";
import { useAuditList } from "../lib/useAuditList";
import { Icon } from "../components/Icon";
import { StatusBadge } from "../components/Badges";
import { ErrorPanel } from "../components/ErrorPanel";

export function ReportsPage() {
  const { audits, total, loading, error, reload } = useAuditList();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<AuditErrorPayload | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteAudit(id);
      setConfirmId(null);
      reload();
    } catch (caught) {
      setDeleteError(
        caught instanceof ApiError
          ? caught.payload
          : {
              code: "DELETE_FAILED",
              title: "The report could not be deleted",
              message: "An unexpected client error occurred.",
              recovery: ["Reload the page and try again."],
            },
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="page reports-page">
      <div className="workspace-topline">
        <span className="eyebrow">
          <span className="eyebrow-dot" aria-hidden="true" />
          Local archive
        </span>
        <Link to="/" className="button button-primary button-sm">
          <Icon name="plus" size={14} /> New audit
        </Link>
      </div>

      <header className="page-header reports-header">
        <h1>Audit reports</h1>
        <p className="lede">
          Every completed, failed, or in-progress audit on this machine. Newest first. Reports are
          evidence records, not scores of research quality.
        </p>
        {!loading && !error && (
          <p className="reports-count">
            {total} stored {plural(total, "report")} · {formatDate(new Date().toISOString())}
          </p>
        )}
      </header>

      {deleteError && (
        <ErrorPanel
          error={deleteError}
          compact
          onDismiss={() => setDeleteError(null)}
        />
      )}

      {error ? (
        <ErrorPanel
          error={error}
          actions={
            <button type="button" className="button button-secondary button-sm" onClick={reload}>
              <Icon name="refresh" size={14} /> Try again
            </button>
          }
        />
      ) : loading ? (
        <div className="reports-table card" aria-busy="true">
          <div className="reports-table-head">
            <span>Document</span>
            <span>Outcome</span>
            <span>Created</span>
            <span aria-hidden="true" />
          </div>
          {[0, 1, 2].map((index) => (
            <div className="report-row" key={index}>
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line" />
              <span />
            </div>
          ))}
        </div>
      ) : audits.length === 0 ? (
        <div className="empty-reports card">
          <span className="empty-icon">
            <Icon name="file" size={24} />
          </span>
          <h2>No audit reports yet</h2>
          <p>
            Upload a text-based PDF to run the first audit. You can also run the synthetic demo paper
            to see how findings and evidence are presented.
          </p>
          <div className="empty-actions">
            <Link to="/" className="button button-primary">
              <Icon name="upload" size={15} /> Start an audit
            </Link>
            <Link to="/methodology" className="button button-secondary">
              Read the method
            </Link>
          </div>
        </div>
      ) : (
        <div className="reports-table card">
          <div className="reports-table-head">
            <span>Document</span>
            <span>Outcome</span>
            <span>Created</span>
            <span className="visually-hidden">Actions</span>
          </div>
          {audits.map((audit) => {
            const summary = audit.summary;
            const complete = audit.status === "complete" && summary;
            return (
              <article className="report-row" key={audit.id}>
                <div className="report-doc">
                  <span className={`report-icon status-ring-${audit.status}`}>
                    <Icon name={audit.status === "complete" ? "fileCheck" : "file"} size={18} />
                  </span>
                  <div className="report-doc-copy">
                    <Link to={`/audits/${audit.id}`} className="report-name">
                      {audit.filename}
                    </Link>
                    <span className="report-meta">
                      {formatBytes(audit.fileSize)}
                      {audit.pageCount ? ` · ${audit.pageCount} pages` : ""}
                      {complete ? ` · ${summary.claimsAudited} ${plural(summary.claimsAudited, "claim")} audited` : ""}
                    </span>
                  </div>
                </div>

                <div className="report-outcome">
                  <StatusBadge status={audit.status} />
                  {complete ? (
                    <div className="mini-categories">
                      {CATEGORY_ORDER.filter((category) => summary.byCategory[category] > 0).map((category) => (
                        <span className={`mini-category ${CATEGORY_META[category].className}`} key={category}>
                          <span className="badge-dot" aria-hidden="true" />
                          {CATEGORY_META[category].shortLabel} {summary.byCategory[category]}
                        </span>
                      ))}
                      {summary.claimsAudited === 0 && <span className="report-meta">No findings</span>}
                    </div>
                  ) : audit.status === "failed" ? (
                    <span className="report-error">{audit.errorTitle ?? "Processing failed"}</span>
                  ) : (
                    <span className="report-meta">{audit.stageDetail || "Processing"}</span>
                  )}
                </div>

                <div className="report-created">
                  <span>{relativeTime(audit.createdAt)}</span>
                  <span className="report-meta">{formatDate(audit.createdAt)}</span>
                </div>

                <div className="report-actions">
                  <Link
                    to={`/audits/${audit.id}`}
                    className="button button-secondary button-sm"
                    aria-label={`Open report for ${audit.filename}`}
                  >
                    Open <Icon name="chevronRight" size={13} />
                  </Link>
                  {confirmId === audit.id ? (
                    <div className="delete-confirm" role="group" aria-label="Confirm deletion">
                      <span>Delete permanently?</span>
                      <button
                        type="button"
                        className="button button-danger button-sm"
                        onClick={() => void handleDelete(audit.id)}
                        disabled={deletingId === audit.id}
                      >
                        {deletingId === audit.id ? "Deleting…" : "Delete"}
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-sm"
                        onClick={() => setConfirmId(null)}
                        disabled={deletingId === audit.id}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setConfirmId(audit.id)}
                      aria-label={`Delete audit ${audit.filename}`}
                      title="Delete audit and stored extracted text"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="workspace-footnote">
        <Icon name="database" size={14} />
        Reports and extracted paper text are stored in the local SQLite database. They are not
        encrypted, are retained until you delete them, and are visible to anyone who can access this
        server. Phase one has no accounts or access control.
      </p>
    </div>
  );
}
