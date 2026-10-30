/**
 * Document-content retention.
 *
 * Completed audits keep findings, summaries, limitations, timings, and
 * aggregate extraction statistics, but never the paper: no full text, page
 * text, section titles, table cells, captions, or file hash. Records written
 * by earlier versions are cleaned in place without losing their findings, the
 * cleanup is idempotent, and the opt-in admin token protects listing,
 * deletion, and backup restore.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import type { AuditRecord } from "../shared/types.js";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "claimcheck-privacy-"));
process.env.CLAIMCHECK_DATA_DIR = DATA_DIR;
const db = await import("../server/src/db.js");
const { extractionHasContent, sanitizeExtraction, sanitizeRecord } = await import("../server/src/privacy.js");
const raw = new DatabaseSync(path.join(DATA_DIR, "claimcheck.sqlite"));

after(() => {
  raw.close();
});

const SECRET_TEXT = "Unpublished result: the confidential method improves recall by 17.3 points.";
const FINDINGS = [
  {
    id: "F-001",
    category: "needs_review",
    title: "A finding",
    claim: { text: "A quoted claim excerpt.", sectionTitle: "Results", sectionCanonical: "results", page: 2, offset: 10 },
    rationale: "No comparable value was located.",
    confidence: "low",
    checks: [],
    evidence: [],
    numericComparisons: [],
    searchScope: { sentencesChecked: 10, tableRowsChecked: 0 },
    limitations: ["A finding limitation."],
  },
];
const SUMMARY = {
  claimsAudited: 1,
  evidenceLinks: 0,
  byCategory: { supported: 0, partially_supported: 0, potentially_unsupported: 0, potential_contradiction: 0, needs_review: 1 },
  tablesDetected: 1,
  tablesParsedReliably: 1,
};
const LEGACY_EXTRACTION = {
  pageCount: 7,
  charCount: 39620,
  wordCount: 6903,
  pagesWithText: 7,
  textDensity: "good",
  bodyFontSize: 10,
  extractionMs: 1200,
  sections: [
    { title: "Confidential Method Heading", auditable: true },
    { title: "Front matter", auditable: false },
  ],
  tables: [{ label: "1", reliable: true, rows: [["Secret", "17.3"]] }],
  captions: [{ label: "1", text: "Table 1. Confidential results." }],
  warnings: ["1 page contained little or no selectable text. Claims on those pages cannot be audited."],
};

function insertLegacyRow(id: string, status = "complete") {
  raw
    .prepare(
      `INSERT INTO audits (id, filename, file_size, file_hash, status, stage, stage_detail, progress, created_at, completed_at,
         engine_version, extraction_json, findings_json, summary_json, limitations_json, timings_json, document_json)
       VALUES (?, 'paper.pdf', 1000, ?, ?, ?, '', 100, '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:01.000Z', '0.1.0', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      "f".repeat(64),
      status,
      status,
      JSON.stringify(LEGACY_EXTRACTION),
      JSON.stringify(FINDINGS),
      JSON.stringify(SUMMARY),
      JSON.stringify(["A limitation."]),
      JSON.stringify({ extractionMs: 1200, auditMs: 30, totalMs: 1300 }),
      JSON.stringify({ text: SECRET_TEXT, pages: [{ page: 1, text: SECRET_TEXT }], sections: LEGACY_EXTRACTION.sections, tables: [], captions: [] }),
    );
}

const rowOf = (id: string) => raw.prepare(`SELECT * FROM audits WHERE id = ?`).get(id) as Record<string, string | null>;

test("sanitizeExtraction keeps aggregate statistics and drops section, table, and caption content", () => {
  const clean = sanitizeExtraction(LEGACY_EXTRACTION)!;
  assert.deepEqual(
    { sections: clean.sectionCount, auditable: clean.auditableSectionCount, tables: clean.tableCount, reliable: clean.reliableTableCount, captions: clean.captionCount },
    { sections: 2, auditable: 1, tables: 1, reliable: 1, captions: 1 },
  );
  assert.equal(clean.pageCount, 7);
  assert.equal(clean.wordCount, 6903);
  assert.equal(extractionHasContent(clean), false);
  assert.ok(!JSON.stringify(clean).includes("Confidential"));
  // Already-clean statistics pass through unchanged.
  assert.deepEqual(sanitizeExtraction(clean), clean);
  assert.equal(sanitizeExtraction(null), null);
});

test("existing records are cleaned in place, keep their findings, and the cleanup is idempotent", () => {
  insertLegacyRow("11111111-1111-4111-8111-111111111111");
  raw.prepare(
    `INSERT INTO audits (id, filename, file_size, status, stage, created_at, engine_version) VALUES (?, 'other.pdf', 10, 'failed', 'failed', '2026-10-30T00:00:00.000Z', '0.1.0')`,
  ).run("22222222-2222-4222-8222-222222222222");
  const before = rowOf("11111111-1111-4111-8111-111111111111");
  const unrelatedBefore = rowOf("22222222-2222-4222-8222-222222222222");

  assert.equal(db.purgeStoredDocumentContent(), 1);
  const after = rowOf("11111111-1111-4111-8111-111111111111");
  assert.equal(after.document_json, null);
  assert.equal(after.file_hash, null);
  assert.equal(extractionHasContent(JSON.parse(after.extraction_json!)), false);
  for (const column of ["findings_json", "summary_json", "limitations_json", "timings_json", "filename", "created_at", "status"]) {
    assert.equal(after[column], before[column], `${column} must be preserved`);
  }
  assert.deepEqual(rowOf("22222222-2222-4222-8222-222222222222"), unrelatedBefore, "unrelated records are untouched");

  // Running again changes nothing.
  assert.equal(db.purgeStoredDocumentContent(), 0);
  assert.deepEqual(rowOf("11111111-1111-4111-8111-111111111111"), after);

  // The removed text is not left behind in the database files.
  const stored = fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.startsWith("claimcheck.sqlite"))
    .map((name) => fs.readFileSync(path.join(DATA_DIR, name)).toString("utf8"))
    .join("\n");
  assert.ok(!stored.includes(SECRET_TEXT), "document text must not survive in the database files");
  assert.ok(!stored.includes("Confidential Method Heading"), "section titles must not survive in the database files");
});

test("records are served with a null document even if a row still holds one", () => {
  insertLegacyRow("33333333-3333-4333-8333-333333333333");
  const record = db.getAudit("33333333-3333-4333-8333-333333333333")!;
  assert.equal(record.document, null);
  assert.equal(extractionHasContent(record.extraction), false);
  assert.equal(record.findings.length, 1);
  assert.equal(record.summary?.claimsAudited, 1);
  const listed = db.listAudits(10).find((item) => item.id === "33333333-3333-4333-8333-333333333333");
  assert.equal(listed?.pageCount, 7);
  db.purgeStoredDocumentContent();
});

test("new audits store findings and statistics but no document or hash", () => {
  db.createAudit({ id: "44444444-4444-4444-8444-444444444444", filename: "new.pdf", fileSize: 10, engineVersion: "0.1.0" });
  db.completeAudit("44444444-4444-4444-8444-444444444444", {
    findings: FINDINGS as never,
    summary: SUMMARY as never,
    limitations: ["A limitation."],
    extraction: { ...LEGACY_EXTRACTION } as never,
    timings: { extractionMs: 1, auditMs: 1, totalMs: 2 },
  });
  const row = rowOf("44444444-4444-4444-8444-444444444444");
  assert.equal(row.document_json, null);
  assert.equal(row.file_hash, null);
  assert.equal(extractionHasContent(JSON.parse(row.extraction_json!)), false);
  assert.equal(JSON.parse(row.findings_json!).length, 1);
});

test("a sanitized backup restores with its original id and never overwrites", () => {
  const backup = sanitizeRecord({
    id: "55555555-5555-4555-8555-555555555555",
    filename: "restored.pdf",
    fileSize: 1000,
    fileHash: "f".repeat(64),
    status: "complete",
    stage: "complete",
    stageDetail: "",
    progress: 100,
    createdAt: "2026-10-30T00:00:00.000Z",
    completedAt: "2026-10-30T00:00:01.000Z",
    engineVersion: "0.1.0",
    error: null,
    extraction: LEGACY_EXTRACTION as never,
    findings: FINDINGS as never,
    summary: SUMMARY as never,
    limitations: ["A limitation."],
    timings: { extractionMs: 1, auditMs: 1, totalMs: 2 },
    document: { text: SECRET_TEXT, pages: [], sections: [], tables: [], captions: [] },
  } as AuditRecord);
  assert.equal(backup.document, null);
  assert.equal(backup.fileHash, null);
  assert.equal(db.importCompletedAudit(backup), true);
  assert.equal(db.importCompletedAudit({ ...backup, filename: "changed.pdf" }), false, "an existing id is never overwritten");
  const restored = db.getAudit("55555555-5555-4555-8555-555555555555")!;
  assert.equal(restored.filename, "restored.pdf");
  assert.equal(restored.findings.length, 1);
  assert.equal(restored.document, null);
  assert.equal(rowOf("55555555-5555-4555-8555-555555555555").document_json, null);
});

// ---------------------------------------------------------------------------
// Opt-in admin token on a running server
// ---------------------------------------------------------------------------

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("no port"));
      probe.close(() => resolve(address.port));
    });
  });
}

async function withServer(env: Record<string, string>, run: (base: string) => Promise<void>) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claimcheck-admin-"));
  const child = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env, PORT: String(port), CLAIMCHECK_DATA_DIR: dataDir, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await run(base);
  } finally {
    child.kill();
  }
}

test("without an admin token the server behaves as before and restore is disabled", async () => {
  await withServer({ CLAIMCHECK_ADMIN_TOKEN: "" }, async (base) => {
    assert.equal((await (await fetch(`${base}/api/health`)).json()).adminProtected, false);
    assert.equal((await fetch(`${base}/api/audits`)).status, 200);
    const restore = await fetch(`${base}/api/admin/import`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(restore.status, 404);
  });
});

test("with an admin token, listing, deleting, and restoring need it; report links stay open", async () => {
  const token = "test-admin-token-123";
  await withServer({ CLAIMCHECK_ADMIN_TOKEN: token }, async (base) => {
    const auth = { authorization: `Bearer ${token}` };
    assert.equal((await (await fetch(`${base}/api/health`)).json()).adminProtected, true);
    assert.equal((await fetch(`${base}/api/audits`)).status, 401);
    assert.equal((await fetch(`${base}/api/audits`, { headers: { authorization: "Bearer wrong" } })).status, 401);
    assert.equal((await fetch(`${base}/api/audits`, { headers: auth })).status, 200);

    const backup = {
      id: "66666666-6666-4666-8666-666666666666",
      filename: "restored.pdf",
      fileSize: 1000,
      status: "complete",
      createdAt: "2026-10-30T00:00:00.000Z",
      completedAt: "2026-10-30T00:00:01.000Z",
      engineVersion: "0.1.0",
      extraction: LEGACY_EXTRACTION,
      findings: FINDINGS,
      summary: SUMMARY,
      limitations: ["A limitation."],
      timings: { extractionMs: 1, auditMs: 1, totalMs: 2 },
      document: { text: SECRET_TEXT },
    };
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/api/admin/import`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(backup) });
    assert.equal((await post({})).status, 401);
    assert.equal((await post(auth)).status, 201);
    assert.equal((await post(auth)).status, 200, "a second restore is a no-op");

    // Anyone with the report link can still read it, without the document.
    const record = (await (await fetch(`${base}/api/audits/${backup.id}`)).json()) as AuditRecord;
    assert.equal(record.findings.length, 1);
    assert.equal(record.document, null);
    assert.equal((await fetch(`${base}/api/audits/${backup.id}/report.md`)).status, 200);

    assert.equal((await fetch(`${base}/api/audits/${backup.id}`, { method: "DELETE" })).status, 401);
    assert.equal((await fetch(`${base}/api/audits/${backup.id}`, { method: "DELETE", headers: auth })).status, 204);
  });
});
