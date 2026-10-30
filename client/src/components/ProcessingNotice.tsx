import { Icon } from "./Icon";

export function ProcessingNotice() {
  return (
    <div className="notice notice-quiet">
      <Icon name="shield" size={16} />
      <p>
        Deterministic checks only. No external AI service receives this document, and every finding
        must point to text that exists in the extracted PDF.
      </p>
    </div>
  );
}
