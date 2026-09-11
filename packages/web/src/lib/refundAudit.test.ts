import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RefundAuditEvent } from '../api/types';
import { canonicalJson, GENESIS_HASH, verifyChain } from './auditChain';

const canonical = '{"action":"approve","actorId":"ana-006","refundId":"r-1","createdAt":"2026-09-11T12:00:00.000Z","fromStatus":"pending","note":"Reviewed receipt","sequence":1,"toStatus":"approved"}';
const event: RefundAuditEvent = {
  id: 'event-1',
  refundId: 'r-1',
  actorId: 'ana-006',
  actorName: 'Demo manager',
  action: 'approve',
  createdAt: '2026-09-11T12:00:00.000Z',
  fromStatus: 'pending',
  toStatus: 'approved',
  note: 'Reviewed receipt',
  sequence: 1,
  prevHash: GENESIS_HASH,
  hash: createHash('sha256').update(GENESIS_HASH + canonical).digest('hex'),
};

describe('shared audit verifier for refunds', () => {
  it('verifies Node-generated hashes using the refund subject contract', async () => {
    expect(canonicalJson(event)).toBe(canonical);
    expect(await verifyChain([event])).toEqual({ ok: true, brokenAtSequence: null });
  });
  it.each([
    { refundId: 'r-2' },
    { actorId: 'ana-003' },
    { toStatus: 'rejected' as const },
    { note: 'Changed reason' },
    { prevHash: 'f'.repeat(64) },
  ])('detects tampering with %j', async (change) => {
    expect(await verifyChain([{ ...event, ...change }])).toEqual({ ok: false, brokenAtSequence: 1 });
  });
  it('cannot reinterpret refund history as KYC history', async () => {
    const { refundId, ...fields } = event;
    expect(await verifyChain([{ ...fields, caseId: refundId }])).toEqual({ ok: false, brokenAtSequence: 1 });
  });
});
