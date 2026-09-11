// API payload types — copied from docs/API_CONTRACT.md (v1).

export type CaseStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'escalated';
export type RiskLevel = 'low' | 'medium' | 'high';
export type CaseAction = 'approve' | 'reject' | 'escalate' | 'start_review';
export type SignalSeverity = 'low' | 'medium' | 'high';
export type AnalystRole = 'analyst' | 'senior_analyst' | 'compliance_manager';

export const CASE_STATUSES: readonly CaseStatus[] = [
  'pending',
  'in_review',
  'approved',
  'rejected',
  'escalated',
];
export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];
export const CASE_ACTIONS: readonly CaseAction[] = ['start_review', 'approve', 'reject', 'escalate'];

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

export interface CaseStats {
  byStatus: Record<CaseStatus, number>;
  byRiskLevel: Record<RiskLevel, number>;
  total: number;
}

export interface CaseListResponse {
  items: KycCase[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CaseDetail extends KycCase {
  customer: Customer;
  signals: RiskSignal[];
  audit: AuditEvent[];
  allowedActions: CaseAction[];
}

export interface ActionResponse extends KycCase {
  audit: AuditEvent[];
  allowedActions: CaseAction[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
