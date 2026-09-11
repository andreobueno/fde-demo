# KYC Review Console — API contract (v1)

Backend: Express + better-sqlite3, TypeScript. Base URL `http://localhost:4000`.
All responses JSON. Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }` with 400/401/403/404/409/500. Responses use `Cache-Control: no-store`.

## Authentication and identity
Every API data/action request except `GET /api/health` requires `Authorization: Bearer <token>`.
CORS `OPTIONS` preflight returns protocol headers only; the subsequent data/action request still requires authentication.
An administrator provisions a per-user, 43-character base64url credential through the local CLI
documented in the root README. Only its SHA-256 hash is stored; it expires after eight hours and
can be revoked. No default credential is seeded.

Missing, malformed, unknown, expired or revoked credentials → generic `401`, without a fallback
identity. The server derives the actor and current role from the token's stored identity.
`x-analyst-id` is optional and only checks expected identity: a mismatch → `403`. Supplying an ID,
role header or request-body actor cannot authenticate or switch the caller.

`GET /api/me` verifies the credential and returns the current identity and permissions. The
authenticated analyst directory contains no credentials or hashes. Production provisioning and
sign-in should use controlled SSO/OIDC; this prototype uses locally issued credentials.

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
interface RiskFactor {
  signalId: string; code: string; title: string; description: string;
  severity: SignalSeverity; weight: number; contributionPct: number;
}
interface RiskExplanation {
  caseId: string; riskScore: number; riskLevel: RiskLevel; summary: string;
  rawScore: number; scoreCapped: boolean; primaryDriver: RiskFactor | null;
  thresholds: { medium: number; high: number };
  factors: RiskFactor[];
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
  - Uses the persisted case `riskScore`/`riskLevel` and recorded `risk_signals`, matching case details. Closed cases retain the assessment used for their decision. Reads do not evaluate current customer fields, use the current clock, or mutate the case/signals.
  - Every factor's `signalId` is the stored signal's `id`. Its code, title, description, severity and weight are returned as recorded; descriptions provide the supporting evidence. No source documents, evidence values, transaction velocity data or LLM text are generated.
  - `factors` are sorted by weight descending, then code ascending, then signal ID ascending. String ties use deterministic, case-sensitive JavaScript string comparison (`<`/`>`), independent of locale. `primaryDriver` is the first factor in this order, or `null` when empty.
  - `rawScore` is the sum of all recorded signal weights. `scoreCapped` is `rawScore > 100`; scores from the risk engine are capped at 100. Neither field overwrites the persisted score or level.
  - `contributionPct` uses largest-remainder apportionment of `weight / rawScore * 100`: floor each share, then distribute remaining percentage points by fractional remainder descending, breaking ties by the deterministic factor order above. Percentages sum to exactly 100 when the raw total is positive, or are all 0 when it is 0. The denominator is the raw total, including when it exceeds 100, not the capped case score.
  - `summary` is a deterministic template reporting the recorded score/level and primary driver. With no evidence, it reports that no signals were recorded and returns `factors: []`, `rawScore: 0`, `scoreCapped: false`, `primaryDriver: null`. It flags discrepancies between the recorded score and capped signal total, or between the recorded level and score thresholds, without inventing factors or changing stored values.
  - Requires the same known analyst identity and `cases:read` permission as before. Missing/unknown analyst ID → 401; an unknown case with an authorized identity → 404 `NOT_FOUND`.
- `GET /api/cases/:id/audit` → `AuditEvent[]` (ascending by sequence)
- `POST /api/cases/:id/actions` body `{ action: CaseAction; note?: string }`, bearer credential required
  - strict body: unknown fields (including role, actor, risk or status) are rejected
  - transitions: `pending → in_review` (start_review); `pending|in_review → approved|rejected|escalated`; `escalated → approved|rejected`, always subject to role/risk permissions
  - `reject` and `escalate` require trimmed `note` (10..1000 chars)
  - `approve` requires 10..1000 chars when high risk (from any legal status), or when `policy.requireApprovalNote` is true. Other notes optional, ≤1000 trimmed chars.
  - invalid transition → 409 `INVALID_TRANSITION`; validation → 400 `VALIDATION_ERROR`; forbidden role → 403 `FORBIDDEN`
  - → `KycCase & { audit: AuditEvent[]; allowedActions: CaseAction[]; approvalNoteRequired: boolean }`

### Approval-note policy

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

### Risk-scoring policy

These settings, versions and history are independent from approval-note policy and refunds.
All endpoints require a known identity. All roles can read; only managers can write.

- `GET /api/risk-policy` → `RiskPolicy` = `{ rules: { code, title, description, weight, defaultWeight }[]; thresholds: { medium, high }; defaultThresholds; version; updatedAt; updatedBy }` (initial version 0)
- `GET /api/risk-policy/history` → `RiskPolicyChange[]` = `{ id, version, actorId, actorName, changes: { key, from, to }[], recomputedCases, createdAt }[]` (newest first)
- `PUT /api/risk-policy` body `{ weights?: Record<RuleCode, int 0..100>; thresholds?: { medium?: int 1..100; high?: int 1..100 } }`, role `compliance_manager` (else 403 `FORBIDDEN`)
  - `medium < high` enforced against the merged policy; unknown rule codes → 400 `VALIDATION_ERROR`
  - re-scores open cases (`pending|in_review|escalated`) in the same immediate transaction, appends `RISK_RESCORED` audit events for changed score, level, evidence or thresholds; closed cases and refunds untouched
  - stores scoring thresholds with the evaluation so later policy updates do not change a closed-case explanation
  - versions increase independently of review policy; concurrent partial updates are serialized, last write to each setting wins (no optimistic version precondition)
  - → `{ policy: RiskPolicy; change: RiskPolicyChange | null }` (`change` is `null` when the patch is a no-op)

## Risk engine (deterministic, policy-driven)
Score = sum of signal weights, clamped 0..100. Level: `<medium low`, `medium..high-1 medium`, `≥high high`; default thresholds 30 / 60. Weights and thresholds come from the persisted risk policy (`risk_policy` table), editable via `PUT /api/risk-policy`.
Default catalogue (code → weight): `SANCTIONS_HIT` 40, `PEP` 30, `HIGH_RISK_JURISDICTION` 25 (residence or nationality in list), `ADVERSE_MEDIA` 10 per hit (max 30), `ID_DOC_UNVERIFIED` 20, `DOCUMENT_EXPIRING` 10 (ID document expires <30 days), `ADDRESS_UNVERIFIED` 10, `HIGH_EXPECTED_VOLUME` 15 (>50k USD/month), `OPAQUE_SOURCE_OF_FUNDS` 15 (`crypto`, `cash_intensive_business`, `unknown`), `NEW_ACCOUNT` 5 (<30 days), `CASH_INTENSIVE_OCCUPATION` 10.

The explanation endpoint describes the saved evaluation, including its thresholds, rather than
running the engine again. Legacy or inconsistent records retain their recorded score, level and
evidence. Legacy cases without threshold snapshots use the original 30/60 defaults; earlier
custom evaluation thresholds cannot be reliably recovered. New rescoring captures thresholds.

## Seed
`npm run seed` (destructive, drops+recreates including policy and both audit histories). 6 identities (3 analysts, 2 seniors, 1 compliance manager), ~60 customers/cases, deterministic PRNG seed `kyc-demo-2026`, fictional names — no real PII. Mix of statuses; audit chain includes creation event `CASE_CREATED`. Seeded decisions use actors authorized for the case's risk.
