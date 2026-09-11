import type { RiskPolicy, RiskPolicyPatch } from '../api/types';

export interface PolicyDraft {
  weights: Record<string, string>;
  thresholds: { medium: string; high: string };
}

function parseInt01(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export function validatePolicyDraft(draft: PolicyDraft): string | null {
  for (const [code, value] of Object.entries(draft.weights)) {
    const n = parseInt01(value);
    if (n === null || n < 0 || n > 100) {
      return `Weight for ${code} must be a whole number between 0 and 100.`;
    }
  }
  const medium = parseInt01(draft.thresholds.medium);
  const high = parseInt01(draft.thresholds.high);
  if (medium === null || medium < 1 || medium > 100) {
    return 'Medium threshold must be a whole number between 1 and 100.';
  }
  if (high === null || high < 1 || high > 100) {
    return 'High threshold must be a whole number between 1 and 100.';
  }
  if (medium >= high) {
    return 'Medium threshold must be lower than the high threshold.';
  }
  return null;
}

/** Returns only the fields that differ from the current policy; `{}` when nothing changed. */
export function buildPolicyPatch(policy: RiskPolicy, draft: PolicyDraft): RiskPolicyPatch {
  const patch: RiskPolicyPatch = {};
  for (const rule of policy.rules) {
    const n = parseInt01(draft.weights[rule.code] ?? '');
    if (n !== null && n !== rule.weight) {
      patch.weights = { ...(patch.weights ?? {}), [rule.code]: n };
    }
  }
  for (const level of ['medium', 'high'] as const) {
    const n = parseInt01(draft.thresholds[level]);
    if (n !== null && n !== policy.thresholds[level]) {
      patch.thresholds = { ...(patch.thresholds ?? {}), [level]: n };
    }
  }
  return patch;
}
