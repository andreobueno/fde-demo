import { describe, expect, it } from 'vitest';
import type { RiskPolicy } from '../api/types';
import { buildPolicyPatch, type PolicyDraft, validatePolicyDraft } from './policyDraft';

const policy: RiskPolicy = {
  rules: [
    {
      code: 'SANCTIONS_HIT',
      title: 'Sanctions match',
      description: '',
      weight: 40,
      defaultWeight: 40,
    },
    { code: 'PEP', title: 'PEP match', description: '', weight: 30, defaultWeight: 30 },
  ],
  thresholds: { medium: 30, high: 60 },
  defaultThresholds: { medium: 30, high: 60 },
  version: 0,
  updatedAt: null,
  updatedBy: null,
};

const clean: PolicyDraft = {
  weights: { SANCTIONS_HIT: '40', PEP: '30' },
  thresholds: { medium: '30', high: '60' },
};

describe('validatePolicyDraft', () => {
  it('accepts a valid draft', () => {
    expect(validatePolicyDraft(clean)).toBeNull();
  });

  it('rejects non-integer or out-of-range weights', () => {
    expect(validatePolicyDraft({ ...clean, weights: { ...clean.weights, PEP: '' } })).toMatch(
      /PEP/,
    );
    expect(validatePolicyDraft({ ...clean, weights: { ...clean.weights, PEP: '12.5' } })).toMatch(
      /PEP/,
    );
    expect(validatePolicyDraft({ ...clean, weights: { ...clean.weights, PEP: '101' } })).toMatch(
      /PEP/,
    );
  });

  it('requires medium threshold below high', () => {
    expect(
      validatePolicyDraft({ ...clean, thresholds: { medium: '60', high: '60' } }),
    ).toMatch(/lower than/);
    expect(validatePolicyDraft({ ...clean, thresholds: { medium: '0', high: '60' } })).toMatch(
      /Medium threshold/,
    );
  });
});

describe('buildPolicyPatch', () => {
  it('returns an empty patch when nothing changed', () => {
    expect(buildPolicyPatch(policy, clean)).toEqual({});
  });

  it('includes only changed weights and thresholds', () => {
    expect(
      buildPolicyPatch(policy, {
        weights: { SANCTIONS_HIT: '40', PEP: '35' },
        thresholds: { medium: '30', high: '70' },
      }),
    ).toEqual({ weights: { PEP: 35 }, thresholds: { high: 70 } });
  });

  it('ignores unparsable values (validation reports them separately)', () => {
    expect(
      buildPolicyPatch(policy, { ...clean, weights: { SANCTIONS_HIT: 'abc', PEP: '30' } }),
    ).toEqual({});
  });
});
