# @kyc/server

Express + better-sqlite3 backend for the KYC Review Console and Refund Operations prototype.
Contracts: [KYC, authentication and policies](../../docs/API_CONTRACT.md) and
[refunds](../../docs/REFUNDS_API.md). Refund approvals record decisions; they do not move money.

## Setup

Run at the repository root with Node and npm workspaces:

```text
npm install
npm run seed
npm run dev:server
```

`seed` **drops and recreates** fictional KYC/refund data, both policies, all audit histories,
password credentials, sessions and automation tokens. It creates 6 identities, 60 cases and
18 refunds. Its PRNG is fixed, but timestamps, audit UUIDs and password salts are not a
byte-identical snapshot. Use it only on a disposable fictional database.

For a retained fictional database, `npm run seed:logins` replaces demo password credentials
and revokes existing browser sessions, preserving business data, histories and automation
tokens. `npm run seed:refunds` adds missing fixtures without resetting existing decisions.
The full seed and login seed reject `NODE_ENV=production`; the additive refund seed has no
production-environment guard.

The development script uses `cross-env` to set `HOST=127.0.0.1` and `LOCAL_DEMO_AUTH=true`
before `tsx watch`, including on Windows PowerShell/Command Prompt, macOS and Linux.
After pulling changes to dependencies, rerun `npm install`. No Bash environment assignment
is needed for the commands above. The default API address is `http://127.0.0.1:4000`.
Start the default UI separately with `npm run dev:web` from the root.

### Environment and startup

| Variable | Behavior |
| --- | --- |
| `PORT` | API port, default `4000` |
| `HOST` | Bind address; the dev script explicitly sets `127.0.0.1` |
| `KYC_DB_PATH` | SQLite path; default `packages/server/data/kyc.db`, resolved from server source location; `:memory:` supported |
| `LOCAL_DEMO_AUTH` | Local adapter enabled only when exactly `true`; dev script enables it |
| `NODE_ENV` | `production` rejects enabling the local adapter |

`npm run start -w packages/server` runs `tsx src/index.ts` without watching or setting any
environment variables. With `HOST` unset it uses Node's default unspecified bind address;
local auth is disabled unless explicitly enabled. It does not enable production identity
management. Keep the public-password adapter local.

For a port override in PowerShell, run `$env:PORT = "4001"` before the start command; in
Command Prompt, `set PORT=4001`; in Bash, `PORT=4001 npm run dev:server`. Point clients at
the same port. Server and seed/credential commands must share `KYC_DB_PATH` when overridden.

### Authentication

All protected API reads and mutations require `Authorization: Bearer <token>`. There is no
default caller: `x-analyst-id` only checks an expected identity and a mismatch returns 403;
an ID alone, a role header, body actor, cookie or query token cannot authenticate.

`GET /api/health` is anonymous. With the local adapter enabled:

- `GET /api/auth/demo-users` returns available `analyst`, `reviewer`, `admin` picker mappings
  (`id`, current name, retained credential email). These keys are not analyst IDs; unavailable
  roles are omitted. This endpoint does not authenticate the selected user.
- `POST /api/auth/sign-in` accepts strict JSON `{email, password}` and returns the verified
  analyst/permissions plus a session token. The public fictional password is `demo-password-2026`;
  use emails printed by `seed:logins` or returned by discovery for retained databases.
- Send the session as a bearer token on API calls; it expires after 12 hours or one idle hour.
  `GET /api/me` returns the current database identity and permissions.
- `POST /api/auth/sign-out` revokes only the supplied session and returns 204 idempotently.
  Other sessions and automation credentials remain valid.

Disabled local auth routes return `404 LOCAL_AUTH_DISABLED`, and existing demo sessions
cannot authenticate. Separate automation credentials still work:

```text
npm run auth:issue -w packages/server -- <analyst-id> <new-output-file>
npm run auth:revoke -w packages/server -- <analyst-id>
```

Issuance requires an existing analyst and a new writable file in an existing directory.
The token is written to that file, not stdout; it expires after eight hours. Revocation
removes all automation credentials for that identity. Only token hashes are stored in
SQLite. See the [API contract](../../docs/API_CONTRACT.md#authentication-and-identity)
for validation, throttling and the role/permission matrix. Controlled production SSO/OIDC
and managed sessions are not implemented.

## Test / checks

From the repository root, run just the server checks:

```text
npm run test -w packages/server
npm run typecheck -w packages/server
npm run lint -w packages/server
```

The root `npm test`, `npm run typecheck` and `npm run lint` scripts run the server and default
web workspace; alternative UI checks have separate scripts.

## Persistence and audit

- Startup creates missing schema and applies supported legacy migrations without seeding
  fixtures or promoting existing roles. Back up retained databases before upgrades.
  File databases use WAL; foreign keys and recursive triggers are enabled.
- Case/refund decisions and audit appends are atomic. `audit_events` is append-only and
  hash-chained independently per case/refund; each event has exactly one subject.
- Approval-note policy (`/api/policy`) uses optimistic versions, a reason and a separate
  snapshot hash chain. Risk policy (`/api/risk-policy`) accepts partial weights/thresholds,
  has independent versions and field-difference history without a hash chain, and atomically
  rescores changed open-case evaluations. Neither policy relaxes refund decision rules.
- Authentication events are append-only in `auth_events`, without a hash chain or HTTP
  endpoint. SQLite audit protection does not prevent a privileged whole-database rewrite
  or detect chain-tail truncation; external immutable anchoring is not implemented.
