import type { Customer, RiskExplanation, RiskLevel, RiskSignal, SignalSeverity } from '../types.js';

export const RISK_THRESHOLDS = { medium: 30, high: 60 } as const;

export const HIGH_RISK_JURISDICTIONS: readonly string[] = [
  'IR',
  'KP',
  'SY',
  'MM',
  'AF',
  'YE',
  'BY',
  'CU',
  'NI',
  'VE',
];

export const OPAQUE_SOURCES_OF_FUNDS: readonly string[] = [
  'crypto',
  'cash_intensive_business',
  'unknown',
];

export const CASH_INTENSIVE_OCCUPATIONS: readonly string[] = [
  'restaurant_owner',
  'car_dealer',
  'construction_contractor',
  'vending_machine_operator',
  'casino_operator',
  'money_service_business',
  'pawnbroker',
  'jewelry_dealer',
];

export const HIGH_EXPECTED_VOLUME_USD = 50_000;
export const NEW_ACCOUNT_DAYS = 30;

interface SignalDef {
  code: string;
  title: string;
  severity: SignalSeverity;
  weight: number;
  description: string;
}

function buildSignal(def: SignalDef): Omit<RiskSignal, 'id' | 'caseId'> {
  return {
    code: def.code,
    title: def.title,
    description: def.description,
    severity: def.severity,
    weight: def.weight,
  };
}

export function computeRisk(
  customer: Customer,
  now: Date,
): { score: number; level: RiskLevel; signals: Omit<RiskSignal, 'id' | 'caseId'>[] } {
  const signals: Omit<RiskSignal, 'id' | 'caseId'>[] = [];

  if (customer.sanctionsHit) {
    signals.push(
      buildSignal({
        code: 'SANCTIONS_HIT',
        title: 'Sanctions list match',
        severity: 'high',
        weight: 60,
        description: 'Customer has a potential sanctions list match requiring immediate review.',
      }),
    );
  }

  if (customer.pepFlag) {
    signals.push(
      buildSignal({
        code: 'PEP',
        title: 'Politically exposed person',
        severity: 'high',
        weight: 35,
        description: 'Customer is identified as a politically exposed person (PEP).',
      }),
    );
  }

  if (
    HIGH_RISK_JURISDICTIONS.includes(customer.countryOfResidence) ||
    HIGH_RISK_JURISDICTIONS.includes(customer.nationality)
  ) {
    signals.push(
      buildSignal({
        code: 'HIGH_RISK_JURISDICTION',
        title: 'High-risk jurisdiction',
        severity: 'high',
        weight: 25,
        description: `Residence (${customer.countryOfResidence}) or nationality (${customer.nationality}) is in a high-risk jurisdiction.`,
      }),
    );
  }

  if (customer.adverseMediaHits > 0) {
    const weight = Math.min(customer.adverseMediaHits * 10, 30);
    signals.push(
      buildSignal({
        code: 'ADVERSE_MEDIA',
        title: 'Adverse media',
        severity: weight >= 30 ? 'high' : 'medium',
        weight,
        description: `${customer.adverseMediaHits} adverse media hit(s) found (10 points each, capped at 30).`,
      }),
    );
  }

  if (!customer.idDocumentVerified) {
    signals.push(
      buildSignal({
        code: 'ID_DOC_UNVERIFIED',
        title: 'ID document unverified',
        severity: 'medium',
        weight: 20,
        description: 'Customer identity document has not been verified.',
      }),
    );
  }

  if (!customer.addressVerified) {
    signals.push(
      buildSignal({
        code: 'ADDRESS_UNVERIFIED',
        title: 'Address unverified',
        severity: 'low',
        weight: 10,
        description: 'Customer address has not been verified.',
      }),
    );
  }

  if (customer.expectedMonthlyVolumeUsd > HIGH_EXPECTED_VOLUME_USD) {
    signals.push(
      buildSignal({
        code: 'HIGH_EXPECTED_VOLUME',
        title: 'High expected volume',
        severity: 'medium',
        weight: 15,
        description: `Expected monthly volume of $${customer.expectedMonthlyVolumeUsd.toLocaleString('en-US')} exceeds $${HIGH_EXPECTED_VOLUME_USD.toLocaleString('en-US')}.`,
      }),
    );
  }

  if (OPAQUE_SOURCES_OF_FUNDS.includes(customer.sourceOfFunds)) {
    signals.push(
      buildSignal({
        code: 'OPAQUE_SOURCE_OF_FUNDS',
        title: 'Opaque source of funds',
        severity: 'medium',
        weight: 15,
        description: `Declared source of funds "${customer.sourceOfFunds}" is difficult to verify.`,
      }),
    );
  }

  const accountAgeDays =
    (now.getTime() - new Date(customer.accountOpenedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (accountAgeDays >= 0 && accountAgeDays < NEW_ACCOUNT_DAYS) {
    signals.push(
      buildSignal({
        code: 'NEW_ACCOUNT',
        title: 'New account',
        severity: 'low',
        weight: 5,
        description: `Account opened ${Math.floor(accountAgeDays)} day(s) ago (< ${NEW_ACCOUNT_DAYS} days).`,
      }),
    );
  }

  if (CASH_INTENSIVE_OCCUPATIONS.includes(customer.occupation)) {
    signals.push(
      buildSignal({
        code: 'CASH_INTENSIVE_OCCUPATION',
        title: 'Cash-intensive occupation',
        severity: 'low',
        weight: 10,
        description: `Occupation "${customer.occupation}" is associated with cash-intensive activity.`,
      }),
    );
  }

  const rawScore = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.min(Math.max(rawScore, 0), 100);
  const level: RiskLevel =
    score >= RISK_THRESHOLDS.high ? 'high' : score >= RISK_THRESHOLDS.medium ? 'medium' : 'low';

  return { score, level, signals };
}

export function explainRisk(
  caseId: string,
  customer: Customer,
  now: Date,
): RiskExplanation {
  const { score, level, signals } = computeRisk(customer, now);
  const factors = signals.map((s) => ({
    code: s.code,
    title: s.title,
    description: s.description,
    severity: s.severity,
    weight: s.weight,
    contributionPct: score === 0 ? 0 : Math.round((s.weight / score) * 100),
  }));

  const summary =
    signals.length === 0
      ? `Case ${caseId} scored ${score} (${level} risk): no risk signals were triggered.`
      : `Case ${caseId} scored ${score} (${level} risk) driven by ${signals.length} signal(s); top contributor: ${signals.reduce((a, b) => (b.weight > a.weight ? b : a)).title}.`;

  return {
    caseId,
    riskScore: score,
    riskLevel: level,
    summary,
    thresholds: { medium: RISK_THRESHOLDS.medium, high: RISK_THRESHOLDS.high },
    factors,
  };
}
