import type { CaseAction, RiskLevel } from '../api/types';

export const ACTION_LABELS: Record<CaseAction, string> = {
  start_review: 'Start review',
  approve: 'Approve',
  reject: 'Reject',
  escalate: 'Escalate',
};

export function noteIsRequired(action: CaseAction, riskLevel: RiskLevel): boolean {
  if (action === 'reject' || action === 'escalate') {
    return true;
  }
  if (action === 'approve' && riskLevel === 'high') {
    return true;
  }
  return false;
}

export function validateActionNote(
  action: CaseAction,
  riskLevel: RiskLevel,
  note: string,
): string | null {
  const trimmed = note.trim();

  if (action === 'reject' || action === 'escalate') {
    if (trimmed.length === 0) {
      return 'A note is required for this action.';
    }
    if (trimmed.length < 10) {
      return 'Note must be at least 10 characters.';
    }
    if (trimmed.length > 1000) {
      return 'Note must be at most 1000 characters.';
    }
    return null;
  }

  if (action === 'approve') {
    if (riskLevel === 'high' && trimmed.length === 0) {
      return 'A note is required when approving a high-risk case.';
    }
    if (trimmed.length > 1000) {
      return 'Note must be at most 1000 characters.';
    }
    return null;
  }

  if (trimmed.length > 1000) {
    return 'Note must be at most 1000 characters.';
  }
  return null;
}
