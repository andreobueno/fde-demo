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

export interface CurrentAnalyst extends Analyst {
  permissions: string[];
}

export interface Policy {
  version: number;
  requireApprovalNote: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PolicyUpdate {
  version: number;
  requireApprovalNote: boolean;
  reason: string;
}

export interface PolicyAuditEvent {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: AnalystRole;
  action: 'policy_updated';
  createdAt: string;
  reason: string;
  previousState: Policy;
  newState: Policy;
  prevHash: string;
  hash: string;
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
  signalId: string;
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
  rawScore: number;
  scoreCapped: boolean;
  summary: string;
  thresholds: { medium: number; high: number };
  factors: RiskFactor[];
  primaryDriver: RiskFactor | null;
}

export interface CaseDetail extends KycCase {
  customer: Customer;
  signals: RiskSignal[];
  audit: AuditEvent[];
  allowedActions: CaseAction[];
  approvalNoteRequired: boolean;
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
  approvalNoteRequired: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type RefundStatus = 'pending' | 'approved' | 'rejected';
export type RefundAction = 'approve' | 'reject';
export type RefundSort = 'reference' | 'customer' | 'amountCents' | 'status' | 'riskLevel' | 'createdAt';
export type RefundAmountBand = 'all' | 'under_1000' | '1000_to_5000' | 'over_5000';

export interface RefundAuditEvent extends Omit<AuditEvent, 'caseId'> {
  refundId: string;
}

export interface Refund {
  id: string;
  reference: string;
  customerId: string;
  customer: Pick<Customer, 'id' | 'fullName' | 'email'>;
  amountCents: number;
  currency: 'USD';
  status: RefundStatus;
  riskLevel: RiskLevel;
  reason: string;
  originalTransaction: { reference: string; amountCents: number; occurredAt: string };
  riskIndicators: { code: string; title: string; description: string; severity: SignalSeverity }[];
  createdAt: string;
  updatedAt: string;
}

export interface RefundDetail extends Refund {
  allowedActions: RefundAction[];
  approvalNoteRequired: true;
  audit: RefundAuditEvent[];
}

export interface RefundListResponse {
  items: Refund[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RefundStats {
  pendingCount: number;
  pendingAmountCents: number;
  approvedToday: number;
  rejectedToday: number;
}
