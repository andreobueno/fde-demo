import type { Db } from '../db.js';
import type { AnalystRole } from '../types.js';
import { policySchema, type PolicyAuditEvent, type ReviewPolicy } from '../domain/policy.js';

interface PolicyRow {
  version: number;
  require_approval_note: number;
  updated_at: string;
  updated_by: string | null;
}

interface PolicyAuditRow {
  id: string;
  actor_id: string;
  actor_name: string;
  actor_role: AnalystRole;
  action: 'policy_updated';
  created_at: string;
  reason: string;
  previous_state: string;
  new_state: string;
  prev_hash: string;
  hash: string;
}

export function getPolicy(db: Db): ReviewPolicy {
  const row = db.prepare<[], PolicyRow>('SELECT * FROM review_policy WHERE id = 1').get();
  if (!row) throw new Error('Review policy is missing.');
  return {
    version: row.version,
    requireApprovalNote: row.require_approval_note === 1,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function savePolicy(db: Db, policy: ReviewPolicy): void {
  db.prepare(`
    UPDATE review_policy
    SET version = ?, require_approval_note = ?, updated_at = ?, updated_by = ?
    WHERE id = 1
  `).run(policy.version, Number(policy.requireApprovalNote), policy.updatedAt, policy.updatedBy);
}

export function lastPolicyHash(db: Db): string | undefined {
  return db.prepare<[], { hash: string }>(
    'SELECT hash FROM policy_audit_events ORDER BY version DESC LIMIT 1',
  ).get()?.hash;
}

export function insertPolicyAuditEvent(db: Db, event: PolicyAuditEvent): void {
  db.prepare(`
    INSERT INTO policy_audit_events
      (id, version, actor_id, actor_name, actor_role, action, created_at,
       reason, previous_state, new_state, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id, event.newState.version, event.actorId, event.actorName, event.actorRole,
    event.action, event.createdAt, event.reason, JSON.stringify(event.previousState),
    JSON.stringify(event.newState), event.prevHash, event.hash,
  );
}

export function listPolicyAuditEvents(db: Db): PolicyAuditEvent[] {
  return db.prepare<[], PolicyAuditRow>(
    'SELECT * FROM policy_audit_events ORDER BY version ASC',
  ).all().map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    action: row.action,
    createdAt: row.created_at,
    reason: row.reason,
    previousState: policySchema.parse(JSON.parse(row.previous_state)),
    newState: policySchema.parse(JSON.parse(row.new_state)),
    prevHash: row.prev_hash,
    hash: row.hash,
  }));
}
