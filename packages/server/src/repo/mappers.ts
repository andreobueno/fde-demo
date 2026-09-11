import type { Analyst, AuditEvent, CaseStatus, Customer, KycCase, RiskSignal } from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function rowToAnalyst(r: any): Analyst {
  return { id: r.id, name: r.name, role: r.role };
}

export function rowToCustomer(r: any): Customer {
  return {
    id: r.id,
    fullName: r.full_name,
    dateOfBirth: r.date_of_birth,
    nationality: r.nationality,
    countryOfResidence: r.country_of_residence,
    occupation: r.occupation,
    email: r.email,
    accountOpenedAt: r.account_opened_at,
    expectedMonthlyVolumeUsd: r.expected_monthly_volume_usd,
    sourceOfFunds: r.source_of_funds,
    idDocumentType: r.id_document_type,
    idDocumentVerified: !!r.id_document_verified,
    addressVerified: !!r.address_verified,
    pepFlag: !!r.pep_flag,
    sanctionsHit: !!r.sanctions_hit,
    adverseMediaHits: r.adverse_media_hits,
  };
}

export function rowToKycCase(r: any): KycCase {
  return {
    id: r.id,
    reference: r.reference,
    customerId: r.customer_id,
    status: r.status,
    riskLevel: r.risk_level,
    riskScore: r.risk_score,
    assignedTo: r.assigned_to ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    customer: {
      id: r.cust_id,
      fullName: r.cust_full_name,
      countryOfResidence: r.cust_country_of_residence,
      nationality: r.cust_nationality,
    },
  };
}

export function rowToRiskSignal(r: any): RiskSignal {
  return {
    id: r.id,
    caseId: r.case_id,
    code: r.code,
    title: r.title,
    description: r.description,
    severity: r.severity,
    weight: r.weight,
  };
}

export function rowToAuditEvent(r: any): AuditEvent {
  return {
    id: r.id,
    caseId: r.case_id,
    sequence: r.sequence,
    actorId: r.actor_id,
    actorName: r.actor_name,
    action: r.action,
    fromStatus: (r.from_status ?? null) as CaseStatus | null,
    toStatus: (r.to_status ?? null) as CaseStatus | null,
    note: r.note ?? null,
    createdAt: r.created_at,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}
