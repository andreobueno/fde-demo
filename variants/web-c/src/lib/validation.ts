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
export function noteRule(action: CaseAction, riskLevel: RiskLevel, approvalNoteRequired: boolean): NoteRule {
  switch (action) {
    case 'reject':
    case 'escalate':
      return {
        required: true,
        hint: `A note of ${NOTE_MIN}–${NOTE_MAX} characters (excluding surrounding whitespace) is required.`,
      };
    case 'approve':
      return riskLevel === 'high' || approvalNoteRequired
        ? {
            required: true,
            hint: `Approving ${riskLevel === 'high' ? 'a high-risk' : 'this'} case requires a note of ${NOTE_MIN}–${NOTE_MAX} characters (excluding surrounding whitespace).`,
          }
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
  approvalNoteRequired: boolean,
): string | null {
  const note = (rawNote ?? '').trim();
  const rule = noteRule(action, riskLevel, approvalNoteRequired);
  if (note.length > NOTE_MAX) return `Note must be at most ${NOTE_MAX} characters.`;
  if (rule.required && note.length < NOTE_MIN) return `Note must be at least ${NOTE_MIN} characters.`;
  return null;
}

/** Normalise the note so an empty optional note is omitted from the request body. */
export function normaliseNote(rawNote: string | undefined): string | undefined {
  const note = (rawNote ?? '').trim();
  return note.length === 0 ? undefined : note;
}
