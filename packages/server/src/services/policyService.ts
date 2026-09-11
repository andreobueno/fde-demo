import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { ApiError } from '../errors.js';
import { computeEventHash, GENESIS_HASH } from '../domain/audit.js';
import {
  applyPatch,
  DEFAULT_THRESHOLDS,
  diffPolicy,
  POLICY_RULES,
  validatePolicy,
  type PolicyPatch,
} from '../domain/policy.js';
import { computeRisk } from '../domain/risk.js';
import { insertAuditEvent, lastAuditEvent } from '../repo/audit.js';
import { listOpenCases, updateCaseRisk } from '../repo/cases.js';
import { getCustomer } from '../repo/customers.js';
import {
  insertPolicyChange,
  latestPolicyChange,
  loadPolicy,
  savePolicy,
} from '../repo/policy.js';
import { replaceSignals } from '../repo/signals.js';
import type { Analyst, AuditEvent, RiskPolicy, RiskPolicyChange, RiskPolicyView } from '../types.js';

export const POLICY_EDITOR_ROLE = 'compliance_manager';
export const RISK_RESCORED_ACTION = 'RISK_RESCORED';

export function getPolicyView(db: Db): RiskPolicyView {
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

export interface PolicyUpdateResult {
  policy: RiskPolicyView;
  change: RiskPolicyChange | null;
}

/**
 * Applies a policy patch, records it in the append-only change log and re-scores every
 * open case (pending / in_review / escalated). Closed cases keep the score they were
 * decided under. Cases whose score or level moved get a RISK_RESCORED audit event.
 */
export function updatePolicy(db: Db, actor: Analyst, patch: PolicyPatch): PolicyUpdateResult {
  if (actor.role !== POLICY_EDITOR_ROLE) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      `Changing the risk policy requires role '${POLICY_EDITOR_ROLE}'.`,
    );
  }

  const txn = db.transaction((): PolicyUpdateResult => {
    const before = loadPolicy(db);
    const after = applyPatch(before, patch);
    const invalid = validatePolicy(after);
    if (invalid) throw new ApiError(400, 'VALIDATION_ERROR', invalid);

    const changes = diffPolicy(before, after);
    if (changes.length === 0) {
      return { policy: getPolicyView(db), change: null };
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
    return { policy: getPolicyView(db), change };
  });

  return txn();
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
    replaceSignals(db, kase.id, signals);
    if (score === kase.riskScore && level === kase.riskLevel) continue;

    const iso = now.toISOString();
    updateCaseRisk(db, kase.id, score, level, iso);

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
      note: `Risk policy v${version}: score ${kase.riskScore} → ${score}, level ${kase.riskLevel} → ${level}.`,
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
