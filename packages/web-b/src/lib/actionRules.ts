import type { CaseAction, RiskLevel } from '@/api/types';
export const ACTION_LABELS: Record<CaseAction, string> = { start_review: 'Start review', approve: 'Approve', reject: 'Reject', escalate: 'Escalate' };
export const ACTION_ORDER: CaseAction[] = ['start_review', 'approve', 'reject', 'escalate'];
export function validateActionNote(action: CaseAction, note: string, riskLevel: RiskLevel): string | null {
  const length = note.trim().length;
  if (action === 'reject' || action === 'escalate') return length < 10 || length > 1000 ? 'A note of 10–1000 characters is required' : null;
  if (action === 'approve') {
    if (riskLevel === 'high' && length < 1) return 'A note is required to approve a high-risk case';
    return length > 1000 ? 'Note must be 1000 characters or fewer' : null;
  }
  return note.length > 1000 ? 'Note must be 1000 characters or fewer' : null;
}
