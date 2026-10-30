import type { ReactNode } from "react";
import type { AuditErrorPayload } from "@shared/types";
import { Icon } from "./Icon";

interface ErrorPanelProps {
  error: AuditErrorPayload;
  actions?: ReactNode;
  compact?: boolean;
  onDismiss?: () => void;
}

export function ErrorPanel({ error, actions, compact = false, onDismiss }: ErrorPanelProps) {
  return (
    <div className={`error-panel${compact ? " error-panel-compact" : ""}`} role="alert">
      <div className="error-head">
        <span className="error-icon" aria-hidden="true">
          <Icon name="alert" size={compact ? 18 : 21} />
        </span>
        <div className="error-copy">
          <span className="error-code">{error.code.replace(/_/g, " ")}</span>
          <h3>{error.title}</h3>
          <p>{error.message}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="icon-button error-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {error.recovery.length > 0 && (
        <div className="error-recovery">
          <span className="error-recovery-label">What you can do</span>
          <ul>
            {error.recovery.map((step) => (
              <li key={step}>
                <Icon name="arrowRight" size={13} />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error.detail && (
        <details className="error-detail">
          <summary>Technical detail</summary>
          <code>{error.detail}</code>
        </details>
      )}
      {actions && <div className="error-actions">{actions}</div>}
    </div>
  );
}
