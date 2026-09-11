import type {
  Customer,
  KycCase,
  PolicyRuleCode,
  RiskExplanation,
  RiskLevel,
  RiskPolicy,
  RiskSignal,
  RiskThresholds,
  SignalSeverity,
} from '../types.js';
import { DEFAULT_RISK_POLICY, ruleDef } from './riskPolicy.js';

export const RISK_THRESHOLDS = DEFAULT_RISK_POLICY.thresholds;

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
export const DOCUMENT_EXPIRING_DAYS = 30;
export const ADVERSE_MEDIA_MAX_HITS = 3;

type Signal = Omit<RiskSignal, 'id' | 'caseId'>;

const DAY_MS = 1000 * 60 * 60 * 24;

export function riskLevelFor(score: number, policy: RiskPolicy): RiskLevel {
  return score >= policy.thresholds.high
    ? 'high'
    : score >= policy.thresholds.medium
      ? 'medium'
      : 'low';
}

export function computeRisk(
  customer: Customer,
  now: Date,
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): { score: number; level: RiskLevel; signals: Signal[] } {
  const signals: Signal[] = [];

  const fire = (
    code: PolicyRuleCode,
    description: string,
    overrides: { weight?: number; severity?: SignalSeverity } = {},
  ) => {
    const def = ruleDef(code);
    const weight = overrides.weight ?? policy.weights[code];
    if (weight <= 0) return;
    signals.push({
      code,
      title: def.title,
      description,
      severity: overrides.severity ?? def.severity,
      weight,
    });
  };

  if (customer.sanctionsHit) {
    fire(
      'SANCTIONS_HIT',
      'Customer has a potential sanctions list match requiring immediate review.',
    );
  }

  if (customer.pepFlag) {
    fire('PEP', 'Customer is identified as a politically exposed person (PEP).');
  }

  if (
    HIGH_RISK_JURISDICTIONS.includes(customer.countryOfResidence) ||
    HIGH_RISK_JURISDICTIONS.includes(customer.nationality)
  ) {
    fire(
      'HIGH_RISK_JURISDICTION',
      `Residence (${customer.countryOfResidence}) or nationality (${customer.nationality}) is in a high-risk jurisdiction.`,
    );
  }

  if (customer.idDocumentExpiresAt) {
    const daysToExpiry = Math.floor(
      (new Date(customer.idDocumentExpiresAt).getTime() - now.getTime()) / DAY_MS,
    );
    if (daysToExpiry < DOCUMENT_EXPIRING_DAYS) {
      fire(
        'DOCUMENT_EXPIRING',
        daysToExpiry < 0
          ? `ID document expired ${-daysToExpiry} day(s) ago.`
          : `ID document expires in ${daysToExpiry} day(s) (< ${DOCUMENT_EXPIRING_DAYS} days).`,
      );
    }
  }

  if (customer.adverseMediaHits > 0) {
    const perHit = policy.weights.ADVERSE_MEDIA;
    const hits = Math.min(customer.adverseMediaHits, ADVERSE_MEDIA_MAX_HITS);
    const weight = perHit * hits;
    fire(
      'ADVERSE_MEDIA',
      `${customer.adverseMediaHits} adverse media hit(s) found (${perHit} points each, capped at ${ADVERSE_MEDIA_MAX_HITS} hits).`,
      { weight, severity: hits >= ADVERSE_MEDIA_MAX_HITS ? 'high' : 'medium' },
    );
  }

  if (!customer.idDocumentVerified) {
    fire('ID_DOC_UNVERIFIED', 'Customer identity document has not been verified.');
  }

  if (!customer.addressVerified) {
    fire('ADDRESS_UNVERIFIED', 'Customer address has not been verified.');
  }

  if (customer.expectedMonthlyVolumeUsd > HIGH_EXPECTED_VOLUME_USD) {
    fire(
      'HIGH_EXPECTED_VOLUME',
      `Expected monthly volume of $${customer.expectedMonthlyVolumeUsd.toLocaleString('en-US')} exceeds $${HIGH_EXPECTED_VOLUME_USD.toLocaleString('en-US')}.`,
    );
  }

  if (OPAQUE_SOURCES_OF_FUNDS.includes(customer.sourceOfFunds)) {
    fire(
      'OPAQUE_SOURCE_OF_FUNDS',
      `Declared source of funds "${customer.sourceOfFunds}" is difficult to verify.`,
    );
  }

  const accountAgeDays = (now.getTime() - new Date(customer.accountOpenedAt).getTime()) / DAY_MS;
  if (accountAgeDays >= 0 && accountAgeDays < NEW_ACCOUNT_DAYS) {
    fire(
      'NEW_ACCOUNT',
      `Account opened ${Math.floor(accountAgeDays)} day(s) ago (< ${NEW_ACCOUNT_DAYS} days).`,
    );
  }

  if (CASH_INTENSIVE_OCCUPATIONS.includes(customer.occupation)) {
    fire(
      'CASH_INTENSIVE_OCCUPATION',
      `Occupation "${customer.occupation}" is associated with cash-intensive activity.`,
    );
  }

  const rawScore = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.min(Math.max(rawScore, 0), 100);

  return { score, level: riskLevelFor(score, policy), signals };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function explainRisk(
  kase: Pick<KycCase, 'id' | 'riskScore' | 'riskLevel'>,
  signals: readonly RiskSignal[],
  thresholds: RiskThresholds = RISK_THRESHOLDS,
): RiskExplanation {
  const { id: caseId, riskScore, riskLevel } = kase;
  const sortedSignals = [...signals].sort((a, b) =>
    b.weight - a.weight || compareStrings(a.code, b.code) || compareStrings(a.id, b.id),
  );
  const rawScore = sortedSignals.reduce((sum, s) => sum + s.weight, 0);
  const factors = sortedSignals.map((s) => ({
    signalId: s.id,
    code: s.code,
    title: s.title,
    description: s.description,
    severity: s.severity,
    weight: s.weight,
    contributionPct: rawScore === 0 ? 0 : Math.round((s.weight / rawScore) * 100),
  }));
  const primaryDriver = factors[0] ?? null;

  let summary = `Case ${caseId} has a recorded score of ${riskScore} (${riskLevel} risk): ${
    primaryDriver
      ? `${factors.length} recorded signal(s) totaling ${rawScore} points; primary driver: ${primaryDriver.title}.`
      : 'no risk signals were recorded.'
  }`;
  if (riskScore !== Math.min(Math.max(rawScore, 0), 100)) {
    summary += ' The recorded score does not match the recorded weights after the 0-100 cap.';
  }
  const levelForScore =
    riskScore >= thresholds.high ? 'high' : riskScore >= thresholds.medium ? 'medium' : 'low';
  if (riskLevel !== levelForScore) {
    summary += ' The recorded risk level does not match the score thresholds.';
  }

  return {
    caseId,
    riskScore,
    riskLevel,
    rawScore,
    scoreCapped: rawScore > 100,
    primaryDriver,
    summary,
    thresholds: { ...thresholds },
    factors,
  };
}
