import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import multer from "multer";
import {
  ENGINE_VERSION,
  type AuditErrorPayload,
  type AuditRecord,
  type BackendInfo,
  type EvaluationSummary,
} from "../../shared/types.js";
import {
  ADMIN_TOKEN,
  CLIENT_DIST,
  DB_PATH,
  EVALUATION_SUMMARY_PATH,
  HOST,
  MAX_FILE_BYTES,
  MAX_PAGES,
  PORT,
  PROCESSING_TIMEOUT_MS,
  ROOT_DIR,
  SAMPLE_PDF,
} from "./config.js";
import {
  countAudits,
  createAudit,
  deleteAudit,
  getAudit,
  importCompletedAudit,
  listAudits,
  purgeStoredDocumentContent,
} from "./db.js";
import { sanitizeRecord } from "./privacy.js";
import { AuditError, ERRORS, safeDetail } from "./errors.js";
import { enqueueAudit, isJobActive } from "./jobs.js";
import { buildJsonReport, buildMarkdownReport, reportFilename } from "./report.js";
import { MAX_VOICE_BYTES, VOICE_ERRORS, VoiceError, readVoiceConfig, transcribe, voiceStatus } from "./voice.js";

// Read once at startup; the API key stays in this process and is never logged.
const voiceConfig = readVoiceConfig();

// Remove document content left by earlier versions before serving anything.
const purgedAtStartup = purgeStoredDocumentContent();

/** Whether the request carries the admin token (constant-time comparison). */
function hasAdminToken(req: Request): boolean {
  if (!ADMIN_TOKEN) return false;
  const supplied = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "")?.[1]?.trim() ?? "";
  const a = crypto.createHash("sha256").update(supplied).digest();
  const b = crypto.createHash("sha256").update(ADMIN_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Enforced only when an admin token is configured, so existing deployments keep working. */
function requireAdminIfConfigured(req: Request): void {
  if (ADMIN_TOKEN && !hasAdminToken(req)) {
    throw new AuditError(
      {
        code: "ADMIN_TOKEN_REQUIRED",
        title: "This action is restricted on this server",
        message: "Listing all reports and deleting reports require the server's admin token. Reports remain available from their own links.",
        recovery: ["Open a report from the link you received when you created it."],
      },
      401,
    );
  }
}

const app = express();
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  // The microphone is allowed for this origin only when API transcription is enabled.
  res.setHeader(
    "Permissions-Policy",
    `camera=(), microphone=${voiceConfig.enabled ? "(self)" : "()"}, geolocation=()`,
  );
  // Content-Security-Policy: tight policy for a local SPA.
  // 'unsafe-inline' is needed for Vite's dev-mode HMR styles only; the
  // production build uses hashed assets. If deploying publicly, tighten
  // this by removing 'unsafe-inline' and adding a nonce/hash.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",       // needed for Vite dev HMR
      "style-src 'self' 'unsafe-inline'",         // inline styles from Vite
      "font-src 'self' data:",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  next();
});
app.use(express.json({ limit: "64kb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 8, fieldSize: 1024 },
});

function sendError(res: Response, error: unknown, fallbackStatus = 500): void {
  if (error instanceof AuditError) {
    res.status(error.httpStatus).json({ error: error.payload });
    return;
  }
  res.status(fallbackStatus).json({
    error: {
      code: "UNEXPECTED_ERROR",
      title: "Something went wrong",
      message: "The server could not complete that request.",
      recovery: ["Reload the page and try again.", "Check the server logs for a technical error."],
    } satisfies AuditErrorPayload,
  });
}

function safeFilename(raw: string): string {
  let name = raw;
  // Multer decodes multipart filenames as latin1 in some browsers.
  if (/[\u0080-\u00ff]/.test(name) && !/[^\u0000-\u00ff]/.test(name)) {
    try {
      const decoded = Buffer.from(name, "latin1").toString("utf8");
      if (!decoded.includes("\uFFFD")) name = decoded;
    } catch {
      // Keep the original name if decoding fails.
    }
  }
  const base = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").trim();
  return base.slice(0, 180) || "paper.pdf";
}

function validatePdf(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
  if (!file) {
    throw new AuditError({
      code: "NO_FILE",
      title: "No PDF was received",
      message: "The upload did not include a file.",
      recovery: ["Choose a PDF using the file picker.", "Drag a .pdf file into the upload area."],
    });
  }
  if (file.size === 0) throw ERRORS.emptyFile();
  if (file.size > MAX_FILE_BYTES) throw ERRORS.tooLarge(file.size);
  if (!/\.pdf$/i.test(file.originalname)) throw ERRORS.invalidType();
  if (file.mimetype && !/pdf/i.test(file.mimetype) && file.mimetype !== "application/octet-stream") {
    throw ERRORS.invalidType();
  }
  const header = file.buffer.subarray(0, 1024).toString("latin1");
  if (!header.includes("%PDF-")) throw ERRORS.notPdf();
}

function createAndQueue(file: Express.Multer.File, filename: string): string {
  const id = crypto.randomUUID();
  // No file hash is stored: it would let anyone holding the PDF confirm it was uploaded.
  createAudit({
    id,
    filename,
    fileSize: file.size,
    engineVersion: ENGINE_VERSION,
  });
  enqueueAudit(id, file.buffer);
  return id;
}

app.get("/api/health", (_req, res) => {
  const info: BackendInfo = {
    ok: true,
    engineVersion: ENGINE_VERSION,
    mode: "local",
    limits: {
      maxFileBytes: MAX_FILE_BYTES,
      maxPages: MAX_PAGES,
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
    },
    persistence: {
      kind: "SQLite (node:sqlite)",
      location: path.relative(ROOT_DIR, DB_PATH) || "data/claimcheck.sqlite",
      note: "Findings, summaries, and aggregate statistics are stored. The uploaded PDF and its extracted text are processed in memory and not retained. Findings quote short claim and evidence excerpts.",
    },
    adminProtected: Boolean(ADMIN_TOKEN),
    sampleAvailable: fs.existsSync(SAMPLE_PDF),
  };
  res.json(info);
});

app.get("/api/voice/status", (_req, res) => {
  res.json(voiceStatus(voiceConfig));
});

app.post(
  "/api/voice/transcribe",
  express.raw({ type: ["audio/wav", "audio/x-wav", "audio/wave"], limit: MAX_VOICE_BYTES + 4096 }),
  async (req, res) => {
    // Cancel the upstream request if the browser aborts (user pressed Cancel).
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      if (!voiceConfig.enabled) throw VOICE_ERRORS.notConfigured();
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw VOICE_ERRORS.badAudio("No WAV audio was received. Send the recording as audio/wav.");
      }
      const result = await transcribe(voiceConfig, req.body, {
        signal: controller.signal,
        dictionary: ["ClaimCheck", "F1", "BLEU", "p-value", "confidence interval"],
      });
      res.json({ text: result.text, seconds: Math.round(result.seconds * 10) / 10 });
    } catch (error) {
      if (res.headersSent || controller.signal.aborted) return;
      if (error instanceof VoiceError) {
        res.status(error.httpStatus).json({ error: error.payload });
        return;
      }
      sendError(res, error);
    }
  },
);

app.get("/api/evaluation", (_req, res) => {
  try {
    if (!fs.existsSync(EVALUATION_SUMMARY_PATH)) {
      res.status(404).json({
        error: {
          code: "EVALUATION_UNAVAILABLE",
          title: "No evaluation run is published",
          message:
            "The product has not published a measured corpus result yet. The evaluation tooling is available in the repository.",
          recovery: ["Run `npm run test:publish` from the project root.", "Reload this page."],
        } satisfies AuditErrorPayload,
      });
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(EVALUATION_SUMMARY_PATH, "utf8")) as EvaluationSummary;
    if (!parsed || !Array.isArray(parsed.cases) || typeof parsed.totals !== "object") {
      throw new Error("Evaluation summary has an unexpected shape.");
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(parsed);
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/audits", (req, res) => {
  try {
    requireAdminIfConfigured(req);
    const requested = Number(req.query.limit ?? 30);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 30;
    res.json({ audits: listAudits(limit), total: countAudits() });
  } catch (error) {
    sendError(res, error);
  }
});

// Restore a completed audit from a sanitized backup (scripts/restore-report.ts).
// Disabled unless an admin token is configured.
app.post("/api/admin/import", express.json({ limit: "4mb" }), (req, res) => {
  try {
    if (!ADMIN_TOKEN) throw ERRORS.notFound();
    requireAdminIfConfigured(req);
    const record = req.body as Partial<AuditRecord> | null;
    const valid =
      record &&
      typeof record.id === "string" &&
      /^[0-9a-f-]{36}$/i.test(record.id) &&
      typeof record.filename === "string" &&
      record.status === "complete" &&
      Array.isArray(record.findings) &&
      record.summary &&
      typeof record.summary === "object" &&
      typeof record.createdAt === "string";
    if (!valid) {
      throw new AuditError(
        {
          code: "INVALID_BACKUP",
          title: "Backup not accepted",
          message: "The body must be a completed audit record exported by scripts/backup-report.ts.",
          recovery: ["Re-export the report and try again."],
        },
        400,
      );
    }
    const clean = sanitizeRecord({
      fileSize: 0,
      fileHash: null,
      stage: "complete",
      stageDetail: "",
      progress: 100,
      completedAt: null,
      engineVersion: ENGINE_VERSION,
      error: null,
      extraction: null,
      limitations: [],
      timings: null,
      document: null,
      ...(record as Partial<AuditRecord>),
    } as AuditRecord);
    const imported = importCompletedAudit(clean);
    res.status(imported ? 201 : 200).json({ id: clean.id, imported, reason: imported ? null : "already present" });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/audits", (req, res) => {
  upload.single("file")(req, res, (uploadError: unknown) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError) {
        if (uploadError.code === "LIMIT_FILE_SIZE") {
          sendError(res, ERRORS.tooLarge(MAX_FILE_BYTES), 413);
          return;
        }
        if (uploadError.code === "LIMIT_UNEXPECTED_FILE") {
          sendError(res, ERRORS.invalidType(), 400);
          return;
        }
      }
      sendError(res, new AuditError({
        code: "UPLOAD_FAILED",
        title: "The upload could not be received",
        message: "The file transfer did not complete.",
        recovery: ["Try uploading the PDF again.", "Check the connection to the local server."],
      }), 400);
      return;
    }

    try {
      validatePdf(req.file);
      const id = createAndQueue(req.file, safeFilename(req.file.originalname));
      res.status(202).json({ auditId: id });
    } catch (error) {
      sendError(res, error);
    }
  });
});

app.post("/api/audits/sample", (_req, res) => {
  if (!fs.existsSync(SAMPLE_PDF)) {
    sendError(res, ERRORS.sampleMissing(), 503);
    return;
  }
  try {
    const buffer = fs.readFileSync(SAMPLE_PDF);
    const file: Express.Multer.File = {
      buffer,
      size: buffer.byteLength,
      originalname: "claimcheck-demo-paper.pdf",
      mimetype: "application/pdf",
      fieldname: "file",
      encoding: "7bit",
      destination: "",
      filename: "claimcheck-demo-paper.pdf",
      path: "",
      stream: undefined as never,
    };
    validatePdf(file);
    const id = createAndQueue(file, "claimcheck-demo-paper.pdf (synthetic demo)");
    res.status(202).json({ auditId: id });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/audits/:id", (req, res) => {
  try {
    const audit = getAudit(req.params.id);
    if (!audit) throw ERRORS.notFound();
    res.json(audit);
  } catch (error) {
    sendError(res, error);
  }
});

function download(res: Response, body: string, contentType: string, filename: string): void {
  res.setHeader("Content-Type", `${contentType}; charset=utf-8`);
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
}

app.get("/api/audits/:id/report.md", (req, res) => {
  try {
    const audit = getAudit(req.params.id);
    if (!audit) throw ERRORS.notFound();
    if (audit.status !== "complete") {
      throw new AuditError({
        code: "REPORT_NOT_READY",
        title: "This audit has no completed report",
        message: "The document has not finished processing successfully.",
        recovery: ["Wait for processing to finish.", "Upload the paper again if the audit failed."],
      }, 409);
    }
    let markdown: string;
    try {
      markdown = buildMarkdownReport(audit);
    } catch (error) {
      throw ERRORS.reportFailed(safeDetail(error));
    }
    download(res, markdown, "text/markdown", reportFilename(audit, "md"));
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/audits/:id/report.json", (req, res) => {
  try {
    const audit = getAudit(req.params.id);
    if (!audit) throw ERRORS.notFound();
    if (audit.status !== "complete") {
      throw new AuditError({
        code: "REPORT_NOT_READY",
        title: "This audit has no completed report",
        message: "The document has not finished processing successfully.",
        recovery: ["Wait for processing to finish.", "Upload the paper again if the audit failed."],
      }, 409);
    }
    let json: string;
    try {
      json = buildJsonReport(audit);
    } catch (error) {
      throw ERRORS.reportFailed(safeDetail(error));
    }
    download(res, json, "application/json", reportFilename(audit, "json"));
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/audits/:id", (req, res) => {
  try {
    requireAdminIfConfigured(req);
    if (isJobActive(req.params.id)) {
      throw new AuditError({
        code: "AUDIT_ACTIVE",
        title: "This audit is still processing",
        message: "The record cannot be deleted while the processing worker is using it.",
        recovery: ["Wait for processing to finish, then delete the audit."],
      }, 409);
    }
    if (!getAudit(req.params.id)) throw ERRORS.notFound();
    if (!deleteAudit(req.params.id)) throw ERRORS.notFound();
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      title: "Endpoint not found",
      message: "This API route does not exist.",
      recovery: ["Return to the application and try again."],
    } satisfies AuditErrorPayload,
  });
});

if (process.env.NODE_ENV === "production" && fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

app.use((error: unknown, req: Request, res: Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  if (req.path === "/api/voice/transcribe" && (error as { type?: string } | null)?.type === "entity.too.large") {
    const tooLong = VOICE_ERRORS.tooLong();
    res.status(tooLong.httpStatus).json({ error: tooLong.payload });
    return;
  }
  sendError(res, error);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`ClaimCheck AI server listening on http://${HOST}:${PORT}`);
  console.log(`Engine ${ENGINE_VERSION} · database ${path.relative(ROOT_DIR, DB_PATH)}`);
  if (purgedAtStartup > 0) console.log(`Removed stored document content from ${purgedAtStartup} earlier audit record(s).`);
  if (ADMIN_TOKEN) {
    console.log("Admin token set: listing all reports, deleting, and restoring backups require it. Report links stay public.");
  } else if (HOST !== "127.0.0.1") {
    console.log(
      "WARNING: no admin token (CLAIMCHECK_ADMIN_TOKEN) is set and this server is reachable from the network. Anyone can upload, list, view, and delete reports.",
    );
  } else {
    console.log("No authentication is enabled. Keep this server on localhost.");
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set PORT to another value and retry.`);
  } else {
    console.error("Server failed to start:", error.message);
  }
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
