import { ENGINE_VERSION, type AuditErrorPayload, type AuditTimings } from "../../shared/types.js";
import { runAudit } from "./audit/engine.js";
import {
  MIN_AUDITABLE_CHARS,
  MIN_AUDITABLE_WORDS,
  MIN_CHARS_PER_PAGE,
  PROCESSING_TIMEOUT_MS,
} from "./config.js";
import { completeAudit, failAudit, updateProgress } from "./db.js";
import { AuditError, ERRORS, safeDetail } from "./errors.js";
import { extractPdf } from "./pdf/extract.js";
import { sanitizeExtraction } from "./privacy.js";

const activeJobs = new Set<string>();

export function isJobActive(id: string): boolean {
  return activeJobs.has(id);
}

function progressForPage(page: number, total: number): number {
  return Math.round(10 + (page / Math.max(1, total)) * 40);
}

async function processAudit(id: string, buffer: Buffer): Promise<void> {
  const started = Date.now();
  let timedOut = false;
  let settled = false;

  const timeout = setTimeout(() => {
    if (settled) return;
    timedOut = true;
    settled = true;
    try {
      failAudit(id, ERRORS.auditTimeout().payload);
    } catch {
      // Nothing more can be reported if the store itself is unavailable.
    }
  }, PROCESSING_TIMEOUT_MS);

  try {
    updateProgress(id, {
      status: "processing",
      stage: "validating",
      stageDetail: "Checking PDF structure.",
      progress: 4,
    });

    updateProgress(id, {
      stage: "extracting",
      stageDetail: "Reading selectable text and layout positions.",
      progress: 8,
    });

    const extracted = await extractPdf(buffer, {
      onPage: (page, total) => {
        if (timedOut) return;
        updateProgress(id, {
          stage: "extracting",
          stageDetail: `Reading page ${page} of ${total}.`,
          progress: progressForPage(page, total),
        });
      },
    });

    if (timedOut) return;

    if (extracted.pagesWithText === 0 || extracted.charCount === 0) {
      throw ERRORS.scanned();
    }
    if (extracted.charCount < MIN_AUDITABLE_CHARS || extracted.wordCount < MIN_AUDITABLE_WORDS) {
      throw ERRORS.lowText(extracted.charCount, extracted.pageCount);
    }
    const averageChars = extracted.charCount / Math.max(1, extracted.pageCount);
    if (extracted.pageCount >= 2 && averageChars < MIN_CHARS_PER_PAGE) {
      throw ERRORS.lowText(extracted.charCount, extracted.pageCount);
    }
    if (extracted.charCount < 2500 && !extracted.warnings.some((warning) => warning.includes("limited"))) {
      extracted.warnings.push(
        "This document contains limited extractable text. Some claims and supporting evidence may be outside the readable text layer.",
      );
    }

    updateProgress(id, {
      stage: "structuring",
      stageDetail: `${extracted.sections.filter((section) => section.auditable).length} auditable sections, ${extracted.tables.length} table candidate(s) mapped.`,
      progress: 55,
    });

    const result = runAudit(extracted, started, (phase, claims) => {
      if (timedOut) return;
      if (phase === "claims") {
        updateProgress(id, {
          stage: "claims",
          stageDetail: `${claims} auditable claim candidate${claims === 1 ? "" : "s"} selected.`,
          progress: 65,
        });
      } else {
        updateProgress(id, {
          stage: "evidence",
          stageDetail: "Comparing claims against extracted passages and table rows.",
          progress: 78,
        });
      }
    });

    if (timedOut) return;

    updateProgress(id, { stage: "report", stageDetail: "Assembling traceable findings.", progress: 92 });

    // Only aggregate statistics leave this function. The extracted text, pages,
    // sections, tables, and captions are dropped with `extracted` when it returns.
    const extraction = sanitizeExtraction({
      ...extracted,
      textDensity: extracted.charCount < 2500 ? "sparse" : "good",
    })!;

    const timings: AuditTimings = {
      extractionMs: extracted.extractionMs,
      auditMs: result.auditMs,
      totalMs: Date.now() - started,
    };

    completeAudit(id, {
      findings: result.findings,
      summary: result.summary,
      limitations: result.limitations,
      extraction,
      timings,
    });
    settled = true;
  } catch (error) {
    if (timedOut || settled) return;
    settled = true;
    let payload: AuditErrorPayload;
    if (error instanceof AuditError) {
      payload = error.payload;
    } else if (error instanceof Error && /SQLITE|database|constraint/i.test(error.message)) {
      payload = ERRORS.storageFailed(safeDetail(error)).payload;
    } else {
      payload = ERRORS.auditFailed(safeDetail(error)).payload;
    }
    try {
      failAudit(id, payload);
    } catch {
      // A failed write to the audit store cannot be surfaced further from here.
    }
  } finally {
    clearTimeout(timeout);
    activeJobs.delete(id);
  }
}

/** The PDF buffer is held in memory only, and only until processing finishes. */
export function enqueueAudit(id: string, buffer: Buffer): void {
  activeJobs.add(id);
  setImmediate(() => {
    void processAudit(id, buffer);
  });
}

export function markQueuedFailure(id: string, error: AuditErrorPayload): void {
  try {
    failAudit(id, error);
  } catch {
    // Caller still receives the processing error.
  }
}

export { ENGINE_VERSION };
