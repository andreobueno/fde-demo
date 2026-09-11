import { describe, expect, it } from 'vitest';
import { computeRisk, explainRisk } from './risk.js';
import { DEFAULT_RISK_POLICY } from './policy.js';
import type { Customer } from '../types.js';

const NOW = new Date('2026-06-01T00:00:00Z');

function baseCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cus-t',
    fullName: 'Test Person',
    dateOfBirth: '1990-01-01',
    nationality: 'US',
    countryOfResidence: 'US',
    occupation: 'teacher',
    email: 't@example.com',
    accountOpenedAt: '2020-01-01T00:00:00Z',
    expectedMonthlyVolumeUsd: 5000,
    sourceOfFunds: 'salary',
    idDocumentType: 'passport',
    idDocumentExpiresAt: '2030-01-01T00:00:00Z',
    idDocumentVerified: true,
    addressVerified: true,
    pepFlag: false,
    sanctionsHit: false,
    adverseMediaHits: 0,
    ...overrides,
  };
}

describe('computeRisk', () => {
  it('scores 0 / low for a clean customer', () => {
    const r = computeRisk(baseCustomer(), NOW);
    expect(r.score).toBe(0);
    expect(r.level).toBe('low');
    expect(r.signals).toHaveLength(0);
  });

  it('level thresholds: <30 low, 30..59 medium, >=60 high', () => {
    // 25 (jurisdiction) + 5 (new account) = 30 → medium
    const med = computeRisk(
      baseCustomer({
        countryOfResidence: 'IR',
        accountOpenedAt: '2026-05-20T00:00:00Z',
      }),
      NOW,
    );
    expect(med.score).toBe(30);
    expect(med.level).toBe('medium');
    // 40 + 20 = 60 → high
    const high = computeRisk(
      baseCustomer({ sanctionsHit: true, idDocumentVerified: false }),
      NOW,
    );
    expect(high.score).toBe(60);
    expect(high.level).toBe('high');
    // 29 → low
    const low = computeRisk(
      baseCustomer({ adverseMediaHits: 2, accountOpenedAt: '2026-05-20T00:00:00Z' }),
      NOW,
    );
    expect(low.score).toBe(25);
    expect(low.level).toBe('low');
  });

  it.each([
    ['SANCTIONS_HIT', { sanctionsHit: true }, 40],
    ['PEP', { pepFlag: true }, 30],
    ['DOCUMENT_EXPIRING', { idDocumentExpiresAt: '2026-06-15T00:00:00Z' }, 10],
    ['DOCUMENT_EXPIRING', { idDocumentExpiresAt: '2026-05-01T00:00:00Z' }, 10],
    ['ID_DOC_UNVERIFIED', { idDocumentVerified: false }, 20],
    ['ADDRESS_UNVERIFIED', { addressVerified: false }, 10],
    ['HIGH_EXPECTED_VOLUME', { expectedMonthlyVolumeUsd: 50_001 }, 15],
    ['CASH_INTENSIVE_OCCUPATION', { occupation: 'car_dealer' }, 10],
  ] as const)('signal %s fires with weight %d', (code, overrides, weight) => {
    const r = computeRisk(baseCustomer(overrides as Partial<Customer>), NOW);
    const s = r.signals.find((x) => x.code === code);
    expect(s).toBeDefined();
    expect(s?.weight).toBe(weight);
  });

  it.each([
    ['HIGH_EXPECTED_VOLUME', { expectedMonthlyVolumeUsd: 50_000 }],
    ['CASH_INTENSIVE_OCCUPATION', { occupation: 'teacher' }],
    ['NEW_ACCOUNT', { accountOpenedAt: '2020-01-01T00:00:00Z' }],
    ['OPAQUE_SOURCE_OF_FUNDS', { sourceOfFunds: 'salary' }],
    ['DOCUMENT_EXPIRING', { idDocumentExpiresAt: '2026-07-15T00:00:00Z' }],
    ['DOCUMENT_EXPIRING', { idDocumentExpiresAt: null }],
  ] as const)('signal %s does not fire', (code, overrides) => {
    const r = computeRisk(baseCustomer(overrides as Partial<Customer>), NOW);
    expect(r.signals.find((x) => x.code === code)).toBeUndefined();
  });

  it('HIGH_RISK_JURISDICTION fires on residence or nationality only once', () => {
    const res = computeRisk(baseCustomer({ countryOfResidence: 'KP' }), NOW);
    expect(res.signals.filter((s) => s.code === 'HIGH_RISK_JURISDICTION')).toHaveLength(1);
    const nat = computeRisk(baseCustomer({ nationality: 'SY' }), NOW);
    expect(nat.signals.filter((s) => s.code === 'HIGH_RISK_JURISDICTION')).toHaveLength(1);
    const both = computeRisk(
      baseCustomer({ nationality: 'IR', countryOfResidence: 'IR' }),
      NOW,
    );
    expect(both.signals.filter((s) => s.code === 'HIGH_RISK_JURISDICTION')).toHaveLength(1);
  });

  it('ADVERSE_MEDIA is 10 per hit capped at 30', () => {
    expect(
      computeRisk(baseCustomer({ adverseMediaHits: 2 }), NOW).signals[0]?.weight,
    ).toBe(20);
    expect(
      computeRisk(baseCustomer({ adverseMediaHits: 5 }), NOW).signals[0]?.weight,
    ).toBe(30);
  });

  it('OPAQUE_SOURCE_OF_FUNDS fires for crypto/cash_intensive_business/unknown', () => {
    for (const sof of ['crypto', 'cash_intensive_business', 'unknown']) {
      const r = computeRisk(baseCustomer({ sourceOfFunds: sof }), NOW);
      expect(r.signals.find((s) => s.code === 'OPAQUE_SOURCE_OF_FUNDS')).toBeDefined();
    }
  });

  it('NEW_ACCOUNT fires only for accounts <30 days old', () => {
    const fresh = computeRisk(
      baseCustomer({ accountOpenedAt: '2026-05-15T00:00:00Z' }),
      NOW,
    );
    expect(fresh.signals.find((s) => s.code === 'NEW_ACCOUNT')).toBeDefined();
    const old = computeRisk(
      baseCustomer({ accountOpenedAt: '2026-04-01T00:00:00Z' }),
      NOW,
    );
    expect(old.signals.find((s) => s.code === 'NEW_ACCOUNT')).toBeUndefined();
  });

  it('clamps score to 100', () => {
    const r = computeRisk(
      baseCustomer({
        sanctionsHit: true,
        pepFlag: true,
        countryOfResidence: 'IR',
        adverseMediaHits: 4,
        idDocumentVerified: false,
        expectedMonthlyVolumeUsd: 100_000,
        sourceOfFunds: 'crypto',
      }),
      NOW,
    );
    expect(r.score).toBe(100);
    expect(r.level).toBe('high');
  });

  it('is deterministic', () => {
    const c = baseCustomer({ pepFlag: true, adverseMediaHits: 2 });
    expect(computeRisk(c, NOW)).toEqual(computeRisk(c, NOW));
  });

  it('honours a custom policy for weights and thresholds', () => {
    const policy = {
      ...DEFAULT_RISK_POLICY,
      weights: { ...DEFAULT_RISK_POLICY.weights, SANCTIONS_HIT: 80, PEP: 0 },
      thresholds: { medium: 10, high: 50 },
    };
    const r = computeRisk(baseCustomer({ sanctionsHit: true, pepFlag: true }), NOW, policy);
    expect(r.score).toBe(80);
    expect(r.level).toBe('high');
    expect(r.signals.map((s) => s.code)).toEqual(['SANCTIONS_HIT']);
    const low = computeRisk(baseCustomer({ addressVerified: false }), NOW, policy);
    expect(low.level).toBe('medium');
  });
});

describe('explainRisk', () => {
  it('returns factors with contributionPct summing ~100 and a summary', () => {
    const e = explainRisk('case-x', baseCustomer({ pepFlag: true, idDocumentVerified: false }), NOW);
    expect(e.caseId).toBe('case-x');
    expect(e.riskScore).toBe(50);
    expect(e.riskLevel).toBe('medium');
    expect(e.thresholds).toEqual({ medium: 30, high: 60 });
    expect(e.summary).toContain('50');
    expect(e.factors.map((f) => f.contributionPct)).toEqual([60, 40]);
  });

  it('contributionPct sums to 100 even when the score is clamped', () => {
    const e = explainRisk(
      'case-z',
      baseCustomer({ sanctionsHit: true, pepFlag: true, idDocumentVerified: false, addressVerified: false }),
      NOW,
    );
    expect(e.riskScore).toBe(100);
    expect(e.factors.reduce((sum, f) => sum + f.contributionPct, 0)).toBe(100);
  });

  it('reports whole elapsed days for expired documents', () => {
    const r = computeRisk(baseCustomer({ idDocumentExpiresAt: '2026-05-31T12:00:00Z' }), NOW);
    expect(r.signals.find((s) => s.code === 'DOCUMENT_EXPIRING')?.description).toBe(
      'ID document expired 0 day(s) ago.',
    );
  });

  it('contributionPct is 0 when score is 0', () => {
    const e = explainRisk('case-y', baseCustomer(), NOW);
    expect(e.riskScore).toBe(0);
    expect(e.factors).toHaveLength(0);
  });
});
