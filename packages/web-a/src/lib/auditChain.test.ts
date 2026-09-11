import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../api/types';
import {
  canonicalJson,
  computeEventHash,
  GENESIS_HASH,
  verifyChain,
  type EventFields,
} from './auditChain';
import fixture from './__fixtures__/audit-case-002.json';

const events = fixture as AuditEvent[];

function fieldsOf(event: AuditEvent): EventFields {
  return {
    caseId: event.caseId,
    sequence: event.sequence,
    actorId: event.actorId,
    action: event.action,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    note: event.note,
    createdAt: event.createdAt,
  };
}

describe('canonicalJson', () => {
  it('matches the server key order', () => {
    const json = canonicalJson(fieldsOf(events[0]!));
    expect(json.startsWith('{"action":"CASE_CREATED","actorId":"ana-004","caseId":"case-002",')).toBe(
      true,
    );
  });
});

describe('computeEventHash', () => {
  it('recomputes the first event hash from the genesis hash', async () => {
    const hash = await computeEventHash(GENESIS_HASH, fieldsOf(events[0]!));
    expect(hash).toBe(events[0]!.hash);
  });
});

describe('verifyChain', () => {
  it('verifies the seeded fixture chain', async () => {
    const result = await verifyChain(events);
    expect(result).toEqual({ ok: true, brokenAtSequence: null });
  });

  it('detects a tampered note in event 2', async () => {
    const tampered = events.map((e) =>
      e.sequence === 2 ? { ...e, note: 'tampered note content' } : e,
    );
    const result = await verifyChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSequence).toBe(2);
  });

  it('detects a tampered prevHash in event 3', async () => {
    const tampered = events.map((e) =>
      e.sequence === 3 ? { ...e, prevHash: 'f'.repeat(64) } : e,
    );
    const result = await verifyChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSequence).toBe(3);
  });
});
