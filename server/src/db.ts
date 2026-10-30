import { DatabaseSync } from "node:sqlite";
import type {
  AuditErrorPayload,
  AuditListItem,
  AuditRecord,
  AuditSummary,
  AuditTimings,
  ExtractionInfo,
  Finding,
} from "../../shared/types.js";
import { DB_PATH } from "./config.js";
import { extractionHasContent, sanitizeExtraction } from "./privacy.js";

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_hash TEXT,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    stage_detail TEXT NOT NULL DEFAULT '',
    progress INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    engine_version TEXT NOT NULL,
    error_json TEXT,
    extraction_json TEXT,
    findings_json TEXT,
    summary_json TEXT,
    limitations_json TEXT,
    timings_json TEXT,
    document_json TEXT
  );
`);

// Records that were mid-flight when the process died are never presented as finished.
db.prepare(
  `UPDATE audits SET status = 'failed', stage = 'failed',
   error_json = ?, stage_detail = 'Processing was interrupted by a server restart.'
   WHERE status IN ('queued', 'processing')`,
).run(
  JSON.stringify({
    code: "PROCESSING_INTERRUPTED",
    title: "Processing was interrupted",
    message:
      "The server restarted while this document was being processed, so the audit did not finish. No partial findings are shown.",
    recovery: ["Upload the paper again to start a new audit."],
  } satisfies AuditErrorPayload),
);

/**
 * Remove document content written by earlier versions: full text and pages
 * (document_json), section titles, table cells, and captions (extraction_json),
 * and file hashes. Findings, summaries, limitations, and timings are untouched.
 * Safe to run any number of times; returns how many rows changed.
 */
export function purgeStoredDocumentContent(): number {
  const rows = db
    .prepare(
      `SELECT id, extraction_json, document_json, file_hash FROM audits
       WHERE document_json IS NOT NULL OR file_hash IS NOT NULL OR extraction_json IS NOT NULL`,
    )
    .all() as AuditRow[];
  const update = db.prepare(`UPDATE audits SET document_json = NULL, file_hash = NULL, extraction_json = ? WHERE id = ?`);
  let changed = 0;
  for (const row of rows) {
    const extraction = parseJson<unknown>(row.extraction_json, null);
    if (row.document_json === null && row.file_hash === null && !extractionHasContent(extraction)) continue;
    const cleaned = extraction === null ? null : JSON.stringify(sanitizeExtraction(extraction));
    update.run(cleaned, String(row.id));
    changed += 1;
  }
  if (changed > 0) {
    // Rewrite the file so the removed text does not linger in free pages or the WAL.
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
  }
  return changed;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type AuditRow = Record<string, unknown>;

function rowToRecord(row: AuditRow): AuditRecord {
  return {
    id: String(row.id),
    filename: String(row.filename),
    fileSize: Number(row.file_size),
    fileHash: row.file_hash ? String(row.file_hash) : null,
    status: String(row.status) as AuditRecord["status"],
    stage: String(row.stage),
    stageDetail: String(row.stage_detail ?? ""),
    progress: Number(row.progress ?? 0),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    engineVersion: String(row.engine_version),
    error: parseJson<AuditErrorPayload | null>(row.error_json, null),
    extraction: sanitizeExtraction(parseJson<unknown>(row.extraction_json, null)),
    findings: parseJson<Finding[]>(row.findings_json, []),
    summary: parseJson<AuditSummary | null>(row.summary_json, null),
    limitations: parseJson<string[]>(row.limitations_json, []),
    timings: parseJson<AuditTimings | null>(row.timings_json, null),
    // The source document is never served, even if an old row still holds one.
    document: null,
  };
}

export interface CreateAuditInput {
  id: string;
  filename: string;
  fileSize: number;
  engineVersion: string;
}

export function createAudit(input: CreateAuditInput): void {
  db.prepare(
    `INSERT INTO audits (id, filename, file_size, file_hash, status, stage, stage_detail, progress, created_at, engine_version, limitations_json)
     VALUES (?, ?, ?, NULL, 'queued', 'queued', ?, 0, ?, ?, '[]')`,
  ).run(
    input.id,
    input.filename,
    input.fileSize,
    "Waiting for the processing worker.",
    new Date().toISOString(),
    input.engineVersion,
  );
}

export function updateProgress(
  id: string,
  patch: { status?: string; stage?: string; stageDetail?: string; progress?: number },
): void {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    values.push(patch.status);
  }
  if (patch.stage !== undefined) {
    sets.push("stage = ?");
    values.push(patch.stage);
  }
  if (patch.stageDetail !== undefined) {
    sets.push("stage_detail = ?");
    values.push(patch.stageDetail);
  }
  if (patch.progress !== undefined) {
    sets.push("progress = ?");
    values.push(Math.max(0, Math.min(100, Math.round(patch.progress))));
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE audits SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export interface CompleteAuditInput {
  findings: Finding[];
  summary: AuditSummary;
  limitations: string[];
  extraction: ExtractionInfo;
  timings: AuditTimings;
}

export function completeAudit(id: string, result: CompleteAuditInput): void {
  db.prepare(
    `UPDATE audits SET status = 'complete', stage = 'complete', stage_detail = 'Audit report ready.',
     progress = 100, completed_at = ?, findings_json = ?, summary_json = ?, limitations_json = ?,
     extraction_json = ?, document_json = NULL, timings_json = ? WHERE id = ?`,
  ).run(
    new Date().toISOString(),
    JSON.stringify(result.findings),
    JSON.stringify(result.summary),
    JSON.stringify(result.limitations),
    JSON.stringify(sanitizeExtraction(result.extraction)),
    JSON.stringify(result.timings),
    id,
  );
}

export function failAudit(id: string, error: AuditErrorPayload): void {
  db.prepare(
    `UPDATE audits SET status = 'failed', stage = 'failed', stage_detail = '', completed_at = ?, error_json = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), JSON.stringify(error), id);
}

export function getAudit(id: string): AuditRecord | null {
  const row = db.prepare(`SELECT * FROM audits WHERE id = ?`).get(id) as AuditRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listAudits(limit = 30): AuditListItem[] {
  const rows = db
    .prepare(
      `SELECT id, filename, file_size, status, stage, stage_detail, progress, created_at, completed_at,
              error_json, summary_json, extraction_json, engine_version
       FROM audits ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as AuditRow[];

  return rows.map((row) => {
    const error = parseJson<AuditErrorPayload | null>(row.error_json, null);
    const summary = parseJson<AuditSummary | null>(row.summary_json, null);
    const extraction = sanitizeExtraction(parseJson<unknown>(row.extraction_json, null));
    return {
      id: String(row.id),
      filename: String(row.filename),
      fileSize: Number(row.file_size),
      status: String(row.status) as AuditListItem["status"],
      stage: String(row.stage),
      stageDetail: String(row.stage_detail ?? ""),
      progress: Number(row.progress ?? 0),
      createdAt: String(row.created_at),
      completedAt: row.completed_at ? String(row.completed_at) : null,
      errorTitle: error?.title ?? null,
      summary,
      pageCount: extraction?.pageCount ?? null,
      engineVersion: String(row.engine_version),
    };
  });
}

/**
 * Restore a completed audit from a sanitized backup (scripts/backup-report.ts).
 * Keeps the original id so existing report links work. Never overwrites an
 * existing record; returns false if the id is already present.
 */
export function importCompletedAudit(record: AuditRecord): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO audits (id, filename, file_size, file_hash, status, stage, stage_detail, progress, created_at,
         completed_at, engine_version, error_json, extraction_json, findings_json, summary_json, limitations_json, timings_json, document_json)
       VALUES (?, ?, ?, NULL, 'complete', 'complete', 'Audit report ready.', 100, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      record.id,
      record.filename,
      record.fileSize,
      record.createdAt,
      record.completedAt ?? record.createdAt,
      record.engineVersion,
      JSON.stringify(sanitizeExtraction(record.extraction)),
      JSON.stringify(record.findings),
      JSON.stringify(record.summary),
      JSON.stringify(record.limitations),
      JSON.stringify(record.timings),
    );
  return Number(result.changes) > 0;
}

export function deleteAudit(id: string): boolean {
  const result = db.prepare(`DELETE FROM audits WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

export function countAudits(): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM audits`).get() as { c: number };
  return Number(row.c);
}
