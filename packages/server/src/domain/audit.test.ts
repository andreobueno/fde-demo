import { describe, expect, it } from 'vitest';
import { computeEventHash, GENESIS_HASH, verifyChain, type EventFields } from './audit.js';
import type { AuditEvent } from '../types.js';

function makeEvent(seq: number, prevHash: string, overrides: Partial<EventFields> = {}): AuditEvent {
  const fields: EventFields = {
    caseId: 'case-1',
    sequence: seq,
    actorId: 'ana-001',
    action: 'APPROVE',
    fromStatus: 'in_review',
    toStatus: 'approved',
    note: 'looks good to me',
    createdAt: `2026-01-01T00:0${seq}:00.000Z`,
    ...overrides,
  };
  return {
    id: `evt-${seq}`,
    ...fields,
    actorName: 'Analyst One',
    prevHash,
    hash: computeEventHash(prevHash, fields),
  };
}

describe('audit chain', () => {
  it('verifies a valid two-event chain', () => {
    const e1 = makeEvent(1, GENESIS_HASH, { action: 'CASE_CREATED', fromStatus: null, toStatus: 'pending' });
    const e2 = makeEvent(2, e1.hash);
    expect(verifyChain([e1, e2])).toBe(true);
  });

  it('verifies an empty chain', () => {
    expect(verifyChain([])).toBe(true);
  });

  it('fails when a note is tampered with', () => {
    const e1 = makeEvent(1, GENESIS_HASH);
    const e2 = makeEvent(2, e1.hash);
    const tampered = { ...e1, note: 'forged note' };
    expect(verifyChain([tampered, e2])).toBe(false);
  });

  it('fails when prevHash linkage is broken', () => {
    const e1 = makeEvent(1, GENESIS_HASH);
    const e2 = makeEvent(2, 'f'.repeat(64));
    expect(verifyChain([e1, e2])).toBe(false);
  });

  it('fails when an event hash is recomputed wrongly', () => {
    const e1 = makeEvent(1, GENESIS_HASH);
    const bad = { ...e1, hash: 'a'.repeat(64) };
    expect(verifyChain([bad])).toBe(false);
  });
});
