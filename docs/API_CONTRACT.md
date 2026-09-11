# KYC Review Console — API contract (v1)

Backend: Express + better-sqlite3, TypeScript. Base URL `http://localhost:4000`.
All responses JSON. Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }` with 400/401/403/404/409/500. Responses use `Cache-Control: no-store`.

## Identity (prototype assumption)
Every `/api` request except `GET /api/health` requires `x-analyst-id: <analystId>`. Unknown/missing id → 401, with no fallback identity. The server resolves roles from stored identities and ignores role headers. This header is a demo impersonation mechanism, not authentication; production must derive identity from validated SSO/OIDC sessions.

All roles read cases, audit history and policy, start review and escalate. Analysts cannot approve/reject. Seniors can approve/reject low/medium cases. Compliance managers can approve/reject any risk and change policy. The same decision rules apply to pending, in-review and escalated cases. No role may edit/delete audit history.

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
  sourceOfFunds: string; idDocumentType: string; idDocumentVerified: boolean; addressVerified: boolean;
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
- `GET /api/me` → `Analyst & { permissions: string[] }`
- `GET /api/analysts` → `Analyst[]`
- `GET /api/cases/stats` → `{ byStatus: Record<CaseStatus, number>; byRiskLevel: Record<RiskLevel, number>; total: number }`
- `GET /api/cases?status=&riskLevel=&q=&sort=&order=&page=&pageSize=`
  - `status`, `riskLevel`: comma-separated multi-value allowed
  - `q`: case-insensitive match on reference, customer fullName, email
  - `sort`: `createdAt | updatedAt | riskScore | reference | customer | country | status | assignedTo` (default `createdAt`), `order`: `asc|desc` (default `desc`). `customer`/`assignedTo` sort by name case-insensitively; unassigned cases sort last for `assignedTo`.
  - `page` ≥1 default 1, `pageSize` 1..100 default 25
  - → `{ items: KycCase[]; total: number; page: number; pageSize: number }`
- `GET /api/cases/:id` → `KycCase & { customer: Customer; signals: RiskSignal[]; audit: AuditEvent[]; allowedActions: CaseAction[]; approvalNoteRequired: boolean }`
- `GET /api/cases/:id/risk-explanation` → `RiskExplanation`
- `GET /api/cases/:id/audit` → `AuditEvent[]` (ascending by sequence)
- `POST /api/cases/:id/actions` body `{ action: CaseAction; note?: string }` header `x-analyst-id` required
  - strict body: unknown fields (including role, actor, risk or status) are rejected
  - transitions: `pending → in_review` (start_review); `pending|in_review → approved|rejected|escalated`; `escalated → approved|rejected`, always subject to role/risk permissions
  - `reject` and `escalate` require trimmed `note` (10..1000 chars)
  - `approve` requires 10..1000 chars when high risk (from any legal status), or when `policy.requireApprovalNote` is true. Other notes optional, ≤1000 trimmed chars.
  - invalid transition → 409 `INVALID_TRANSITION`; validation → 400 `VALIDATION_ERROR`; forbidden role → 403 `FORBIDDEN`
  - → `KycCase & { audit: AuditEvent[]; allowedActions: CaseAction[]; approvalNoteRequired: boolean }`

### Policy

```ts
interface Policy {
  version: number;
  requireApprovalNote: boolean;
  updatedAt: string;
  updatedBy: string | null;
}
interface PolicyAuditEvent {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: Analyst['role'];
  action: 'policy_updated';
  createdAt: string;
  reason: string;
  previousState: Policy;
  newState: Policy;
  prevHash: string;
  hash: string;
}
```

- `GET /api/policy` → `Policy`. Initial version 1, approval notes required, updatedBy null.
- `PUT /api/policy` → `Policy`. Manager only. Strict body `{ version: number; requireApprovalNote: boolean; reason: string }`. Trimmed reason 10..1000 chars. Stale version → 409 `POLICY_CONFLICT`; unchanged setting or invalid input → 400. Version increments with each change.
- `GET /api/policy/audit` → `PolicyAuditEvent[]`, ordered by new policy version.
- Policy updates and audit appends are atomic. This policy only controls low/medium approval notes; elevated roles and high-risk justification are fixed security boundaries.

## Risk engine (deterministic)
Score = sum of signal weights, clamped 0..100. Level: `<30 low`, `30..59 medium`, `≥60 high`.
Signal catalogue (code → weight): `SANCTIONS_HIT` 60, `PEP` 35, `HIGH_RISK_JURISDICTION` 25 (residence or nationality in list), `ADVERSE_MEDIA` 10 per hit (max 30), `ID_DOC_UNVERIFIED` 20, `ADDRESS_UNVERIFIED` 10, `HIGH_EXPECTED_VOLUME` 15 (>50k USD/month), `OPAQUE_SOURCE_OF_FUNDS` 15 (`crypto`, `cash_intensive_business`, `unknown`), `NEW_ACCOUNT` 5 (<30 days), `CASH_INTENSIVE_OCCUPATION` 10.

## Seed
`npm run seed` (destructive, drops+recreates including policy and both audit histories). 6 identities (3 analysts, 2 seniors, 1 compliance manager), ~60 customers/cases, deterministic PRNG seed `kyc-demo-2026`, fictional names — no real PII. Mix of statuses; audit chain includes creation event `CASE_CREATED`. Seeded decisions use actors authorized for the case's risk.
