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

export type RefundStatus = 'pending' | 'approved' | 'rejected';
export type RefundAction = 'approve' | 'reject';
export type RefundAuditEvent = Omit<AuditEvent, 'caseId'> & { refundId: string };

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
  originalTransaction: {
    reference: string;
    amountCents: number;
    occurredAt: string;
  };
  riskIndicators: Array<{
    code: string;
    title: string;
    description: string;
    severity: RiskLevel;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface RefundDetail extends Refund {
  allowedActions: RefundAction[];
  approvalNoteRequired: true;
  audit: RefundAuditEvent[];
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
  primaryDriver: RiskFactor | null;
  summary: string;
  thresholds: { medium: number; high: number };
  factors: RiskFactor[];
}
