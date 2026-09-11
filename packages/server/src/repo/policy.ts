import type { Db } from '../db.js';
import { DEFAULT_RISK_POLICY, POLICY_RULE_CODES } from '../domain/policy.js';
import type { PolicyRuleCode, RiskPolicy, RiskPolicyChange } from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function rowToPolicyChange(r: any): RiskPolicyChange {
  return {
    id: r.id,
    version: r.version,
    actorId: r.actor_id,
    actorName: r.actor_name,
    changes: JSON.parse(r.changes),
    recomputedCases: r.recomputed_cases,
    createdAt: r.created_at,
  };
}

/** Reads the stored policy; any key not yet persisted falls back to the code default. */
export function loadPolicy(db: Db): RiskPolicy {
  const rows = db.prepare('SELECT key, value FROM risk_policy').all() as Array<{
    key: string;
    value: number;
  }>;
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const weights = { ...DEFAULT_RISK_POLICY.weights };
  for (const code of POLICY_RULE_CODES) {
    const v = stored.get(`weights.${code}`);
    if (v !== undefined) weights[code as PolicyRuleCode] = v;
  }
  return {
    weights,
    thresholds: {
      medium: stored.get('thresholds.medium') ?? DEFAULT_RISK_POLICY.thresholds.medium,
      high: stored.get('thresholds.high') ?? DEFAULT_RISK_POLICY.thresholds.high,
    },
  };
}

export function savePolicy(db: Db, policy: RiskPolicy): void {
  const upsert = db.prepare(
    'INSERT INTO risk_policy (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const code of POLICY_RULE_CODES) {
    upsert.run(`weights.${code}`, policy.weights[code]);
  }
  upsert.run('thresholds.medium', policy.thresholds.medium);
  upsert.run('thresholds.high', policy.thresholds.high);
}

export function listPolicyChanges(db: Db): RiskPolicyChange[] {
  return db
    .prepare('SELECT * FROM risk_policy_changes ORDER BY version DESC')
    .all()
    .map(rowToPolicyChange);
}

export function latestPolicyChange(db: Db): RiskPolicyChange | null {
  const row = db
    .prepare('SELECT * FROM risk_policy_changes ORDER BY version DESC LIMIT 1')
    .get();
  return row ? rowToPolicyChange(row) : null;
}

export function insertPolicyChange(db: Db, change: RiskPolicyChange): void {
  db.prepare(
    `INSERT INTO risk_policy_changes
     (id, version, actor_id, actor_name, changes, recomputed_cases, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    change.id,
    change.version,
    change.actorId,
    change.actorName,
    JSON.stringify(change.changes),
    change.recomputedCases,
    change.createdAt,
  );
}
