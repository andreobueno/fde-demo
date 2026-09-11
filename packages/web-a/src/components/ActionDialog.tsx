import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import type { CaseAction, RiskLevel } from '../api/types';
import { ACTION_LABELS, noteIsRequired, validateActionNote } from '../lib/actionRules';
import styles from './ActionDialog.module.css';

interface ActionDialogProps {
  action: CaseAction;
  riskLevel: RiskLevel;
  caseReference: string;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}

function helperText(action: CaseAction, riskLevel: RiskLevel): string {
  if (action === 'reject' || action === 'escalate') {
    return 'Required, 10–1000 characters.';
  }
  if (action === 'approve' && riskLevel === 'high') {
    return 'Required for high-risk approvals.';
  }
  return 'Optional, up to 1000 characters.';
}

export function ActionDialog({
  action,
  riskLevel,
  caseReference,
  onClose,
  onSubmit,
}: ActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const handleCancel = () => {
      onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (e.target === dialog) {
        onClose();
      }
    };
    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('click', handleClick);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  const validationError = validateActionNote(action, riskLevel, note);
  const shownClientError = attempted ? validationError : clientError;

  const handleSubmit = async () => {
    setAttempted(true);
    const err = validateActionNote(action, riskLevel, note);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    setServerError(null);
    setSubmitting(true);
    try {
      await onSubmit(note.trim());
    } catch (e) {
      if (e instanceof ApiError) {
        const prefix =
          e.status === 409 || e.status === 403 || e.status === 400 ? `${e.code}: ` : '';
        setServerError(`${prefix}${e.message}`);
      } else {
        setServerError('Unexpected error. Please try again.');
      }
      setSubmitting(false);
    }
  };

  return (
    <dialog ref={dialogRef} className={styles.dialog}>
      <h2 className={styles.title}>
        {ACTION_LABELS[action]} case {caseReference}
      </h2>
      <label className={styles.label} htmlFor="action-note">
        Note {noteIsRequired(action, riskLevel) ? '(required)' : '(optional)'}
      </label>
      <textarea
        id="action-note"
        ref={textareaRef}
        rows={5}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          if (attempted) {
            setClientError(validateActionNote(action, riskLevel, e.target.value));
          }
        }}
      />
      <p className={styles.helper}>{helperText(action, riskLevel)}</p>
      {shownClientError ? <p className={styles.error}>{shownClientError}</p> : null}
      {serverError ? (
        <p className={styles.error} role="alert">
          {serverError}
        </p>
      ) : null}
      <div className={styles.buttons}>
        <button type="button" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={submitting}
        >
          {submitting ? 'Submitting…' : 'Confirm'}
        </button>
      </div>
    </dialog>
  );
}
