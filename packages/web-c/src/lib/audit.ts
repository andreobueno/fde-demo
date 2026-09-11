import { createHash } from 'node:crypto';
import type { AuditEvent } from '../api/types.js';

export const GENESIS_HASH = '0'.repeat(64);

type EventFields = Pick<
  AuditEvent,
  'caseId' | 'sequence' | 'actorId' | 'action' | 'fromStatus' | 'toStatus' | 'note' | 'createdAt'
>;

// Mirrors packages/server/src/domain/audit.ts: keys serialised in this fixed order.
function canonicalJson(fields: EventFields): string {
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

export function computeEventHash(prevHash: string, fields: EventFields): string {
  return createHash('sha256').update(prevHash + canonicalJson(fields)).digest('hex');
}

export interface ChainVerification {
  valid: boolean;
  /** Sequence number of the first event that failed verification, if any. */
  brokenAt: number | null;
  /** Per-event result keyed by event id. */
  eventValid: Record<string, boolean>;
}

export function verifyChain(events: readonly AuditEvent[]): ChainVerification {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  let prevHash = GENESIS_HASH;
  let valid = true;
  let brokenAt: number | null = null;
  const eventValid: Record<string, boolean> = {};
  for (const event of sorted) {
    const expected = computeEventHash(prevHash, event);
    const ok = valid && event.prevHash === prevHash && event.hash === expected;
    eventValid[event.id] = ok;
    if (!ok && valid) {
      valid = false;
      brokenAt = event.sequence;
    }
    prevHash = event.hash;
  }
  return { valid, brokenAt, eventValid };
}
