import { useEffect, useRef } from "react";
import type { AuditedDocument } from "@shared/types";
import { Icon } from "./Icon";

interface DocumentViewProps {
  document: AuditedDocument;
  page: number;
  onPageChange: (page: number) => void;
  highlight: string | null;
  onClearHighlight: () => void;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findAnchor(text: string, quote: string): { index: number; length: number } | null {
  const words = quote
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 1);
  for (const size of [10, 7, 5, 3]) {
    const slice = words.slice(0, size);
    if (slice.length === 0) continue;
    const pattern = slice.map(escapeRegex).join("\\s+");
    try {
      const match = new RegExp(pattern, "i").exec(text);
      if (match && match.index >= 0) return { index: match.index, length: match[0].length };
    } catch {
      // Try a shorter anchor.
    }
  }
  return null;
}

export function DocumentView({
  document,
  page,
  onPageChange,
  highlight,
  onClearHighlight,
}: DocumentViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLElement>(null);
  const pageData = document.pages.find((candidate) => candidate.number === page) ?? document.pages[0];
  const anchor = pageData && highlight ? findAnchor(pageData.text, highlight) : null;

  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => {
      const container = scrollRef.current;
      const mark = markRef.current;
      if (!container || !mark) return;
      container.scrollTo({
        top: Math.max(0, mark.offsetTop - container.offsetTop - 90),
        behavior: "smooth",
      });
    }, 60);
    return () => clearTimeout(timer);
  }, [highlight, page]);

  const pageSections = document.sections.filter(
    (section) => pageData && section.pageStart <= pageData.number && section.pageEnd >= pageData.number,
  );

  if (!pageData) {
    return <div className="notice notice-warning">No page text was extracted.</div>;
  }

  const renderText = () => {
    if (!anchor) return pageData.text;
    const before = pageData.text.slice(0, anchor.index);
    const marked = pageData.text.slice(anchor.index, anchor.index + anchor.length);
    const after = pageData.text.slice(anchor.index + anchor.length);
    return (
      <>
        {before}
        <mark className="quote-mark" ref={markRef}>
          {marked}
        </mark>
        {after}
      </>
    );
  };

  return (
    <div className="doc-layout">
      <aside className="doc-rail">
        <div className="doc-rail-block">
          <span className="rail-label">Detected structure</span>
          <nav className="section-list" aria-label="Document sections">
            {document.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`section-link${pageSections.some((item) => item.id === section.id) ? " is-current" : ""}`}
                onClick={() => {
                  onClearHighlight();
                  onPageChange(section.pageStart);
                }}
              >
                <span className="section-link-title">{section.title}</span>
                <span className="section-link-meta">
                  p. {section.pageStart}
                  {section.pageEnd !== section.pageStart ? `–${section.pageEnd}` : ""}
                  {!section.auditable ? " · not audited" : ""}
                </span>
              </button>
            ))}
          </nav>
        </div>

        <div className="doc-rail-block">
          <span className="rail-label">Tables</span>
          {document.tables.length === 0 ? (
            <p className="rail-note">No tables could be reconstructed from the extracted text.</p>
          ) : (
            <ul className="table-list">
              {document.tables.map((table) => (
                <li key={table.id}>
                  <button
                    type="button"
                    className="table-link"
                    onClick={() => {
                      onClearHighlight();
                      onPageChange(table.page);
                    }}
                  >
                    <span className="table-link-head">
                      <strong>Table {table.label}</strong>
                      <span className={`table-quality ${table.reliable ? "is-reliable" : "is-unreliable"}`}>
                        {table.reliable ? "reliable" : "unverified"}
                      </span>
                    </span>
                    <span className="table-link-caption">{table.caption}</span>
                    <span className="table-link-page">p. {table.page}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="doc-viewer" aria-label="Extracted document text">
        <div className="doc-toolbar">
          <div className="doc-toolbar-left">
            <span className="subtle-tag">
              <Icon name="file" size={13} /> Extracted text
            </span>
            {pageSections[0] && <span className="doc-section-name">{pageSections[0].title}</span>}
          </div>
          <div className="pager">
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                onClearHighlight();
                onPageChange(Math.max(1, pageData.number - 1));
              }}
              disabled={pageData.number <= 1}
              aria-label="Previous page"
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <label className="page-select-label">
              <span className="visually-hidden">Page</span>
              <select
                className="page-select"
                value={pageData.number}
                onChange={(event) => {
                  onClearHighlight();
                  onPageChange(Number(event.target.value));
                }}
              >
                {document.pages.map((candidate) => (
                  <option value={candidate.number} key={candidate.number}>
                    Page {candidate.number}
                  </option>
                ))}
              </select>
              <span className="page-total">of {document.pages.length}</span>
            </label>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                onClearHighlight();
                onPageChange(Math.min(document.pages.length, pageData.number + 1));
              }}
              disabled={pageData.number >= document.pages.length}
              aria-label="Next page"
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </div>

        <p className="doc-extraction-note">
          <Icon name="info" size={13} />
          Text is shown as extracted from PDF text positions. Paragraph and table layout is
          approximate; verify against the original PDF.
        </p>

        {highlight && (
          <div className="doc-focus">
            <span className="doc-focus-label">
              <Icon name="quote" size={13} /> Located evidence
            </span>
            <p>{highlight}</p>
            {!anchor && (
              <span className="doc-focus-warn">
                The exact phrase could not be highlighted on this page; the source page is shown.
              </span>
            )}
            <button type="button" className="icon-button" onClick={onClearHighlight} aria-label="Clear highlight">
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        <div className="doc-page-scroll" ref={scrollRef}>
          <article className="doc-page">
            <header className="doc-page-head">
              <span className="doc-page-label">Page {pageData.number}</span>
              <span>{pageData.lineCount} extracted lines</span>
            </header>
            <pre className="page-text">{renderText()}</pre>
          </article>
        </div>
      </section>
    </div>
  );
}
