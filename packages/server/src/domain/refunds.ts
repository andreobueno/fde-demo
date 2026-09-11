import { z } from 'zod';
import type { AnalystRole, RefundAction, RefundStatus, RiskLevel } from '../types.js';
import type { ActionErrorCode } from './transitions.js';
import { hasPermission } from './authorization.js';

export const REFUND_ACTIONS = ['approve', 'reject'] as const;
export const REFUND_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const REFUND_SORTS = ['reference', 'customer', 'amountCents', 'status', 'riskLevel', 'createdAt'] as const;
export const REFUND_AMOUNT_BANDS = ['all', 'under_1000', '1000_to_5000', 'over_5000'] as const;
export type RefundSort = (typeof REFUND_SORTS)[number];
export type RefundAmountBand = (typeof REFUND_AMOUNT_BANDS)[number];

export const refundActionBodySchema = z.object({
  action: z.enum(REFUND_ACTIONS),
  note: z.string().trim().min(10).max(1000),
}).strict();

const cents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const riskLevel = z.enum(['low', 'medium', 'high']);
export const refundIndicatorsSchema = z.array(z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  severity: riskLevel,
}).strict());

export const refundRecordSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  customerId: z.string().min(1),
  amountCents: cents,
  currency: z.literal('USD'),
  status: z.enum(REFUND_STATUSES),
  riskLevel,
  reason: z.string().trim().min(1).max(1000),
  originalTransaction: z.object({
    reference: z.string().min(1),
    amountCents: cents,
    occurredAt: z.string().datetime(),
  }).strict(),
  riskIndicators: refundIndicatorsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict().refine((refund) => refund.amountCents <= refund.originalTransaction.amountCents, {
  message: 'Refund amount cannot exceed the original transaction amount.',
  path: ['amountCents'],
});
export type RefundRecord = z.infer<typeof refundRecordSchema>;

type RefundActionResult =
  | { ok: true; toStatus: RefundStatus }
  | { ok: false; error: { code: ActionErrorCode; message: string } };

interface RefundTransitionInput {
  status: RefundStatus;
  role: AnalystRole;
  riskLevel: RiskLevel;
  amountCents: number;
  action: RefundAction;
}

function validateRefundTransition(input: RefundTransitionInput): RefundActionResult {
  const { status, role, riskLevel, amountCents, action } = input;
  if (status !== 'pending' || !REFUND_ACTIONS.includes(action)) {
    return {
      ok: false,
      error: { code: 'INVALID_TRANSITION', message: `Cannot perform '${action}' on a '${status}' refund.` },
    };
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Refund amount must be positive integer cents.' } };
  }
  const permitted = hasPermission(role, 'refunds:read') && (
    hasPermission(role, 'refunds:decide_high') ||
    ((riskLevel === 'low' || riskLevel === 'medium') && amountCents <= 500000 &&
      hasPermission(role, 'refunds:decide_low_medium'))
  );
  if (!permitted) {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Your role does not permit deciding this refund risk and amount.' },
    };
  }
  return { ok: true, toStatus: action === 'approve' ? 'approved' : 'rejected' };
}

export function getAllowedRefundActions(
  status: RefundStatus, role: AnalystRole, riskLevel: RiskLevel, amountCents: number,
): RefundAction[] {
  return REFUND_ACTIONS.filter((action) =>
    validateRefundTransition({ status, role, riskLevel, amountCents, action }).ok,
  );
}

export function validateRefundAction(input: RefundTransitionInput & { note: string }): RefundActionResult {
  const transition = validateRefundTransition(input);
  if (!transition.ok) return transition;
  if (!refundActionBodySchema.safeParse({ action: input.action, note: input.note }).success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'A note of 10..1000 characters is required to decide a refund.' },
    };
  }
  return transition;
}
