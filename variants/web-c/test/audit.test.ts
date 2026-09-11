import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/api/types.js';
import { GENESIS_HASH, computeEventHash, verifyChain } from '../src/lib/audit.js';
import fixture from './fixtures-audit.json' with { type: 'json' };

// Two events captured from the seeded DB (case-006) — hashes produced by packages/server.
const events = fixture as AuditEvent[];

describe('audit chain verifier', () => {
  it('reproduces the server hash for the genesis event', () => {
    const first = events[0]!;
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(computeEventHash(first.prevHash, first)).toBe(first.hash);
  });

  it('verifies the seeded chain regardless of input order', () => {
    const result = verifyChain([...events].reverse());
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
    expect(Object.values(result.eventValid).every(Boolean)).toBe(true);
  });

  it('detects a tampered note and marks the event and its successors invalid', () => {
    const tampered: AuditEvent[] = events.map((e, i) => (i === 0 ? { ...e, note: 'edited' } : e));
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.eventValid[tampered[0]!.id]).toBe(false);
    expect(result.eventValid[tampered[1]!.id]).toBe(false);
  });

  it('detects a broken prevHash link', () => {
    const broken: AuditEvent[] = events.map((e, i) => (i === 1 ? { ...e, prevHash: 'f'.repeat(64) } : e));
    const result = verifyChain(broken);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.eventValid[broken[0]!.id]).toBe(true);
  });
});
