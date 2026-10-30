/**
 * ReviewerPanel — per-finding disposition selector and note editor.
 *
 * Rendered inside FindingDetail. All state is localStorage-backed via
 * the useReviewer hook. Clearly separated from engine classifications.
 */
import { useEffect, useRef, useState } from "react";
import {
  DISPOSITION_META,
  DISPOSITION_ORDER,
  type ReviewDisposition,
  type ReviewerState,
} from "../lib/useReviewer";
import { Icon } from "./Icon";

interface ReviewerPanelProps {
  findingId: string;
  state: ReviewerState;
  onDispositionChange: (disposition: ReviewDisposition) => void;
  onNoteChange: (note: string) => void;
}

export function ReviewerPanel({
  findingId,
  state,
  onDispositionChange,
  onNoteChange,
}: ReviewerPanelProps) {
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(state.note);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync draft when finding changes.
  useEffect(() => {
    setDraft(state.note);
    setEditingNote(false);
  }, [findingId, state.note]);

  const saveNote = () => {
    onNoteChange(draft.trim());
    setEditingNote(false);
  };

  const cancelNote = () => {
    setDraft(state.note);
    setEditingNote(false);
  };

  const startEditing = () => {
    setDraft(state.note);
    setEditingNote(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const hasNote = state.note.trim().length > 0;
  const currentMeta = DISPOSITION_META[state.disposition];

  return (
    <section className="detail-block reviewer-panel" aria-labelledby={`reviewer-heading-${findingId}`}>
      <div className="reviewer-panel-head">
        <span className="detail-label" id={`reviewer-heading-${findingId}`}>
          Reviewer workspace
        </span>
        <span className="reviewer-engine-note">
          <Icon name="info" size={12} />
          Separate from engine classification
        </span>
      </div>

      <div className="disposition-group" role="group" aria-label="Reviewer disposition">
        {DISPOSITION_ORDER.map((disposition) => {
          const meta = DISPOSITION_META[disposition];
          const active = state.disposition === disposition;
          return (
            <button
              key={disposition}
              type="button"
              className={`disposition-chip ${meta.className}${active ? " is-active" : ""}`}
              onClick={() => onDispositionChange(disposition)}
              aria-pressed={active}
              title={meta.description}
            >
              {disposition === "to_review" && <Icon name="alert" size={12} />}
              {disposition === "confirmed_issue" && <Icon name="check" size={12} />}
              {disposition === "false_positive" && <Icon name="x" size={12} />}
              {disposition === "resolved" && <Icon name="shield" size={12} />}
              {meta.label}
            </button>
          );
        })}
      </div>
      <p className="disposition-description">{currentMeta.description}</p>

      <div className="reviewer-note-section">
        {editingNote ? (
          <div className="note-editor">
            <label className="note-editor-label" htmlFor={`note-textarea-${findingId}`}>
              Reviewer note
            </label>
            <textarea
              ref={textareaRef}
              id={`note-textarea-${findingId}`}
              className="note-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add context, evidence, or a suggested action for this finding…"
              rows={4}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelNote();
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveNote();
              }}
            />
            <div className="note-actions">
              <button type="button" className="button button-primary button-sm" onClick={saveNote}>
                <Icon name="check" size={14} /> Save note
              </button>
              <button type="button" className="button button-ghost button-sm" onClick={cancelNote}>
                Cancel
              </button>
              <span className="note-hint">Ctrl+Enter to save · Esc to cancel</span>
            </div>
          </div>
        ) : hasNote ? (
          <div className="note-display">
            <div className="note-display-head">
              <span className="detail-label-sm">
                <Icon name="quote" size={12} /> Reviewer note
              </span>
              <button
                type="button"
                className="text-link text-link-sm"
                onClick={startEditing}
                aria-label="Edit reviewer note"
              >
                Edit
              </button>
            </div>
            <p className="note-text">{state.note}</p>
            {state.updatedAt && (
              <span className="note-updated">
                Saved in this browser {new Date(state.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="add-note-button"
            onClick={startEditing}
            aria-label="Add a reviewer note to this finding"
          >
            <Icon name="plus" size={14} />
            Add reviewer note
          </button>
        )}
      </div>
      <p className="reviewer-storage-note">
        Dispositions and notes are kept in this browser only. They are not sent to the server and are not
        included in downloaded reports.
      </p>
    </section>
  );
}
