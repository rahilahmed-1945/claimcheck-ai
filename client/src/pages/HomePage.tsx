import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AuditErrorPayload, AuditListItem, BackendInfo } from "@shared/types";
import { fetchHealth } from "../lib/api";
import { CATEGORY_META, CATEGORY_ORDER } from "../lib/categories";
import { formatDate, formatShortDate, plural, relativeTime } from "../lib/format";
import { useAuditList } from "../lib/useAuditList";
import { Icon, type IconName } from "../components/Icon";
import { StatusBadge } from "../components/Badges";
import { UploadPanel } from "../components/UploadPanel";

const CHECKS: { icon: IconName; title: string; body: string; caveat: string }[] = [
  {
    icon: "scale",
    title: "Repeated numeric claims",
    body: "Labelled metric values such as accuracy, F1, and AUC are compared across sections, including abstract versus results.",
    caveat: "Only recognized metric labels are compared.",
  },
  {
    icon: "table",
    title: "Claim versus table",
    body: "Simple table rows are reconstructed from text positions, then matched to claims that report the same metric.",
    caveat: "Complex or multi-page tables may not parse reliably.",
  },
  {
    icon: "flask",
    title: "Significance language",
    body: "Wording such as “statistically significant” is checked for a p-value, confidence interval, named test, or effect size.",
    caveat: "Absence of a test is not proof the result is non-significant.",
  },
  {
    icon: "layers",
    title: "Claim scope",
    body: "Universal wording (“all baselines”, “all domains”) is weighed against the comparisons and datasets actually located.",
    caveat: "Scope is judged from this paper alone.",
  },
];

function RecentAudits({
  audits,
  loading,
  error,
  reload,
}: {
  audits: AuditListItem[];
  loading: boolean;
  error: AuditErrorPayload | null;
  reload: () => void;
}) {
  if (loading) {
    return (
      <div className="recent-list" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <div className="recent-row skeleton-row" key={index}>
            <span className="skeleton skeleton-icon" />
            <span className="skeleton skeleton-line" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="notice notice-warning">
        <Icon name="alert" size={16} />
        <p>{error.message}</p>
        <button type="button" className="text-link" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  if (audits.length === 0) {
    return (
      <div className="empty-recent">
        <span className="empty-recent-icon">
          <Icon name="file" size={22} />
        </span>
        <div>
          <strong>No audits yet</strong>
          <p>Your first report will appear here. Reports are stored in this workspace’s local database.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="recent-list">
      {audits.slice(0, 5).map((audit) => {
        const findings = audit.summary?.claimsAudited;
        const contradictions = audit.summary?.byCategory.potential_contradiction ?? 0;
        return (
          <Link to={`/audits/${audit.id}`} className="recent-row" key={audit.id}>
            <span className={`recent-file-icon status-ring-${audit.status}`}>
              <Icon name={audit.status === "complete" ? "fileCheck" : "file"} size={19} />
            </span>
            <span className="recent-main">
              <strong>{audit.filename}</strong>
              <span className="recent-meta">
                {formatDate(audit.createdAt)}
                {audit.pageCount ? ` · ${audit.pageCount} pages` : ""}
                {typeof findings === "number" && audit.status === "complete"
                  ? ` · ${findings} ${plural(findings, "claim")} audited`
                  : ""}
                {contradictions > 0 ? ` · ${contradictions} potential ${plural(contradictions, "contradiction")}` : ""}
              </span>
              {audit.status === "failed" && audit.errorTitle && (
                <span className="recent-error">{audit.errorTitle}</span>
              )}
            </span>
            <span className="recent-status">
              <StatusBadge status={audit.status} />
              <Icon name="chevronRight" size={15} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<BackendInfo | null>(null);
  const [healthError, setHealthError] = useState<AuditErrorPayload | null>(null);
  const [healthNonce, setHealthNonce] = useState(0);
  const { audits, loading, error, reload } = useAuditList();

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((info) => {
        setHealth(info);
        setHealthError(null);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setHealthError(
          caught && typeof caught === "object" && "payload" in caught
            ? (caught as { payload: AuditErrorPayload }).payload
            : {
                code: "SERVER_OFFLINE",
                title: "Cannot reach the ClaimCheck server",
                message: "The local processing server did not respond.",
                recovery: ["Start the development server with `npm run dev`.", "Reload this page."],
              },
        );
      });
    return () => controller.abort();
  }, [healthNonce]);

  const latest = audits[0];

  return (
    <div className="page home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="eyebrow-dot" aria-hidden="true" />
            Research integrity workbench
          </span>
          <h1>
            Trace every claim
            <em>back to the page.</em>
          </h1>
          <p className="hero-lede">
            ClaimCheck AI reads an academic PDF, identifies auditable statements, and compares them
            with the paper’s own results, tables, and surrounding text. Every finding shows its
            evidence. Nothing is invented.
          </p>
          <div className="hero-points">
            <span>
              <Icon name="quote" size={15} /> No generated quotations
            </span>
            <span>
              <Icon name="shield" size={15} /> Evidence-linked findings
            </span>
            <span>
              <Icon name="lock" size={15} /> Local processing
            </span>
          </div>
        </div>
        <UploadPanel
          health={health}
          healthError={healthError}
          onRetryHealth={() => setHealthNonce((value) => value + 1)}
          onUploaded={(auditId) => navigate(`/audits/${auditId}`)}
        />
      </section>

      <section className="recent-section" aria-labelledby="recent-heading">
        <div className="section-heading-row">
          <div>
            <span className="card-kicker">Workbench</span>
            <h2 id="recent-heading">Recent audit reports</h2>
          </div>
          {audits.length > 0 && (
            <Link to="/reports" className="text-link">
              View all reports <Icon name="arrowRight" size={14} />
            </Link>
          )}
        </div>
        <RecentAudits audits={audits} loading={loading} error={error} reload={reload} />
        {latest && latest.status === "complete" && latest.summary && (
          <p className="recent-footnote">
            Latest report: {latest.summary.claimsAudited} {plural(latest.summary.claimsAudited, "claim")} audited
            {" · "}
            {latest.summary.byCategory.potential_contradiction} potential{" "}
            {plural(latest.summary.byCategory.potential_contradiction, "contradiction")}
            {" · "}
            saved {relativeTime(latest.createdAt)}. Counts reflect this paper only.
          </p>
        )}
      </section>

      <section className="categories-section" aria-labelledby="categories-heading">
        <div className="section-heading-row">
          <div>
            <span className="card-kicker">Classification</span>
            <h2 id="categories-heading">Five categories. One rule: show the evidence.</h2>
          </div>
          <p className="section-side-copy">
            Every finding gets exactly one label. A label describes the evidence relationship — never
            a verdict on the research.
          </p>
        </div>
        <div className="category-grid">
          {CATEGORY_ORDER.map((category, index) => {
            const meta = CATEGORY_META[category];
            return (
              <article className={`category-card ${meta.className}`} key={category}>
                <span className="category-index">0{index + 1}</span>
                <span className="category-name">
                  <span className="badge-dot" aria-hidden="true" />
                  {meta.label}
                </span>
                <p>{meta.definition}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="checks-section" aria-labelledby="checks-heading">
        <div className="section-heading-row">
          <div>
            <span className="card-kicker">Verification engine</span>
            <h2 id="checks-heading">What phase one actually checks</h2>
          </div>
          <span className="subtle-tag">
            <Icon name="flask" size={13} /> Deterministic rules
          </span>
        </div>
        <div className="checks-grid">
          {CHECKS.map((check) => (
            <article className="card check-card" key={check.title}>
              <span className="check-icon">
                <Icon name={check.icon} size={19} />
              </span>
              <h3>{check.title}</h3>
              <p>{check.body}</p>
              <span className="check-caveat">
                <Icon name="info" size={12} /> {check.caveat}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="closing-band">
        <div>
          <span className="card-kicker">Read the method</span>
          <h2>A revision instrument, not an integrity verdict.</h2>
          <p>
            ClaimCheck is designed to help authors and reviewers investigate specific statements
            efficiently. It does not infer missing results, verify external literature, or prove
            research misconduct.
          </p>
        </div>
        <div className="closing-actions">
          <Link to="/methodology" className="button button-secondary">
            <Icon name="book" size={15} /> How the audit works
          </Link>
          <span className="closing-note">
            Engine 0.1 · {formatShortDate(new Date().toISOString())} build
          </span>
        </div>
      </section>
    </div>
  );
}
