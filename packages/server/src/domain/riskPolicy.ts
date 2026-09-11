import { z } from 'zod';
import type { PolicyRuleCode, RiskPolicy, RiskThresholds, SignalSeverity } from '../types.js';

export interface PolicyRuleDef {
  code: PolicyRuleCode;
  title: string;
  description: string;
  severity: SignalSeverity;
  defaultWeight: number;
}

export const POLICY_RULES: readonly PolicyRuleDef[] = [
  {
    code: 'HIGH_RISK_JURISDICTION',
    title: 'High-risk jurisdiction',
    description: 'Residence or nationality is in the high-risk jurisdiction list.',
    severity: 'high',
    defaultWeight: 25,
  },
  {
    code: 'SANCTIONS_HIT',
    title: 'Sanctions match',
    description: 'Potential sanctions list match.',
    severity: 'high',
    defaultWeight: 40,
  },
  {
    code: 'PEP',
    title: 'PEP match',
    description: 'Customer is a politically exposed person.',
    severity: 'high',
    defaultWeight: 30,
  },
  {
    code: 'DOCUMENT_EXPIRING',
    title: 'Document expiring <30 days',
    description: 'ID document expires within 30 days (or has already expired).',
    severity: 'low',
    defaultWeight: 10,
  },
  {
    code: 'HIGH_EXPECTED_VOLUME',
    title: 'Unusual transaction volume',
    description: 'Expected monthly volume exceeds $50,000.',
    severity: 'medium',
    defaultWeight: 15,
  },
  {
    code: 'ADVERSE_MEDIA',
    title: 'Adverse media',
    description: 'Per adverse media hit, capped at 3 hits.',
    severity: 'medium',
    defaultWeight: 10,
  },
  {
    code: 'ID_DOC_UNVERIFIED',
    title: 'ID document unverified',
    description: 'Identity document has not been verified.',
    severity: 'medium',
    defaultWeight: 20,
  },
  {
    code: 'ADDRESS_UNVERIFIED',
    title: 'Address unverified',
    description: 'Address has not been verified.',
    severity: 'low',
    defaultWeight: 10,
  },
  {
    code: 'OPAQUE_SOURCE_OF_FUNDS',
    title: 'Opaque source of funds',
    description: 'Declared source of funds is crypto, cash-intensive business or unknown.',
    severity: 'medium',
    defaultWeight: 15,
  },
  {
    code: 'NEW_ACCOUNT',
    title: 'New account',
    description: 'Account opened less than 30 days ago.',
    severity: 'low',
    defaultWeight: 5,
  },
  {
    code: 'CASH_INTENSIVE_OCCUPATION',
    title: 'Cash-intensive occupation',
    description: 'Occupation is associated with cash-intensive activity.',
    severity: 'low',
    defaultWeight: 10,
  },
];

export const POLICY_RULE_CODES = POLICY_RULES.map((r) => r.code) as [
  PolicyRuleCode,
  ...PolicyRuleCode[],
];

export const DEFAULT_THRESHOLDS: RiskThresholds = { medium: 30, high: 60 };

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  weights: Object.fromEntries(POLICY_RULES.map((r) => [r.code, r.defaultWeight])) as Record<
    PolicyRuleCode,
    number
  >,
  thresholds: DEFAULT_THRESHOLDS,
};

export function ruleDef(code: PolicyRuleCode): PolicyRuleDef {
  const def = POLICY_RULES.find((r) => r.code === code);
  if (!def) throw new Error(`Unknown policy rule '${code}'.`);
  return def;
}

export const MAX_WEIGHT = 100;

const weightSchema = z.number().int().min(0).max(MAX_WEIGHT);
const thresholdSchema = z.number().int().min(1).max(100);

export const policyPatchSchema = z
  .object({
    weights: z
      .object(
        Object.fromEntries(POLICY_RULE_CODES.map((c) => [c, weightSchema.optional()])) as Record<
          PolicyRuleCode,
          z.ZodOptional<typeof weightSchema>
        >,
      )
      .strict()
      .optional(),
    thresholds: z
      .object({ medium: thresholdSchema.optional(), high: thresholdSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();

export type PolicyPatch = z.infer<typeof policyPatchSchema>;

export function applyPatch(current: RiskPolicy, patch: PolicyPatch): RiskPolicy {
  const weights = { ...current.weights };
  for (const code of POLICY_RULE_CODES) {
    const w = patch.weights?.[code];
    if (w !== undefined) weights[code] = w;
  }
  return {
    weights,
    thresholds: {
      medium: patch.thresholds?.medium ?? current.thresholds.medium,
      high: patch.thresholds?.high ?? current.thresholds.high,
    },
  };
}

export function validatePolicy(policy: RiskPolicy): string | null {
  if (policy.thresholds.medium >= policy.thresholds.high) {
    return 'The medium threshold must be lower than the high threshold.';
  }
  return null;
}

export function diffPolicy(
  before: RiskPolicy,
  after: RiskPolicy,
): Array<{ key: string; from: number; to: number }> {
  const changes: Array<{ key: string; from: number; to: number }> = [];
  for (const code of POLICY_RULE_CODES) {
    if (before.weights[code] !== after.weights[code]) {
      changes.push({ key: `weights.${code}`, from: before.weights[code], to: after.weights[code] });
    }
  }
  for (const level of ['medium', 'high'] as const) {
    if (before.thresholds[level] !== after.thresholds[level]) {
      changes.push({
        key: `thresholds.${level}`,
        from: before.thresholds[level],
        to: after.thresholds[level],
      });
    }
  }
  return changes;
}
