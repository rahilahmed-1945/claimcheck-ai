/**
 * HTTP API tests.
 *
 * The real server process is started against a throwaway SQLite directory, so
 * validation, processing failure states, persistence, retrieval, report
 * downloads, and deletion are exercised end to end.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import PDFDocument from "pdfkit";
import type { AuditErrorPayload, AuditRecord, AuditListResponse } from "../shared/types.js";

const ROOT = process.cwd();
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "claimcheck-api-"));

interface ServerHandle {
  baseUrl: string;
  process: ChildProcessByStdio<null, Readable, Readable>;
  logs: string[];
  stop: () => Promise<void>;
}

let server: ServerHandle;
let completedAuditId = "";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not allocate a test port."));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(): Promise<ServerHandle> {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CLAIMCHECK_DATA_DIR: DATA_DIR, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => logs.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming ready:\n${logs.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return {
          baseUrl,
          process: child,
          logs,
          stop: async () => {
            if (child.exitCode !== null) return;
            child.kill("SIGTERM");
            const killer = setTimeout(() => child.kill("SIGKILL"), 5_000);
            killer.unref();
            await once(child, "exit");
            clearTimeout(killer);
          },
        };
      }
    } catch {
      // The listener is not accepting connections yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  child.kill("SIGKILL");
  throw new Error(`Server did not become ready:\n${logs.join("")}`);
}

async function upload(name: string, bytes: Uint8Array, type = "application/pdf"): Promise<Response> {
  const form = new FormData();
  const copy = new Uint8Array(bytes);
  form.append("file", new Blob([copy.buffer], { type }), name);
  return fetch(`${server.baseUrl}/api/audits`, { method: "POST", body: form });
}

async function waitForAudit(id: string): Promise<AuditRecord> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${server.baseUrl}/api/audits/${id}`);
    assert.equal(response.status, 200, `audit ${id} could not be retrieved`);
    const record = (await response.json()) as AuditRecord;
    if (record.status === "complete" || record.status === "failed") return record;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Audit ${id} did not finish in time. Server logs:\n${server.logs.join("")}`);
}

function makePdf(text?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 64 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.addPage();
    if (text) doc.font("Times-Roman").fontSize(11).text(text);
    doc.end();
  });
}

before(async () => {
  server = await startServer();
});

after(async () => {
  await server.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

test("reports backend health, limits, and unknown routes", async () => {
  const response = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const info = (await response.json()) as {
    ok: boolean;
    limits: { maxFileBytes: number; maxPages: number; processingTimeoutMs: number };
    persistence: { kind: string };
    sampleAvailable: boolean;
  };
  assert.equal(info.ok, true);
  assert.ok(info.limits.maxFileBytes > 0);
  assert.ok(info.limits.maxPages > 0);
  assert.ok(info.limits.processingTimeoutMs > 0);
  assert.match(info.persistence.kind, /SQLite/);
  assert.equal(info.sampleAvailable, true);

  const missing = await fetch(`${server.baseUrl}/api/does-not-exist`);
  assert.equal(missing.status, 404);
  const payload = (await missing.json()) as { error: AuditErrorPayload };
  assert.equal(payload.error.code, "NOT_FOUND");
});

test("rejects invalid uploads before creating an audit", async () => {
  const textFile = await upload("paper.txt", new TextEncoder().encode("%PDF-1.4\n"));
  assert.equal(textFile.status, 400);
  assert.equal(((await textFile.json()) as { error: AuditErrorPayload }).error.code, "INVALID_TYPE");

  const empty = await upload("empty.pdf", new Uint8Array());
  assert.equal(empty.status, 400);
  assert.equal(((await empty.json()) as { error: AuditErrorPayload }).error.code, "EMPTY_FILE");

  const fake = await upload("fake.pdf", new TextEncoder().encode("This is not a PDF at all."));
  assert.equal(fake.status, 400);
  assert.equal(((await fake.json()) as { error: AuditErrorPayload }).error.code, "INVALID_PDF_SIGNATURE");

  const noFile = await fetch(`${server.baseUrl}/api/audits`, { method: "POST", body: new FormData() });
  assert.equal(noFile.status, 400);
  assert.equal(((await noFile.json()) as { error: AuditErrorPayload }).error.code, "NO_FILE");

  const list = (await (await fetch(`${server.baseUrl}/api/audits`)).json()) as AuditListResponse;
  assert.equal(list.total, 0, "rejected uploads must not create archive records");
});

test("marks a damaged PDF as failed with no findings or downloadable report", async () => {
  const response = await upload("damaged.pdf", new TextEncoder().encode("%PDF-1.4\nbroken body\n%%EOF"));
  assert.equal(response.status, 202);
  const { auditId } = (await response.json()) as { auditId: string };
  const record = await waitForAudit(auditId);

  assert.equal(record.status, "failed");
  assert.equal(record.error?.code, "CORRUPT_PDF");
  assert.equal(record.findings.length, 0);
  assert.equal(record.summary, null);
  assert.equal(record.document, null);

  const report = await fetch(`${server.baseUrl}/api/audits/${auditId}/report.md`);
  assert.equal(report.status, 409);
  assert.equal(((await report.json()) as { error: AuditErrorPayload }).error.code, "REPORT_NOT_READY");
});

test("rejects an image-only PDF as scanned instead of producing empty results", async () => {
  const response = await upload("scan.pdf", await makePdf());
  assert.equal(response.status, 202);
  const { auditId } = (await response.json()) as { auditId: string };
  const record = await waitForAudit(auditId);

  assert.equal(record.status, "failed");
  assert.equal(record.error?.code, "SCANNED_PDF");
  assert.equal(record.findings.length, 0);
});

test("rejects a PDF with too little text to audit", async () => {
  const response = await upload("sparse.pdf", await makePdf("A short note. The result is preliminary."));
  assert.equal(response.status, 202);
  const { auditId } = (await response.json()) as { auditId: string };
  const record = await waitForAudit(auditId);

  assert.equal(record.status, "failed");
  assert.equal(record.error?.code, "LOW_TEXT");
  assert.equal(record.findings.length, 0);
});

test("processes the sample paper into a persisted, downloadable audit", async () => {
  const response = await fetch(`${server.baseUrl}/api/audits/sample`, { method: "POST" });
  assert.equal(response.status, 202);
  const { auditId } = (await response.json()) as { auditId: string };
  completedAuditId = auditId;

  const record = await waitForAudit(auditId);
  assert.equal(record.status, "complete", `sample audit failed: ${record.error?.code ?? "unknown"}`);
  assert.ok(record.summary, "completed audit must expose a summary");
  assert.ok(record.summary.claimsAudited > 0);
  assert.ok(record.findings.length > 0);
  assert.ok(record.document && record.document.text.length > 0);
  assert.equal(record.summary.claimsAudited, record.findings.length);
  assert.ok(record.summary.byCategory.potential_contradiction >= 1, "demo paper must retain its known contradiction");

  for (const finding of record.findings) {
    assert.equal(
      record.document.text.slice(finding.claim.offset, finding.claim.offset + finding.claim.text.length),
      finding.claim.text,
    );
    for (const reference of finding.evidence) {
      if (reference.kind === "metadata") continue;
      assert.ok(reference.page >= 1);
      assert.equal(
        record.document.text.slice(reference.offset ?? -1, (reference.offset ?? -1) + reference.quote.length),
        reference.quote,
      );
    }
  }

  const list = (await (await fetch(`${server.baseUrl}/api/audits`)).json()) as AuditListResponse;
  const stored = list.audits.find((item) => item.id === auditId);
  assert.ok(stored, "completed audit must appear in the archive");
  assert.equal(stored.status, "complete");
  assert.equal(stored.pageCount, record.extraction?.pageCount ?? null);

  const markdown = await fetch(`${server.baseUrl}/api/audits/${auditId}/report.md`);
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get("content-type") ?? "", /text\/markdown/);
  assert.match(markdown.headers.get("content-disposition") ?? "", /attachment;.*\.md/);
  const text = await markdown.text();
  assert.match(text, /^# ClaimCheck AI audit report/);
  for (const finding of record.findings) {
    assert.ok(text.includes(finding.claim.text), "Markdown report must include every audited claim");
  }

  const json = await fetch(`${server.baseUrl}/api/audits/${auditId}/report.json`);
  assert.equal(json.status, 200);
  assert.match(json.headers.get("content-disposition") ?? "", /attachment;.*\.json/);
  const parsed = (await json.json()) as {
    product: string;
    documentTextIncluded: boolean;
    audit: { findings: unknown[]; limitations: string[] };
  };
  assert.equal(parsed.product, "ClaimCheck AI");
  assert.equal(parsed.documentTextIncluded, false);
  assert.equal(parsed.audit.findings.length, record.findings.length);
  assert.ok(parsed.audit.limitations.length > 0);
});

test("retrieves the completed audit after a restart and deletes it", async () => {
  assert.ok(completedAuditId, "the completed audit test must run first");

  await server.stop();
  server = await startServer();

  const response = await fetch(`${server.baseUrl}/api/audits/${completedAuditId}`);
  assert.equal(response.status, 200);
  const record = (await response.json()) as AuditRecord;
  assert.equal(record.status, "complete");
  assert.ok(record.findings.length > 0);
  assert.ok(record.document?.text.length);
  assert.ok(record.summary?.claimsAudited);

  const deleted = await fetch(`${server.baseUrl}/api/audits/${completedAuditId}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);

  const missing = await fetch(`${server.baseUrl}/api/audits/${completedAuditId}`);
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: AuditErrorPayload }).error.code, "NOT_FOUND");
});
