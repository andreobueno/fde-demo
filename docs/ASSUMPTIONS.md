# Prototype assumptions vs production requirements

This prototype deliberately trades production concerns for speed and clarity. Each row states what the prototype does and what a production deployment handling real KYC data would need instead.

| Area | Prototype assumption | Production requirement |
| --- | --- | --- |
| Authentication / identity | Administrator-issued, expiring/revocable opaque bearer credentials on all sensitive routes; only token hashes stored. No seeded credentials. SPA tokens stay in memory; SSR uses secure cookies. IDs alone cannot authenticate. | SSO/OIDC (e.g. Entra ID, Okta), controlled provisioning from the IdP/HR directory, managed session lifecycle and MFA per company policy. |
| Authorization | Central server permission matrix for analyst, senior analyst and compliance manager. Current stored roles, case risk and state authorize each mutation. All roles can read all cases. | Controlled role provisioning, assignment/tenant/field-level scope, separation of duties (maker/checker), audited access grants and periodic access reviews. |
| Database | Single SQLite file (`packages/server/data/kyc.db`), schema applied on startup, `seed` drops and recreates. No migrations. | Postgres (managed) with versioned migrations, connection pooling, PITR backups tested by restore drills, read replicas if reporting needs them, per-environment credentials. |
| Audit immutability | Server-generated case and policy audit events, atomic with mutations, no audit write API, append-only triggers including replacement-insert protection. Hashes live beside operational data; a DB administrator can bypass them. | Separate append-only/WORM storage, restricted writer privileges, externally anchored chain heads, defined retention, monitored verification and restore tests. Include access/denial/admin events and decision-time role/policy evidence. |
| Review policy | Manager-only setting for low/medium approval notes, version conflict checks, mandatory change reason and before/after audit snapshots. High-risk role/note boundaries are fixed. | Dual approval/change control for sensitive policy updates, policy version retained on case decisions, staged rollout and periodic governance review. |
| Risk engine | Deterministic sum of hardcoded weights in `domain/risk.ts`; the explanation uses the recorded case score and signal evidence; thresholds are fixed in code; no versioning. | Versioned rules configuration (each case records the ruleset version used), change control with 4-eyes approval, back-testing before rollout, model governance/inventory if any ML is introduced, explainability output retained with the decision, regulator-readable rationale. Any LLM-written summary must cite the structured result and cannot become the policy source of truth. |
| Data | Seeded fictional customers from a fixed-seed PRNG; no real PII. Data at rest is a plaintext SQLite file. | Real PII: encryption at rest and in transit, field-level encryption or tokenisation for identifiers, data minimisation, field-level access controls and masking in the UI, data residency constraints, GDPR rights (access/erasure balanced against AML retention obligations), documented retention and deletion schedule. |
| Secrets / config | `PORT` and `KYC_DB_PATH` env vars; CLI-issued access tokens written once to private files. Only hashes live in SQLite. | Secrets manager (Vault, AWS Secrets Manager), secure credential delivery, no secrets in repo or images, rotation, per-environment config validated at startup. |
| Observability | `console.log` on startup; errors returned in the JSON envelope. | Structured logs with request ids, metrics (latency, error rate, queue depth by status), tracing, alerting, log retention that excludes PII, dashboards for analyst throughput and SLA. |
| Rate limiting / CSRF / CSP | Basic security headers, no-store API responses, a localhost-only CORS allow-list and explicit bearer headers in SPAs. SSR uses SameSite=Strict cookies. No rate limiting. | Rate limiting and abuse detection at the edge, reviewed CSRF protection for cookie-based auth, strict CSP, HSTS, request body limits tuned, WAF, dependency and container scanning. |
| Deployment | Local dev only: `tsx watch`, SQLite on disk. | Containers built in CI, image signing, CD with staged environments, infrastructure as code, health/readiness probes, zero-downtime deploys, rollback procedure. |
| Testing | Vitest role/risk/state matrix, Supertest authorization and policy boundaries, transactional rollback and migration tests, web identity and note-rule tests. | Add end-to-end browser tests, load tests, security tests of real authentication and CI gates. |
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

- **Authentication and access administration.** Entra ID sign-in and access administration are platform features. Here authentication and RBAC are enforced, but credential provisioning is a local CLI operation, without managed SSO or row-level scoping.
- **Hosting and operations.** No servers, backups, patching, TLS, or monitoring to run. Everything in the table above under database, deployment, observability and secrets is someone's job in the code-first world.
- **Connectors.** Hundreds of prebuilt connectors (SharePoint, Outlook, Teams, Dataverse, approvals). Each integration here is code to write and maintain.
- **Citizen-developer editing.** Compliance staff can tweak a form or add a column themselves. Here every change goes through engineering (or an agent) and a PR.
- **Governance built in.** Environments, DLP policies, solution lifecycle and audit of maker activity are platform features.

Honest read: the code-first approach wins when the tool has real business logic, needs tests and review, or will be one of many built from a shared template. Power Apps wins for simple CRUD over Microsoft 365 data where the business owner wants to edit the app directly. The 10+ upcoming internal apps should be triaged against that line rather than migrated wholesale. The cost that must be budgeted for the code-first path is the platform work in the table above — done once, shared across apps.
