import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FINDING_CATEGORIES,
  type AuditRecord,
  type FindingCategory,
} from "@shared/types";
import { reportUrl } from "../lib/api";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  emptySummary,
  findingMatches,
} from "../lib/categories";
import { formatBytes, formatDate, formatDuration, plural } from "../lib/format";
import {
  DISPOSITION_META,
  DISPOSITION_ORDER,
  useReviewer,
  type ReviewDisposition,
} from "../lib/useReviewer";
import { CategoryBadge, ConfidenceBadge } from "./Badges";
import { DocumentView } from "./DocumentView";
import { FindingDetail } from "./FindingDetail";
import { Icon } from "./Icon";

type CategoryFilter = FindingCategory | "all";
type DispositionFilter = ReviewDisposition | "all";

function DispositionBadge({ disposition }: { disposition: ReviewDisposition }) {
  const meta = DISPOSITION_META[disposition];
  if (disposition === "to_review") return null; // default, don't badge
  return (
    <span className={`disposition-mini ${meta.className}`} title={meta.label}>
      {meta.shortLabel}
    </span>
  );
}

export function AuditWorkspace({ audit }: { audit: AuditRecord }) {
  const findings = audit.findings;
  const summary = audit.summary ?? emptySummary();
  const extraction = audit.extraction;
  const [tab, setTab] = useState<"findings" | "document">("findings");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [dispositionFilter, setDispositionFilter] = useState<DispositionFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(findings[0]?.id ?? null);
  const [docPage, setDocPage] = useState(1);
  const [highlight, setHighlight] = useState<string | null>(null);

  const reviewer = useReviewer(
    audit.id,
    findings.map((f) => f.id),
  );

  const visible = findings.filter((finding) => {
    if (categoryFilter !== "all" && finding.category !== categoryFilter) return false;
    if (dispositionFilter !== "all") {
      const state = reviewer.getState(finding.id);
      if (state.disposition !== dispositionFilter) return false;
    }
    return findingMatches(finding, query);
  });

  const selected = visible.find((finding) => finding.id === selectedId) ?? visible[0] ?? null;

  const viewInDocument = (page: number, quote: string) => {
    setDocPage(page > 0 ? page : 1);
    setHighlight(quote);
    setTab("document");
  };

  const resetFilters = () => {
    setCategoryFilter("all");
    setDispositionFilter("all");
    setQuery("");
  };

  const reviewSummaryItems = DISPOSITION_ORDER.filter(
    (d) => reviewer.countByDisposition[d] > 0,
  );

  return (
    <div className="page audit-page">
      <div className="workspace-topline">
        <Link to="/reports" className="breadcrumb-link">
          <Icon name="chevronLeft" size={14} /> All reports
        </Link>
        <div className="workspace-actions">
          <a
            className="button button-secondary button-sm"
            href={reportUrl(audit.id, "md")}
            download
            title="Download the evidence-linked audit report as Markdown"
          >
            <Icon name="download" size={14} /> Markdown
          </a>
          <a
            className="button button-secondary button-sm"
            href={reportUrl(audit.id, "json")}
            download
            title="Download the structured audit record as JSON"
          >
            <Icon name="download" size={14} /> JSON
          </a>
          <Link to="/" className="button button-primary button-sm">
            <Icon name="plus" size={14} /> New audit
          </Link>
        </div>
      </div>

      <header className="audit-header">
        <span className="eyebrow">
          <span className="eyebrow-dot" aria-hidden="true" />
          Audit report
        </span>
        <h1>{audit.filename}</h1>
        <div className="audit-meta">
          <span>{formatDate(audit.createdAt)}</span>
          {extraction && <span>{extraction.pageCount} pages</span>}
          {extraction && <span>{extraction.wordCount.toLocaleString()} words extracted</span>}
          <span>{formatBytes(audit.fileSize)}</span>
          {audit.timings && <span>Processed in {formatDuration(audit.timings.totalMs)}</span>}
          <span className="mono">Engine {audit.engineVersion}</span>
        </div>
      </header>

      {extraction && extraction.warnings.length > 0 && (
        <details className="extraction-details notice notice-quiet">
          <summary>
            <Icon name="alert" size={15} />
            <span>
              {extraction.warnings.length} extraction {plural(extraction.warnings.length, "notice")} —
              read before interpreting findings
            </span>
            <Icon name="chevronDown" size={14} />
          </summary>
          <ul>
            {extraction.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      <section className="summary-panel" aria-labelledby="summary-heading">
        <div className="summary-top">
          <div>
            <span className="card-kicker">Audit summary</span>
            <h2 id="summary-heading">
              {summary.claimsAudited} {plural(summary.claimsAudited, "claim")} audited
            </h2>
            <p>
              Each classification describes the relationship between a sentence and the extracted
              document. It is not a verdict on the research.
            </p>
          </div>
          <div className="summary-metrics">
            <div>
              <strong>{summary.evidenceLinks}</strong>
              <span>evidence links</span>
            </div>
            <div>
              <strong>
                {summary.tablesParsedReliably}/{summary.tablesDetected}
              </strong>
              <span>tables verified</span>
            </div>
          </div>
        </div>

        {/* Category filter chips */}
        <div className="filter-chips" role="group" aria-label="Filter findings by classification">
          <button
            type="button"
            className={`filter-chip filter-all${categoryFilter === "all" ? " is-active" : ""}`}
            onClick={() => setCategoryFilter("all")}
            aria-pressed={categoryFilter === "all"}
          >
            All claims <span className="chip-count">{summary.claimsAudited}</span>
          </button>
          {CATEGORY_ORDER.map((category) => {
            const meta = CATEGORY_META[category];
            const count = summary.byCategory[category];
            return (
              <button
                type="button"
                key={category}
                className={`filter-chip ${meta.className}${categoryFilter === category ? " is-active" : ""}`}
                onClick={() => setCategoryFilter(category)}
                aria-pressed={categoryFilter === category}
              >
                <span className="badge-dot" aria-hidden="true" />
                {meta.label} <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Reviewer status summary + filter */}
        {reviewer.hasAnnotations && (
          <div className="reviewer-summary-row">
            <span className="reviewer-summary-label">
              <Icon name="scale" size={13} /> Reviewer status:
            </span>
            <div className="disposition-filter-chips" role="group" aria-label="Filter by reviewer disposition">
              <button
                type="button"
                className={`disposition-filter-chip${dispositionFilter === "all" ? " is-active" : ""}`}
                onClick={() => setDispositionFilter("all")}
                aria-pressed={dispositionFilter === "all"}
              >
                All
              </button>
              {DISPOSITION_ORDER.map((disposition) => {
                const meta = DISPOSITION_META[disposition];
                const count = reviewer.countByDisposition[disposition];
                if (count === 0) return null;
                return (
                  <button
                    type="button"
                    key={disposition}
                    className={`disposition-filter-chip ${meta.className}${dispositionFilter === disposition ? " is-active" : ""}`}
                    onClick={() => setDispositionFilter(disposition)}
                    aria-pressed={dispositionFilter === disposition}
                  >
                    {meta.label} <span className="chip-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <div className="workspace-tabs" role="tablist" aria-label="Audit views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "findings"}
          className={`workspace-tab${tab === "findings" ? " is-active" : ""}`}
          onClick={() => setTab("findings")}
        >
          <Icon name="list" size={15} /> Findings <span>{findings.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "document"}
          className={`workspace-tab${tab === "document" ? " is-active" : ""}`}
          onClick={() => setTab("document")}
        >
          <Icon name="file" size={15} /> Source text
          {audit.document && extraction && <span>{extraction.pageCount}</span>}
        </button>
      </div>

      {tab === "findings" ? (
        <div className="findings-workspace" role="tabpanel" aria-label="Findings">
          <div className="findings-toolbar">
            <span className="results-count">
              Showing {visible.length} of {findings.length} {plural(findings.length, "finding")}
              {categoryFilter !== "all" ? ` · ${CATEGORY_META[categoryFilter].label}` : ""}
              {dispositionFilter !== "all" ? ` · ${DISPOSITION_META[dispositionFilter].label}` : ""}
            </span>
            <label className="search-field">
              <Icon name="search" size={15} />
              <span className="visually-hidden">Search findings</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search claims, evidence, sections…"
              />
              {query && (
                <button
                  type="button"
                  className="icon-button icon-button-sm"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </label>
          </div>

          {findings.length === 0 ? (
            <div className="empty-findings card">
              <span className="empty-icon">
                <Icon name="search" size={23} />
              </span>
              <h3>No auditable claims were selected</h3>
              <p>
                The claim selector did not find statements with checkable numeric, statistical, or
                scope language in the auditable sections. This is not a clean bill of health. Review
                the paper manually and read the method limits.
              </p>
              <div className="empty-actions">
                <Link to="/methodology" className="button button-ghost button-sm">
                  Read method limits
                </Link>
              </div>
            </div>
          ) : (
            <div className="audit-split">
              <div className="findings-list" aria-label="Findings list">
                {visible.length === 0 ? (
                  <div className="empty-filter">
                    <span className="empty-icon">
                      <Icon name="search" size={20} />
                    </span>
                    <strong>No findings match this view</strong>
                    <p>Try another classification or clear the search.</p>
                    <button type="button" className="button button-secondary button-sm" onClick={resetFilters}>
                      Reset filters
                    </button>
                  </div>
                ) : (
                  visible.map((finding) => {
                    const meta = CATEGORY_META[finding.category];
                    const active = selected?.id === finding.id;
                    const reviewState = reviewer.getState(finding.id);
                    return (
                      <button
                        type="button"
                        key={finding.id}
                        className={`finding-row ${meta.className}${active ? " is-selected" : ""}`}
                        onClick={() => setSelectedId(finding.id)}
                        aria-pressed={active}
                      >
                        <div className="finding-row-top">
                          <CategoryBadge category={finding.category} short />
                          <ConfidenceBadge confidence={finding.confidence} />
                          <DispositionBadge disposition={reviewState.disposition} />
                        </div>
                        <h3>{finding.title}</h3>
                        <p>{finding.claim.text}</p>
                        <div className="finding-row-meta">
                          <span>
                            {finding.claim.sectionTitle} · p. {finding.claim.page}
                          </span>
                          <span className="mono">{finding.id}</span>
                        </div>
                        {reviewState.note && (
                          <span className="finding-row-note">
                            <Icon name="quote" size={11} /> {reviewState.note.slice(0, 60)}{reviewState.note.length > 60 ? "…" : ""}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="detail-panel">
                {selected ? (
                  <FindingDetail
                    finding={selected}
                    onViewInDocument={audit.document ? viewInDocument : undefined}
                    reviewerState={reviewer.getState(selected.id)}
                    onDispositionChange={(disposition) => reviewer.setDisposition(selected.id, disposition)}
                    onNoteChange={(note) => reviewer.setNote(selected.id, note)}
                  />
                ) : (
                  <div className="empty-detail">
                    <Icon name="quote" size={22} />
                    <h3>Select a finding</h3>
                    <p>The evidence, numeric trace, and interpretation limits will appear here.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="document-workspace" role="tabpanel" aria-label="Source text">
          {audit.document ? (
            <DocumentView
              document={audit.document}
              page={docPage}
              onPageChange={setDocPage}
              highlight={highlight}
              onClearHighlight={() => setHighlight(null)}
            />
          ) : (
            <div className="notice notice-quiet source-unavailable" role="status">
              <Icon name="shield" size={18} />
              <div>
                <strong>Source text is not retained.</strong>
                <p>
                  To protect unpublished work, ClaimCheck processes the uploaded PDF in memory and keeps
                  only the audit: findings, summaries, and statistics. The full text, pages, section
                  headings, and tables are not stored, so the document cannot be shown here.
                </p>
                <p>
                  Each finding still quotes the claim and evidence excerpts it relies on, with their
                  section and page number{extraction ? ` (${extraction.pageCount} pages, ${extraction.wordCount.toLocaleString()} words were analysed)` : ""}.
                  Open your own copy of the PDF to read them in context.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="workspace-footnote">
        <Icon name="database" size={14} />
        This report's findings, summary, and short quoted excerpts are stored in the ClaimCheck
        database on this server. The uploaded PDF and its full text are not kept. Findings are not
        sent to any external service.
        {reviewer.hasAnnotations && (
          <>
            {" "}Reviewer notes and dispositions are stored in your browser's local storage,
            keyed to this audit.
          </>
        )}
      </p>
    </div>
  );
}
