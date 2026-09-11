export type CaseStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'escalated';
export type RiskLevel = 'low' | 'medium' | 'high';
export type CaseAction = 'approve' | 'reject' | 'escalate' | 'start_review';
export type SignalSeverity = 'low' | 'medium' | 'high';
export type AnalystRole = 'analyst' | 'senior_analyst' | 'compliance_manager';

export interface Analyst {
  id: string;
  name: string;
  role: AnalystRole;
}

export interface Customer {
  id: string;
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  countryOfResidence: string;
  occupation: string;
  email: string;
  accountOpenedAt: string;
  expectedMonthlyVolumeUsd: number;
  sourceOfFunds: string;
  idDocumentType: string;
  idDocumentExpiresAt: string | null;
  idDocumentVerified: boolean;
  addressVerified: boolean;
  pepFlag: boolean;
  sanctionsHit: boolean;
  adverseMediaHits: number;
}

export interface RiskSignal {
  id: string;
  caseId: string;
  code: string;
  title: string;
  description: string;
  severity: SignalSeverity;
  weight: number;
}

export interface KycCase {
  id: string;
  reference: string;
  customerId: string;
  status: CaseStatus;
  riskLevel: RiskLevel;
  riskScore: number;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  customer: Pick<Customer, 'id' | 'fullName' | 'countryOfResidence' | 'nationality'>;
}

export interface AuditEvent {
  id: string;
  caseId: string;
  sequence: number;
  actorId: string;
  actorName: string;
  action: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus | null;
  note: string | null;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export type PolicyRuleCode =
  | 'HIGH_RISK_JURISDICTION'
  | 'SANCTIONS_HIT'
  | 'PEP'
  | 'DOCUMENT_EXPIRING'
  | 'HIGH_EXPECTED_VOLUME'
  | 'ADVERSE_MEDIA'
  | 'ID_DOC_UNVERIFIED'
  | 'ADDRESS_UNVERIFIED'
  | 'OPAQUE_SOURCE_OF_FUNDS'
  | 'NEW_ACCOUNT'
  | 'CASH_INTENSIVE_OCCUPATION';

export interface RiskThresholds {
  medium: number;
  high: number;
}

export interface RiskPolicy {
  weights: Record<PolicyRuleCode, number>;
  thresholds: RiskThresholds;
}

export interface RiskPolicyRuleView {
  code: PolicyRuleCode;
  title: string;
  description: string;
  weight: number;
  defaultWeight: number;
}

export interface RiskPolicyView {
  rules: RiskPolicyRuleView[];
  thresholds: RiskThresholds;
  defaultThresholds: RiskThresholds;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface RiskPolicyChange {
  id: string;
  version: number;
  actorId: string;
  actorName: string;
  changes: Array<{ key: string; from: number; to: number }>;
  recomputedCases: number;
  createdAt: string;
}

export interface RiskExplanation {
  caseId: string;
  riskScore: number;
  riskLevel: RiskLevel;
  summary: string;
  thresholds: { medium: number; high: number };
  factors: Array<{
    code: string;
    title: string;
    description: string;
    severity: SignalSeverity;
    weight: number;
    contributionPct: number;
  }>;
}
