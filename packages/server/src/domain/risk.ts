import type {
  Customer,
  PolicyRuleCode,
  RiskExplanation,
  RiskLevel,
  RiskPolicy,
  RiskSignal,
  RiskThresholds,
  SignalSeverity,
} from '../types.js';
import { DEFAULT_RISK_POLICY, ruleDef } from './policy.js';

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
    const deltaDays =
      (new Date(customer.idDocumentExpiresAt).getTime() - now.getTime()) / DAY_MS;
    if (deltaDays < DOCUMENT_EXPIRING_DAYS) {
      fire(
        'DOCUMENT_EXPIRING',
        deltaDays < 0
          ? `ID document expired ${Math.floor(-deltaDays)} day(s) ago.`
          : `ID document expires in ${Math.floor(deltaDays)} day(s) (< ${DOCUMENT_EXPIRING_DAYS} days).`,
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

export function explainRisk(
  caseId: string,
  customer: Customer,
  now: Date,
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): RiskExplanation {
  const { score, level, signals } = computeRisk(customer, now, policy);
  return explainAssessment(caseId, score, level, signals, policy.thresholds);
}

/** Explains an already-computed (persisted) assessment without re-scoring it. */
export function explainAssessment(
  caseId: string,
  score: number,
  level: RiskLevel,
  signals: Signal[],
  thresholds: RiskThresholds,
): RiskExplanation {
  const rawTotal = signals.reduce((sum, s) => sum + s.weight, 0);
  const factors = signals.map((s) => ({
    code: s.code,
    title: s.title,
    description: s.description,
    severity: s.severity,
    weight: s.weight,
    contributionPct: rawTotal === 0 ? 0 : Math.round((s.weight / rawTotal) * 100),
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
    thresholds: { ...thresholds },
    factors,
  };
}
