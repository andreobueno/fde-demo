import { describe, expect, it } from 'vitest';
import { getAllowedRefundActions, refundActionBodySchema, refundRecordSchema, validateRefundAction } from './refunds.js';
import { REFUND_NOTE } from '../refundFixtures.js';

const roles = ['analyst', 'senior_analyst', 'compliance_manager'] as const;
const risks = ['low', 'medium', 'high'] as const;
const actions = ['approve', 'reject'] as const;
const matrix = roles.flatMap((role) => risks.flatMap((riskLevel) =>
  [99999, 100000, 500000, 500001].flatMap((amountCents) =>
    actions.map((action) => ({ role, riskLevel, amountCents, action })),
  ),
));

describe('refund authorization', () => {
  it.each(matrix)('$role $action $riskLevel $amountCents', (input) => {
    const allowed = input.role === 'compliance_manager' ||
      (input.role === 'senior_analyst' && input.riskLevel !== 'high' && input.amountCents <= 500000);
    const result = validateRefundAction({ ...input, status: 'pending', note: REFUND_NOTE });
    expect(result.ok).toBe(allowed);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    expect(getAllowedRefundActions('pending', input.role, input.riskLevel, input.amountCents))
      .toEqual(allowed ? ['approve', 'reject'] : []);
  });
  it.each((['pending', 'approved', 'rejected'] as const).flatMap((status) =>
    actions.map((action) => ({ status, action })),
  ))('$status -> $action', ({ status, action }) => {
    const result = validateRefundAction({
      status, action, role: 'compliance_manager', riskLevel: 'high', amountCents: 500001, note: REFUND_NOTE,
    });
    expect(result).toEqual(status === 'pending'
      ? { ok: true, toStatus: action === 'approve' ? 'approved' : 'rejected' }
      : { ok: false, error: { code: 'INVALID_TRANSITION', message: expect.any(String) } });
    expect(getAllowedRefundActions(status, 'compliance_manager', 'high', 500001))
      .toEqual(status === 'pending' ? ['approve', 'reject'] : []);
  });
  it.each(actions)('%s always requires a trimmed bounded note', (action) => {
    for (const note of ['', ' '.repeat(10), 'n'.repeat(9), 'n'.repeat(1001)]) {
      expect(validateRefundAction({
        action, status: 'pending', role: 'compliance_manager', riskLevel: 'low', amountCents: 1, note,
      })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    }
    for (const note of ['n'.repeat(10), 'n'.repeat(1000)]) {
      expect(refundActionBodySchema.parse({ action, note: `  ${note}  ` }).note).toBe(note);
    }
  });
  it.each([0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])('rejects invalid cents %s', (amountCents) => {
    expect(getAllowedRefundActions('pending', 'compliance_manager', 'low', amountCents)).toEqual([]);
  });
});

describe('refund storage validation', () => {
  const valid = {
    id: 'refund', reference: 'RFD', customerId: 'customer', amountCents: 100, currency: 'USD',
    status: 'pending', riskLevel: 'low', reason: 'Duplicate charge',
    originalTransaction: { reference: 'TXN', amountCents: 100, occurredAt: '2026-01-01T00:00:00.000Z' },
    riskIndicators: [], createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
  };
  it('accepts an exact full refund and safe integer maximum', () => {
    expect(refundRecordSchema.safeParse(valid).success).toBe(true);
    expect(refundRecordSchema.safeParse({
      ...valid, amountCents: Number.MAX_SAFE_INTEGER,
      originalTransaction: { ...valid.originalTransaction, amountCents: Number.MAX_SAFE_INTEGER },
    }).success).toBe(true);
  });
  it.each([0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 101])(
    'rejects invalid refund cents %s', (amountCents) => {
      expect(refundRecordSchema.safeParse({ ...valid, amountCents }).success).toBe(false);
    },
  );
  it.each([0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1])('rejects invalid original cents %s', (amountCents) => {
    expect(refundRecordSchema.safeParse({
      ...valid, originalTransaction: { ...valid.originalTransaction, amountCents },
    }).success).toBe(false);
  });
  it.each(['EUR', 'usd', '', null])('rejects currency %s', (currency) => {
    expect(refundRecordSchema.safeParse({ ...valid, currency }).success).toBe(false);
  });
});
