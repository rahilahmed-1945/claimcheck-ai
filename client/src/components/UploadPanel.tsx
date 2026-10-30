import { useRef, useState, type DragEvent } from "react";
import type { AuditErrorPayload, BackendInfo } from "@shared/types";
import { runSampleAudit, uploadPdf } from "../lib/api";
import { formatBytes } from "../lib/format";
import { ErrorPanel } from "./ErrorPanel";
import { Icon } from "./Icon";

type Phase = "idle" | "uploading" | "starting" | "sample" | "error";

interface UploadPanelProps {
  health: BackendInfo | null;
  healthError: AuditErrorPayload | null;
  onRetryHealth: () => void;
  onUploaded: (auditId: string) => void;
}

function localError(
  code: string,
  title: string,
  message: string,
  recovery: string[],
): AuditErrorPayload {
  return { code, title, message, recovery };
}

export function UploadPanel({ health, healthError, onRetryHealth, onUploaded }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [activeName, setActiveName] = useState("");
  const [error, setError] = useState<AuditErrorPayload | null>(null);
  const busy = phase === "uploading" || phase === "starting" || phase === "sample";
  const offline = Boolean(healthError);
  const unavailable = offline || (!health && !healthError);
  const maxBytes = health?.limits.maxFileBytes ?? 25 * 1024 * 1024;

  const fail = (payload: AuditErrorPayload) => {
    setError(payload);
    setPhase("error");
    setProgress(0);
  };

  const validate = (file: File): AuditErrorPayload | null => {
    if (!/\.pdf$/i.test(file.name)) {
      return localError(
        "INVALID_TYPE",
        "That file is not a PDF",
        "ClaimCheck AI only accepts PDF documents. The selected file has a different extension.",
        ["Choose a file ending in .pdf.", "Export a Word or LaTeX document to PDF first."],
      );
    }
    if (file.size === 0) {
      return localError(
        "EMPTY_FILE",
        "That file is empty",
        "The selected file contains no data, so there is nothing to analyze.",
        ["Re-export the PDF.", "Choose a different PDF file."],
      );
    }
    if (file.size > maxBytes) {
      return localError(
        "FILE_TOO_LARGE",
        "This PDF is too large for phase one",
        `The selected file is ${formatBytes(file.size)}. The current limit is ${formatBytes(maxBytes)}.`,
        ["Compress large images or export a text-focused version.", "Audit the main paper separately from appendices."],
      );
    }
    if (file.type && !/pdf/i.test(file.type)) {
      return localError(
        "INVALID_TYPE",
        "The selected file is not recognized as a PDF",
        "The browser reported a different content type for this file.",
        ["Choose a file exported as PDF.", "If the file is a PDF, try selecting it again from the file picker."],
      );
    }
    return null;
  };

  const startUpload = async (file: File) => {
    if (busy || unavailable) return;
    const problem = validate(file);
    if (problem) {
      fail(problem);
      return;
    }
    setError(null);
    setActiveName(file.name);
    setProgress(0);
    setPhase("uploading");
    try {
      const result = await uploadPdf(file, (value) => {
        setProgress(value);
        if (value >= 100) setPhase("starting");
      });
      onUploaded(result.auditId);
    } catch (caught) {
      const payload =
        caught && typeof caught === "object" && "payload" in caught
          ? (caught as { payload: AuditErrorPayload }).payload
          : localError(
              "UPLOAD_FAILED",
              "The upload could not be completed",
              "The browser could not send the file to the local server.",
              ["Check that the server is running.", "Try the upload again."],
            );
      fail(payload);
    }
  };

  const pickFile = () => {
    if (busy || unavailable) return;
    inputRef.current?.click();
  };

  const onFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void startUpload(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    if (busy || unavailable) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    if (files.length > 1) {
      fail(
        localError(
          "MULTIPLE_FILES",
          "One paper at a time",
          "ClaimCheck audits one document per report. Drop a single PDF.",
          ["Drop just one PDF file.", "Split supplementary material into a separate audit."],
        ),
      );
      return;
    }
    const [file] = files;
    if (file) void startUpload(file);
  };

  const startSample = async () => {
    if (busy || unavailable || !health?.sampleAvailable) return;
    setError(null);
    setPhase("sample");
    try {
      const result = await runSampleAudit();
      onUploaded(result.auditId);
    } catch (caught) {
      const payload =
        caught && typeof caught === "object" && "payload" in caught
          ? (caught as { payload: AuditErrorPayload }).payload
          : localError(
              "SAMPLE_FAILED",
              "The sample audit could not be started",
              "The local server did not accept the demo document.",
              ["Try again.", "Upload your own PDF instead."],
            );
      fail(payload);
    }
  };

  return (
    <section className="card upload-card" aria-labelledby="upload-heading">
      <div className="upload-card-head">
        <div>
          <span className="card-kicker">Start an audit</span>
          <h2 id="upload-heading">Upload a research paper</h2>
        </div>
        <span className="format-pill">PDF</span>
      </div>

      {healthError && (
        <ErrorPanel
          error={healthError}
          compact
          actions={
            <button type="button" className="button button-secondary button-sm" onClick={onRetryHealth}>
              <Icon name="refresh" size={14} /> Check server again
            </button>
          }
        />
      )}
      {error && (
        <ErrorPanel
          error={error}
          compact
          onDismiss={() => {
            setError(null);
            setPhase("idle");
          }}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="visually-hidden"
        onChange={onFileInput}
        tabIndex={-1}
      />

      <div
        className={`dropzone${isDragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}${
          unavailable ? " is-disabled" : ""
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy && !unavailable) setIsDragging(true);
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          dragCounter.current += 1;
          if (!busy && !unavailable) setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragCounter.current = Math.max(0, dragCounter.current - 1);
          if (dragCounter.current === 0) setIsDragging(false);
        }}
        onDrop={onDrop}
        onClick={pickFile}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            pickFile();
          }
        }}
        role="button"
        tabIndex={unavailable || busy ? -1 : 0}
        aria-label="Upload a PDF research paper"
        aria-disabled={unavailable || busy}
      >
        {phase === "uploading" || phase === "starting" ? (
          <div className="upload-progress">
            <span className="drop-icon">
              <Icon name="file" size={23} />
            </span>
            <strong>{activeName}</strong>
            <div className="progress-track progress-track-sm">
              <span className="progress-fill" style={{ width: `${phase === "starting" ? 100 : progress}%` }} />
            </div>
            <span className="upload-progress-label">
              {phase === "starting" ? "Upload received. Validating the PDF…" : `Uploading · ${progress}%`}
            </span>
          </div>
        ) : phase === "sample" ? (
          <div className="upload-progress">
            <span className="drop-icon">
              <Icon name="flask" size={23} />
            </span>
            <strong>Preparing the synthetic demo audit</strong>
            <span className="upload-progress-label">Sending the sample PDF to the local extractor…</span>
          </div>
        ) : (
          <>
            <span className="drop-icon">
              <Icon name="upload" size={23} />
            </span>
            <strong>{isDragging ? "Drop to begin the audit" : "Drop your paper here"}</strong>
            <p>or choose a text-based PDF from this machine</p>
            <span className="button button-primary drop-button">
              <Icon name="file" size={15} />
              {healthError ? "Server unavailable" : !health ? "Connecting…" : "Select PDF"}
            </span>
            <span className="drop-meta">
              Up to {formatBytes(maxBytes)} · {health?.limits.maxPages ?? 150} pages max · selectable text
              required
            </span>
          </>
        )}
      </div>

      <div className="sample-row">
        <div className="sample-copy">
          <span className="sample-label">
            <Icon name="flask" size={14} /> Try the workbench
          </span>
          <p>
            Run a synthetic demo paper with deliberately seeded inconsistencies. It is clearly
            labeled and processed like any other PDF.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary button-sm sample-button"
          onClick={startSample}
          disabled={busy || unavailable || !health?.sampleAvailable}
          title={
            health && !health.sampleAvailable
              ? "The sample PDF is not installed. Run `npm run sample`."
              : undefined
          }
        >
          {phase === "sample" ? (
            <>
              <span className="spinner spinner-dark" aria-hidden="true" /> Starting…
            </>
          ) : health && !health.sampleAvailable ? (
            "Demo unavailable"
          ) : (
            "Run sample audit"
          )}
        </button>
      </div>

      <p className="privacy-line">
        <Icon name="lock" size={14} />
        Processed on this machine. No external AI service is called. The original PDF is held in
        memory and is not saved.
      </p>
    </section>
  );
}
