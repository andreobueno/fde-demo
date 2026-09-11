# Authorization and audit hardening

## What was incomplete

- Queue, customer detail, risk explanations and audit reads did not require an explicit identity. Some reads silently used a seeded senior.
- Analysts could approve/reject pending and in-review cases at any risk. Senior-only authorization applied only when resolving escalated cases.
- High-risk approval required a note only before escalation; there was no manager role, permission matrix or policy-management boundary.
- The write service accepted an actor object without reloading its role/name from storage.
- Case actions already appended server-side audit events transactionally, and update/delete triggers already existed. Those protections were retained. Rollback, identity boundaries and replace-style audit overwrites lacked tests.
- The UI could retain case data and an action dialog while identity changed; an empty action list was incorrectly described as a closed case.
- The initial RBAC implementation trusted a caller-selected analyst ID. Anyone knowing a manager ID could impersonate that manager. The interim fail-closed header guard prevented access by default but did not provide a usable authentication mechanism.

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

Every sensitive API route requires an authenticated credential. Case and policy services reload the actor from the database within immediate SQLite transactions, so stale or forged role/name fields in a service context cannot elevate access. API bodies reject extra actor/role/state fields. Responses are not cacheable.

### Authenticated access

An administrator provisions opaque credentials generated from 32 cryptographically random bytes.
Only SHA-256 hashes are stored with the analyst association and issuance/expiry timestamps.
Revocation deletes the stored hashes for the selected analyst.
Credentials last eight hours; no default credentials are seeded. The CLI writes a raw credential
once to a new `0600` file, refuses overwrite and never prints it. Issuance and revocation require
direct administrative database access; there are no public provisioning endpoints.

All API routes except health validate bearer credentials. A bare `x-analyst-id` cannot
authenticate, and a supplied ID that differs from the authenticated actor is rejected with `403`.
CORS preflight returns headers only without credentials, allowing browsers to make authenticated requests.
Missing, malformed, unknown, expired or revoked tokens receive a generic `401`. Directory access
also requires authentication; directory entries cannot grant a caller access to those identities.
Current roles are loaded from SQLite, so a role change takes effect without reissuing a token.

The selected SPA and reference SPA require verified sign-in before loading sensitive pages and
keep tokens in memory only. SSR verifies the same credential and uses an HttpOnly, SameSite=Strict,
Secure cookie. Insecure local HTTP is an explicit non-production option. No user has a default
identity; switching users requires a new credential. Switching or signing out remounts sensitive
views, discards dialogs and cancels requests; late responses cannot restore a previous identity.
Cancellation cannot undo a server commit already made as the original actor. UI sign-out does not
revoke copies of a token; administrative revocation or expiry invalidates those copies.

### Auditable policy

Managers can require or waive notes for low/medium approvals. High-risk approval always requires a manager and a trimmed 10–1000 character justification, including escalated cases. Reject/escalate always require 10–1000 characters.

Policy updates require the current version and a change reason. Each change records actor ID/name/role, action, timestamp, complete before/after policy snapshots and hash links. A stale version is rejected. Policy and event writes are atomic, just like case decisions.

### Audit protections and migration

Case audit events retain case ID, actor ID/name, action, timestamp, previous/new status, note, sequence and hash chain. The API exposes read-only audit routes. SQLite append-only triggers apply to case and policy histories; recursive triggers prevent replacement inserts from overwriting existing records.

Startup widens the role constraint without modifying stored actors or historical audit contents. New demo seeding includes a manager and uses appropriately authorized actors for decisions. Seeding is an administrative reset, never an application endpoint or migration.

### Automated verification

- Role × risk × state × action matrix, terminal-state behavior, unknown roles and required-note boundaries.
- HTTP access with missing/malformed/unknown/expired/revoked credentials, forged manager headers, expected-identity mismatches and valid credentials for each role.
- Hash-only credential storage, no seeded credentials, issuance file permissions/overwrite protection, revocation and current-role resolution.
- Authorized/denied actions and policy changes, including effects on actual state and audit contents.
- Current database roles overriding forged or stale service objects.
- Case/policy transaction rollback when event insertion fails.
- Audit update/delete/replace protection and duplicate terminal decisions.
- Existing-database migration preserving stored records and hashes, repeated startup and failed migration rollback.
- Web credential headers, memory-only storage, sign-in gating, request cancellation, late-response isolation and server-supplied note rules.
- SSR secure-cookie defaults/local opt-in, stale/invalid cookies, no credential leakage and open-but-restricted case messaging.

## Still required for production

1. **Managed sign-in and provisioning.** Replace locally delivered bearer credentials with SSO/OIDC using validated issuer/audience/signature/expiry, MFA, controlled identity-to-role mapping, managed session lifetimes and credential rotation. Protect administrator access to the database and issuance files. Tokens are bearer secrets: a copied token works until revoked or expired.
2. **Authorization governance.** Controlled role provisioning/revocation and periodic reviews; assignment/tenant/field-level scoping; separation of duties or dual approval for sensitive decisions and policy changes. Currently all roles can read all cases and managers can decide cases they reviewed.
3. **Independent audit durability.** The runtime owns the SQLite file. An OS/DB administrator can drop triggers, alter the schema or rewrite hashes. External append-only/WORM storage, restricted service accounts, retention, chain-head anchoring, backup/restore procedures and monitored verification are needed. A hash chain alone cannot prove that its tail was not removed. The legacy case hash does not cover actor display names or record the actor's historical role or policy version.
4. **Broader audit coverage.** Record sensitive data reads/exports, denied access attempts, role grants, sign-in/session events and administrative operations in a separate security event stream. Retain decision-time risk evidence and ruleset versions. Current business audit history records successful case and policy mutations.
5. **Data and operations.** Encryption at rest/in transit, PII masking and minimization, tested backups, rate limits, secrets management, dependency maintenance, CSRF protection for cookie sessions, deployment hardening and CI security gates. Never seed/reset a retained production database.
6. **Concurrency and change governance.** Policy has optimistic version checks; cases still validate the latest state without an explicit client version. Add stale-case detection, idempotency keys where required, controlled migrations and a reviewed policy rollout process.

This implements credential authentication, role authorization and audit foundations. Production deployment and identity administration remain separate work.
