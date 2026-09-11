import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { ApiError, unauthorized } from '../errors.js';
import { hasPermission } from '../domain/authorization.js';
import { GENESIS_HASH } from '../domain/audit.js';
import {
  computePolicyEventHash,
  policyUpdateSchema,
  type PolicyAuditEvent,
  type PolicyUpdate,
  type ReviewPolicy,
} from '../domain/policy.js';
import { getAnalyst } from '../repo/analysts.js';
import { getPolicy, insertPolicyAuditEvent, lastPolicyHash, savePolicy } from '../repo/policy.js';

export function updatePolicy(db: Db, actorId: string, input: PolicyUpdate): ReviewPolicy {
  return db.transaction(() => {
    const actor = getAnalyst(db, actorId);
    if (!actor) throw unauthorized('Unknown analyst context.');
    if (!hasPermission(actor.role, 'policy:manage')) {
      throw new ApiError(403, 'FORBIDDEN', 'Only compliance managers can manage policy.');
    }
    const parsed = policyUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid policy update.', parsed.error.issues);
    }
    const previousState = getPolicy(db);
    if (parsed.data.version !== previousState.version) {
      throw new ApiError(409, 'POLICY_CONFLICT', 'Policy changed. Reload before saving.');
    }
    if (parsed.data.requireApprovalNote === previousState.requireApprovalNote) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Policy update must change a setting.');
    }
    const now = new Date().toISOString();
    const newState: ReviewPolicy = {
      version: previousState.version + 1,
      requireApprovalNote: parsed.data.requireApprovalNote,
      updatedAt: now,
      updatedBy: actor.id,
    };
    const fields: Omit<PolicyAuditEvent, 'hash'> = {
      id: randomUUID(),
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'policy_updated',
      createdAt: now,
      reason: parsed.data.reason,
      previousState,
      newState,
      prevHash: lastPolicyHash(db) ?? GENESIS_HASH,
    };
    savePolicy(db, newState);
    insertPolicyAuditEvent(db, { ...fields, hash: computePolicyEventHash(fields) });
    return newState;
  }).immediate();
}
