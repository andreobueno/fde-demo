import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { Refund, RefundAction, RiskLevel } from './types.js';
import { computeEventHash, GENESIS_HASH } from './domain/audit.js';
import { getAllowedRefundActions } from './domain/refunds.js';
import { listAnalysts } from './repo/analysts.js';
import { insertAuditEvent } from './repo/audit.js';
import { getRefund, insertRefund, updateRefundStatus } from './repo/refunds.js';

const DAY = 86400000;
const INDICATORS: Record<RiskLevel, Refund['riskIndicators']> = {
  low: [{
    code: 'TRANSACTION_MATCHED', title: 'Original transaction matched', severity: 'low',
    description: 'Fictional demo evidence: receipt and original transaction reference match.',
  }],
  medium: [{
    code: 'REPEAT_REQUEST', title: 'Repeated refund requests', severity: 'medium',
    description: 'Fictional demo evidence: two prior refund requests within 30 days.',
  }],
  high: [{
    code: 'EVIDENCE_MISMATCH', title: 'Supporting evidence mismatch', severity: 'high',
    description: 'Fictional demo evidence: submitted receipt details differ from the original transaction.',
  }],
};
const REASONS = [
  'Duplicate charge reported by the fictional customer.',
  'Order cancelled before fulfilment in the demo scenario.',
  'Returned item confirmed in fictional merchant records.',
];

export function seedRefunds(db: Db, now = new Date()): number {
  return db.transaction(() => {
    const customers = db.prepare<[], { id: string; email: string }>(
      'SELECT id, email FROM customers ORDER BY id',
    ).all().filter((customer) =>
      /^cus-\d{3}$/.test(customer.id) && /@example-(mail|post|inbox)\.com$/.test(customer.email),
    );
    if (!customers.length) {
      throw new Error('No seeded fictional customers found. Run npm run seed on a separate fictional demo database; it destructively resets that database.');
    }
    const analysts = listAnalysts(db);
    const creator = analysts[0];
    if (!creator) throw new Error('No analysts found. Run npm run seed on a separate fictional demo database.');
    let added = 0;
    for (let index = 0; index < 18; index++) {
      const ordinal = String(index + 1).padStart(3, '0');
      const id = `refund-${ordinal}`;
      if (getRefund(db, id)) continue;
      const customer = customers[index % customers.length]!;
      const amountCents = index < 12
        ? [99999, 100000, 500000, 500001][index % 4]!
        : [4999, 100000, 500000][index % 3]!;
      const riskLevel: RiskLevel = index < 12
        ? (['low', 'medium', 'high'] as const)[Math.floor(index / 4)]!
        : index % 2 === 0 ? 'low' : 'medium';
      const createdAt = new Date(now.getTime() - (index + 8) * DAY).toISOString();
      const decision: RefundAction | null = index < 12 ? null : index % 2 === 0 ? 'approve' : 'reject';
      const actor = decision ? analysts.find((analyst) =>
        getAllowedRefundActions('pending', analyst.role, riskLevel, amountCents).includes(decision),
      ) : creator;
      if (!actor) {
        throw new Error('No existing analyst can decide a seeded refund. Seed a separate fictional demo database with npm run seed.');
      }
      insertRefund(db, {
        id, reference: `RFD-DEMO-${ordinal}`, customerId: customer.id, amountCents, currency: 'USD',
        status: 'pending', riskLevel, reason: REASONS[index % REASONS.length]!,
        originalTransaction: {
          reference: `TXN-DEMO-${ordinal}`, amountCents: amountCents + 25000,
          occurredAt: new Date(Date.parse(createdAt) - 7 * DAY).toISOString(),
        },
        riskIndicators: INDICATORS[riskLevel], createdAt, updatedAt: createdAt,
      });
      const creation = {
        refundId: id, sequence: 1, actorId: creator.id, action: 'REFUND_CREATED',
        fromStatus: null, toStatus: 'pending' as const,
        note: 'Fictional refund request created for the operations demo.', createdAt,
      };
      const creationHash = computeEventHash(GENESIS_HASH, creation);
      insertAuditEvent(db, {
        id: randomUUID(), ...creation, actorName: creator.name,
        prevHash: GENESIS_HASH, hash: creationHash,
      });
      if (decision) {
        const decidedAt = new Date(now.getTime() - Math.floor((index - 12) / 2) * DAY).toISOString();
        const toStatus = decision === 'approve' ? 'approved' : 'rejected';
        updateRefundStatus(db, id, toStatus, decidedAt);
        const fields = {
          refundId: id, sequence: 2, actorId: actor.id, action: decision,
          fromStatus: 'pending' as const, toStatus,
          note: decision === 'approve'
            ? 'Fictional supporting evidence reviewed; refund request approved.'
            : 'Fictional supporting evidence insufficient; refund request rejected.',
          createdAt: decidedAt,
        } as const;
        insertAuditEvent(db, {
          id: randomUUID(), ...fields, actorName: actor.name, prevHash: creationHash,
          hash: computeEventHash(creationHash, fields),
        });
      }
      added++;
    }
    return added;
  }).immediate();
}
