# Prototype assumptions vs production requirements

This prototype deliberately trades production concerns for speed and clarity. Each row states what the prototype does and what a production deployment handling real KYC data would need instead.

| Area | Prototype assumption | Production requirement |
| --- | --- | --- |
| Authentication / identity | Caller identity is a plain `x-analyst-id` header; no login, no session, reads default to `ana-001`. Analysts are seeded rows. | SSO/OIDC (e.g. Entra ID, Okta) with short-lived sessions or tokens validated server-side; identity provisioned from the IdP/HR directory, not seeded; MFA per company policy. |
| Authorization | Single role check in code (`senior_analyst` may resolve escalated cases). Roles stored on the analyst row. | RBAC/ABAC via a policy engine (OPA, Cedar) or at minimum a central permission module; least privilege; separation of duties (maker/checker); admin actions audited; periodic access reviews. |
| Database | Single SQLite file (`packages/server/data/kyc.db`), schema applied on startup, `seed` drops and recreates. No migrations. | Postgres (managed) with versioned migrations, connection pooling, PITR backups tested by restore drills, read replicas if reporting needs them, per-environment credentials. |
| Audit immutability | SHA-256 hash chain per case plus SQLite triggers rejecting `UPDATE`/`DELETE` on `audit_events`, all in the same database as the data. | Append-only/WORM store separate from the operational DB (e.g. QLDB, immutable object storage, or a ledger table with DB-level privileges preventing writes by the app role), periodic external anchoring of chain heads (timestamping service / signed digests), defined retention (typically 5+ years for KYC), verification jobs that alert on chain breaks. |
| Risk engine | Deterministic sum of hardcoded weights in `domain/risk.ts`; thresholds fixed in code; no versioning. | Versioned rules configuration (each case records the ruleset version used), change control with 4-eyes approval, back-testing before rollout, model governance/inventory if any ML is introduced, explainability output retained with the decision, regulator-readable rationale. |
| Data | Seeded fictional customers from a fixed-seed PRNG; no real PII. Data at rest is a plaintext SQLite file. | Real PII: encryption at rest and in transit, field-level encryption or tokenisation for identifiers, data minimisation, field-level access controls and masking in the UI, data residency constraints, GDPR rights (access/erasure balanced against AML retention obligations), documented retention and deletion schedule. |
| Secrets / config | `PORT` and `KYC_DB_PATH` env vars; no secrets exist. | Secrets manager (Vault, AWS Secrets Manager), no secrets in repo or images, rotation, per-environment config validated at startup. |
| Observability | `console.log` on startup; errors returned in the JSON envelope. | Structured logs with request ids, metrics (latency, error rate, queue depth by status), tracing, alerting, log retention that excludes PII, dashboards for analyst throughput and SLA. |
| Rate limiting / CSRF / CSP | Basic security headers and a localhost-only CORS allow-list. No rate limiting; header-based identity means CSRF is not exploitable, but that changes with cookie sessions. | Rate limiting and abuse detection at the edge, CSRF protection once cookie-based auth exists, strict CSP, HSTS, request body limits tuned, WAF, dependency and container scanning. |
| Deployment | Local dev only: `tsx watch`, SQLite on disk. | Containers built in CI, image signing, CD with staged environments, infrastructure as code, health/readiness probes, zero-downtime deploys, rollback procedure. |
| Testing | Vitest unit tests for domain functions, service tests against in-memory SQLite, HTTP tests with supertest. | Add end-to-end tests of the UI against a seeded environment, contract tests between UI and API, load tests for queue endpoints, security tests (authz matrix), CI gates on all of them. |
| Multi-user concurrency | Last write wins; two analysts acting on the same case at once are serialised by the SQLite transaction but the second sees a `409` only if the transition is now invalid. | Optimistic locking (`If-Match`/version column) so a stale view cannot act, explicit case locking or assignment, UI refresh on conflict. |
| Case assignment / SLA | `assignedTo` is set to whoever acts; no queues, no ownership, no deadlines. | Assignment rules (round-robin, workload, seniority), claim/release, SLA timers with breach alerts, escalation paths, supervisor dashboards. |
| Notifications | None. | Email/Slack/in-app notifications for escalations, SLA breaches and reassignment; digest for seniors. |
| Document storage (ID scans) | Only boolean flags (`idDocumentVerified`, `addressVerified`); no files. | Encrypted object storage with signed, expiring URLs, virus scanning, access logging, retention tied to the case, redaction tooling, integration with an IDV provider. |
| Integrations | Sanctions, PEP and adverse media are seeded flags. | Screening providers (e.g. ComplyAdvantage, Refinitiv) with re-screening schedules, webhook ingestion, provider outage handling. |

## What this prototype demonstrates about the Power Apps replacement question

What the code-first approach shows well:

- **Velocity on non-trivial logic.** State machine, role rules, risk scoring and a hash-chained audit trail were specified in a one-page contract and implemented with tests in a single pass. Equivalent logic in Power Fx formulas and Dataverse business rules is harder to express and to review.
- **Testability.** Business rules are pure functions with unit tests; the HTTP layer is tested end to end against in-memory SQLite. Power Apps has no comparable automated test story for canvas apps.
- **Version control and review.** Every change is a diff in a PR with CI. Power Apps solutions can be exported to source, but diffs are noisy and merges are painful.
- **Portability.** The API is plain HTTP + JSON; the data layer is a thin repo module. Swapping SQLite for Postgres or adding a second UI does not change the domain.
- **A template.** The workspace/layer structure is designed to be copied for the next internal tool (see `ARCHITECTURE.md`).

What Power Apps gives for free that this prototype does not:

- **Authentication and authorization.** Entra ID sign-in, security roles and row-level security exist out of the box. Here identity is a header and authorization is one `if`.
- **Hosting and operations.** No servers, backups, patching, TLS, or monitoring to run. Everything in the table above under database, deployment, observability and secrets is someone's job in the code-first world.
- **Connectors.** Hundreds of prebuilt connectors (SharePoint, Outlook, Teams, Dataverse, approvals). Each integration here is code to write and maintain.
- **Citizen-developer editing.** Compliance staff can tweak a form or add a column themselves. Here every change goes through engineering (or an agent) and a PR.
- **Governance built in.** Environments, DLP policies, solution lifecycle and audit of maker activity are platform features.

Honest read: the code-first approach wins when the tool has real business logic, needs tests and review, or will be one of many built from a shared template. Power Apps wins for simple CRUD over Microsoft 365 data where the business owner wants to edit the app directly. The 10+ upcoming internal apps should be triaged against that line rather than migrated wholesale. The cost that must be budgeted for the code-first path is the platform work in the table above — done once, shared across apps.
