import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { openDb, type Db } from '../db.js';
import { computeEventHash, GENESIS_HASH, verifyChain } from '../domain/audit.js';
import { insertAuditEvent, lastAuditEvent, listAuditEvents, listRefundAuditEvents } from '../repo/audit.js';
import { getRefund } from '../repo/refunds.js';
import { applyRefundAction, refundDetail } from './refundService.js';
import { addRefund, refundFixtureContext, REFUND_ACTORS, REFUND_NOTE } from '../refundFixtures.js';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); refundFixtureContext(db); addRefund(db); });
afterEach(() => { db.close(); vi.restoreAllMocks(); });
const senior = REFUND_ACTORS.senior_analyst;
const manager = REFUND_ACTORS.compliance_manager;

describe('refund service transaction', () => {
  it.each(['approve', 'reject'] as const)('atomically records %s with server identity and exact refund hash format', (action) => {
    const result = applyRefundAction(db, 'refund-test', { ...senior, name: 'Forged' }, action, `  ${REFUND_NOTE}  `);
    expect(result).toMatchObject({
      status: action === 'approve' ? 'approved' : 'rejected', allowedActions: [], approvalNoteRequired: true,
    });
    const event = result.audit[1]!;
    expect(event).toMatchObject({
      actorId: senior.id, actorName: senior.name, refundId: 'refund-test', action,
      note: REFUND_NOTE, fromStatus: 'pending', toStatus: result.status,
      sequence: 2, createdAt: result.updatedAt, prevHash: result.audit[0]!.hash,
    });
    expect(event).not.toHaveProperty('caseId');
    const canonical = JSON.stringify({
      action, actorId: senior.id, refundId: 'refund-test', createdAt: result.updatedAt,
      fromStatus: 'pending', note: REFUND_NOTE, sequence: 2, toStatus: result.status,
    });
    expect(event.hash).toBe(createHash('sha256').update(event.prevHash + canonical).digest('hex'));
    expect(verifyChain(result.audit)).toBe(true);
    expect(verifyChain([{ ...event, note: 'forged' }])).toBe(false);
    for (const retry of ['approve', 'reject'] as const) {
      expect(() => applyRefundAction(db, result.id, manager, retry, REFUND_NOTE))
        .toThrowError(expect.objectContaining({ status: 409 }));
    }
    expect(listRefundAuditEvents(db, result.id)).toEqual(result.audit);
  });
  it('rolls back all state when the shared audit append fails', () => {
    const before = getRefund(db, 'refund-test');
    const history = listRefundAuditEvents(db, 'refund-test');
    db.exec(`CREATE TRIGGER fail_refund_audit BEFORE INSERT ON audit_events
      WHEN NEW.refund_id IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'simulated audit outage'); END;`);
    expect(() => applyRefundAction(db, 'refund-test', senior, 'approve', REFUND_NOTE))
      .toThrow(/simulated audit outage/);
    expect(getRefund(db, 'refund-test')).toEqual(before);
    expect(listRefundAuditEvents(db, 'refund-test')).toEqual(history);
  });
  it('resolves saved role within a transaction, rejecting forged and revoked contexts', () => {
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('FROM analysts') || sql.includes('FROM refunds')) expect(db.inTransaction).toBe(true);
      return prepare(sql);
    });
    db.prepare("UPDATE analysts SET role = 'analyst' WHERE id = ?").run(senior.id);
    expect(() => applyRefundAction(db, 'refund-test', { ...senior, role: 'compliance_manager' }, 'approve', REFUND_NOTE))
      .toThrowError(expect.objectContaining({ status: 403 }));
    spy.mockRestore();
    expect(listRefundAuditEvents(db, 'refund-test')).toHaveLength(1);
  });
  it.each([
    "UPDATE refunds SET risk_level = 'high' WHERE id = 'refund-test'",
    "UPDATE refunds SET amount_cents = 500001 WHERE id = 'refund-test'",
  ])('re-reads saved eligibility after a detail response: %s', (sql) => {
    const before = refundDetail(db, getRefund(db, 'refund-test')!, senior);
    expect(before.allowedActions).toEqual(['approve', 'reject']);
    db.exec(sql);
    expect(() => applyRefundAction(db, 'refund-test', senior, 'reject', REFUND_NOTE))
      .toThrowError(expect.objectContaining({ status: 403 }));
    expect(listRefundAuditEvents(db, 'refund-test')).toHaveLength(1);
  });
  it('keeps refunds note policy mandatory when KYC policy disables approval notes', () => {
    db.exec('UPDATE review_policy SET require_approval_note = 0');
    expect(refundDetail(db, getRefund(db, 'refund-test')!, senior).approvalNoteRequired).toBe(true);
    expect(() => applyRefundAction(db, 'refund-test', senior, 'approve', ''))
      .toThrowError(expect.objectContaining({ status: 400 }));
  });
  it('returns missing refund and identity errors without appends', () => {
    expect(() => applyRefundAction(db, 'missing', senior, 'approve', REFUND_NOTE))
      .toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => applyRefundAction(db, 'refund-test', { ...senior, id: 'missing' }, 'approve', REFUND_NOTE))
      .toThrowError(expect.objectContaining({ status: 401 }));
  });
});

describe('shared audit invariants', () => {
  it.each([
    "UPDATE audit_events SET note = 'forged' WHERE refund_id = 'refund-test'",
    "DELETE FROM audit_events WHERE refund_id = 'refund-test'",
    "INSERT OR REPLACE INTO audit_events SELECT * FROM audit_events WHERE refund_id = 'refund-test'",
  ])('rejects history tampering: %s', (sql) => {
    const before = listRefundAuditEvents(db, 'refund-test');
    expect(() => db.exec(sql)).toThrow(/append-only/);
    expect(listRefundAuditEvents(db, 'refund-test')).toEqual(before);
  });
  it('isolates matching textual case and refund IDs in the same audit table', () => {
    db.prepare(`INSERT INTO cases VALUES
      ('refund-test', 'KYC-TEST', 'cus-001', 'pending', 'low', 10, NULL, '2026-09-01', '2026-09-01')`).run();
    const fields = {
      caseId: 'refund-test', sequence: 1, actorId: senior.id, action: 'CASE_CREATED',
      fromStatus: null, toStatus: 'pending' as const, note: REFUND_NOTE, createdAt: '2026-09-01',
    };
    insertAuditEvent(db, {
      id: 'case-creation', ...fields, actorName: senior.name, prevHash: GENESIS_HASH,
      hash: computeEventHash(GENESIS_HASH, fields),
    });
    const caseEvents = listAuditEvents(db, 'refund-test');
    const result = applyRefundAction(db, 'refund-test', senior, 'approve', REFUND_NOTE);
    expect(result.audit).toHaveLength(2);
    expect(result.audit.every((event) => event.refundId === 'refund-test' && !('caseId' in event))).toBe(true);
    expect(listAuditEvents(db, 'refund-test')).toEqual(caseEvents);
    expect(lastAuditEvent(db, 'refund-test')).toEqual(caseEvents[0]);
    expect(verifyChain(caseEvents)).toBe(true);
    expect(verifyChain(result.audit)).toBe(true);
    expect(caseEvents[0]!.hash).not.toBe(result.audit[0]!.hash);
    expect(() => db.exec(`INSERT INTO audit_events
      SELECT 'both', case_id, 'refund-test', 5, actor_id, actor_name, action,
      from_status, to_status, note, created_at, prev_hash, hash
      FROM audit_events WHERE case_id = 'refund-test'`)).toThrow(/CHECK/);
  });
  it('rejects subject-less and missing-refund audit events', () => {
    expect(() => db.exec(`INSERT INTO audit_events
      SELECT 'neither', NULL, NULL, 5, actor_id, actor_name, action,
      from_status, to_status, note, created_at, prev_hash, hash FROM audit_events`)).toThrow(/CHECK/);
    expect(() => db.exec(`INSERT INTO audit_events
      SELECT 'missing', NULL, 'absent', 5, actor_id, actor_name, action,
      from_status, to_status, note, created_at, prev_hash, hash FROM audit_events`)).toThrow(/FOREIGN KEY/);
  });
});
