import { describe, expect, it } from 'vitest';
import { computeRisk, explainRisk } from './risk.js';
import type { Customer, RiskSignal } from '../types.js';

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
    idDocumentVerified: true,
    addressVerified: true,
    pepFlag: false,
    sanctionsHit: false,
    adverseMediaHits: 0,
    ...overrides,
  };
}

function recordedSignal(overrides: Partial<RiskSignal> = {}): RiskSignal {
  return {
    id: 'signal-pep',
    caseId: 'case-x',
    code: 'PEP',
    title: 'Politically exposed person',
    description: 'PEP flag recorded during the original review.',
    severity: 'high',
    weight: 35,
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
    // 60 → high
    const high = computeRisk(baseCustomer({ sanctionsHit: true }), NOW);
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
    ['SANCTIONS_HIT', { sanctionsHit: true }, 60],
    ['PEP', { pepFlag: true }, 35],
    ['HIGH_RISK_JURISDICTION', { countryOfResidence: 'IR' }, 25],
    ['ADVERSE_MEDIA', { adverseMediaHits: 4 }, 30],
    ['ID_DOC_UNVERIFIED', { idDocumentVerified: false }, 20],
    ['ADDRESS_UNVERIFIED', { addressVerified: false }, 10],
    ['HIGH_EXPECTED_VOLUME', { expectedMonthlyVolumeUsd: 50_001 }, 15],
    ['OPAQUE_SOURCE_OF_FUNDS', { sourceOfFunds: 'crypto' }, 15],
    ['NEW_ACCOUNT', { accountOpenedAt: '2026-05-20T00:00:00Z' }, 5],
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
});

describe('explainRisk', () => {
  const kase = { id: 'case-x', riskScore: 55, riskLevel: 'medium' } as const;
  const signals = [
    recordedSignal(),
    recordedSignal({
      id: 'signal-id',
      code: 'ID_DOC_UNVERIFIED',
      title: 'ID document unverified',
      description: 'Identity document was unverified at the time of review.',
      severity: 'medium',
      weight: 20,
    }),
  ];

  it('returns factors with contributionPct summing ~100 and a summary', () => {
    const e = explainRisk(kase, signals);
    expect(e.caseId).toBe('case-x');
    expect(e.riskScore).toBe(55);
    expect(e.riskLevel).toBe('medium');
    expect(e.rawScore).toBe(55);
    expect(e.scoreCapped).toBe(false);
    expect(e.thresholds).toEqual({ medium: 30, high: 60 });
    expect(e.summary).toContain('55');
    expect(e.summary).toContain('primary driver: Politically exposed person');
    expect(e.summary).not.toContain('does not match');
    expect(e.factors).toEqual(signals.map((s, index) => ({
      signalId: s.id,
      code: s.code,
      title: s.title,
      description: s.description,
      severity: s.severity,
      weight: s.weight,
      contributionPct: [64, 36][index],
    })));
    expect(e.primaryDriver).toEqual(e.factors[0]);
  });

  it('is deterministic for repeated and reordered input without mutating stored evidence', () => {
    const input = Object.freeze(signals.map((s) => Object.freeze({ ...s })));
    const first = explainRisk(kase, input);
    expect(explainRisk(kase, input)).toEqual(first);
    expect(explainRisk(kase, [...input].reverse())).toEqual(first);
    expect(input).toEqual(signals);
  });

  it('orders by weight, then code and signal ID using stable string comparison for the primary tie', () => {
    const input = [
      recordedSignal({ id: 'signal-z', code: 'z' }),
      recordedSignal({ id: 'signal-a', code: 'Z' }),
      recordedSignal({ id: 'signal-A', code: 'Z' }),
      recordedSignal({ id: 'signal-low', code: 'A', weight: 5 }),
    ];
    const e = explainRisk({ ...kase, riskScore: 100, riskLevel: 'high' }, input);
    expect(e.factors.map((f) => f.signalId)).toEqual([
      'signal-A', 'signal-a', 'signal-z', 'signal-low',
    ]);
    expect(e.primaryDriver).toEqual(e.factors[0]);
    expect(e.primaryDriver?.signalId).toBe('signal-A');
    expect(explainRisk({ ...kase, riskScore: 100, riskLevel: 'high' }, [...input].reverse())).toEqual(e);
  });

  it('reports absent evidence without inventing factors for a recorded score', () => {
    const e = explainRisk(kase, []);
    expect(e.riskScore).toBe(55);
    expect(e.riskLevel).toBe('medium');
    expect(e.rawScore).toBe(0);
    expect(e.scoreCapped).toBe(false);
    expect(e.factors).toEqual([]);
    expect(e.primaryDriver).toBeNull();
    expect(e.summary).toContain('no risk signals were recorded');
    expect(e.summary).toContain('recorded score does not match');
  });

  it('returns a zero-score explanation for empty evidence', () => {
    const e = explainRisk({ ...kase, riskScore: 0, riskLevel: 'low' }, []);
    expect(e.riskScore).toBe(0);
    expect(e.factors).toHaveLength(0);
    expect(e.primaryDriver).toBeNull();
    expect(e.summary).not.toContain('does not match');
  });

  it('contributionPct is 0 for a recorded factor when the raw total is 0', () => {
    const e = explainRisk(kase, [recordedSignal({ weight: 0 })]);
    expect(e.rawScore).toBe(0);
    expect(e.factors[0]?.contributionPct).toBe(0);
  });

  it('uses raw weights above 100 as the percentage denominator', () => {
    const e = explainRisk({ ...kase, riskScore: 100, riskLevel: 'high' }, [
      ...signals,
      recordedSignal({
        id: 'signal-sanctions',
        code: 'SANCTIONS_HIT',
        title: 'Sanctions list match',
        weight: 60,
      }),
    ]);
    expect(e.riskScore).toBe(100);
    expect(e.rawScore).toBe(115);
    expect(e.scoreCapped).toBe(true);
    expect(e.factors.map((f) => f.contributionPct)).toEqual([52, 30, 17]);
    expect(e.summary).not.toContain('does not match');
  });

  it('does not mark an exact raw total of 100 as capped', () => {
    const e = explainRisk({ ...kase, riskScore: 100, riskLevel: 'high' }, [
      recordedSignal({ weight: 100 }),
    ]);
    expect(e.rawScore).toBe(100);
    expect(e.scoreCapped).toBe(false);
  });

  it('preserves inconsistent recorded scores and levels while flagging the discrepancy', () => {
    const e = explainRisk({ ...kase, riskScore: 80, riskLevel: 'low' }, signals);
    expect(e.riskScore).toBe(80);
    expect(e.riskLevel).toBe('low');
    expect(e.rawScore).toBe(55);
    expect(e.factors.map((f) => f.contributionPct)).toEqual([64, 36]);
    expect(e.summary).toContain('80 (low risk)');
    expect(e.summary).toContain('recorded score does not match');
    expect(e.summary).toContain('recorded risk level does not match');
  });
});
