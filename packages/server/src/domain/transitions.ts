import { z } from 'zod';
import type { AnalystRole, CaseAction, CaseStatus, RiskLevel } from '../types.js';
import { hasPermission } from './authorization.js';

export const actionBodySchema = z.object({
  action: z.enum(['approve', 'reject', 'escalate', 'start_review']),
  note: z.string().trim().max(1000).optional(),
}).strict();

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

function getLegalActions(status: CaseStatus): CaseAction[] {
  switch (status) {
    case 'pending':
      return ['start_review', 'approve', 'reject', 'escalate'];
    case 'in_review':
      return ['approve', 'reject', 'escalate'];
    case 'escalated':
      return ['approve', 'reject'];
    case 'approved':
    case 'rejected':
    default:
      return [];
  }
}

function canPerformAction(role: AnalystRole, action: CaseAction, riskLevel: RiskLevel): boolean {
  switch (action) {
    case 'start_review':
      return hasPermission(role, 'cases:review');
    case 'escalate':
      return hasPermission(role, 'cases:escalate');
    case 'approve':
    case 'reject':
      switch (riskLevel) {
        case 'low':
        case 'medium':
          return hasPermission(role, 'cases:decide_low_medium');
        case 'high':
          return hasPermission(role, 'cases:decide_high');
        default:
          return false;
      }
    default:
      return false;
  }
}

export function getAllowedActions(
  status: CaseStatus,
  role: AnalystRole,
  riskLevel: RiskLevel,
): CaseAction[] {
  return getLegalActions(status).filter((action) => canPerformAction(role, action, riskLevel));
}

export function validateAction(input: {
  status: CaseStatus;
  role: AnalystRole;
  riskLevel: RiskLevel;
  action: CaseAction;
  note?: string | undefined;
  requireApprovalNote?: boolean;
}): ActionResult {
  const { status, role, riskLevel, action, note, requireApprovalNote = true } = input;
  const toStatus = TARGET_STATUS[action];

  if (!getLegalActions(status).includes(action)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TRANSITION',
        message: `Cannot perform '${action}' on a case with status '${status}'.`,
      },
    };
  }

  if (!canPerformAction(role, action, riskLevel)) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: `Your role does not permit '${action}' on a '${riskLevel}' risk case.`,
      },
    };
  }

  const trimmed = note?.trim() ?? '';
  const noteRequired =
    action === 'reject' ||
    action === 'escalate' ||
    (action === 'approve' && (riskLevel === 'high' || requireApprovalNote));
  if (noteRequired && (trimmed.length < 10 || trimmed.length > 1000)) {
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

  return { ok: true, toStatus };
}
