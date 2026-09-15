import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';

export type AuthEventType =
  | 'sign_in_succeeded'
  | 'sign_in_failed'
  | 'sign_in_throttled'
  | 'sign_out';

export interface AuthEvent {
  id: string;
  createdAt: string;
  event: AuthEventType;
  analystId: string | null;
  email: string | null;
  reason: string | null;
}

interface AuthEventRow {
  id: string;
  created_at: string;
  event: AuthEventType;
  analyst_id: string | null;
  email: string | null;
  reason: string | null;
}

export function recordAuthEvent(
  db: Db,
  event: AuthEventType,
  details: { analystId?: string | null; email?: string | null; reason?: string | null; now?: Date } = {},
): AuthEvent {
  const record: AuthEvent = {
    id: randomUUID(),
    createdAt: (details.now ?? new Date()).toISOString(),
    event,
    analystId: details.analystId ?? null,
    email: details.email ?? null,
    reason: details.reason ?? null,
  };
  db.prepare(`
    INSERT INTO auth_events (id, created_at, event, analyst_id, email, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(record.id, record.createdAt, record.event, record.analystId, record.email, record.reason);
  return record;
}

export function listAuthEvents(db: Db, limit = 100): AuthEvent[] {
  return db
    .prepare<[number], AuthEventRow>(
      'SELECT * FROM auth_events ORDER BY created_at DESC, id DESC LIMIT ?',
    )
    .all(limit)
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      event: row.event,
      analystId: row.analyst_id,
      email: row.email,
      reason: row.reason,
    }));
}
