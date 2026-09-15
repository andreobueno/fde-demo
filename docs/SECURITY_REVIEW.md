# Authorization and audit hardening

## Historical findings before hardening

These findings describe earlier implementation stages, not the current API. The transition
hardening is visible in [83cf122](https://github.com/andreobueno/fde-demo/commit/83cf122),
identity/policy transactions in [73a3dbb](https://github.com/andreobueno/fde-demo/commit/73a3dbb),
UI identity handling in [518ab25](https://github.com/andreobueno/fde-demo/commit/518ab25),
and bearer authentication in [1b4d745](https://github.com/andreobueno/fde-demo/commit/1b4d745).

- Queue, customer detail, risk explanations and audit reads did not require an explicit identity. Some reads silently used a seeded senior.
- Analysts could approve/reject pending and in-review cases at any risk. Senior-only authorization applied only when resolving escalated cases.
- High-risk approval required a note only before escalation; there was no manager role, permission matrix or policy-management boundary.
- The write service accepted an actor object without reloading its role/name from storage.
- Case actions already appended server-side audit events transactionally, and update/delete triggers already existed. Those protections were retained and rollback/identity/replacement protections gained regression tests.
- The selected UI could retain case data and an action dialog while identity changed; an empty action list was incorrectly described as a closed case.
- The initial RBAC implementation trusted a caller-selected analyst ID. Requiring that header prevented anonymous reads, but anyone knowing a manager ID could still impersonate that manager.

## Current implementation

### Enforced permission matrix

| Capability | analyst | senior_analyst | compliance_manager |
| --- | --- | --- | --- |
| Read KYC/refunds, risk explanations, business audit and policy | Yes | Yes | Yes |
| Start KYC review and escalate from a legal state | Yes | Yes | Yes |
| Decide low/medium KYC risk | No | Yes | Yes |
| Decide high KYC risk | No | No | Yes |
| Decide low/medium refunds up to USD 5,000 | No | Yes | Yes |
| Decide high-risk refunds or refunds above USD 5,000 | No | No | Yes |
| Manage either KYC policy | No | No | Yes |
| Change or delete audit events through the API | No | No | No |

[`domain/authorization.ts`](../packages/server/src/domain/authorization.ts) centralizes
permissions, with unknown roles denied. `domain/transitions.ts` combines them with legal case
transitions and note requirements; `domain/refunds.ts` checks pending status, risk, amount and
mandatory notes. Both advertised actions and writes use these rules. UI actions may be stale;
the write service rechecks them.

Protected API routes require a bearer credential. Case, refund and both policy services reload
the actor inside immediate SQLite transactions, so a forged/stale role in the supplied context
does not elevate access. Their action/policy body schemas reject extra actor/role/state fields.
All supported roles can read all cases and refunds; assignment is not an access restriction and
there is no tenant, field-level or maker/checker boundary. Responses carry `Cache-Control:
no-store`; this header does not erase copies already held by a client.

### Authenticated access

The local adapter accepts email/password at `/api/auth/sign-in`. The selected SPA's
development-only Analyst / Reviewer / Admin picker first reads anonymous
`/api/auth/demo-users`: it maps labels to the first retained credential by analyst ID for each
current role (analyst / senior analyst / compliance manager), omitting missing roles.
It submits that email and the public `demo-password-2026`, then verifies `/api/me` before
installing identity. Failed verification attempts to revoke the new session; failed network
revocation cannot guarantee it was removed. Labels and analyst IDs alone do not authenticate.

The mapping endpoint and password sign-in are intentionally accessible without a prior
credential when enabled. Anyone reaching the adapter can sign in as a seeded manager using
the public password. A picker hiding the password from the form is a convenience, not secrecy
or controlled account provisioning.

The API `dev` script sets `HOST=127.0.0.1` and `LOCAL_DEMO_AUTH=true`. Ordinary `start` sets
neither and honors existing environment values; without `HOST`, the listener is not explicitly
restricted to loopback. Local auth defaults off, returns `404 LOCAL_AUTH_DISABLED` on its routes
when off, and rejects previously issued demo sessions on protected routes. It throws if enabled
with `NODE_ENV=production`. These checks do not establish that a caller is on a trusted network.
Full demo/login seeding also rejects production; refund-only seeding has no production guard.

Password creation uses 16-byte random salts and scrypt (`N=16384, r=8, p=1`, 32-byte key), with
a 12–256 character input requirement and NFKC normalization before derivation. Sign-in accepts
1–256 characters to check an existing hash. Unknown emails incur decoy verification; excessive
or malformed stored parameters are rejected before derivation. Valid-shaped unknown-account
and wrong-password requests return the same `401 INVALID_CREDENTIALS`; malformed input is
`400` and throttling is `429`. This does not promise indistinguishable timing or account secrecy
given the public demo mapping.

In-process limits block after eight email failures or 64 socket-IP failures within 15 minutes.
Each throttle holds at most 1,000 keys; it resets with the process and evicts keys under pressure.
The source limit counts credential `401`s, not every malformed/throttled request, and sees a
reverse proxy's connection IP. There is no general API throttle. Synchronous scrypt and these
bounded local limits are unsuitable as the production abuse-control design.

Sign-in issues 32 random bytes as a base64url bearer token, stores only its SHA-256 hash, and
associates it with an analyst. Sessions end after one idle hour or 12 hours total. Authentication
updates idle activity or deletes an expired row; each new session also purges up to 1,000
expired/idle rows. Sign-out revokes only the submitted session and is idempotent for unknown
tokens. Session creation/revocation and their event writes are atomic. A separate append-only
`auth_events` table records success, failure, throttling and logout without raw passwords/tokens.
These events have no public mutation or read endpoint; they are available to database administrators.
Malformed sign-in bodies, expiry cleanup and administrative reseeding do not produce separate
auth events. `auth_events` contains identity metadata and failure reasons; it is not hash-chained.

Automation uses separate bearer credentials with an eight-hour default lifetime and no idle
timeout. The administrative CLI requests a new file with mode `0600`, refuses overwrite
(including an existing symlink) and logs metadata rather than the token. Filesystem/OS access
controls still need verification on the deployment platform. No automation tokens are seeded.
The revoke CLI removes all automation tokens for the named analyst, without revoking sessions.

API health and enabled local authentication routes are the anonymous exceptions. The main
identity middleware rejects a bare `x-analyst-id`; with a valid bearer, an explicitly supplied
mismatched ID returns `403`. CORS handles preflight before identity checks and allows
localhost/127.0.0.1 origins; it does not prevent non-browser network access. Protected requests
with missing, malformed, unknown, expired or revoked tokens receive generic `401 UNAUTHORIZED`.
`/api/analysts` requires authentication, while the demo mapping deliberately exposes selected
credential names/emails anonymously. Current roles are loaded from SQLite on each request.

The selected SPA preserves same-origin cookies for authenticated preview/reverse-proxy access.
The API ignores cookies when resolving application identity and still requires its bearer token.
Fetch redirects remain disabled.

The SPAs gate sensitive views on a server-authenticated identity and store only session tokens
in `sessionStorage` (`operations.session` in the selected UI, `kyc.web-b.session` in web-b).
Restore verifies `/api/me`; fresh web-b sign-in uses the sign-in response. Storage is scoped by
origin (including port) and tab, but duplicated/opener-created tabs may inherit a copied token.
JavaScript can read it, so XSS can steal it. A copied token works in another context until
revoked/expired. Clearing storage or closing a tab does not itself revoke the server session.

SSR accepts email/password, stores the issued session in an HttpOnly, SameSite=Strict cookie
at path `/`, and forwards it to the API as a bearer credential. Protected page requests resolve
`/api/me`. Cookies default to Secure, with absolute expiry from the API; the API still enforces
idle expiry. `ALLOW_INSECURE_LOCAL_AUTH=true` allows local HTTP and is rejected in production.
SSR `LOCAL_DEMO_AUTH` controls fictional sign-in help; it does not enable the API adapter.
The cookie name defaults to `kyc_session_<PORT>` or `SESSION_COOKIE_NAME`; cookies are shared
across tabs and ports, so names provide functional instance selection rather than a security
boundary. Legacy identity/token cookies are ignored and cleared.

SSR form requests require an `Origin` matching the request host and expected protocol, and
reject `Sec-Fetch-Site: cross-site`; GET/HEAD/OPTIONS are exempt. There is no synchronizer CSRF
token, configured canonical-origin allow-list or enabled Express `trust proxy`. SameSite and
these origin checks are useful defenses, not a reviewed production cookie/CSRF architecture.

The SPAs clear/remount sensitive views, cancel requests and guard against late results during
identity changes. SSR uses page/htmx redirects and optional expected-identity checks on forms;
it does not share the SPA cancellation mechanism. Neither cancellation nor sign-out can undo
a server commit already made. Successful logout revokes token copies while preserving
independently issued sessions. The UIs report failed revocation instead of guaranteeing remote
logout. These are local lifecycle safeguards, not isolation from all stale pages or same-host apps.

Sources: [`password.ts`](../packages/server/src/domain/password.ts),
[`authService.ts`](../packages/server/src/services/authService.ts),
[`sessions.ts`](../packages/server/src/repo/sessions.ts),
[`auth.ts`](../packages/server/src/http/auth.ts),
[`selected SPA client`](../packages/web/src/api/client.ts),
[`web-b session`](../variants/web-b/src/lib/authSession.ts),
[`SSR app`](../variants/web-c/src/app.tsx).

### Two independent policies

Managers can require or waive notes for low/medium approvals. High-risk approval always requires a manager and a trimmed 10–1000 character justification, including escalated cases. Reject/escalate always require 10–1000 characters.

These are server rules. Reference web-b's [local validator](../variants/web-b/src/lib/actionRules.ts)
does not consume `approvalNoteRequired`: low/medium approval permits an empty note locally, and
high-risk approval requires only one trimmed character. The API rejects notes that violate its
current rules, with the dialog displaying the returned error. Web-b also still labels any empty
action list as “Case closed” in its [detail page](../variants/web-b/src/pages/CaseDetailPage.tsx),
even when an open case has no actions available to that role. These reference-client gaps
do not grant additional server permissions.

This approval-note policy uses `/api/policy` and singleton `review_policy` (initial version 1).
Updates require the current version and a trimmed 10–1000 character reason. Each change records
actor ID/name/role, action, timestamp, complete before/after snapshots and hash links in
`policy_audit_events`. Stale versions are rejected. Setting/event writes are atomic.

Risk scoring uses separate `/api/risk-policy` settings and `risk_policy_changes` versions
(initially 0). Managers change persisted weights/thresholds; an effective update rescales open
cases in the same transaction and writes `RISK_RESCORED` case events only for changed
evaluations. Thresholds are saved per changed case; missing snapshots fall back to 30/60.
Closed cases keep saved scores/signals/thresholds. Explanation reads do not recompute against
the current clock or policy. Risk history is append-only, without hashes, a required reason,
or a client-version precondition. A no-op patch writes nothing. Neither policy affects refunds,
whose approve/reject notes always require 10–1000 trimmed characters.

### Audit protections and migration

Case/refund events share `audit_events` but form independent per-subject chains. Each row has
exactly one subject, actor ID/name, action, timestamp, status transition, note, sequence and hash
link. The legacy hash covers the subject ID, actor ID, action, timestamp, statuses, note and
sequence; it omits the event ID and actor display name. Historical actor role and decision-time
policy version are not dedicated event fields. Risk-rescore notes include a scoring-policy
version and summary, not a complete historical evidence snapshot.

Approval-note policy has a separate chain including event ID, actor name/role and complete
policy snapshots. Risk-policy/auth histories have no hash chains. All four histories have
update/delete triggers; `openDb` enables recursive triggers to reject replace-style overwrites,
and risk history also rejects conflicting ID/version inserts explicitly. The API exposes
read-only business history routes and no arbitrary audit insertion/deletion endpoint. Hash
checks can detect changed covered fields or broken links in supplied records; they cannot
prove completeness, prevent a privileged rewrite or detect removal of the chain tail.

Startup creates missing schema objects, widens legacy analyst roles, expands the audit table
to refunds and adds optional ID-document expiry metadata without reseeding existing records.
These idempotent migration functions have individual transactions and no migration ledger.
They do not add a manager to a retained database.

Full `seed` is a destructive administrative reset, including history and credentials, followed
by fictional KYC/refund fixtures and demo logins. `seed:logins` replaces credentials and revokes
browser sessions for retained analysts while preserving business/auth history and automation
tokens. `seed:refunds` adds missing fictional refund fixtures without overwriting decisions.
All are CLI/admin operations, not HTTP routes or automatic startup steps.

Sources: [`schema.sql`](../packages/server/src/schema.sql),
[`migrations.ts`](../packages/server/src/migrations.ts),
[`audit hashing`](../packages/server/src/domain/audit.ts),
[`policy hashing`](../packages/server/src/domain/policy.ts),
[`risk policy service`](../packages/server/src/services/riskPolicyService.ts),
[`full seed`](../packages/server/src/seed.ts),
[`login seed`](../packages/server/src/seedLogins.ts),
[`refund seed`](../packages/server/src/seedRefunds.ts).

### HTTP behavior limits

The API and SSR have separate response contracts. API `ApiError`s use a JSON envelope;
`SyntaxError` maps to `400`, and other unexpected errors map to generic `500` without stack
logging. JSON body limits exist (2 KB auth, 50 KB general), but oversized-body errors are not
explicitly mapped to `413`. CORS preflight precedes auth; unknown protected API routes can
return `401` before route lookup. Sign-out returns `204` idempotently when its handler
completes, rather than rejecting every expired/unknown token. SSR returns HTML or htmx
headers: normal successful form redirects use `303`, htmx redirects use `204` plus
`HX-Redirect`, and error/sign-in paths can use other statuses.

### Automated coverage in the repository

The following describes checked-in tests, not a claim that a browser run or CI passed during
this documentation review. Root workspace scripts provide test/lint/typecheck commands; no CI
workflow is tracked here.

- Role × risk × state × action matrix, terminal-state behavior, unknown roles and required-note boundaries.
- HTTP access with missing/malformed/unknown/expired/revoked credentials, forged manager headers, expected-identity mismatches and valid credentials for each role.
- Hash-only token storage, no seeded automation tokens, issuance file permissions/overwrite protection, revocation and current-role resolution.
- Password verification, generic failures, throttling, session idle/absolute expiry, logout isolation, session-role demotion, authentication event rollback, local-only production guard.
- Authorized/denied actions and policy changes, including effects on actual state and audit contents.
- Current database roles overriding forged or stale service objects.
- Case/refund/both-policy transaction rollback when event insertion fails.
- Audit update/delete/replace protection and duplicate terminal decisions.
- Existing-database migration preserving stored records and hashes, repeated startup and failed migration rollback.
- Web credential headers, tab/origin session storage, verified restoration, sign-in gating, request cancellation and late-response isolation; selected-SPA/SSR tests cover server-supplied note rules.
- SSR secure-cookie defaults/local opt-in, origin checks, stale/invalid cookies, configured namespaces and restricted-case messaging.
- Persisted risk evidence/thresholds, changed-evidence rescoring, closed-case preservation and additive refund/login reseeding.

## Still required for production

1. **Managed sign-in and provisioning.** Replace the local password adapter with SSO/OIDC using validated issuer/audience/signature/expiry, MFA, controlled identity-to-role mapping, managed server sessions and credential rotation. Protect administrator access to the database and issuance files. Tokens are bearer secrets: a copied token works until revoked or expired.
2. **Authorization governance.** Controlled role provisioning/revocation and periodic reviews; assignment/tenant/field-level scoping; separation of duties or dual approval for sensitive decisions and policy changes. Currently all roles can read all cases and managers can decide cases they reviewed.
3. **Independent audit durability.** The runtime owns the SQLite file. An OS/DB administrator can drop triggers, alter the schema or rewrite hashes. External append-only/WORM storage, restricted service accounts, retention, chain-head anchoring, backup/restore procedures and monitored verification are needed. A hash chain alone cannot prove that its tail was not removed. The legacy case hash does not cover actor display names or record the actor's historical role or policy version.
4. **Broader audit coverage.** Export authentication events to an independent security stream; add sensitive data reads/exports, denied access, role grants, session expiry and administrative operations. Retain decision-time risk evidence and ruleset versions. Current business histories record successful case/refund decisions, risk rescores and changes to both policies, but do not retain complete prior risk evaluations.
5. **Data and operations.** Encryption at rest/in transit, PII masking and minimization, tested backups, rate limits, secrets management, dependency maintenance, CSRF protection for cookie sessions, deployment hardening and CI security gates. Never seed/reset a retained production database.
6. **Concurrency and change governance.** Approval-note policy has optimistic version checks; risk-policy patches and case/refund decisions validate current state without an explicit client version. Add stale-view detection, idempotency keys where required, controlled migrations and a reviewed policy rollout process.
