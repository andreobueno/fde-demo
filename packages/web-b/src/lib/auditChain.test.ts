import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/audit-case-006.json';
import { verifyChain } from './auditChain';
import type { AuditEvent } from '@/api/types';
describe('audit chain', () => {
  it('verifies valid and tampered chains', async () => {
    const events = fixture as AuditEvent[];
    expect(await verifyChain(events)).toEqual({ ok: true, brokenAt: null });
    const noteTampered = events.map((e) => ({ ...e }));
    noteTampered[1]!.note = 'tampered';
    expect(await verifyChain(noteTampered)).toEqual({ ok: false, brokenAt: 2 });
    const prevTampered = events.map((e) => ({ ...e }));
    prevTampered[1]!.prevHash = 'x'.repeat(64);
    expect(await verifyChain(prevTampered)).toEqual({ ok: false, brokenAt: 2 });
  });
});
