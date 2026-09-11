import { createHash } from 'node:crypto';
import type { AuditEvent, CaseStatus, RefundAuditEvent } from '../types.js';

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

export type RefundEventFields = Omit<EventFields, 'caseId'> & { refundId: string };

function canonicalJson(fields: EventFields | RefundEventFields): string {
  if ('refundId' in fields) {
    return JSON.stringify({
      action: fields.action,
      actorId: fields.actorId,
      refundId: fields.refundId,
      createdAt: fields.createdAt,
      fromStatus: fields.fromStatus,
      note: fields.note,
      sequence: fields.sequence,
      toStatus: fields.toStatus,
    });
  }
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

export function computeEventHash(prevHash: string, fields: EventFields | RefundEventFields): string {
  return createHash('sha256')
    .update(prevHash + canonicalJson(fields))
    .digest('hex');
}

export function verifyChain(events: readonly (AuditEvent | RefundAuditEvent)[]): boolean {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  let prevHash = GENESIS_HASH;
  for (const event of sorted) {
    if (event.prevHash !== prevHash) return false;
    const expected = computeEventHash(prevHash, event);
    if (event.hash !== expected) return false;
    prevHash = event.hash;
  }
  return true;
}
