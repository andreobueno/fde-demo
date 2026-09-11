import type { CaseAction } from '../api/types';

export const ACTION_LABELS: Record<CaseAction, string> = {
  start_review: 'Start review',
  approve: 'Approve',
  reject: 'Reject',
  escalate: 'Escalate',
};

export function noteIsRequired(action: CaseAction, approvalNoteRequired: boolean): boolean {
  return action === 'reject' || action === 'escalate' ||
    (action === 'approve' && approvalNoteRequired);
}

export function validateActionNote(
  action: CaseAction,
  approvalNoteRequired: boolean,
  note: string,
): string | null {
  return validateNote(note, noteIsRequired(action, approvalNoteRequired));
}

export function validateNote(note: string, required: boolean, label = 'Note'): string | null {
  const trimmed = note.trim();

  if (required) {
    if (trimmed.length === 0) {
      return `${label} is required.`;
    }
    if (trimmed.length < 10) {
      return `${label} must be at least 10 characters.`;
    }
  }

  if (trimmed.length > 1000) {
    return `${label} must be at most 1000 characters.`;
  }
  return null;
}
