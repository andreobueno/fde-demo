import type { Db } from '../db.js';
import type { AuditEvent, CaseStatus, RefundAuditEvent } from '../types.js';

interface AuditRow {
  id: string;
  sequence: number;
  actor_id: string;
  actor_name: string;
  action: string;
  from_status: CaseStatus | null;
  to_status: CaseStatus | null;
  note: string | null;
  created_at: string;
  prev_hash: string;
  hash: string;
}

function auditFields(row: AuditRow): Omit<AuditEvent, 'caseId'> {
  return {
    id: row.id,
    sequence: row.sequence,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    createdAt: row.created_at,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

function caseEvent(row: AuditRow & { case_id: string }): AuditEvent {
  return { ...auditFields(row), caseId: row.case_id };
}

function refundEvent(row: AuditRow & { refund_id: string }): RefundAuditEvent {
  return { ...auditFields(row), refundId: row.refund_id };
}

export function listAuditEvents(db: Db, caseId: string): AuditEvent[] {
  return db
    .prepare<[string], AuditRow & { case_id: string }>(
      'SELECT * FROM audit_events WHERE case_id = ? ORDER BY sequence ASC',
    )
    .all(caseId)
    .map(caseEvent);
}

export function lastAuditEvent(db: Db, caseId: string): AuditEvent | null {
  const row = db
    .prepare<[string], AuditRow & { case_id: string }>(
      'SELECT * FROM audit_events WHERE case_id = ? ORDER BY sequence DESC LIMIT 1',
    )
    .get(caseId);
  return row ? caseEvent(row) : null;
}

export function listRefundAuditEvents(db: Db, refundId: string): RefundAuditEvent[] {
  return db.prepare<[string], AuditRow & { refund_id: string }>(
    'SELECT * FROM audit_events WHERE refund_id = ? ORDER BY sequence ASC',
  ).all(refundId).map(refundEvent);
}

export function lastRefundAuditEvent(db: Db, refundId: string): RefundAuditEvent | null {
  const row = db.prepare<[string], AuditRow & { refund_id: string }>(
    'SELECT * FROM audit_events WHERE refund_id = ? ORDER BY sequence DESC LIMIT 1',
  ).get(refundId);
  return row ? refundEvent(row) : null;
}

export function insertAuditEvent(db: Db, event: AuditEvent | RefundAuditEvent): void {
  db.prepare(
    `INSERT INTO audit_events
     (id, case_id, refund_id, sequence, actor_id, actor_name, action, from_status, to_status,
      note, created_at, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    'refundId' in event ? null : event.caseId,
    'refundId' in event ? event.refundId : null,
    event.sequence,
    event.actorId,
    event.actorName,
    event.action,
    event.fromStatus,
    event.toStatus,
    event.note,
    event.createdAt,
    event.prevHash,
    event.hash,
  );
}
