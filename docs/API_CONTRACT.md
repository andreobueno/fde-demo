# KYC Review Console — API contract (v1)

Backend: Express + better-sqlite3, TypeScript. Local development base URL `http://127.0.0.1:4000`.
Successful routes return `200` JSON unless stated otherwise; sign-out and CORS preflight return
`204` without a body, and HEAD responses have no body. Errors:
`{ "error": { "code": string, "message": string, "details"?: unknown } }`
with 400/401/403/404/409/429/500. Responses use `Cache-Control: no-store`.
Refund routes and types are documented in [REFUNDS_API.md](REFUNDS_API.md).

## Authentication and identity
Every protected API data/action request requires `Authorization: Bearer <token>`.
The scheme is case-insensitive, followed by exactly one space and 43 base64url characters.
Cookies, query parameters and HTTP Basic credentials do not authenticate API requests.
CORS `OPTIONS` preflight returns protocol headers only; the subsequent data/action request still requires authentication.
CORS allows HTTP(S) origins on `localhost` or `127.0.0.1`, with an optional port.
`GET /api/health` is anonymous. With `LOCAL_DEMO_AUTH=true`, these local adapter routes are enabled
without the protected-route identity middleware:

- `POST /api/auth/sign-in`: strict JSON `{email: string, password: string}`.
  Email must be a valid address of 3..254 characters after trimming, then is lowercased.
  Password must be 1..256 characters; it is not trimmed and is NFKC-normalized for verification.
  Server verifies the salted scrypt password hash and returns
  `201 {analyst: CurrentAnalyst, session: {token: string, expiresAt: string, idleTimeoutMs: number}}`.
  The opaque token contains 32 random bytes (43 base64url characters). Only its SHA-256 hash is stored.
  Session lifetime is 12 hours, idle timeout one hour; protected requests renew the idle window.
  The token is delivered only to the sign-in caller, never in URLs, logs or other API responses.
  Wrong passwords/unknown emails both return `401 INVALID_CREDENTIALS`, malformed/extra fields
  return `400 VALIDATION_ERROR`. Login failures are limited per email (8) and connection IP (64)
  in a 15-minute window; further attempts return `429 TOO_MANY_ATTEMPTS`. Limits are in-process
  and reset on API restart. Reverse proxies share the source limit; forwarded IP headers are not trusted.
- `GET /api/auth/demo-users` → `DemoUser[]`: returns at most one credential mapping per picker
  choice, in `analyst`, `reviewer`, `admin` order. These IDs are picker keys, not analyst IDs;
  they map to `analyst`, `senior_analyst`, `compliance_manager` respectively. Each selects the
  first credential-bearing analyst of that role by analyst ID; missing roles are omitted
  (an empty database returns `[]`). Names and emails come from the retained database, with no
  fictional-email filter. It returns no password, hash, permissions or authenticated identity.
- `POST /api/auth/sign-out`: bearer session token, no body required. Returns `204`, deletes only that
  session hash. Missing, expired or already revoked credentials are accepted idempotently.
  Other sessions (including another login for the same analyst) remain valid. Automation
  credentials are not revoked through this route; `x-analyst-id` is not checked here.

`npm run seed` and `npm run seed:logins` provision the public fictional password
`demo-password-2026`. `seed:logins` preserves business data and automation tokens, but replaces
all password credentials and revokes existing sessions for every retained analyst. It derives
unique emails from their current names; it does not create identities or assign roles.
Both commands reject `NODE_ENV=production`, which also rejects enabling local authentication.
When disabled, `/api/auth/*` returns `404 LOCAL_AUTH_DISABLED` (except protocol preflight),
and existing demo session tokens cannot access protected routes.

For automation an administrator can still issue a separate eight-hour bearer credential through
`npm run auth:issue -w packages/server -- <analyst-id> <new-output-file>`. It writes the token
to a new file (mode `0600` on systems supporting POSIX permissions) and prints metadata only.
Only its hash is stored in SQLite. `npm run auth:revoke -w packages/server -- <analyst-id>`
revokes all automation credentials for that identity, leaving demo sessions alone.
No default automation tokens are seeded.

Missing, malformed, unknown, expired or revoked credentials → generic `401`, without a fallback
identity. The server derives the actor and current role from the token's stored identity.
`x-analyst-id` is optional and only checks expected identity: a mismatch → `403`. Supplying an ID,
role header or request-body actor cannot authenticate or switch the caller.

`GET /api/me` verifies the credential and returns the current identity and permissions. The
authenticated analyst directory contains no credentials or hashes. Production provisioning and
sign-in should use controlled SSO/OIDC and managed sessions; this prototype's adapter is local-only.

All roles read cases, refunds, audit history and both policies, and can start review or escalate
when the case state permits. Analysts cannot approve/reject. Seniors can approve/reject low/medium
cases. Compliance managers can approve/reject any case risk and change either policy. The same
decision rules apply to pending, in-review and escalated cases. No role may edit/delete audit history.

Common permissions: `cases:read`, `audit:read`, `cases:review`, `cases:escalate`, `policy:read`,
`refunds:read`. Seniors additionally receive `cases:decide_low_medium` and
`refunds:decide_low_medium`; managers receive those plus `cases:decide_high`, `policy:manage`
and `refunds:decide_high`. Refund amount limits are in the [refund contract](REFUNDS_API.md#authorization-and-transitions).

Authentication events are stored separately in append-only `auth_events`, without a hash chain:
`{ id, createdAt, event, analystId: string | null, email: string | null, reason: string | null }`,
where `id`/`createdAt` are strings and `event` is `sign_in_succeeded | sign_in_failed |
sign_in_throttled | sign_out`. They contain neither passwords nor tokens and have no HTTP
read/write endpoint. Successful session creation/revocation and its auth event are transactional.

## Enums
- `CaseStatus`: `pending | in_review | approved | rejected | escalated`
- `RiskLevel`: `low | medium | high`
- `CaseAction`: `approve | reject | escalate | start_review`
- `SignalSeverity`: `low | medium | high`

## Types
```ts
interface Analyst { id: string; name: string; role: 'analyst' | 'senior_analyst' | 'compliance_manager' }
type Permission =
  | 'cases:read' | 'audit:read' | 'cases:review' | 'cases:escalate'
  | 'cases:decide_low_medium' | 'cases:decide_high'
  | 'refunds:read' | 'refunds:decide_low_medium' | 'refunds:decide_high'
  | 'policy:read' | 'policy:manage';
type CurrentAnalyst = Analyst & { permissions: Permission[] };
interface DemoUser { id: 'analyst' | 'reviewer' | 'admin'; name: string; email: string }
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
- `GET /api/me` → `CurrentAnalyst`
- `GET /api/analysts` → `Analyst[]`, ordered by ID
- `GET /api/cases/stats` → `{ byStatus: Record<CaseStatus, number>; byRiskLevel: Record<RiskLevel, number>; total: number }`, all cases regardless of list filters, including zero counts
- `GET /api/cases?status=&riskLevel=&q=&sort=&order=&page=&pageSize=`
  - `status`, `riskLevel`: comma-separated enum values; whitespace and empty entries are removed. Omitted/empty lists apply no filter.
  - `q`: trimmed text, max 100 characters, matched against reference, customer fullName and email using SQLite `LIKE` (ASCII case-insensitive). `%` and `_` remain wildcards here; refund search escapes them.
  - `sort`: `createdAt | updatedAt | riskScore | reference | customer | country | status | assignedTo` (default `createdAt`), `order`: `asc|desc` (default `desc`). `customer`/`assignedTo` use SQLite `NOCASE`; unassigned cases sort last in either direction. `country` is country of residence; `status` sorts lexically. All sorts break ties by ascending case ID.
  - `page`: integer ≥1, default 1; `pageSize`: integer 1..100, default 25. Unlike refunds, the case query has no safe-offset maximum.
  - Unknown query keys are stripped/ignored; invalid known values return `400 VALIDATION_ERROR`. Filter values use SQL bound parameters; sort expressions are whitelisted.
  - → `{ items: KycCase[]; total: number; page: number; pageSize: number }`
- `GET /api/cases/:id` → `KycCase & { customer: Customer; signals: RiskSignal[]; audit: AuditEvent[]; allowedActions: CaseAction[]; approvalNoteRequired: boolean }`
  - Full customer replaces the list summary; signals are ordered by weight descending then code ascending. Audit is ascending by sequence.
- `GET /api/cases/:id/risk-explanation` → `RiskExplanation`
  - Uses the persisted case `riskScore`/`riskLevel` and recorded `risk_signals`, matching case details. Closed cases retain the assessment used for their decision. Reads do not evaluate current customer fields, use the current clock, or mutate the case/signals.
  - Every factor's `signalId` is the stored signal's `id`. Its code, title, description, severity and weight are returned as recorded; descriptions provide the supporting evidence. No source documents, evidence values, transaction velocity data or LLM text are generated.
  - `factors` are sorted by weight descending, then code ascending, then signal ID ascending. String ties use deterministic, case-sensitive JavaScript string comparison (`<`/`>`), independent of locale. `primaryDriver` is the first factor in this order, or `null` when empty.
  - `rawScore` is the sum of all recorded signal weights. `scoreCapped` is `rawScore > 100`; scores from the risk engine are capped at 100. Neither field overwrites the persisted score or level.
  - `contributionPct` uses largest-remainder apportionment of `weight / rawScore * 100`: floor each share, then distribute remaining percentage points by fractional remainder descending, breaking ties by the deterministic factor order above. Percentages sum to exactly 100 when the raw total is positive, or are all 0 when it is 0. The denominator is the raw total, including when it exceeds 100, not the capped case score.
  - `summary` is a deterministic template reporting the recorded score/level and primary driver. With no evidence, it reports that no signals were recorded and returns `factors: []`, `rawScore: 0`, `scoreCapped: false`, `primaryDriver: null`. It flags discrepancies between the recorded score and capped signal total, or between the recorded level and score thresholds, without inventing factors or changing stored values.
  - Requires a valid bearer credential and `cases:read`. Missing/invalid credentials → `401 UNAUTHORIZED`; an unknown case with an authorized identity → `404 NOT_FOUND`.
- `GET /api/cases/:id/audit` → `AuditEvent[]` (ascending by sequence)
- `POST /api/cases/:id/actions` body `{ action: CaseAction; note?: string }`, bearer credential required
  - strict body: unknown fields (including role, actor, risk or status) are rejected
  - transitions: `pending → in_review` (start_review); `pending|in_review → approved|rejected|escalated`; `escalated → approved|rejected`, always subject to role/risk permissions
  - `reject` and `escalate` require trimmed `note` (10..1000 chars)
  - `approve` requires 10..1000 chars when high risk (from any legal status), or when `policy.requireApprovalNote` is true. Other notes optional, ≤1000 trimmed chars.
  - invalid transition → 409 `INVALID_TRANSITION`; validation → 400 `VALIDATION_ERROR`; forbidden role → 403 `FORBIDDEN`
  - Re-reads the actor's current role, saved case and approval-note policy in an immediate transaction. Updates status, `assignedTo` to the acting analyst, and `updatedAt`, then appends one audit event atomically. Empty optional notes are stored as `null`. Terminal cases cannot be reopened.
  - → `KycCase & { audit: AuditEvent[]; allowedActions: CaseAction[]; approvalNoteRequired: boolean }`

Case list/stats, analyst directory, explanation and case actions require `cases:read`;
case detail also requires `audit:read`. The standalone case audit route requires `audit:read`.
Actions additionally enforce the role/risk rules above. The action response contains the
summary customer, not the full customer or signals returned by case detail.

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

- `GET /api/policy` → `Policy` (`policy:read`). Initial version 1, approval notes required, updatedBy null; after a change `updatedBy` is the actor ID.
- `PUT /api/policy` → `Policy` (`policy:manage`, manager only). Strict body `{ version: number; requireApprovalNote: boolean; reason: string }`. Version is a positive integer; trimmed reason 10..1000 chars. Stale version → 409 `POLICY_CONFLICT`; unchanged setting or invalid input → 400 `VALIDATION_ERROR`. Version increments with each change.
- `GET /api/policy/audit` → `PolicyAuditEvent[]` (`audit:read`), ordered by new policy version ascending.
- Policy updates and audit appends are atomic. This policy only controls low/medium approval notes; elevated roles and high-risk justification are fixed security boundaries.
- The separate `policy_audit_events` hash chain covers ID, actor ID/name/role, action, timestamp,
  reason and complete previous/new policy snapshots. `hash = sha256(prevHash + JSON.stringify(...))`
  uses that field order; each snapshot uses `version, requireApprovalNote, updatedAt, updatedBy`
  order. Genesis `prevHash` is 64 zeroes. SQLite UPDATE/DELETE triggers and recursive triggers
  protect against mutation/replacement.

### Risk-scoring policy

These settings, versions and history are independent from approval-note policy and refunds.
All endpoints require a valid bearer credential. All roles can read; only managers can write.

```ts
type PolicyRuleCode =
  | 'SANCTIONS_HIT' | 'PEP' | 'HIGH_RISK_JURISDICTION' | 'ADVERSE_MEDIA'
  | 'ID_DOC_UNVERIFIED' | 'DOCUMENT_EXPIRING' | 'ADDRESS_UNVERIFIED'
  | 'HIGH_EXPECTED_VOLUME' | 'OPAQUE_SOURCE_OF_FUNDS' | 'NEW_ACCOUNT'
  | 'CASH_INTENSIVE_OCCUPATION';
interface RiskThresholds { medium: number; high: number }
interface RiskPolicyView {
  rules: Array<{ code: PolicyRuleCode; title: string; description: string; weight: number; defaultWeight: number }>;
  thresholds: RiskThresholds;
  defaultThresholds: RiskThresholds;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}
interface RiskPolicyChange {
  id: string; version: number; actorId: string; actorName: string;
  changes: Array<{ key: string; from: number; to: number }>;
  recomputedCases: number; createdAt: string;
}
interface RiskPolicyPatch {
  weights?: Partial<Record<PolicyRuleCode, number>>;
  thresholds?: Partial<RiskThresholds>;
}
```

- `GET /api/risk-policy` → `RiskPolicyView` (`policy:read`). Initial version 0 with null
  `updatedAt`/`updatedBy`; defaults are used for settings not yet persisted. After a change,
  `updatedBy` is the actor **name**, unlike the approval-note policy's actor ID.
- `GET /api/risk-policy/history` → `RiskPolicyChange[]` (`audit:read`), newest version first.
  Change keys are `weights.<PolicyRuleCode>`, `thresholds.medium` or `thresholds.high`.
  `recomputedCases` counts cases whose saved evaluation changed, not every open case inspected.
- `PUT /api/risk-policy` body `RiskPolicyPatch`, requiring `policy:manage` (else 403 `FORBIDDEN`)
  - weights must be integers 0..100; thresholds integers 1..100; `medium < high` enforced
    against the merged policy. Unknown fields at any level, including rule codes, version
    or reason → 400 `VALIDATION_ERROR`.
  - re-scores open cases (`pending|in_review|escalated`) in the same immediate transaction, appends `RISK_RESCORED` audit events for changed score, level, evidence or thresholds; closed cases and refunds untouched
  - stores scoring thresholds with the evaluation so later policy updates do not change a closed-case explanation
  - versions increase independently of review policy; concurrent partial updates are serialized, last write to each setting wins (no optimistic version precondition)
  - → `{ policy: RiskPolicyView; change: RiskPolicyChange | null }`. Empty or unchanged patches
    return `change: null` without rescoring, version increment or history append.
- `risk_policy_changes` is versioned and append-only (UPDATE/DELETE/replacement triggers);
  it has no hash chain, reason or full policy snapshots. A changed policy, its history,
  rescored evaluations and their case audit events commit or roll back together.

## Risk engine (deterministic, policy-driven)
Score = sum of signal weights, clamped 0..100. Level: `<medium low`, `medium..high-1 medium`, `≥high high`; default thresholds 30 / 60. Weights and thresholds come from the persisted risk policy (`risk_policy` table), editable via `PUT /api/risk-policy`.
Default catalogue (code → weight): `SANCTIONS_HIT` 40, `PEP` 30, `HIGH_RISK_JURISDICTION` 25 (residence or nationality in list), `ADVERSE_MEDIA` 10 per hit (max 30), `ID_DOC_UNVERIFIED` 20, `DOCUMENT_EXPIRING` 10 (ID document expires <30 days), `ADDRESS_UNVERIFIED` 10, `HIGH_EXPECTED_VOLUME` 15 (>50k USD/month), `OPAQUE_SOURCE_OF_FUNDS` 15 (`crypto`, `cash_intensive_business`, `unknown`), `NEW_ACCOUNT` 5 (<30 days), `CASH_INTENSIVE_OCCUPATION` 10.

The jurisdiction list is `IR, KP, SY, MM, AF, YE, BY, CU, NI, VE`. Cash-intensive occupations
are `restaurant_owner`, `car_dealer`, `construction_contractor`, `vending_machine_operator`,
`casino_operator`, `money_service_business`, `pawnbroker`, `jewelry_dealer`.
Document expiry includes already-expired documents; a missing date does not trigger it.
New accounts must have age ≥0 and <30 days. Adverse media uses the configured per-hit weight
times at most three hits (so its signal may exceed 100); severity is high at three capped
hits, otherwise medium. A zero weight suppresses the signal.

The explanation endpoint describes the saved evaluation, including its thresholds, rather than
running the engine again. Legacy or inconsistent records retain their recorded score, level and
evidence. Legacy cases without threshold snapshots use the original 30/60 defaults; earlier
custom evaluation thresholds cannot be reliably recovered. New rescoring captures thresholds.

## Case audit storage

`audit_events` is shared with refunds; each row has exactly one case/refund subject and a
unique sequence per subject. KYC hashing preserves this exact JSON key order:

```ts
JSON.stringify({ action, actorId, caseId, createdAt, fromStatus, note, sequence, toStatus })
```

`hash = sha256(prevHash + canonicalJson)`, with 64 zeroes as the genesis `prevHash`.
The hash excludes event ID and actor display name. UPDATE/DELETE triggers and enabled
recursive triggers block replacements. There is no endpoint to create cases/customers,
assign arbitrary actors, insert arbitrary events or edit/delete history. `CASE_CREATED`
is generated by the seed; `RISK_RESCORED` records an evaluation change without a status change.
Chains can expose modified hashed fields and broken links; they do not detect a privileged
whole-chain rewrite or tail truncation. No external immutable audit store is implemented.

## Validation and errors

Protected API requests authenticate before parsing JSON. JSON body limits are 50 KiB for
protected routes and 2 KiB for the local auth router. Send `Content-Type: application/json`
for JSON bodies. Malformed JSON produces `400 VALIDATION_ERROR`; schema errors may include
Zod issues in `details`. The current error handler maps body-size-limit failures to
`500 INTERNAL`, not `413`. Unknown authenticated API routes/methods return `404 NOT_FOUND`;
unknown protected routes without credentials return `401 UNAUTHORIZED`.
Uncaught errors return `500 INTERNAL` with a generic message.

## Database, migration and seed

`openDb` defaults to `packages/server/data/kyc.db` independently of the working directory;
`KYC_DB_PATH` overrides it (`:memory:` is supported). File databases use WAL; connections
enable foreign keys and recursive triggers. Startup creates missing schema and migrates
legacy analyst role constraints, the shared refund audit table and the optional customer
ID expiry column. These migrations preserve existing identities and audit values; they do
not promote an analyst to manager. No case, refund, analyst or login fixtures are automatically
populated. Missing legacy evaluation thresholds fall back to 30/60. Back up retained
databases before upgrades; no reset is required for supported migrations.

`npm run seed` is a destructive reset of KYC, refunds, both policies, all audit histories,
password credentials, sessions and automation tokens. It creates 6 fictional identities
(3 analysts, 2 seniors, 1 compliance manager), 60 customers/cases, 18 refunds and demo logins.
The PRNG seed is `kyc-demo-2026`, but timestamps use the current clock and audit IDs/password salts use
randomness, so reruns are not byte-identical. Case statuses are mixed; every case audit
starts with `CASE_CREATED` and seeded decisions use actors authorized for that risk.
`seed:logins` preserves business data while resetting logins/sessions as described above;
`seed:refunds` is additive and has no production-environment guard (see [refund seeding](REFUNDS_API.md#migration-and-seeding)).
Use all seeds only on known fictional demo databases.

For cross-platform startup commands and environment overrides, see the [server README](../packages/server/README.md).
