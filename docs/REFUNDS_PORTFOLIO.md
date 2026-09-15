# Refund Operations: second-tool implementation report

This report describes the original refund implementation and the shared architecture as it
exists today. The initial verification results below are historical; use the current commands
to obtain results for your checkout.

## Scope and economics

The pre-implementation estimate was one implementation session, approximately 45–75 minutes,
with one backend child working alongside parent-side UI integration. The delivered scope is
two routes, five endpoints and a smaller pending/approved/rejected workflow. No new workspace,
runtime dependency, framework, server process or deployment architecture was introduced.

This establishes reusable application mechanics, not a measured portfolio-wide cost saving.
The initial KYC effort also included three competing UI implementations and subsequent hardening,
so comparing raw elapsed time with this extension would not be a controlled experiment.
The useful marginal-cost distinction is domain work versus work amortized over future tools:
refunds adds its own records, financial limits, queries and fixtures, while sharing the shell,
identity, auditing, interaction components and verification tooling.

## What was reused

| Capability | Existing code reused or extended |
| --- | --- |
| Shell/navigation | `packages/web/src/App.tsx`: two routes and a Refunds entry; same authenticated identity and router |
| Request identity | `AnalystProvider`, API request helper and `useApi`: server-verified session identity, bearer credentials, expected-identity guard, cancellation, loading, errors and reload |
| Table/filter patterns | KYC's embedded table, search and pagination extracted to `DataTable`, `SearchInput`, `FilterChips`, `Pagination`; both queues now consume them |
| Detail interactions | Existing `ActionDialog` accepts a subject label; same validation, submission and error behavior |
| Audit display | KYC's embedded timeline extracted into `AuditTimeline`; both domains use the same browser verifier |
| Styles | Existing queue/detail CSS moved to shared components; no new visual design system |
| Authorization | Existing roles, permission catalog, identity middleware and database actor lookup; additive refund permissions |
| Workflow pattern | Pure domain transition validation, server-derived `allowedActions`, strict bodies, common error envelope and immediate transactions |
| Audit persistence | Existing `audit_events` table, repository helpers, SHA-256 hashing, append-only protections and transactional append |
| Database | Existing SQLite connection, foreign keys, schema bootstrap, customers and analysts |
| Tests/build | Existing Vitest, in-memory SQLite, supertest, static React rendering, ESLint, TypeScript and Vite commands |

Reuse is not a claim that one generic workflow handles every domain. Refund and KYC transition
functions remain separate small modules because their rules differ. The enforcement boundaries
and persistence conventions are shared.

## What is new

- Refund records with original transaction context, integer-cent USD amounts and recorded risk
  indicators; deterministic fixtures referencing existing fictional customers.
- A three-state refund domain, role/risk/amount authorization and mandatory decision reasons.
- Refund repository queries, counters, transactional service and five API endpoints. See
  [REFUNDS_API.md](REFUNDS_API.md) for the contract.
- Two React pages: queue/dashboard and detail. Refund-specific code configures shared components
  rather than reimplementing sorting, pagination, dialogs or audit display.
- Additive refund seeding, and migration of the previously KYC-only audit subject relationship.
- Frontend contract/filter tests and server domain/database/HTTP integration tests.

## Product rules and boundaries

All known roles may read refunds. Analysts cannot decide. Senior analysts can approve/reject
low/medium-risk refunds of at most $5,000, inclusive; managers can decide any refund. Both decisions
require a trimmed reason of 10–1000 characters, regardless of KYC approval-note policy.

Only pending refunds can change state. Duplicate or conflicting decisions return 409, and a failed
audit append rolls back the status change. The server reads the saved role, amount and risk inside
the transaction. Requests cannot supply actor, role, amount or target status as trusted inputs.

Money remains integer cents; amount bands are `< 100000`, `100000–500000` inclusive and `> 500000`.
Dashboard totals cover all refunds, independent of search/filter results. “Today” means UTC and
uses decision timestamps. Refund approval does not execute a payment.

Individual refund amounts are validated as positive safe-integer cents and rendered without
losing their cent component. The pending total still uses SQLite `SUM` and a JavaScript number:
totals above `Number.MAX_SAFE_INTEGER` cents (roughly $90 trillion) can lose precision, and
SQLite's signed 64-bit sum can overflow. This is an accepted prototype limit; production needs
exact aggregate arithmetic and an API representation that preserves it.

## Current regression commands

From the repository root:

```bash
npm test
npm run lint
npm run typecheck
npm run build:web
```

These cover the API and selected SPA, including later authentication, role-picker, policy and
exact-cent regressions. Reference UI suites run separately; see the [root README](../README.md#setup-and-run).
The runner output is the source for current test totals; counts are not line-coverage percentages.

## Verification at the initial refund integration

The following counts and smoke check were recorded when [Refund Operations was first integrated](https://github.com/andreobueno/fde-demo/pull/15).
They do not describe the current suite size.

Frontend coverage added **52 tests**, retaining the existing **55**:

- 16 API contract tests: explicit identity, cancellation, strict mutation payload, preserved
  server authorization/evidence, and no automatic retry of rejected decisions.
- 18 URL filter tests: amount-band and sort roundtrips, search encoding, invalid enums and pages.
- 7 audit tests: Node/browser hash compatibility, altered subject/actor/status/note/link detection,
  and rejection of refund history reinterpreted as KYC history.
- 11 rendering/format tests: exact cents, transaction/evidence display, server-driven action
  availability, terminal states and UTC counter labeling.

Server coverage added **290 checks** to the existing **1,042**:

- 104 refund-domain checks: roles, risks, amount thresholds, transitions and reason boundaries.
- 142 HTTP checks: protected reads, forged/extra fields, missing identity, filtering, pagination,
  sorting, permission boundaries and terminal decisions.
- 13 service/audit checks: saved-role and eligibility re-resolution, exactly one append,
  rollback on audit failure, update/delete/replace protection and subject isolation.
- 14 repository checks: integer cents, amount bands, literal search, ordering and UTC day boundaries.
- 6 additive-seed checks: deterministic fixtures, truthful histories, retained decisions and
  failure without existing fictional customers/eligible actors.
- 2 migration checks: old-row/hash preservation, idempotent startup, foreign keys and rollback.
- 9 additional checks in the existing permission catalog suite.

Historical integrated result: **1,332 server + 107 web = 1,439 tests passed** across 25 files.
`npm test`, `npm run lint`, `npm run typecheck`, `npm run build:web`, and `git diff --check`
passed after integrating backend and frontend. Test counts are not a measured line-coverage percentage.

An additional integration smoke check ran the actual frontend API client over HTTP against Express
using a copy of the retained demo database. Migration and additive seeding preserved all 60 KYC
cases, 122 original case audit events, customer/analyst records and policy history. Refund
approval/rejection, forbidden decisions, duplicate rejection, combined filtering and exact counter
changes passed; the browser hash verifier accepted the real API histories. Reseeding retained the
new decisions. This check did not modify decisions in the live demo database.

These are automated domain, HTTP and rendering checks; they are not a browser interaction recording.

## Architectural weaknesses exposed

1. **Audit subjects were KYC-specific.** Adding refunds required a table migration, even though
   hashing and transactional append were reusable. Nullable case/refund foreign keys with an
   exactly-one-subject constraint preserve integrity for two tools; repeating this for ten subjects
   would require a deliberate registry/schema design rather than endlessly adding columns.
2. **UI reuse was partly implicit.** Table, pagination and audit rendering were embedded in pages.
   Extracting them was a one-time integration cost. Domain-specific filters and page composition
   remain explicit, rather than introducing a generic form/workflow builder.
3. **The role model is organization-wide.** Everyone can read both tools. A portfolio needs
   application membership, queue/tenant/field scopes and controlled grants, not simply more broad
   manager powers. Both tools now share token authentication; managed SSO and provisioning remain production work.
4. **Policy is still domain-specific.** KYC now has separate approval-note and risk-scoring editors.
   Refund amount/risk limits are prototype constants. A real operation needs versioned refund
   policy and evidence of which policy authorized each decision.
5. **Contracts are duplicated.** Server and web TypeScript types plus browser/server canonical hash
   definitions require synchronization. Tests guard the current contract; a shared schema package
   or generated client may be worthwhile as more tools are added.
6. **Shared runtime means shared operational limits.** Both tools share one SQLite writer and
   one release unit. This is suitable for the prototype but does not demonstrate independent
   scaling, availability or deployment ownership for a ten-tool portfolio.
7. **Audit is tamper-evident, not independently immutable.** Ordinary application users cannot
   modify/delete history, but a privileged database owner can rewrite it. External anchoring,
   retention, backups and immutable storage remain production work. Legacy-compatible event hashes
   do not authenticate the actor display name.
8. **Payment operations require more than a decision screen.** Production refunds need provider
   integration, idempotency, reconciliation, cumulative refund limits against a payment, separation
   of duties and failed-payment handling. This prototype validates individual refund amounts
   against a recorded original amount, without executing or reconciling real payments.

The second tool demonstrates incremental reuse of the application layer. It does not replace
Power Apps' surrounding identity administration, connectors, governance and operational services.
