import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AnalystRole, RiskLevel } from '../types.js';

export const policySchema = z.object({
  version: z.number().int().positive(),
  requireApprovalNote: z.boolean(),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
});

export type ReviewPolicy = z.infer<typeof policySchema>;

export const policyUpdateSchema = z.object({
  version: z.number().int().positive(),
  requireApprovalNote: z.boolean(),
  reason: z.string().trim().min(10).max(1000),
}).strict();

export type PolicyUpdate = z.infer<typeof policyUpdateSchema>;

export interface PolicyAuditEvent {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: AnalystRole;
  action: 'policy_updated';
  createdAt: string;
  reason: string;
  previousState: ReviewPolicy;
  newState: ReviewPolicy;
  prevHash: string;
  hash: string;
}

export function approvalNoteRequired(riskLevel: RiskLevel, policy: ReviewPolicy): boolean {
  return riskLevel === 'high' || policy.requireApprovalNote;
}

export function computePolicyEventHash(event: Omit<PolicyAuditEvent, 'hash'>): string {
  return createHash('sha256').update(event.prevHash + JSON.stringify({
    id: event.id,
    actorId: event.actorId,
    actorName: event.actorName,
    actorRole: event.actorRole,
    action: event.action,
    createdAt: event.createdAt,
    reason: event.reason,
    previousState: policySchema.parse(event.previousState),
    newState: policySchema.parse(event.newState),
  })).digest('hex');
}
