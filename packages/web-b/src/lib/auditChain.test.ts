import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/audit-case-006.json';
import { verifyChain } from './auditChain';
import type { AuditEvent } from '@/api/types';

const events = fixture as AuditEvent[];

describe('audit chain', () => {
  it('verifies the seeded audit fixture', async () => {
    expect(await verifyChain(events)).toEqual({ ok: true, brokenAt: null });
  });

  it('detects a mutated event note', async () => {
    const tamperedEvents = events.map((event) => ({ ...event }));
    tamperedEvents[1]!.note = 'tampered';

    expect(await verifyChain(tamperedEvents)).toEqual({ ok: false, brokenAt: 2 });
  });

  it('detects a tampered previous hash', async () => {
    const tamperedEvents = events.map((event) => ({ ...event }));
    tamperedEvents[1]!.prevHash = 'x'.repeat(64);

    expect(await verifyChain(tamperedEvents)).toEqual({ ok: false, brokenAt: 2 });
  });
});
