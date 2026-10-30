import type {
  AuditErrorPayload,
  AuditListResponse,
  AuditRecord,
  BackendInfo,
  EvaluationSummary,
  UploadResponse,
} from "@shared/types";

export class ApiError extends Error {
  payload: AuditErrorPayload;
  status: number;

  constructor(payload: AuditErrorPayload, status = 0) {
    super(payload.message);
    this.name = "ApiError";
    this.payload = payload;
    this.status = status;
  }
}

const NETWORK_ERROR: AuditErrorPayload = {
  code: "NETWORK_ERROR",
  title: "Cannot reach the ClaimCheck server",
  message:
    "The local processing server did not respond. The interface cannot start or continue an audit without it.",
  recovery: [
    "Confirm the development server is running (`npm run dev`).",
    "Reload this page and try again.",
  ],
};

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: AuditErrorPayload };
    if (body.error) return new ApiError(body.error, response.status);
  } catch {
    // Fall through to a generic payload.
  }
  return new ApiError(
    {
      code: "REQUEST_FAILED",
      title: "The request failed",
      message: `The server returned an unexpected ${response.status} response.`,
      recovery: ["Reload the page and try again."],
    },
    response.status,
  );
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(NETWORK_ERROR);
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export function fetchHealth(signal?: AbortSignal): Promise<BackendInfo> {
  return getJson<BackendInfo>("/api/health", signal);
}

export function fetchAudits(signal?: AbortSignal): Promise<AuditListResponse> {
  return getJson<AuditListResponse>("/api/audits?limit=50", signal);
}

export function fetchAudit(id: string, signal?: AbortSignal): Promise<AuditRecord> {
  return getJson<AuditRecord>(`/api/audits/${encodeURIComponent(id)}`, signal);
}

export function fetchEvaluation(signal?: AbortSignal): Promise<EvaluationSummary> {
  return getJson<EvaluationSummary>("/api/evaluation", signal);
}

export function uploadPdf(
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/audits");
    xhr.responseType = "text";
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onerror = () => reject(new ApiError(NETWORK_ERROR));
    xhr.onabort = () =>
      reject(
        new ApiError({
          code: "UPLOAD_ABORTED",
          title: "Upload cancelled",
          message: "The file transfer was cancelled before it finished.",
          recovery: ["Try uploading the PDF again."],
        }),
      );
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        // handled below
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as UploadResponse);
        return;
      }
      const errorPayload =
        payload && typeof payload === "object" && "error" in payload
          ? ((payload as { error: AuditErrorPayload }).error)
          : {
              code: "UPLOAD_FAILED",
              title: "The upload failed",
              message: `The server returned an unexpected ${xhr.status} response.`,
              recovery: ["Try again with the same PDF.", "Reload the page if the problem persists."],
            };
      reject(new ApiError(errorPayload, xhr.status));
    };
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export async function runSampleAudit(): Promise<UploadResponse> {
  let response: Response;
  try {
    response = await fetch("/api/audits/sample", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError(NETWORK_ERROR);
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as UploadResponse;
}

export async function deleteAudit(id: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/audits/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    throw new ApiError(NETWORK_ERROR);
  }
  if (!response.ok) throw await parseError(response);
}

export function reportUrl(id: string, format: "md" | "json"): string {
  return `/api/audits/${encodeURIComponent(id)}/report.${format}`;
}

export interface VoiceStatus {
  enabled: boolean;
  provider: "wispr-flow-rest";
  reason: "enabled" | "flag_off" | "missing_key" | "invalid_endpoint";
  maxSeconds: number;
  verified: false;
  note: string;
}

export function fetchVoiceStatus(signal?: AbortSignal): Promise<VoiceStatus> {
  return getJson<VoiceStatus>("/api/voice/status", signal);
}

/** Send a 16 kHz mono WAV recording to the server, which forwards it to the Wispr Flow API. */
export async function transcribeRecording(wav: Uint8Array, signal?: AbortSignal): Promise<{ text: string; seconds: number }> {
  let response: Response;
  try {
    response = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "audio/wav", Accept: "application/json" },
      body: new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(NETWORK_ERROR);
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as { text: string; seconds: number };
}
