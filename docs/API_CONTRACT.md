# KYC Review Console — API contract (v1)

Backend: Express + better-sqlite3, TypeScript. Base URL `http://localhost:4000`.
All responses JSON. Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }` with 400/404/409/500.

## Identity (prototype assumption)
Every request may carry `x-analyst-id: <analystId>`. Unknown/missing id → 401 on mutations, defaults to `ana-001` on reads.
Production requirement: SSO/OIDC session, RBAC. See README.

## Enums
- `CaseStatus`: `pending | in_review | approved | rejected | escalated`
- `RiskLevel`: `low | medium | high`
- `CaseAction`: `approve | reject | escalate | start_review`
- `SignalSeverity`: `low | medium | high`

## Types
```ts
interface Analyst { id: string; name: string; role: 'analyst' | 'senior_analyst' | 'compliance_manager' }
interface Customer {
  id: string; fullName: string; dateOfBirth: string; nationality: string; countryOfResidence: string;
  occupation: string; email: string; accountOpenedAt: string; expectedMonthlyVolumeUsd: number;
  sourceOfFunds: string; idDocumentType: string; idDocumentExpiresAt: string | null; idDocumentVerified: boolean; addressVerified: boolean;
  pepFlag: boolean; sanctionsHit: boolean; adverseMediaHits: number;
}
interface RiskSignal { id: string; caseId: string; code: string; title: string; description: string; severity: SignalSeverity; weight: number }
interface KycCase {
  id: string; reference: string; customerId: string; status: CaseStatus; riskLevel: RiskLevel; riskScore: number;
  assignedTo: string | null; createdAt: string; updatedAt: string;
  customer: Pick<Customer,'id'|'fullName'|'countryOfResidence'|'nationality'>;
}
interface AuditEvent {
  id: string; caseId: string; sequence: number; actorId: string; actorName: string; action: string;
  fromStatus: CaseStatus | null; toStatus: CaseStatus | null; note: string | null; createdAt: string;
  prevHash: string; hash: string;   // sha256 chain: hash = sha256(prevHash + canonical(event fields))
}
interface RiskExplanation {
  caseId: string; riskScore: number; riskLevel: RiskLevel; summary: string;
  thresholds: { medium: number; high: number };
  factors: Array<{ code: string; title: string; description: string; severity: SignalSeverity; weight: number; contributionPct: number }>;
}
```

## Endpoints
- `GET /api/health` → `{ ok: true }`
- `GET /api/me` → `Analyst`
- `GET /api/analysts` → `Analyst[]`
- `GET /api/cases/stats` → `{ byStatus: Record<CaseStatus, number>; byRiskLevel: Record<RiskLevel, number>; total: number }`
- `GET /api/cases?status=&riskLevel=&q=&sort=&order=&page=&pageSize=`
  - `status`, `riskLevel`: comma-separated multi-value allowed
  - `q`: case-insensitive match on reference, customer fullName, email
  - `sort`: `createdAt | updatedAt | riskScore | reference | customer | country | status | assignedTo` (default `createdAt`), `order`: `asc|desc` (default `desc`). `customer`/`assignedTo` sort by name case-insensitively; unassigned cases sort last for `assignedTo`.
  - `page` ≥1 default 1, `pageSize` 1..100 default 25
  - → `{ items: KycCase[]; total: number; page: number; pageSize: number }`
- `GET /api/cases/:id` → `KycCase & { customer: Customer; signals: RiskSignal[]; audit: AuditEvent[]; allowedActions: CaseAction[] }`
- `GET /api/cases/:id/risk-explanation` → `RiskExplanation` (built from the persisted score/signals — for closed cases this is the assessment the decision was made under, not a re-score under the current policy; `contributionPct` is relative to the unclamped sum of weights, so it totals 100)
- `GET /api/cases/:id/audit` → `AuditEvent[]` (ascending by sequence)
- `POST /api/cases/:id/actions` body `{ action: CaseAction; note?: string }` header `x-analyst-id` required
  - transitions: `pending → in_review` (start_review); `pending|in_review → approved|rejected|escalated`; `escalated → approved|rejected` (only `senior_analyst`)
  - `reject` and `escalate` require `note` (10..1000 chars); `approve` note optional (≤1000)
  - approving a `high` risk case from `pending|in_review` requires a note
  - invalid transition → 409 `INVALID_TRANSITION`; validation → 400 `VALIDATION_ERROR`; forbidden role → 403 `FORBIDDEN`
  - → `KycCase & { audit: AuditEvent[]; allowedActions: CaseAction[] }`
- `GET /api/policy` → `RiskPolicy` = `{ rules: { code, title, description, weight, defaultWeight }[]; thresholds: { medium, high }; defaultThresholds; version; updatedAt; updatedBy }`
- `GET /api/policy/history` → `RiskPolicyChange[]` = `{ id, version, actorId, actorName, changes: { key, from, to }[], recomputedCases, createdAt }[]` (newest first)
- `PUT /api/policy` body `{ weights?: Record<RuleCode, int 0..100>; thresholds?: { medium?: int 1..100; high?: int 1..100 } }` header `x-analyst-id` required, role `compliance_manager` (else 403 `FORBIDDEN`)
  - `medium < high` enforced against the merged policy; unknown rule codes → 400 `VALIDATION_ERROR`
  - re-scores open cases (`pending|in_review|escalated`) in the same transaction, appends `RISK_RESCORED` audit events for changed cases; closed cases untouched
  - → `{ policy: RiskPolicy; change: RiskPolicyChange | null }` (`change` is `null` when the patch is a no-op)

## Risk engine (deterministic, policy-driven)
Score = sum of signal weights, clamped 0..100. Level: `<medium low`, `medium..high-1 medium`, `≥high high`; default thresholds 30 / 60. Weights and thresholds come from the persisted risk policy (`risk_policy` table), editable via `PUT /api/policy`.
Default catalogue (code → weight): `SANCTIONS_HIT` 40, `PEP` 30, `HIGH_RISK_JURISDICTION` 25 (residence or nationality in list), `ADVERSE_MEDIA` 10 per hit (max 30), `ID_DOC_UNVERIFIED` 20, `DOCUMENT_EXPIRING` 10 (ID document expires <30 days), `ADDRESS_UNVERIFIED` 10, `HIGH_EXPECTED_VOLUME` 15 (>50k USD/month), `OPAQUE_SOURCE_OF_FUNDS` 15 (`crypto`, `cash_intensive_business`, `unknown`), `NEW_ACCOUNT` 5 (<30 days), `CASH_INTENSIVE_OCCUPATION` 10.

## Seed
`npm run seed` (idempotent, drops+recreates). 6 analysts (2 senior, 1 compliance manager), ~60 customers/cases, deterministic PRNG seed `kyc-demo-2026`, fictional names (`faker` with fixed seed OK) — no real PII. Mix of statuses; audit chain includes creation event `CASE_CREATED`.
