import { useEffect, useState } from 'react';
import type { AuditEvent, CaseStatus } from '@/api/types';
export interface EventFields {
  caseId: string;
  sequence: number;
  actorId: string;
  action: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus | null;
  note: string | null;
  createdAt: string;
}
export const GENESIS_HASH = '0'.repeat(64);
export function canonicalJson(fields: EventFields): string {
  return JSON.stringify({
    action: fields.action,
    actorId: fields.actorId,
    caseId: fields.caseId,
    createdAt: fields.createdAt,
    fromStatus: fields.fromStatus,
    note: fields.note,
    sequence: fields.sequence,
    toStatus: fields.toStatus,
  });
}
export async function computeEventHash(prevHash: string, fields: EventFields): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(prevHash + canonicalJson(fields)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifyChain(
  events: AuditEvent[],
): Promise<{ ok: boolean; brokenAt: number | null }> {
  let previous = GENESIS_HASH;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.prevHash !== previous) return { ok: false, brokenAt: event.sequence };
    const expected = await computeEventHash(previous, event);
    if (event.hash !== expected) return { ok: false, brokenAt: event.sequence };
    previous = event.hash;
  }
  return { ok: true, brokenAt: null };
}
export function useChainVerification(events: AuditEvent[]): 'checking' | 'verified' | 'broken' {
  const [state, setState] = useState<'checking' | 'verified' | 'broken'>('checking');
  useEffect(() => {
    let active = true;
    setState('checking');
    void verifyChain(events).then((result) => {
      if (active) setState(result.ok ? 'verified' : 'broken');
    });
    return () => {
      active = false;
    };
  }, [events]);
  return state;
}
