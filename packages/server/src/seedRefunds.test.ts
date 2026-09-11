import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from './db.js';
import { seedRefunds } from './seedRefunds.js';
import { refundFixtureContext, REFUND_ACTORS, REFUND_NOTE, REFUND_TIME } from './refundFixtures.js';
import { verifyChain } from './domain/audit.js';
import { getAllowedRefundActions } from './domain/refunds.js';
import { listRefundAuditEvents } from './repo/audit.js';
import { listRefunds, refundStats } from './repo/refunds.js';
import { getAnalyst } from './repo/analysts.js';
import { applyRefundAction } from './services/refundService.js';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); vi.useRealTimers(); });

describe('additive fictional refund seeding', () => {
  it('requires existing demo customers and never creates customer records', () => {
    expect(() => seedRefunds(db)).toThrow(/npm run seed.*fictional demo database/);
    expect(db.prepare('SELECT * FROM customers').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM refunds').all()).toEqual([]);
  });
  it('does not use customers outside the seeded fictional conventions', () => {
    refundFixtureContext(db);
    db.exec("UPDATE customers SET email = 'not-a-demo@example.test'");
    expect(() => seedRefunds(db)).toThrow(/No seeded fictional customers/);
    expect(db.prepare('SELECT * FROM refunds').all()).toEqual([]);
  });
  it('creates all risk/amount boundaries and truthful authorized hashed histories', () => {
    refundFixtureContext(db);
    const customers = db.prepare('SELECT * FROM customers').all();
    expect(seedRefunds(db, new Date(REFUND_TIME))).toBe(18);
    const refunds = listRefunds(db, { amountBand: 'all', sort: 'reference', order: 'asc', page: 1, pageSize: 100 }).items;
    const pending = refunds.filter((refund) => refund.status === 'pending');
    expect(pending).toHaveLength(12);
    for (const riskLevel of ['low', 'medium', 'high']) {
      expect(pending.filter((refund) => refund.riskLevel === riskLevel).map((refund) => refund.amountCents))
        .toEqual([99999, 100000, 500000, 500001]);
    }
    for (const refund of refunds) {
      const events = listRefundAuditEvents(db, refund.id);
      expect(verifyChain(events)).toBe(true);
      expect(events[0]).toMatchObject({ action: 'REFUND_CREATED', fromStatus: null, toStatus: 'pending', sequence: 1 });
      expect(events[0]!.createdAt).toBe(refund.createdAt);
      expect(events.at(-1)!.toStatus).toBe(refund.status);
      expect(events.at(-1)!.createdAt).toBe(refund.updatedAt);
      expect(Date.parse(refund.originalTransaction.occurredAt)).toBeLessThan(Date.parse(refund.createdAt));
      if (refund.status !== 'pending') {
        const decision = events[1]!;
        const actor = getAnalyst(db, decision.actorId)!;
        expect(events).toHaveLength(2);
        expect(getAllowedRefundActions('pending', actor.role, refund.riskLevel, refund.amountCents))
          .toContain(decision.action);
        expect(Date.parse(decision.createdAt)).toBeGreaterThan(Date.parse(refund.createdAt));
      }
    }
    expect(refundStats(db, new Date(REFUND_TIME))).toEqual({
      pendingCount: 12, pendingAmountCents: pending.reduce((sum, refund) => sum + refund.amountCents, 0),
      approvedToday: 1, rejectedToday: 1,
    });
    expect(db.prepare('SELECT * FROM customers').all()).toEqual(customers);
  });
  it('retains all decisions and audit bytes on repeated seeds, including a later day', () => {
    refundFixtureContext(db);
    seedRefunds(db, new Date(REFUND_TIME));
    vi.useFakeTimers().setSystemTime(new Date(REFUND_TIME));
    applyRefundAction(db, 'refund-001', REFUND_ACTORS.senior_analyst, 'approve', REFUND_NOTE);
    const refunds = db.prepare('SELECT * FROM refunds ORDER BY id').all();
    const audit = db.prepare('SELECT * FROM audit_events ORDER BY id').all();
    expect(seedRefunds(db, new Date('2026-09-20T12:00:00.000Z'))).toBe(0);
    expect(db.prepare('SELECT * FROM refunds ORDER BY id').all()).toEqual(refunds);
    expect(db.prepare('SELECT * FROM audit_events ORDER BY id').all()).toEqual(audit);
    expect(refundStats(db, new Date(REFUND_TIME))).toMatchObject({ pendingCount: 11, approvedToday: 2 });
    expect(refundStats(db, new Date('2026-09-20T12:00:00.000Z'))).toMatchObject({ approvedToday: 0, rejectedToday: 0 });
  });
  it('works with older seeded analyst roles without creating a manager', () => {
    refundFixtureContext(db);
    db.prepare('DELETE FROM analysts WHERE id = ?').run(REFUND_ACTORS.compliance_manager.id);
    expect(seedRefunds(db, new Date(REFUND_TIME))).toBe(18);
    expect(db.prepare("SELECT * FROM analysts WHERE role = 'compliance_manager'").all()).toEqual([]);
  });
  it('rolls back the entire batch if a shared audit append fails', () => {
    refundFixtureContext(db);
    db.exec(`CREATE TRIGGER fail_seed BEFORE INSERT ON audit_events
      WHEN NEW.refund_id = 'refund-005'
      BEGIN SELECT RAISE(ABORT, 'simulated seed audit failure'); END;`);
    expect(() => seedRefunds(db)).toThrow(/simulated seed audit failure/);
    expect(db.prepare('SELECT * FROM refunds').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM audit_events').all()).toEqual([]);
  });
});
