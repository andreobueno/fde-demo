import type { CaseAction, RiskLevel } from '../api/types.js';

export const NOTE_MIN = 10;
export const NOTE_MAX = 1000;

export const ACTION_LABELS: Record<CaseAction, string> = {
  start_review: 'Start review',
  approve: 'Approve',
  reject: 'Reject',
  escalate: 'Escalate',
};

export interface NoteRule {
  required: boolean;
  hint: string;
}

/** Client-side mirror of the server's note rules (server remains the source of truth). */
export function noteRule(action: CaseAction, riskLevel: RiskLevel): NoteRule {
  switch (action) {
    case 'reject':
    case 'escalate':
      return { required: true, hint: `A note of ${NOTE_MIN}–${NOTE_MAX} characters is required.` };
    case 'approve':
      return riskLevel === 'high'
        ? { required: true, hint: 'Approving a high-risk case requires a note (max 1000 characters).' }
        : { required: false, hint: 'Optional note (max 1000 characters).' };
    case 'start_review':
      return { required: false, hint: 'Optional note (max 1000 characters).' };
  }
}

/** Returns an error message, or null when the note is acceptable for this action. */
export function validateNote(
  action: CaseAction,
  riskLevel: RiskLevel,
  rawNote: string | undefined,
): string | null {
  const note = (rawNote ?? '').trim();
  const rule = noteRule(action, riskLevel);
  if (note.length > NOTE_MAX) return `Note must be at most ${NOTE_MAX} characters.`;
  if (action === 'reject' || action === 'escalate') {
    if (note.length < NOTE_MIN) return `Note must be at least ${NOTE_MIN} characters.`;
    return null;
  }
  if (rule.required && note.length === 0) return 'A note is required to approve a high-risk case.';
  return null;
}

/** Normalise the note so an empty optional note is omitted from the request body. */
export function normaliseNote(rawNote: string | undefined): string | undefined {
  const note = (rawNote ?? '').trim();
  return note.length === 0 ? undefined : note;
}
