import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditErrorPayload, AuditRecord } from "@shared/types";
import { ApiError, fetchAudit } from "./api";

interface UseAuditResult {
  audit: AuditRecord | null;
  loading: boolean;
  error: AuditErrorPayload | null;
  connectionIssue: AuditErrorPayload | null;
  retry: () => void;
}

export function useAudit(id: string | undefined): UseAuditResult {
  const [audit, setAudit] = useState<AuditRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<AuditErrorPayload | null>(null);
  const [connectionIssue, setConnectionIssue] = useState<AuditErrorPayload | null>(null);
  const [attempt, setAttempt] = useState(0);
  const auditRef = useRef<AuditRecord | null>(null);

  const retry = useCallback(() => {
    setError(null);
    setConnectionIssue(null);
    setLoading(true);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError(null);

    const tick = async () => {
      try {
        const record = await fetchAudit(id);
        if (cancelled) return;
        auditRef.current = record;
        setAudit(record);
        setError(null);
        setConnectionIssue(null);
        setLoading(false);
        if (record.status === "queued" || record.status === "processing") {
          timer = setTimeout(tick, 900);
        }
      } catch (caught) {
        if (cancelled) return;
        setLoading(false);
        if (caught instanceof ApiError && caught.status === 404) {
          setError(caught.payload);
          return;
        }
        const payload =
          caught instanceof ApiError
            ? caught.payload
            : {
                code: "UNKNOWN",
                title: "Could not load this audit",
                message: "An unexpected client error occurred.",
                recovery: ["Reload the page."],
              };
        setConnectionIssue(payload);
        timer = setTimeout(tick, 2600);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, attempt]);

  return { audit, loading, error, connectionIssue, retry };
}
