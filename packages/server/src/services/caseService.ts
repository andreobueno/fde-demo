import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { ApiError, notFound, unauthorized } from '../errors.js';
import { computeEventHash, GENESIS_HASH } from '../domain/audit.js';
import { getAllowedActions, validateAction, actionBodySchema } from '../domain/transitions.js';
import { hasPermission } from '../domain/authorization.js';
import { approvalNoteRequired } from '../domain/policy.js';
import { getCase, updateCaseStatus } from '../repo/cases.js';
import { insertAuditEvent, lastAuditEvent, listAuditEvents } from '../repo/audit.js';
import { getAnalyst } from '../repo/analysts.js';
import { getPolicy } from '../repo/policy.js';
import type { Analyst, AuditEvent, CaseAction, KycCase } from '../types.js';

export interface CaseActionResult {
  case: KycCase;
  audit: AuditEvent[];
  allowedActions: CaseAction[];
  approvalNoteRequired: boolean;
}

export function applyCaseAction(
  db: Db,
  caseId: string,
  context: Analyst,
  action: CaseAction,
  note: string | undefined,
): CaseActionResult {
  const txn = db.transaction((): CaseActionResult => {
    const actor = getAnalyst(db, context.id);
    if (!actor) throw unauthorized('Unknown analyst context.');
    if (!hasPermission(actor.role, 'cases:read')) {
      throw new ApiError(403, 'FORBIDDEN', 'Insufficient permission.');
    }
    const parsed = actionBodySchema.safeParse({ action, ...(note !== undefined ? { note } : {}) });
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid action body.', parsed.error.issues);
    }
    const kase = getCase(db, caseId);
    if (!kase) throw notFound(`Case '${caseId}' not found.`);
    const policy = getPolicy(db);

    const result = validateAction({
      status: kase.status,
      role: actor.role,
      riskLevel: kase.riskLevel,
      action,
      note,
      requireApprovalNote: policy.requireApprovalNote,
    });
    if (!result.ok) {
      const status =
        result.error.code === 'INVALID_TRANSITION'
          ? 409
          : result.error.code === 'FORBIDDEN'
            ? 403
            : 400;
      throw new ApiError(status, result.error.code, result.error.message);
    }

    const now = new Date().toISOString();
    updateCaseStatus(db, kase.id, result.toStatus, actor.id, now);

    const last = lastAuditEvent(db, kase.id);
    const sequence = (last?.sequence ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const fields = {
      caseId: kase.id,
      sequence,
      actorId: actor.id,
      action,
      fromStatus: kase.status,
      toStatus: result.toStatus,
      note: note?.trim() || null,
      createdAt: now,
    };
    const event: AuditEvent = {
      id: randomUUID(),
      ...fields,
      actorName: actor.name,
      prevHash,
      hash: computeEventHash(prevHash, fields),
    };
    insertAuditEvent(db, event);

    const updated = getCase(db, kase.id);
    if (!updated) throw new ApiError(500, 'INTERNAL', 'Case disappeared during update.');
    return {
      case: updated,
      audit: listAuditEvents(db, kase.id),
      allowedActions: getAllowedActions(updated.status, actor.role, updated.riskLevel),
      approvalNoteRequired: approvalNoteRequired(updated.riskLevel, policy),
    };
  });

  return txn.immediate();
}
