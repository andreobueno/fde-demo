import type { AuditEvent, CaseStatus, RefundAuditEvent } from '../api/types';

export const GENESIS_HASH = '0'.repeat(64);

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

export interface RefundEventFields extends Omit<EventFields, 'caseId'> {
  refundId: string;
}

export function canonicalJson(fields: EventFields | RefundEventFields): string {
  return JSON.stringify({
    action: fields.action,
    actorId: fields.actorId,
    ...('refundId' in fields ? { refundId: fields.refundId } : { caseId: fields.caseId }),
    createdAt: fields.createdAt,
    fromStatus: fields.fromStatus,
    note: fields.note,
    sequence: fields.sequence,
    toStatus: fields.toStatus,
  });
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

export async function computeEventHash(prevHash: string, fields: EventFields | RefundEventFields): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(prevHash + canonicalJson(fields)),
  );
  return toHex(digest);
}

export interface ChainVerification {
  ok: boolean;
  brokenAtSequence: number | null;
}

export async function verifyChain(events: (AuditEvent | RefundAuditEvent)[]): Promise<ChainVerification> {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  let prevHash = GENESIS_HASH;
  for (const event of sorted) {
    if (event.prevHash !== prevHash) {
      return { ok: false, brokenAtSequence: event.sequence };
    }
    const expected = await computeEventHash(prevHash, {
      ...('refundId' in event ? { refundId: event.refundId } : { caseId: event.caseId }),
      sequence: event.sequence,
      actorId: event.actorId,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt,
    });
    if (event.hash !== expected) {
      return { ok: false, brokenAtSequence: event.sequence };
    }
    prevHash = event.hash;
  }
  return { ok: true, brokenAtSequence: null };
}
