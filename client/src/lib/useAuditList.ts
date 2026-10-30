import { useCallback, useEffect, useState } from "react";
import type { AuditErrorPayload, AuditListItem } from "@shared/types";
import { ApiError, fetchAudits } from "./api";

interface AuditListState {
  audits: AuditListItem[];
  total: number;
  loading: boolean;
  error: AuditErrorPayload | null;
  reload: () => void;
}

export function useAuditList(): AuditListState {
  const [audits, setAudits] = useState<AuditListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AuditErrorPayload | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchAudits(controller.signal)
      .then((response) => {
        setAudits(response.audits);
        setTotal(response.total ?? response.audits.length);
        setError(null);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(
          caught instanceof ApiError
            ? caught.payload
            : {
                code: "UNKNOWN",
                title: "Could not load audits",
                message: "An unexpected client error occurred.",
                recovery: ["Reload the page."],
              },
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [nonce]);

  return { audits, total, loading, error, reload };
}
