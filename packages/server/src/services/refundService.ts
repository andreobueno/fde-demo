import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import type { Analyst, Refund, RefundAction, RefundDetail } from '../types.js';
import { ApiError, notFound, unauthorized } from '../errors.js';
import { hasPermission } from '../domain/authorization.js';
import { computeEventHash, GENESIS_HASH } from '../domain/audit.js';
import { getAllowedRefundActions, refundActionBodySchema, validateRefundAction } from '../domain/refunds.js';
import { getAnalyst } from '../repo/analysts.js';
import { insertAuditEvent, lastRefundAuditEvent, listRefundAuditEvents } from '../repo/audit.js';
import { getRefund, updateRefundStatus } from '../repo/refunds.js';

export function refundDetail(db: Db, refund: Refund, actor: Analyst): RefundDetail {
  return {
    ...refund,
    audit: listRefundAuditEvents(db, refund.id),
    allowedActions: getAllowedRefundActions(refund.status, actor.role, refund.riskLevel, refund.amountCents),
    approvalNoteRequired: true,
  };
}

export function applyRefundAction(
  db: Db, refundId: string, context: Analyst, action: RefundAction, note: string,
): RefundDetail {
  return db.transaction(() => {
    const actor = getAnalyst(db, context.id);
    if (!actor) throw unauthorized('Unknown analyst context.');
    if (!hasPermission(actor.role, 'refunds:read') || !hasPermission(actor.role, 'audit:read')) {
      throw new ApiError(403, 'FORBIDDEN', 'Insufficient permission.');
    }
    const parsed = refundActionBodySchema.safeParse({ action, note });
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid refund action body.', parsed.error.issues);
    }
    const refund = getRefund(db, refundId);
    if (!refund) throw notFound(`Refund '${refundId}' not found.`);
    const result = validateRefundAction({
      status: refund.status, riskLevel: refund.riskLevel, amountCents: refund.amountCents,
      role: actor.role, ...parsed.data,
    });
    if (!result.ok) {
      const status = result.error.code === 'INVALID_TRANSITION' ? 409 :
        result.error.code === 'FORBIDDEN' ? 403 : 400;
      throw new ApiError(status, result.error.code, result.error.message);
    }
    const now = new Date().toISOString();
    updateRefundStatus(db, refund.id, result.toStatus, now);
    const last = lastRefundAuditEvent(db, refund.id);
    const prevHash = last?.hash ?? GENESIS_HASH;
    const fields = {
      refundId: refund.id,
      sequence: (last?.sequence ?? 0) + 1,
      actorId: actor.id,
      action: parsed.data.action,
      fromStatus: refund.status,
      toStatus: result.toStatus,
      note: parsed.data.note,
      createdAt: now,
    };
    insertAuditEvent(db, {
      id: randomUUID(), ...fields, actorName: actor.name, prevHash,
      hash: computeEventHash(prevHash, fields),
    });
    const updated = getRefund(db, refund.id);
    if (!updated) throw new ApiError(500, 'INTERNAL', 'Refund disappeared during update.');
    return refundDetail(db, updated, actor);
  }).immediate();
}
