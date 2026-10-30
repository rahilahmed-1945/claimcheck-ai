import type { AuditErrorPayload } from "../../shared/types.js";

export class AuditError extends Error {
  payload: AuditErrorPayload;
  httpStatus: number;

  constructor(payload: AuditErrorPayload, httpStatus = 400) {
    super(payload.message);
    this.name = "AuditError";
    this.payload = payload;
    this.httpStatus = httpStatus;
  }
}

export const ERRORS = {
  invalidType: () =>
    new AuditError({
      code: "INVALID_TYPE",
      title: "That file is not a PDF",
      message: "ClaimCheck AI only accepts PDF documents. The selected file has a different type.",
      recovery: [
        "Choose a file ending in .pdf.",
        "If your paper is in Word or LaTeX, export it to PDF first.",
      ],
    }),
  emptyFile: () =>
    new AuditError({
      code: "EMPTY_FILE",
      title: "That file is empty",
      message: "The selected file contains no data, so there is nothing to analyze.",
      recovery: ["Re-export the PDF from your editor or browser.", "Choose a different PDF file."],
    }),
  tooLarge: (bytes: number) =>
    new AuditError({
      code: "FILE_TOO_LARGE",
      title: "This PDF is too large for phase one",
      message: `The selected file is ${(bytes / (1024 * 1024)).toFixed(1)} MB. The current limit is 25 MB per document.`,
      recovery: [
        "Compress images in the PDF or export a text-focused version.",
        "Split an appendix into a separate document and audit the main paper first.",
      ],
    }, 413),
  notPdf: () =>
    new AuditError({
      code: "INVALID_PDF_SIGNATURE",
      title: "This file is labeled PDF but is not readable as one",
      message:
        "The file does not contain a valid PDF header. Renaming a file to .pdf does not convert it.",
      recovery: [
        "Export the document directly to PDF from its original application.",
        "Try opening the file in a PDF reader to confirm it is valid.",
      ],
    }),
  emptyPdf: () =>
    new AuditError({
      code: "EMPTY_PDF",
      title: "This PDF has no pages",
      message: "The PDF opened, but it does not contain any readable pages.",
      recovery: ["Re-export the document.", "Choose a different PDF file."],
    }),
  encrypted: () =>
    new AuditError({
      code: "ENCRYPTED_PDF",
      title: "This PDF is password-protected",
      message:
        "ClaimCheck AI cannot open password-protected or encrypted PDFs. No audit was produced.",
      recovery: [
        "Remove the password in your PDF editor and export an unlocked copy.",
        "Use a version of the paper without document restrictions.",
      ],
    }),
  corrupt: (detail?: string) =>
    new AuditError({
      code: "CORRUPT_PDF",
      title: "This PDF could not be read",
      message:
        "The file appears to be damaged or uses a PDF feature the extractor cannot open. No audit was produced.",
      recovery: [
        "Open the PDF in a viewer to confirm it displays correctly.",
        "Repair or re-export the file, then upload it again.",
      ],
      detail,
    }),
  tooManyPages: (pages: number) =>
    new AuditError({
      code: "TOO_MANY_PAGES",
      title: "This document is longer than phase one supports",
      message: `The PDF has ${pages} pages. The current limit is 150 pages per audit.`,
      recovery: [
        "Audit the main paper separately from supplementary material.",
        "Split the PDF into smaller documents.",
      ],
    }),
  scanned: () =>
    new AuditError({
      code: "SCANNED_PDF",
      title: "No selectable text was found",
      message:
        "This looks like a scanned or image-only PDF. ClaimCheck AI does not perform OCR, so it cannot audit the document and has not produced any findings.",
      recovery: [
        "Run OCR on the PDF (for example with your scanner software or a PDF editor).",
        "Export a text-based PDF from the original document source.",
        "Then upload the text-based version.",
      ],
    }),
  lowText: (chars: number, pages: number) =>
    new AuditError({
      code: "LOW_TEXT",
      title: "There is too little extractable text to audit reliably",
      message: `Only ${chars.toLocaleString()} characters were extracted across ${pages} page${pages === 1 ? "" : "s"}. This is usually caused by image-only pages or a broken text layer. No findings were generated.`,
      recovery: [
        "Confirm that text can be selected in a PDF reader.",
        "Run OCR or re-export the document with a proper text layer.",
        "Upload the text-based version.",
      ],
    }),
  extractionTimeout: () =>
    new AuditError({
      code: "EXTRACTION_TIMEOUT",
      title: "Text extraction timed out",
      message:
        "The PDF took longer than the processing limit. No partial findings were kept because a partial document could produce misleading results.",
      recovery: [
        "Try a smaller or simpler PDF.",
        "Remove very large embedded images and re-export.",
      ],
    }, 504),
  extractionFailed: (detail?: string) =>
    new AuditError({
      code: "EXTRACTION_FAILED",
      title: "Text extraction failed",
      message:
        "The PDF was valid, but the extractor could not finish reading it. No findings were produced.",
      recovery: ["Re-export the PDF.", "Try another PDF reader to verify the file.", "Upload it again."],
      detail,
    }, 422),
  auditTimeout: () =>
    new AuditError({
      code: "AUDIT_TIMEOUT",
      title: "The audit exceeded its time limit",
      message:
        "Processing stopped before a complete report could be assembled. No partial audit is shown as a finished result.",
      recovery: ["Try a shorter paper.", "Upload the document again."],
    }, 504),
  auditFailed: (detail?: string) =>
    new AuditError({
      code: "AUDIT_FAILED",
      title: "The audit could not be completed",
      message:
        "The document was extracted, but the checks could not finish. No audit report was saved.",
      recovery: ["Try again.", "If the problem persists, use a shorter text-based PDF."],
      detail,
    }, 500),
  storageFailed: (detail?: string) =>
    new AuditError({
      code: "STORAGE_FAILED",
      title: "The audit could not be saved",
      message:
        "Processing finished, but the local audit store could not persist the result. Nothing was recorded.",
      recovery: [
        "Check that the data directory is writable and has free space.",
        "Restart the server, then upload the paper again.",
      ],
      detail,
    }, 500),
  notFound: () =>
    new AuditError({
      code: "NOT_FOUND",
      title: "Audit not found",
      message: "This audit does not exist in the local store. It may have been deleted.",
      recovery: ["Return to the reports list.", "Upload the paper to create a new audit."],
    }, 404),
  reportFailed: (detail?: string) =>
    new AuditError({
      code: "REPORT_FAILED",
      title: "The report could not be generated",
      message: "The audit is stored, but formatting the requested download failed.",
      recovery: ["Try the other report format.", "Reload the page and download again."],
      detail,
    }, 500),
  serverRestart: () =>
    new AuditError({
      code: "PROCESSING_INTERRUPTED",
      title: "Processing was interrupted",
      message:
        "The server restarted while this document was being processed, so the audit did not finish. No partial findings are shown.",
      recovery: ["Upload the paper again to start a new audit."],
    }, 500),
  sampleMissing: () =>
    new AuditError({
      code: "SAMPLE_UNAVAILABLE",
      title: "The sample paper is not installed",
      message:
        "The synthetic demo PDF was not found on this machine. You can still upload your own PDF.",
      recovery: ["Run `npm run sample` to generate the demo document."],
    }, 503),
} as const;

export function safeDetail(error: unknown): string | undefined {
  if (error instanceof Error) {
    // Never surface raw PDF content; messages from pdfjs are short technical descriptions.
    return error.message.slice(0, 300);
  }
  return undefined;
}
