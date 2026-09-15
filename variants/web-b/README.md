# KYC Review Console (web-b)

Reference component-library SPA from the original KYC UI evaluation. It implements
the KYC queue at `/`, case detail at `/cases/:id`, and a not-found fallback.
It does not implement Refund Operations, approval-note or risk-scoring policy
pages, or the default SPA's local role picker. See the
[current workspace comparison](../README.md).

## How to run

Use Node 22.x at least 22.13, or Node 24+. The locked lint dependency
`eslint-visitor-keys@5.0.1` requires `^20.19.0 || ^22.13.0 || >=24`;
Node 20.x needs at least 20.19. From the repository root:

```sh
npm ci
npm run seed            # destructive reset of fictional data, credentials and sessions
```

For an existing fictional database, use `npm run seed:logins` instead. This resets
demo passwords and browser sessions while preserving business data; a fresh full
seed already includes logins. Use the same `KYC_DB_PATH` for seeding and the API
if overriding the default.

Start the long-running commands in separate terminals:

```sh
npm run dev:server      # loopback API at http://127.0.0.1:4000
npm run dev:web-b       # Vite defaults to http://localhost:5173
```

The API development command uses `cross-env HOST=127.0.0.1 LOCAL_DEMO_AUTH=true`
on Windows, macOS and Linux. [Vite](vite.config.ts) proxies `/api` to
`http://127.0.0.1:4000`, so the browser uses same-origin requests. An API `PORT`
override does not change this proxy target. Unlike the default SPA's script,
web-b does not set `--strictPort` by default and can choose the next free port;
check the startup output when running it beside another UI.

For simultaneous users, run another instance with `npm run dev -w variants/web-b -- --port 5174 --strictPort`. Sign in separately on each port; both frontends can use the API on port 4000. Independently opened tabs also have separate sessionStorage. Browser “duplicate tab” or opener-created tabs can initially copy sessionStorage: open a fresh tab independently for a different user, rather than duplicating an authenticated tab.

## Authenticated access

Sign in with email and password. For isolated local development, `npm run dev:server` explicitly enables `LOCAL_DEMO_AUTH=true`; production rejects this authentication mode. The sign-in page shows these publicly documented, fictional demo accounts in development builds, matching a fresh seed:

| Role | Email |
| --- | --- |
| Analyst | `grete.lindholm@northwind-demo.example` |
| Senior analyst | `marta.ellison@northwind-demo.example` |
| Compliance manager | `sofia.chen@northwind-demo.example` |

All use the local-only password `demo-password-2026`. Login seeding normalizes
stored names into addresses at `northwind-demo.example` and adds a deterministic
ID suffix when normalized names collide. Retained databases may therefore have
different addresses: use the login seeder's output rather than assuming the
static help matches that database. Web-b does not resolve role choices through
`/api/auth/demo-users`. These are fictional credentials; local authentication
still runs through the API, and the frontend never grants permissions.

The form posts `{email,password}` as JSON to `POST /api/auth/sign-in`. A successful response provides the verified analyst, permissions, and an opaque session token. Incorrect credentials receive a generic error; validation and throttling have separate guidance. The password field is cleared on submission. No password or analyst identity is persisted by the app.

Initial sign-in validates and accepts the identity in that response; it does not
make the default SPA's additional `/api/me` check immediately after sign-in.
Production builds hide only the demo-account help, not the password form. The
API adapter is disabled by ordinary startup and cannot be enabled in production;
production SSO/OIDC is not implemented in this reference UI.

Only the session token is stored in this tab's sessionStorage, isolated by origin (including port) and tab. Refresh uses that token in `GET /api/me` before rendering protected content or starting queue, case, or directory queries; stored identity data is never trusted. Subsequent API calls use `Authorization: Bearer <token>` and the verified user's ID in `x-analyst-id` as a consistency guard. The directory only supplies display names. A 403 remains a permission error without an actor fallback. Server-side policy remains authoritative.

SessionStorage is accessible to page JavaScript, including injected scripts; this is a local prototype trade-off, not an HttpOnly session. Tokens are not saved in localStorage, URLs, query caches, or rendered HTML. Closing a tab normally ends its browser storage, but does not itself revoke the server session. The server enforces absolute and idle expiry; a 401 clears local state and requires sign-in again. If browser storage is unavailable, the app reports that refreshing requires a new sign-in.

**Sign out** immediately clears local identity, storage, query/mutation caches and feedback, aborts protected requests, unmounts protected pages/dialogs, and posts to `/api/auth/sign-out` to revoke only this session. A failed revocation is visibly reported: the server session may still exist until expiry. Other users' sessions are unaffected. Switching users and cancelled sign-ins use the same isolation protections. Late login, restoration, query, and logout responses cannot replace or erase a newer identity. If a cancelled sign-in still returns a token, the app makes a best-effort independent request to revoke it.

## KYC workflow

The queue has status totals, status/risk filters, debounced search and pagination.
Filter/sort/page state is stored in URL query parameters. The server sorts by
`createdAt`, `updatedAt` or `riskScore`; other displayed columns are not sortable.
Case detail shows the customer, signals, deterministic risk explanation and an
audit timeline with browser-side chain verification.

TanStack Query fetches and caches API data; protected reads may retry once,
excluding 401/403/404 and aborted requests. Mutations are not retried. Successful
actions invalidate the case, audit, queue and statistics queries. See
[query definitions](src/api/queries.ts).

## Actions and note validation

Buttons are drawn from the API's `allowedActions`: `start_review`, `approve`,
`reject` and `escalate`. The current server still checks the stored user's role,
case state and approval policy when an action is submitted.

The reference UI's [note validator](src/lib/actionRules.ts) and
[dialog](src/components/ActionDialog.tsx) retain earlier rules:

- Reject/escalate require 10–1000 trimmed characters.
- High-risk approval only requires a nonempty trimmed note locally, capped at
  1000; the current API requires at least 10 characters.
- Low/medium approval is presented as optional locally, without consuming the
  API's `approvalNoteRequired` flag. The current API requires 10–1000 characters
  when approval-note policy is enabled (the default).
- Start-review notes are optional, with a 1000-character limit.

A locally accepted approval can therefore fail API validation; the dialog shows
that error. Use a 10–1000 character explanation for required approvals. There is
no policy editor here; use the default SPA to change policy. The reference case
page also labels an empty action list as “Case closed” even when the API withheld
actions because of the user's role.

## Validation

From the repository root:

```sh
npm run test:web-b
npm run lint:web-b
npm run typecheck:web-b
npm run build:web-b
```

Vitest uses mocked fetch, isolated storage, real TanStack Query caches, and React server rendering to cover password sign-in, verified restoration, revocation, cancellation, session isolation, role resolution, and the sign-in boundary. These tests do not exercise a live authentication server or interactive browser dialogs.

Pure helper suites also cover URL filters, the retained note rules and audit
hashing against a fixture. Root `npm test`, `npm run lint` and `npm run typecheck`
do not include this workspace. The build runs `tsc -b` and Vite and emits
`dist/` here; deployment needs `/api` routing and a client-route fallback to
`index.html`, in addition to production authentication. There is no workspace
`preview` script. `npm run format -w variants/web-b` rewrites source formatting;
lint includes a read-only Prettier check.

## Approach

Approach B — a component-library SPA. The app uses a small set of owned, shadcn/ui-style primitives with Radix accessibility foundations, TanStack Query for server state, and TanStack Table for the review queue.

## Dependencies

### Runtime

- React 18 and React DOM — UI runtime.
- React Router DOM 6 — client-side routes.
- TanStack Query 5 — API cache and mutations.
- TanStack Table 8 — manual sorting and responsive queue table.
- Radix Dialog, Select, Tooltip, and Slot — accessible primitives.
- class-variance-authority, clsx, tailwind-merge — class composition.
- lucide-react — consistent interface icons.
- sonner — action feedback toasts.

### Development

- Vite 6 and the React plugin — fast dev server and production bundling.
- TypeScript — strict static typing.
- Tailwind CSS 3, PostCSS, and Autoprefixer — utility styling.
- Vitest — logic, mocked API/session, and server-rendering tests.
- ESLint, typescript-eslint, React Hooks, and React Refresh plugins — code quality checks.
- Prettier — consistent source formatting.

## Trade-offs of this approach

- There are many small dependencies and Radix versions can change independently.
- Copied shadcn-style code is owned code that must be maintained.
- Tailwind can produce dense class strings in complex screens.
- TanStack Table is more machinery than one table requires, but scales to richer queues.
- Radix and query/table libraries add browser dependencies; historical bundle
  comparisons are not current measurements.
- Contributors need familiarity with several composable APIs.
