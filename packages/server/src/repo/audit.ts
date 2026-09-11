import type { Db } from '../db.js';
import type { AuditEvent } from '../types.js';
import { rowToAuditEvent } from './mappers.js';

export function listAuditEvents(db: Db, caseId: string): AuditEvent[] {
  return db
    .prepare('SELECT * FROM audit_events WHERE case_id = ? ORDER BY sequence ASC')
    .all(caseId)
    .map(rowToAuditEvent);
}

export function lastAuditEvent(db: Db, caseId: string): AuditEvent | null {
  const row = db
    .prepare('SELECT * FROM audit_events WHERE case_id = ? ORDER BY sequence DESC LIMIT 1')
    .get(caseId);
  return row ? rowToAuditEvent(row) : null;
}

export function insertAuditEvent(db: Db, event: AuditEvent): void {
  db.prepare(
    `INSERT INTO audit_events
     (id, case_id, sequence, actor_id, actor_name, action, from_status, to_status, note, created_at, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    event.caseId,
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
