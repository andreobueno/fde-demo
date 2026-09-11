import type { Db } from './db.js';
import type { Analyst } from './types.js';
import type { RefundRecord } from './domain/refunds.js';
import { computeEventHash, GENESIS_HASH } from './domain/audit.js';
import { insertAuditEvent } from './repo/audit.js';
import { insertRefund } from './repo/refunds.js';

export const REFUND_ACTORS = {
  analyst: { id: 'ana-003', name: 'Fictional Analyst', role: 'analyst' },
  senior_analyst: { id: 'ana-001', name: 'Fictional Senior', role: 'senior_analyst' },
  compliance_manager: { id: 'ana-006', name: 'Fictional Manager', role: 'compliance_manager' },
} satisfies Record<string, Analyst>;
export const REFUND_NOTE = 'Supporting fictional evidence verified.';
export const REFUND_TIME = '2026-09-11T12:00:00.000Z';

export function refundFixtureContext(db: Db): void {
  for (const actor of Object.values(REFUND_ACTORS)) {
    db.prepare('INSERT INTO analysts VALUES (?, ?, ?)').run(actor.id, actor.name, actor.role);
  }
  const insert = db.prepare(`INSERT INTO customers (
    id, full_name, date_of_birth, nationality, country_of_residence, occupation, email,
    account_opened_at, expected_monthly_volume_usd, source_of_funds, id_document_type,
    id_document_verified, address_verified, pep_flag, sanctions_hit, adverse_media_hits
  ) VALUES
    (?, ?, '1990-01-01', 'US', 'US', 'teacher', ?, '2020-01-01', 1000,
     'salary', 'passport', 1, 1, 0, 0, 0)`);
  insert.run('cus-001', 'Avery Fiction', 'avery.fiction@example-mail.com');
  insert.run('cus-002', 'Zelda Example', 'zelda.example@example-post.com');
}

export function addRefund(db: Db, overrides: Partial<RefundRecord> = {}): RefundRecord {
  const refund: RefundRecord = {
    id: 'refund-test', reference: 'RFD-TEST', customerId: 'cus-001', amountCents: 100000,
    currency: 'USD', status: 'pending', riskLevel: 'low', reason: 'Fictional duplicate charge.',
    originalTransaction: { reference: 'TXN-TEST', amountCents: 1000000, occurredAt: '2026-08-01T00:00:00.000Z' },
    riskIndicators: [{
      code: 'MATCHED', title: 'Receipt matched', description: 'Fictional evidence matched.', severity: 'low',
    }],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  insertRefund(db, refund);
  const fields = {
    refundId: refund.id, sequence: 1, actorId: REFUND_ACTORS.analyst.id,
    action: 'REFUND_CREATED', fromStatus: null, toStatus: 'pending' as const,
    note: REFUND_NOTE, createdAt: refund.createdAt,
  };
  insertAuditEvent(db, {
    id: `creation-${refund.id}`, ...fields, actorName: REFUND_ACTORS.analyst.name,
    prevHash: GENESIS_HASH, hash: computeEventHash(GENESIS_HASH, fields),
  });
  return refund;
}
