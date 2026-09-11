import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db.js';
import { computeEventHash } from '../domain/audit.js';
import { addRefund, refundFixtureContext, REFUND_ACTORS, REFUND_NOTE, REFUND_TIME } from '../refundFixtures.js';
import { insertAuditEvent, lastRefundAuditEvent } from './audit.js';
import { getRefund, refundStats, updateRefundStatus } from './refunds.js';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); refundFixtureContext(db); });
afterEach(() => db.close());

describe('refund database money invariants', () => {
  beforeEach(() => { addRefund(db); });
  it.each([0, -1, 0.5, 'invalid', 1000001, Number.MAX_SAFE_INTEGER + 1])('rejects amount %s at the database', (amount) => {
    expect(() => db.prepare('UPDATE refunds SET amount_cents = ?').run(amount)).toThrow(/CHECK/);
    expect(getRefund(db, 'refund-test')?.amountCents).toBe(100000);
  });
  it.each([0, -1, 100000.5, 'invalid', Number.MAX_SAFE_INTEGER + 1])('rejects original amount %s at the database', (amount) => {
    expect(() => db.prepare('UPDATE refunds SET transaction_amount_cents = ?').run(amount)).toThrow(/CHECK/);
  });
  it('rejects non-USD currencies and unsupported states', () => {
    expect(() => db.exec("UPDATE refunds SET currency = 'EUR'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE refunds SET status = 'processing'")).toThrow(/CHECK/);
  });
});

describe('refund stats over actual UTC decisions', () => {
  it('returns zeroes for an empty database', () => {
    expect(refundStats(db)).toEqual({ pendingCount: 0, pendingAmountCents: 0, approvedToday: 0, rejectedToday: 0 });
  });
  it('uses exact UTC day bounds and counts each subject once', () => {
    const decisions = [
      { action: 'approve', time: '2026-09-10T23:59:59.999Z' },
      { action: 'approve', time: '2026-09-11T00:00:00.000Z' },
      { action: 'approve', time: '2026-09-11T23:59:59.999Z' },
      { action: 'reject', time: '2026-09-12T00:00:00.000Z' },
      { action: 'reject', time: '2026-09-11T00:30:00+01:00' },
      { action: 'reject', time: '2026-09-12T00:30:00+01:00' },
    ] as const;
    for (const [index, decision] of decisions.entries()) {
      const refund = addRefund(db, { id: `refund-${index}`, reference: `RFD-${index}` });
      const toStatus = decision.action === 'approve' ? 'approved' : 'rejected';
      const fields = {
        refundId: refund.id, sequence: 2, actorId: REFUND_ACTORS.senior_analyst.id,
        action: decision.action, fromStatus: 'pending' as const, toStatus,
        note: REFUND_NOTE, createdAt: decision.time,
      } as const;
      const prevHash = lastRefundAuditEvent(db, refund.id)!.hash;
      insertAuditEvent(db, {
        id: `decision-${index}`, ...fields, actorName: REFUND_ACTORS.senior_analyst.name,
        prevHash, hash: computeEventHash(prevHash, fields),
      });
      updateRefundStatus(db, refund.id, toStatus, '2026-10-01T00:00:00.000Z');
      if (index === 1) {
        const duplicate = { ...fields, sequence: 3 };
        const previous = lastRefundAuditEvent(db, refund.id)!.hash;
        insertAuditEvent(db, {
          id: 'duplicate-import', ...duplicate, actorName: REFUND_ACTORS.senior_analyst.name,
          prevHash: previous, hash: computeEventHash(previous, duplicate),
        });
      }
    }
    addRefund(db, { amountCents: 500001 });
    expect(refundStats(db, new Date(REFUND_TIME))).toEqual({
      pendingCount: 1, pendingAmountCents: 500001, approvedToday: 2, rejectedToday: 1,
    });
  });
});
