# Internal Operations: KYC and Refunds

Prototype internal tool for compliance analysts at a fictional Series C fintech. Analysts work a queue of KYC cases, inspect the customer profile and the risk signals that drove the score, and approve, reject or escalate each case; every decision is written to a tamper-evident audit trail. The project exists to evaluate whether Devin-built, version-controlled software can replace the company's Microsoft Power Apps internal tools. It is a prototype: see [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) for every shortcut taken and what production would require instead.

The second tool, **Refund Operations**, shares the same application shell, identity, API server,
SQLite database and audit system. It adds refund search, filters, dashboard totals, transaction
details and authorized approval/rejection. See the [portfolio implementation report](docs/REFUNDS_PORTFOLIO.md)
for reuse, new work, test coverage and the limitations exposed by adding a second application.

## Architecture

npm workspaces monorepo:

| Package | Role |
| --- | --- |
| `packages/server` | Express + better-sqlite3 API (TypeScript, ESM). Implements [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md). Layered `http → services → domain (pure) → repo → SQLite`; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). |
| `packages/web` | Default UI: Vite + React 18 + react-router-dom SPA. Talks to the API over HTTP on `http://localhost:4000` (Vite proxies `/api/*`). |
| `variants/web-b`, `variants/web-c` | Alternative UI implementations evaluated during selection — see [`variants/README.md`](variants/README.md). |

### UI (`packages/web`)

Minimal SPA: a case queue at `/`, case detail at `/cases/:id`, refund queue at `/refunds`, refund detail at `/refunds/:id`, and KYC policy at `/policy`. Both queues use the same table, filter chips, debounced search and pagination components; both detail pages use the same decision dialog and audit timeline. Plain CSS, no UI kit or data-fetching library. The dev server runs on `http://localhost:5173` and proxies `/api/*` to the API on port 4000. The analyst identity is chosen from a header dropdown (persisted in localStorage) and sent as the `x-analyst-id` header. Production build emits `packages/web/dist/`.

Two alternative UIs were built and evaluated; they are kept as reference implementations under `variants/`:

- `variants/web-b` — component-library SPA: Tailwind CSS, shadcn-style primitives on Radix, TanStack Query + Table. Run: `npm run dev:web-b`.
- `variants/web-c` — server-rendered: Express SSR + React 19 + htmx on port 3000. Run: `npm run dev:web-c`.

web-a was selected as the default: same features, simplest stack, fewest dependencies.

## Prerequisites

- Node 20+ (`node -v`)
- npm 10 (`npm -v`) — workspaces support is required

## Setup and run

```bash
npm install          # installs all workspaces
npm run seed         # DESTRUCTIVE: reset fictional KYC, refunds and audit data
npm run dev:server   # API on http://localhost:4000 (override with PORT)
npm run dev:web      # UI dev server on http://localhost:5173 (see UI section above)
```

For an existing fictional demo database, run `npm run seed:refunds` to add refund fixtures
without resetting KYC, existing refund decisions or audit history. Startup applies the schema
migration; it does not populate new refund records automatically. Do not run demo seeds against
real customer databases.

Checks:

```bash
npm test             # vitest: server + web suites
npm run lint         # eslint: server + web
npm run typecheck    # tsc --noEmit: server + web
```

Per-variant equivalents exist for the alternative UIs (`npm run test:web-b`, `npm run typecheck:web-c`, etc.).

Environment variables (server): `PORT` (default `4000`), `KYC_DB_PATH` (default `packages/server/data/kyc.db`; `:memory:` supported).

Quick smoke test after `npm run dev:server`:

```bash
curl -s localhost:4000/api/health
curl -s 'localhost:4000/api/cases?riskLevel=high&pageSize=3' -H 'x-analyst-id: ana-003'
curl -s -X POST localhost:4000/api/cases/<id>/actions \
  -H 'content-type: application/json' -H 'x-analyst-id: ana-003' \
  -d '{"action":"start_review"}'
```

## Analyst workflow

1. **Queue** — `GET /api/cases` lists cases with status, risk level, score and customer summary; `GET /api/cases/stats` feeds the header counters.
2. **Filter** — by `status`, `riskLevel` (multi-value), free-text `q` (reference, customer name, email), sorted by `createdAt`, `updatedAt` or `riskScore`.
3. **Open case** — `GET /api/cases/:id` returns the full customer record, the risk signals, the audit history and `allowedActions` for the calling analyst.
4. **Review customer + risk signals** — verification flags, PEP/sanctions/adverse media, expected volume, source of funds.
5. **Act** — `POST /api/cases/:id/actions` with `start_review`, `approve`, `reject` or `escalate` (rules below). The response includes the updated case and audit trail.
6. **Audit history** — `GET /api/cases/:id/audit`, an ordered hash-chained list of every state change with actor and note.
7. **"Why is this case high risk?"** — `GET /api/cases/:id/risk-explanation` returns the score, the thresholds and each contributing factor with its weight and percentage contribution.

## Case state machine

```mermaid
stateDiagram-v2
    [*] --> pending: CASE_CREATED
    pending --> in_review: start_review
    pending --> approved: approve
    pending --> rejected: reject
    pending --> escalated: escalate
    in_review --> approved: approve
    in_review --> rejected: reject
    in_review --> escalated: escalate
    escalated --> approved: approve (authorized decision-maker)
    escalated --> rejected: reject (authorized decision-maker)
    approved --> [*]
    rejected --> [*]
```

Rules enforced by the domain layer (`packages/server/src/domain/transitions.ts`):

- `reject` and `escalate` require a trimmed note of 10–1000 characters.
- Every high-risk approval requires a 10–1000 character note, including escalated cases.
- Low/medium approvals require the same note by default; a compliance manager can change this through the KYC policy page. Optional notes remain capped at 1000 characters.
- Decisions from `pending`, `in_review`, and `escalated` use the role/risk matrix below. Terminal cases cannot be changed.
- Errors: `409 INVALID_TRANSITION`, `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `401 UNAUTHORIZED`, `404 NOT_FOUND`.

## Refund workflow

Open **Refunds** in the same header. The queue shows pending count/amount and decisions made today
(UTC), independently of the current filters. Search covers refund reference, customer name/email
and original transaction reference. Combine status and risk chips with amount bands: under $1,000,
$1,000–$5,000 inclusive, or over $5,000. Every displayed table column is sortable; filters and page
are stored in the URL.

Open a refund to review its customer, original transaction, exact amount, request reason and
recorded risk indicators. All money is stored in integer cents and this prototype supports USD
only. Decisions follow `pending → approved | rejected`; approved/rejected refunds are terminal.

| Refund permission | Analyst | Senior analyst | Compliance manager |
| --- | --- | --- | --- |
| Read refunds and their audits | Yes | Yes | Yes |
| Approve/reject low or medium risk, amount ≤ $5,000 | No | Yes | Yes |
| Approve/reject high risk or amount > $5,000 | No | No | Yes |

Both decisions require a trimmed 10–1000 character reason. These are prototype rules, enforced
from the stored role, risk and amount inside the server transaction. KYC policy settings do not
relax refund requirements. **Approval records an operational decision; it does not move money.**
There is no refund-creation, payment-provider, reversal or settlement workflow.

Refund endpoints are under `/api/refunds`; see [the API contract](docs/REFUNDS_API.md).

**Accepted prototype limit:** pending totals above 9,007,199,254,740,991 cents (roughly
$90 trillion) can lose cent precision; totals beyond SQLite's integer range make the stats
endpoint fail. This aggregate bound is not enforced. The seeded data stays well below it;
see [aggregate-money limits](docs/REFUNDS_API.md#known-aggregate-money-limit).

## Risk scoring model

Deterministic: score = sum of triggered signal weights, clamped to 0–100. Level: `< medium` low, `medium..high-1` medium, `≥ high` high. Weights and thresholds are **configuration, not code** — see [Risk policy](#risk-policy). Defaults:

The prototype deliberately uses deterministic explanations. A production implementation could augment this with an LLM, but the system should retain structured evidence and deterministic policy evaluation as the source of truth.

This evaluation intentionally tests the AI-assisted layer over a working workflow rather than treating generated text as the workflow itself. Any future summary should point back to the recorded factors below; authorization, risk policy and case decisions remain deterministic.

That follows the same architectural direction as [Microsoft 365 Copilot over Dataverse](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-data-copilot): assistance sits over governed application data and respects the underlying access model. This prototype tests that seam with a deterministic explanation first, rather than pretending AI replaces the workflow.

| Code | Default weight | Trigger |
| --- | --- | --- |
| `SANCTIONS_HIT` | 40 | Customer matches a sanctions list |
| `PEP` | 30 | Politically exposed person |
| `HIGH_RISK_JURISDICTION` | 25 | Residence or nationality in the high-risk list |
| `ADVERSE_MEDIA` | 10 per hit (max 30) | Adverse media hits |
| `ID_DOC_UNVERIFIED` | 20 | ID document not verified |
| `DOCUMENT_EXPIRING` | 10 | ID document expires in < 30 days |
| `HIGH_EXPECTED_VOLUME` | 15 | Unusual transaction volume (> 50k USD/month expected) |
| `OPAQUE_SOURCE_OF_FUNDS` | 15 | Source of funds is `crypto`, `cash_intensive_business` or `unknown` |
| `ADDRESS_UNVERIFIED` | 10 | Address not verified |
| `CASH_INTENSIVE_OCCUPATION` | 10 | Cash-intensive occupation |
| `NEW_ACCOUNT` | 5 | Account opened < 30 days ago |

The explanation endpoint ranks the recorded case signals, identifies the primary driver and reports each factor's `contributionPct` relative to the raw signal total. The case page keeps descriptions and evidence-record IDs behind **View supporting evidence**. If the raw total exceeds 100, the displayed risk score remains capped at 100 while the explanation shows the uncapped total.

## Risk policy

The **KYC policy** navigation has two independent sections: **Approval notes** (`/policy`) and
**Risk scoring** (`/policy/risk`). Each has its own settings, version and history. Both use the
same identity and permission checks; neither changes refund policy.

Risk scoring shows every rule with its current and default weight plus the medium/high thresholds
(default 30 / 60). A `compliance_manager` can edit them; analysts and senior analysts see the page
read-only. Saving calls `PUT /api/risk-policy`, which:

- validates the patch (weights 0–100, thresholds 1–100, `medium < high`; unknown rule codes are rejected),
- persists the new values in `risk_policy` and appends a versioned row to the append-only `risk_policy_changes` table,
- re-scores every **open** case (`pending`, `in_review`, `escalated`) inside the same transaction and appends a `RISK_RESCORED` audit event whenever its saved score, level, evidence or thresholds change; closed cases retain their saved evaluation,
- returns the new policy and the change record (`recomputedCases`).

`GET /api/risk-policy` and `GET /api/risk-policy/history` require a known demo identity. No deploy
or code change is needed to change the rules. Explanation reads use saved evidence and the
thresholds captured during evaluation, never today's clock or a newer policy.

## Audit hash chain

Every case or refund state change appends one row to the shared `audit_events` table, with a
monotonically increasing `sequence` per subject. An event references exactly one case or refund.
Each event stores `prevHash` (the previous event's `hash`, or 64 zeros for the first event) and

```
hash = sha256(prevHash + canonicalJson({ action, actorId, caseId, createdAt, fromStatus, note, sequence, toStatus }))
```

with keys in that fixed order. Each event records server-derived actor ID/name, action, case ID, timestamp, previous/new status and the trimmed note. SQLite triggers reject `UPDATE`/`DELETE`; recursive triggers also prevent `INSERT OR REPLACE` from overwriting history. There are no application routes to insert arbitrary events, edit them, or delete them, including for managers. Case changes and audit appends commit or roll back together.

Refunds use the same hash function, substituting `refundId` for `caseId` at the same position in
canonical JSON. Existing KYC hash input and stored hashes remain unchanged. Refund changes and
their audit appends also commit or roll back together.

Hash verification detects altered hashed fields and broken links. It cannot detect deletion of the chain tail or a privileged rewrite of the whole database, and the legacy case hash does not cover actor display names. Approval-note changes have a separate hash chain covering actor ID/name/role, reason and complete previous/new policy snapshots. Risk-scoring changes retain a versioned, append-only field-difference history without a hash chain. All histories remain in the operational database; external immutable storage and chain anchoring are production requirements.

## Identity model

There is no login. The **Demo identity** selector sends `x-analyst-id` on every API request. All sensitive reads and writes require a known ID (`401` for missing/unknown); only health is anonymous. The server loads roles from the database, never from request body or role headers, and re-resolves the actor within mutation transactions. New UI visitors start as `ana-003`, an analyst. Switching identity discards stale dialogs and data and aborts pending client requests; a request already committed server-side retains its original actor.

**This is enforced authorization with simulated identity, not production authentication.** Anyone able to call the API can choose a seeded manager ID. Before handling sensitive data, replace the selector/header with server-validated SSO sessions and provision roles through a controlled process.

Seeded identities:

| Id | Name | Role |
| --- | --- | --- |
| `ana-001` | Marta Ellison | `senior_analyst` |
| `ana-002` | Tommy Reyes | `senior_analyst` |
| `ana-003` | Grete Lindholm | `analyst` |
| `ana-004` | Kwame Osei | `analyst` |
| `ana-005` | Ines Morales | `analyst` |
| `ana-006` | Sofia Chen | `compliance_manager` |

`GET /api/me` returns the resolved identity and permissions; `GET /api/analysts` lists demo identities.

| Permission | Analyst | Senior analyst | Compliance manager |
| --- | --- | --- | --- |
| Read cases, risk information, audit history and policy | Yes | Yes | Yes |
| Start review / escalate | Yes | Yes | Yes |
| Approve/reject low or medium risk | No | Yes | Yes |
| Approve/reject high risk | No | No | Yes |
| Change policy | No | No | Yes |
| Modify/delete audit history | No | No | No |

The API returns `allowedActions` from the same role/risk/state rules used to authorize mutations. Denied requests do not change case state or decision history. All identities share the case queue; tenant, assignment and field-level restrictions are not implemented.

## Policy and existing databases

The Approval notes section retains `GET/PUT /api/policy` and `GET /api/policy/audit`. Managers
must provide a change reason and the current version; concurrent edits return `409 POLICY_CONFLICT`.
Approval-note updates cannot relax high-risk role or note requirements and never rescore cases.
Risk scoring uses a separate partial-update contract and version history; concurrent risk edits
are serialized, with the last write to a setting taking effect. Every accepted policy change and
its audit writes commit together.

Startup upgrades the old analyst-role constraint, creates the default policy, and extends the
audit table to support refund subjects while preserving existing rows and hashes. Back up the
database before upgrades. Existing databases do not automatically gain a manager account: provision
one through trusted administrative access or use a separate freshly seeded demo database.
`npm run seed` remains a **destructive demo reset**, including policy and refund history; never use
it to migrate retained records.

Startup also adds document expiry storage and a separate table for saved scoring thresholds.
Legacy cases without a threshold snapshot use the original 30/60 defaults until rescored.
Historical custom thresholds from versions predating snapshots cannot be reliably recovered;
production would require complete versioned evaluation snapshots.

See [authorization and audit hardening](docs/SECURITY_REVIEW.md) for the before/after assessment, test coverage and remaining production work.

## Further reading

- [`docs/REFUNDS_PORTFOLIO.md`](docs/REFUNDS_PORTFOLIO.md) — marginal scope, reuse, tests and architecture findings
- [`docs/REFUNDS_API.md`](docs/REFUNDS_API.md) — refund endpoint and audit contract
- [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) — endpoints, types, domain rules (authoritative)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — request flow, layering, transaction boundaries, how to build the next internal tool
- [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) — prototype assumptions vs production requirements; the Power Apps replacement question
