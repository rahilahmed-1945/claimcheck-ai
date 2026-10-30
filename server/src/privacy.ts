/**
 * Document-content retention rules.
 *
 * ClaimCheck keeps the audit (findings, summary, limitations, timings, and
 * aggregate extraction statistics) but never the paper itself: no full text,
 * page text, section titles, table cells, or captions are stored once an audit
 * completes. Findings still quote short claim and evidence excerpts; those
 * excerpts are the audit result and are kept on purpose.
 *
 * The same functions clean records written by older versions, so stored rows,
 * imported backups, and new audits all end up in the same shape.
 */
import type { AuditRecord, ExtractionInfo } from "../../shared/types.js";

const count = (value: unknown, predicate: (item: Record<string, unknown>) => boolean = () => true) =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && predicate(item as Record<string, unknown>)).length : 0;
const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * Reduce an extraction object (new or legacy) to aggregate statistics.
 * Legacy objects carried `sections`, `tables`, and `captions` arrays with the
 * paper's headings, table cells, and caption text; only their counts survive.
 */
export function sanitizeExtraction(input: unknown): ExtractionInfo | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const hasLegacyArrays = Array.isArray(raw.sections) || Array.isArray(raw.tables) || Array.isArray(raw.captions);
  return {
    pageCount: num(raw.pageCount),
    charCount: num(raw.charCount),
    wordCount: num(raw.wordCount),
    pagesWithText: num(raw.pagesWithText),
    textDensity: raw.textDensity === "sparse" ? "sparse" : "good",
    bodyFontSize: num(raw.bodyFontSize),
    extractionMs: num(raw.extractionMs),
    sectionCount: hasLegacyArrays ? count(raw.sections) : num(raw.sectionCount),
    auditableSectionCount: hasLegacyArrays ? count(raw.sections, (section) => section.auditable === true) : num(raw.auditableSectionCount),
    tableCount: hasLegacyArrays ? count(raw.tables) : num(raw.tableCount),
    reliableTableCount: hasLegacyArrays ? count(raw.tables, (table) => table.reliable === true) : num(raw.reliableTableCount),
    captionCount: hasLegacyArrays ? count(raw.captions) : num(raw.captionCount),
    // Extractor warnings are fixed templates with counts only (no document text).
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((warning): warning is string => typeof warning === "string") : [],
  };
}

/** Whether an extraction object still carries document content. */
export function extractionHasContent(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const raw = input as Record<string, unknown>;
  return ["sections", "tables", "captions", "text", "pages"].some((key) => key in raw);
}

/**
 * A record safe to store or serve: no document, sanitized extraction, and no
 * file hash (a hash lets anyone holding a copy of the PDF confirm it was uploaded).
 */
export function sanitizeRecord(record: AuditRecord): AuditRecord {
  return { ...record, fileHash: null, extraction: sanitizeExtraction(record.extraction), document: null };
}
