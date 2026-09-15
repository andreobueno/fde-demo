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

The local development adapter replaces browser token entry with email/password sign-in. The
selected SPA hides those fictional credentials behind an Analyst / Reviewer / Admin picker.
The client maps the label to a seeded account, then verifies the issued session through `/api/me`
before installing it. A failed verification requests revocation of the new session. The API never
accepts the selected label, role or analyst ID as authentication; current database identity and
permissions remain authoritative.
`LOCAL_DEMO_AUTH=true` is explicit in the API dev script; ordinary startup disables it.
Production rejects enabling it and rejects demo seeding. Disabled adapters do not accept
previously issued demo sessions. The shared seeded password is intentionally public, for
fictional role evaluation only. Do not expose this adapter to untrusted networks.

Password hashes use salted scrypt (`N=16384, r=8, p=1`); unknown users incur dummy verification.
Failures return the same message regardless of account existence. In-process rate limits apply
per email and connection IP, with bounded state; these are not distributed production controls.
Password verification is synchronous and suitable only for the local demo workload.

Sign-in issues 32 random bytes, stores only a SHA-256 session hash, and associates it with an
analyst. Sessions end after one idle hour or 12 hours total. Sign-out revokes only the current
session. Successful sign-in/out and their audit writes are atomic. A separate append-only
`auth_events` table records success, failure, throttling and logout without raw passwords/tokens.
These events have no public mutation or read endpoint; they are available to database administrators.
Session inactivity expiry and administrative reseeding are not separately audited.

Automation keeps the existing eight-hour bearer credentials. The administrative CLI writes
a token once to a new `0600` file, refuses overwrite and never prints it. These tokens are
not seeded, and the automation revoke command does not revoke browser sessions.

All protected API routes validate bearer credentials. Health and enabled local authentication
routes are the anonymous exceptions. A bare `x-analyst-id` cannot
authenticate, and a supplied ID that differs from the authenticated actor is rejected with `403`.
CORS preflight returns headers only without credentials, allowing browsers to make authenticated requests.
Missing, malformed, unknown, expired or revoked tokens receive a generic `401`. Directory access
also requires authentication; directory entries cannot grant a caller access to those identities.
Current roles are loaded from SQLite, so a role change takes effect without reissuing a token.

The selected SPA and reference SPA require verified sign-in before loading sensitive pages and
keep session tokens in `sessionStorage`. It isolates browser tabs and origins (including ports)
and supports refresh by rechecking `/api/me`. Neither password nor actor/role is stored there.
Duplicated tabs can inherit a copied session, so two distinct local ports are the recommended demo.
JavaScript can read sessionStorage; XSS can steal a token. Production should replace this with
an IdP/BFF session boundary and reviewed cookie/CSRF controls.

SSR verifies the same server session and uses an HttpOnly, SameSite=Strict, Secure cookie
with an instance-specific name. Insecure local HTTP is an explicit non-production option.
Cookie names isolate local instances for functional testing, not security boundaries between
untrusted applications on the same host. No user has a default identity.
Switching or signing out remounts sensitive
views, discards dialogs and cancels requests; late responses cannot restore a previous identity.
Cancellation cannot undo a server commit already made as the original actor. Logout revokes the
browser session, including copies, while leaving independent sessions active. If API revocation
fails, the UI reports that the remote session may remain valid until expiry.

### Auditable policy

Managers can require or waive notes for low/medium approvals. High-risk approval always requires a manager and a trimmed 10–1000 character justification, including escalated cases. Reject/escalate always require 10–1000 characters.

Policy updates require the current version and a change reason. Each change records actor ID/name/role, action, timestamp, complete before/after policy snapshots and hash links. A stale version is rejected. Policy and event writes are atomic, just like case decisions.

### Audit protections and migration

Case audit events retain case ID, actor ID/name, action, timestamp, previous/new status, note, sequence and hash chain. The API exposes read-only audit routes. SQLite append-only triggers apply to case and policy histories; recursive triggers prevent replacement inserts from overwriting existing records.

Startup widens the role constraint without modifying stored actors or historical audit contents. New demo seeding includes a manager and uses appropriately authorized actors for decisions. Seeding is an administrative reset, never an application endpoint or migration.

### Automated verification

- Role × risk × state × action matrix, terminal-state behavior, unknown roles and required-note boundaries.
- HTTP access with missing/malformed/unknown/expired/revoked credentials, forged manager headers, expected-identity mismatches and valid credentials for each role.
- Hash-only token storage, no seeded automation tokens, issuance file permissions/overwrite protection, revocation and current-role resolution.
- Password verification, generic failures, throttling, session idle/absolute expiry, logout isolation, session-role demotion, authentication event rollback, local-only production guard.
- Authorized/denied actions and policy changes, including effects on actual state and audit contents.
- Current database roles overriding forged or stale service objects.
- Case/policy transaction rollback when event insertion fails.
- Audit update/delete/replace protection and duplicate terminal decisions.
- Existing-database migration preserving stored records and hashes, repeated startup and failed migration rollback.
- Web credential headers, tab/origin session storage, verified restoration, sign-in gating, request cancellation, late-response isolation and server-supplied note rules.
- SSR secure-cookie defaults/local opt-in, stale/invalid cookies, no credential leakage and open-but-restricted case messaging.

## Still required for production

1. **Managed sign-in and provisioning.** Replace the local password adapter with SSO/OIDC using validated issuer/audience/signature/expiry, MFA, controlled identity-to-role mapping, managed server sessions and credential rotation. Protect administrator access to the database and issuance files. Tokens are bearer secrets: a copied token works until revoked or expired.
2. **Authorization governance.** Controlled role provisioning/revocation and periodic reviews; assignment/tenant/field-level scoping; separation of duties or dual approval for sensitive decisions and policy changes. Currently all roles can read all cases and managers can decide cases they reviewed.
3. **Independent audit durability.** The runtime owns the SQLite file. An OS/DB administrator can drop triggers, alter the schema or rewrite hashes. External append-only/WORM storage, restricted service accounts, retention, chain-head anchoring, backup/restore procedures and monitored verification are needed. A hash chain alone cannot prove that its tail was not removed. The legacy case hash does not cover actor display names or record the actor's historical role or policy version.
4. **Broader audit coverage.** Export authentication events to an independent security stream; add sensitive data reads/exports, denied access, role grants, session expiry and administrative operations. Retain decision-time risk evidence and ruleset versions. Current business audit history records successful case and policy mutations.
5. **Data and operations.** Encryption at rest/in transit, PII masking and minimization, tested backups, rate limits, secrets management, dependency maintenance, CSRF protection for cookie sessions, deployment hardening and CI security gates. Never seed/reset a retained production database.
6. **Concurrency and change governance.** Policy has optimistic version checks; cases still validate the latest state without an explicit client version. Add stale-case detection, idempotency keys where required, controlled migrations and a reviewed policy rollout process.

This implements credential authentication, role authorization and audit foundations. Production deployment and identity administration remain separate work.
