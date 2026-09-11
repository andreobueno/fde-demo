# Authorization and audit hardening

## What was incomplete

- Queue, customer detail, risk explanations and audit reads did not require an explicit identity. Some reads silently used a seeded senior.
- Analysts could approve/reject pending and in-review cases at any risk. Senior-only authorization applied only when resolving escalated cases.
- High-risk approval required a note only before escalation; there was no manager role, permission matrix or policy-management boundary.
- The write service accepted an actor object without reloading its role/name from storage.
- Case actions already appended server-side audit events transactionally, and update/delete triggers already existed. Those protections were retained. Rollback, identity boundaries and replace-style audit overwrites lacked tests.
- The UI could retain case data and an action dialog while identity changed; an empty action list was incorrectly described as a closed case.

## Changes

### Enforced permission matrix

| Capability | analyst | senior_analyst | compliance_manager |
| --- | --- | --- | --- |
| Read KYC cases, risk explanations, audit and policy | Yes | Yes | Yes |
| Start review and escalate | Yes | Yes | Yes |
| Decide low/medium risk | No | Yes | Yes |
| Decide high risk | No | No | Yes |
| Manage policy | No | No | Yes |
| Change or delete audit events | No | No | No |

`domain/authorization.ts` centralizes permissions, with unknown roles denied. `domain/transitions.ts` combines permissions with legal case transitions and note requirements. Both `allowedActions` and writes use these rules. No UI permission check substitutes for server enforcement.

Every sensitive API route requires an explicit known identity. Case and policy services reload the actor from the database within immediate SQLite transactions, so stale or forged role/name fields in a service context cannot elevate access. API bodies reject extra actor/role/state fields. Responses are not cacheable.

The selected UI identity is sent on every request. New visitors default to an analyst. Switching identity remounts sensitive views, discards open dialogs and cancels outstanding client requests. Cancellation cannot undo a server commit already made as the original actor.

### Auditable policy

Managers can require or waive notes for low/medium approvals. High-risk approval always requires a manager and a trimmed 10–1000 character justification, including escalated cases. Reject/escalate always require 10–1000 characters.

Policy updates require the current version and a change reason. Each change records actor ID/name/role, action, timestamp, complete before/after policy snapshots and hash links. A stale version is rejected. Policy and event writes are atomic, just like case decisions.

### Audit protections and migration

Case audit events retain case ID, actor ID/name, action, timestamp, previous/new status, note, sequence and hash chain. The API exposes read-only audit routes. SQLite append-only triggers apply to case and policy histories; recursive triggers prevent replacement inserts from overwriting existing records.

Startup widens the role constraint without modifying stored actors or historical audit contents. New demo seeding includes a manager and uses appropriately authorized actors for decisions. Seeding is an administrative reset, never an application endpoint or migration.

### Automated verification

- Role × risk × state × action matrix, terminal-state behavior, unknown roles and required-note boundaries.
- HTTP access with missing/unknown identity, spoofed roles/body fields and different selected users.
- Authorized/denied actions and policy changes, including effects on actual state and audit contents.
- Current database roles overriding forged or stale service objects.
- Case/policy transaction rollback when event insertion fails.
- Audit update/delete/replace protection and duplicate terminal decisions.
- Existing-database migration preserving stored records and hashes, repeated startup and failed migration rollback.
- Web request identity, request cancellation, role types and server-supplied note rules.

## Still required for production

1. **Authenticated identity.** The selectable `x-analyst-id` is deliberate demo impersonation: a caller can select a manager ID. Use SSO/OIDC with validated issuer/audience/signature/expiry, MFA, session revocation and trusted identity-to-role mapping. Remove the demo selector and strip untrusted identity headers at the boundary.
2. **Authorization governance.** Controlled role provisioning/revocation and periodic reviews; assignment/tenant/field-level scoping; separation of duties or dual approval for sensitive decisions and policy changes. Currently all roles can read all cases and managers can decide cases they reviewed.
3. **Independent audit durability.** The runtime owns the SQLite file. An OS/DB administrator can drop triggers, alter the schema or rewrite hashes. External append-only/WORM storage, restricted service accounts, retention, chain-head anchoring, backup/restore procedures and monitored verification are needed. A hash chain alone cannot prove that its tail was not removed. The legacy case hash does not cover actor display names or record the actor's historical role or policy version.
4. **Broader audit coverage.** Record sensitive data reads/exports, denied access attempts, role grants, sign-in/session events and administrative operations in a separate security event stream. Retain decision-time risk evidence and ruleset versions. Current business audit history records successful case and policy mutations.
5. **Data and operations.** Encryption at rest/in transit, PII masking and minimization, tested backups, rate limits, secrets management, dependency maintenance, CSRF protection for cookie sessions, deployment hardening and CI security gates. Never seed/reset a retained production database.
6. **Concurrency and change governance.** Policy has optimistic version checks; cases still validate the latest state without an explicit client version. Add stale-case detection, idempotency keys where required, controlled migrations and a reviewed policy rollout process.

This implements the authorization and audit foundations of the application. It is not an authenticated production deployment.
