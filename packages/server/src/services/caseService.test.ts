import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db.js';
import { applyCaseAction } from './caseService.js';
import { computeEventHash, GENESIS_HASH, verifyChain } from '../domain/audit.js';
import { listAuditEvents } from '../repo/audit.js';
import type { Analyst, CaseStatus, RiskLevel } from '../types.js';
import { ApiError } from '../errors.js';

const SENIOR: Analyst = { id: 'ana-001', name: 'Senior One', role: 'senior_analyst' };
const ANALYST: Analyst = { id: 'ana-003', name: 'Analyst Three', role: 'analyst' };

let db: Db;

function insertCase(id: string, status: CaseStatus, riskLevel: RiskLevel = 'low'): void {
  db.prepare(`INSERT INTO customers (id, full_name, date_of_birth, nationality, country_of_residence,
    occupation, email, account_opened_at, expected_monthly_volume_usd, source_of_funds,
    id_document_type, id_document_verified, address_verified, pep_flag, sanctions_hit, adverse_media_hits)
    VALUES (?, 'Test Cust', '1990-01-01', 'US', 'US', 'teacher', 't@example.com', '2020-01-01',
    1000, 'salary', 'passport', 1, 1, 0, 0, 0)`).run(`${id}-cust`);
  db.prepare(`INSERT INTO cases (id, reference, customer_id, status, risk_level, risk_score,
    assigned_to, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 10, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).run(
    id, `REF-${id}`, `${id}-cust`, status, riskLevel,
  );
  // Properly hashed creation event (sequence 1) so the chain verifies.
  const fields = {
    caseId: id,
    sequence: 1,
    actorId: SENIOR.id,
    action: 'CASE_CREATED',
    fromStatus: null,
    toStatus: 'pending' as CaseStatus,
    note: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
  db.prepare(`INSERT INTO audit_events (id, case_id, sequence, actor_id, actor_name, action,
    from_status, to_status, note, created_at, prev_hash, hash)
    VALUES (?, ?, 1, 'ana-001', 'Senior One', 'CASE_CREATED', NULL, 'pending', NULL,
    '2026-01-01T00:00:00Z', ?, ?)`).run(
    `evt-${id}-1`, id, GENESIS_HASH, computeEventHash(GENESIS_HASH, fields),
  );
}

beforeEach(() => {
  db = openDb(':memory:');
  for (const a of [SENIOR, ANALYST]) {
    db.prepare('INSERT INTO analysts (id, name, role) VALUES (?, ?, ?)').run(a.id, a.name, a.role);
  }
});

describe('applyCaseAction', () => {
  it('approves a pending case: status, assignment, audit sequence 2, valid chain', () => {
    insertCase('c1', 'pending');
    const res = applyCaseAction(db, 'c1', SENIOR, 'approve', 'All checks passed fine.');
    expect(res.case.status).toBe('approved');
    expect(res.case.assignedTo).toBe('ana-001');
    expect(res.allowedActions).toEqual([]);
    const audit = listAuditEvents(db, 'c1');
    expect(audit).toHaveLength(2);
    expect(audit[1]?.sequence).toBe(2);
    expect(audit[1]?.action).toBe('approve');
    expect(audit[1]?.fromStatus).toBe('pending');
    expect(audit[1]?.toStatus).toBe('approved');
    expect(audit[1]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(audit)).toBe(true);
  });

  it('start_review moves pending → in_review', () => {
    insertCase('c2', 'pending');
    const res = applyCaseAction(db, 'c2', ANALYST, 'start_review', undefined);
    expect(res.case.status).toBe('in_review');
    expect(res.allowedActions).toEqual(['approve', 'reject', 'escalate']);
    expect(verifyChain(res.audit)).toBe(true);
  });

  it('throws INVALID_TRANSITION (409) for invalid action', () => {
    insertCase('c3', 'approved');
    try {
      applyCaseAction(db, 'c3', SENIOR, 'approve', undefined);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.code).toBe('INVALID_TRANSITION');
      expect(err.status).toBe(409);
    }
  });

  it('throws FORBIDDEN for analyst resolving escalated case', () => {
    insertCase('c4', 'escalated');
    try {
      applyCaseAction(db, 'c4', ANALYST, 'reject', 'reason reason reason');
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).code).toBe('FORBIDDEN');
      expect((e as ApiError).status).toBe(403);
    }
  });

  it('throws NOT_FOUND for unknown case', () => {
    try {
      applyCaseAction(db, 'nope', SENIOR, 'approve', undefined);
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).status).toBe(404);
    }
  });

  it('audit_events trigger rejects UPDATE', () => {
    insertCase('c5', 'pending');
    expect(() =>
      db.prepare("UPDATE audit_events SET note = 'x' WHERE case_id = 'c5'").run(),
    ).toThrowError(/append-only/);
  });

  it('audit_events trigger rejects DELETE', () => {
    insertCase('c5b', 'pending');
    expect(() =>
      db.prepare("DELETE FROM audit_events WHERE case_id = 'c5b'").run(),
    ).toThrowError(/append-only/);
  });
});
