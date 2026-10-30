/**
 * Restore a sanitized report backup (from scripts/backup-report.ts) into a
 * running ClaimCheck server through its admin endpoint. The server must have
 * CLAIMCHECK_ADMIN_TOKEN set; pass the same token in the environment here.
 * The report keeps its original id, so existing links keep working. An id that
 * already exists is left untouched.
 *
 *   CLAIMCHECK_ADMIN_TOKEN=... npx tsx scripts/restore-report.ts <baseUrl> <backup.json> [--filename "New name.pdf"]
 */
import fs from "node:fs";

const [base, file] = process.argv.slice(2);
const renameIndex = process.argv.indexOf("--filename");
const rename = renameIndex > 0 ? process.argv[renameIndex + 1] : undefined;
const token = process.env.CLAIMCHECK_ADMIN_TOKEN?.trim();
if (!base || !file || !token) {
  console.error('Usage: CLAIMCHECK_ADMIN_TOKEN=... npx tsx scripts/restore-report.ts <baseUrl> <backup.json> [--filename "name.pdf"]');
  process.exit(1);
}
const record = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
if (record.document) {
  console.error("Refusing to upload a backup that still contains document text. Re-create it with scripts/backup-report.ts.");
  process.exit(1);
}
if (rename) record.filename = rename;
const response = await fetch(`${base.replace(/\/$/, "")}/api/admin/import`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(record),
});
const body = await response.text();
console.log(`HTTP ${response.status}: ${body}`);
if (!response.ok) process.exit(1);

// Confirm what is now served for that id.
const check = await fetch(`${base.replace(/\/$/, "")}/api/audits/${encodeURIComponent(String(record.id))}`);
const served = (await check.json()) as { status?: string; findings?: unknown[]; document?: unknown; extraction?: Record<string, unknown> };
console.log(
  JSON.stringify({
    id: record.id,
    status: served.status,
    findings: served.findings?.length ?? 0,
    documentServed: served.document !== null && served.document !== undefined,
    extractionContentKeys: Object.keys(served.extraction ?? {}).filter((key) => ["sections", "tables", "captions", "text", "pages"].includes(key)),
  }),
);
