import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { ApiError, notFound } from '../errors.js';
import { computeEventHash, GENESIS_HASH } from '../domain/audit.js';
import { getAllowedActions, validateAction } from '../domain/transitions.js';
import { getCase, updateCaseStatus } from '../repo/cases.js';
import { insertAuditEvent, lastAuditEvent, listAuditEvents } from '../repo/audit.js';
import type { Analyst, AuditEvent, CaseAction, KycCase } from '../types.js';

export interface CaseActionResult {
  case: KycCase;
  audit: AuditEvent[];
  allowedActions: CaseAction[];
}

export function applyCaseAction(
  db: Db,
  caseId: string,
  actor: Analyst,
  action: CaseAction,
  note: string | undefined,
): CaseActionResult {
  const txn = db.transaction((): CaseActionResult => {
    const kase = getCase(db, caseId);
    if (!kase) throw notFound(`Case '${caseId}' not found.`);

    const result = validateAction({
      status: kase.status,
      role: actor.role,
      riskLevel: kase.riskLevel,
      action,
      note,
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
      note: note ?? null,
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
      allowedActions: getAllowedActions(updated.status, actor.role),
    };
  });

  return txn();
}
