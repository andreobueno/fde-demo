import { z } from 'zod';
import type { AnalystRole, CaseAction, CaseStatus, RiskLevel } from '../types.js';

export const actionBodySchema = z.object({
  action: z.enum(['approve', 'reject', 'escalate', 'start_review']),
  note: z.string().max(1000).optional(),
});

export type ActionBody = z.infer<typeof actionBodySchema>;

export type ActionErrorCode = 'INVALID_TRANSITION' | 'VALIDATION_ERROR' | 'FORBIDDEN';

export type ActionResult =
  | { ok: true; toStatus: CaseStatus }
  | { ok: false; error: { code: ActionErrorCode; message: string } };

const TARGET_STATUS: Record<CaseAction, CaseStatus> = {
  start_review: 'in_review',
  approve: 'approved',
  reject: 'rejected',
  escalate: 'escalated',
};

export function getAllowedActions(status: CaseStatus, role: AnalystRole): CaseAction[] {
  switch (status) {
    case 'pending':
      return ['start_review', 'approve', 'reject', 'escalate'];
    case 'in_review':
      return ['approve', 'reject', 'escalate'];
    case 'escalated':
      return role === 'senior_analyst' ? ['approve', 'reject'] : [];
    case 'approved':
    case 'rejected':
      return [];
  }
}

export function validateAction(input: {
  status: CaseStatus;
  role: AnalystRole;
  riskLevel: RiskLevel;
  action: CaseAction;
  note?: string | undefined;
}): ActionResult {
  const { status, role, riskLevel, action, note } = input;
  const toStatus = TARGET_STATUS[action];

  const transitionAllowed = (() => {
    if (action === 'start_review') return status === 'pending';
    if (status === 'pending' || status === 'in_review') {
      return action === 'approve' || action === 'reject' || action === 'escalate';
    }
    if (status === 'escalated') {
      return action === 'approve' || action === 'reject';
    }
    return false;
  })();

  if (!transitionAllowed) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TRANSITION',
        message: `Cannot perform '${action}' on a case with status '${status}'.`,
      },
    };
  }

  if (status === 'escalated' && role !== 'senior_analyst') {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: `Resolving an escalated case requires role 'senior_analyst'.`,
      },
    };
  }

  const trimmed = note?.trim() ?? '';
  if ((action === 'reject' || action === 'escalate') && (trimmed.length < 10 || trimmed.length > 1000)) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `A note of 10..1000 characters is required to ${action} a case.`,
      },
    };
  }

  if (note !== undefined && trimmed.length > 1000) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Note must be at most 1000 characters.',
      },
    };
  }

  if (
    action === 'approve' &&
    riskLevel === 'high' &&
    (status === 'pending' || status === 'in_review') &&
    trimmed.length === 0
  ) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Approving a high-risk case requires a note.',
      },
    };
  }

  return { ok: true, toStatus };
}
