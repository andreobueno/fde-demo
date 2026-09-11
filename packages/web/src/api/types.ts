export type CaseStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'escalated';
export type RiskLevel = 'low' | 'medium' | 'high';
export type CaseAction = 'approve' | 'reject' | 'escalate' | 'start_review';
export type SignalSeverity = 'low' | 'medium' | 'high';
export type AnalystRole = 'analyst' | 'senior_analyst' | 'compliance_manager';
export type CaseSort =
  | 'createdAt'
  | 'updatedAt'
  | 'riskScore'
  | 'reference'
  | 'customer'
  | 'country'
  | 'status'
  | 'assignedTo';
export type SortOrder = 'asc' | 'desc';

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

export interface RiskFactor {
  code: string;
  title: string;
  description: string;
  severity: SignalSeverity;
  weight: number;
  contributionPct: number;
}

export interface RiskExplanation {
  caseId: string;
  riskScore: number;
  riskLevel: RiskLevel;
  summary: string;
  thresholds: { medium: number; high: number };
  factors: RiskFactor[];
}

export interface CaseDetail extends KycCase {
  customer: Customer;
  signals: RiskSignal[];
  audit: AuditEvent[];
  allowedActions: CaseAction[];
}

export interface CaseListResponse {
  items: KycCase[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CaseStats {
  byStatus: Record<CaseStatus, number>;
  byRiskLevel: Record<RiskLevel, number>;
  total: number;
}

export interface ActionResponse extends KycCase {
  audit: AuditEvent[];
  allowedActions: CaseAction[];
}

export interface RiskThresholds {
  medium: number;
  high: number;
}

export interface RiskPolicyRule {
  code: string;
  title: string;
  description: string;
  weight: number;
  defaultWeight: number;
}

export interface RiskPolicy {
  rules: RiskPolicyRule[];
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

export interface RiskPolicyPatch {
  weights?: Record<string, number>;
  thresholds?: Partial<RiskThresholds>;
}

export interface RiskPolicyUpdateResponse {
  policy: RiskPolicy;
  change: RiskPolicyChange | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
