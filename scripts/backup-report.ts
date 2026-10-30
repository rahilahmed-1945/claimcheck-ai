/**
 * Save a sanitized copy of one report from a running ClaimCheck server.
 *
 * The full record is fetched and cleaned in memory; only the sanitized copy
 * (findings, summary, limitations, timings, aggregate extraction statistics,
 * no document text, no file hash) is written. Keep the output outside the
 * repository: findings quote short excerpts of the paper.
 *
 *   npx tsx scripts/backup-report.ts <baseUrl> <auditId> <output.json>
 */
import fs from "node:fs";
import type { AuditRecord } from "../shared/types.js";
import { extractionHasContent, sanitizeRecord } from "../server/src/privacy.js";

const [base, id, out] = process.argv.slice(2);
if (!base || !id || !out) {
  console.error("Usage: npx tsx scripts/backup-report.ts <baseUrl> <auditId> <output.json>");
  process.exit(1);
}
const response = await fetch(`${base.replace(/\/$/, "")}/api/audits/${encodeURIComponent(id)}`);
if (!response.ok) {
  console.error(`Could not read audit ${id}: HTTP ${response.status}`);
  process.exit(1);
}
const live = (await response.json()) as AuditRecord;
if (live.status !== "complete") {
  console.error(`Audit ${id} is ${live.status}; only completed audits are backed up.`);
  process.exit(1);
}
const clean = sanitizeRecord(live);
fs.writeFileSync(out, `${JSON.stringify(clean, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      id: clean.id,
      filename: clean.filename,
      findings: clean.findings.length,
      byCategory: clean.summary?.byCategory ?? null,
      limitations: clean.limitations.length,
      sourceHadDocumentText: Boolean(live.document),
      backupHasDocument: clean.document !== null,
      backupExtractionHasContent: extractionHasContent(clean.extraction),
      extraction: clean.extraction,
      written: out,
    },
    null,
    2,
  ),
);
