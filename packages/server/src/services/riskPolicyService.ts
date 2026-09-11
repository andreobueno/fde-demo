import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { ApiError, unauthorized } from '../errors.js';
import { hasPermission } from '../domain/authorization.js';
import { computeEventHash, GENESIS_HASH } from '../domain/audit.js';
import {
  applyPatch,
  DEFAULT_THRESHOLDS,
  diffPolicy,
  POLICY_RULES,
  policyPatchSchema,
  validatePolicy,
  type PolicyPatch,
} from '../domain/riskPolicy.js';
import { computeRisk } from '../domain/risk.js';
import { insertAuditEvent, lastAuditEvent } from '../repo/audit.js';
import { getCaseRiskThresholds, listOpenCases, updateCaseRisk } from '../repo/cases.js';
import { getAnalyst } from '../repo/analysts.js';
import { getCustomer } from '../repo/customers.js';
import {
  insertPolicyChange,
  latestPolicyChange,
  loadPolicy,
  savePolicy,
} from '../repo/riskPolicy.js';
import { listSignals, replaceSignals } from '../repo/signals.js';
import type { Analyst, AuditEvent, RiskPolicy, RiskPolicyChange, RiskPolicyView } from '../types.js';

export const RISK_RESCORED_ACTION = 'RISK_RESCORED';

export function getRiskPolicyView(db: Db): RiskPolicyView {
  const policy = loadPolicy(db);
  const latest = latestPolicyChange(db);
  return {
    rules: POLICY_RULES.map((r) => ({
      code: r.code,
      title: r.title,
      description: r.description,
      weight: policy.weights[r.code],
      defaultWeight: r.defaultWeight,
    })),
    thresholds: policy.thresholds,
    defaultThresholds: DEFAULT_THRESHOLDS,
    version: latest?.version ?? 0,
    updatedAt: latest?.createdAt ?? null,
    updatedBy: latest?.actorName ?? null,
  };
}

export interface RiskPolicyUpdateResult {
  policy: RiskPolicyView;
  change: RiskPolicyChange | null;
}

export function updateRiskPolicy(db: Db, actorId: string, patch: PolicyPatch): RiskPolicyUpdateResult {
  return db.transaction((): RiskPolicyUpdateResult => {
    const actor = getAnalyst(db, actorId);
    if (!actor) throw unauthorized('Unknown analyst context.');
    if (!hasPermission(actor.role, 'policy:manage')) {
      throw new ApiError(403, 'FORBIDDEN', 'Only compliance managers can manage risk policy.');
    }
    const parsed = policyPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid risk policy update.', parsed.error.issues);
    }
    const before = loadPolicy(db);
    const after = applyPatch(before, parsed.data);
    const invalid = validatePolicy(after);
    if (invalid) throw new ApiError(400, 'VALIDATION_ERROR', invalid);

    const changes = diffPolicy(before, after);
    if (changes.length === 0) {
      return { policy: getRiskPolicyView(db), change: null };
    }

    savePolicy(db, after);
    const version = (latestPolicyChange(db)?.version ?? 0) + 1;
    const now = new Date();
    const recomputed = rescoreOpenCases(db, actor, after, version, now);

    const change: RiskPolicyChange = {
      id: randomUUID(),
      version,
      actorId: actor.id,
      actorName: actor.name,
      changes,
      recomputedCases: recomputed,
      createdAt: now.toISOString(),
    };
    insertPolicyChange(db, change);
    return { policy: getRiskPolicyView(db), change };
  }).immediate();
}

function rescoreOpenCases(
  db: Db,
  actor: Analyst,
  policy: RiskPolicy,
  version: number,
  now: Date,
): number {
  let changed = 0;
  for (const kase of listOpenCases(db)) {
    const customer = getCustomer(db, kase.customerId);
    if (!customer) continue;
    const { score, level, signals } = computeRisk(customer, now, policy);
    const previousSignals = listSignals(db, kase.id);
    const signalsMatch = signals.length === previousSignals.length && signals.every((signal) =>
      previousSignals.some((previous) =>
        previous.code === signal.code &&
        previous.title === signal.title &&
        previous.description === signal.description &&
        previous.severity === signal.severity &&
        previous.weight === signal.weight,
      ),
    );
    const previousThresholds = getCaseRiskThresholds(db, kase.id);
    if (
      score === kase.riskScore && level === kase.riskLevel && signalsMatch &&
      previousThresholds.medium === policy.thresholds.medium &&
      previousThresholds.high === policy.thresholds.high
    ) continue;

    if (!signalsMatch) replaceSignals(db, kase.id, signals);

    const iso = now.toISOString();
    updateCaseRisk(db, kase.id, score, level, iso, policy.thresholds);

    const last = lastAuditEvent(db, kase.id);
    const sequence = (last?.sequence ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const fields = {
      caseId: kase.id,
      sequence,
      actorId: actor.id,
      action: RISK_RESCORED_ACTION,
      fromStatus: kase.status,
      toStatus: kase.status,
      note: `Risk policy v${version}: score ${kase.riskScore} → ${score}, level ${kase.riskLevel} → ${level}. ` +
        `Thresholds ${previousThresholds.medium}/${previousThresholds.high} → ${policy.thresholds.medium}/${policy.thresholds.high}. ` +
        `Evidence ${signalsMatch ? 'unchanged' : 'updated'}.`,
      createdAt: iso,
    };
    const event: AuditEvent = {
      id: randomUUID(),
      ...fields,
      actorName: actor.name,
      prevHash,
      hash: computeEventHash(prevHash, fields),
    };
    insertAuditEvent(db, event);
    changed += 1;
  }
  return changed;
}
