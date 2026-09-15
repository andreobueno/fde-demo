# @kyc/web — Operations console — default UI

Vite 6 + React 18 + react-router-dom v6 + CSS Modules. The default UI contains
KYC review, Refund Operations, and two KYC policy sections. No UI kit or
data-fetching library.

## How to run

Use Node 22.x at least 22.13, or Node 24+. The locked lint dependency
`eslint-visitor-keys@5.0.1` requires `^20.19.0 || ^22.13.0 || >=24`; the nominal
Node 20+ minimum does not include every Node 20 release (20.x needs at least
20.19). See the [root setup guide](../../README.md#setup-and-run).

From the repository root:

```sh
npm ci
npm run seed          # destructive reset of fictional data, credentials and sessions
```

For an existing fictional database, `npm run seed:logins` provisions demo logins
and resets browser sessions while preserving business records. `npm run seed:refunds`
adds refund fixtures without resetting existing decisions. Use the same `KYC_DB_PATH`
for seeding and the API when overriding the default.

Start these long-running processes in separate terminals:

```sh
npm run dev:server     # loopback API at http://127.0.0.1:4000
npm run dev:web        # this app at http://localhost:5173
```

The API development script uses `cross-env HOST=127.0.0.1 LOCAL_DEMO_AUTH=true`
and works on Windows, macOS and Linux. The SPA uses `--port 5173 --strictPort`.
For another independent origin, run `npm run dev:web:second` in another terminal
(port 5174, also strict).

[Vite's configuration](vite.config.ts) proxies `/api` to `http://127.0.0.1:4000`,
so the browser makes same-origin requests. Changing the API's `PORT` does not
change this proxy target; update the proxy configuration if using a different API port.

## Local identity and sessions

The development sign-in screen is a **role picker**, with Analyst, Reviewer and
Admin choices mapping to `analyst`, `senior_analyst` and `compliance_manager`.
It resolves the selected role's provisioned email through `GET /api/auth/demo-users`,
posts it with the public demo password to `POST /api/auth/sign-in`, and verifies
the issued token through `GET /api/me` before accepting the server identity.
The server's stored role and permissions are authoritative; a missing provisioned
role produces an error. There is no password or bearer-token input in this UI.
See [the client](src/api/client.ts) and [picker](src/analyst/ManualIdentityForm.tsx).

Only the opaque browser-session token is persisted in `sessionStorage`; the
password and actor/role are not. Refresh restores the current identity through
`/api/me` before protected pages load. Protected API requests send the token as
`Authorization: Bearer …` plus `x-analyst-id` as an expected-identity guard.
Sign out / switch user clears local state and protected views, aborts pending
requests and asks the API to revoke that session. Failed revocation is reported;
the server session may remain valid until expiry. A 401 clears local identity.

Storage is scoped to origin (including port) and tab. Independently opened tabs
can use different users; duplicating a tab or opening it through an authenticated
opener can copy its initial storage. Separate ports avoid that ambiguity.
If storage is blocked, sign-in still works in memory but refresh needs another
sign-in. Closing a tab does not itself revoke the server session.

This is local demo authentication. The API adapter is off during ordinary server
startup unless explicitly enabled, and production rejects enabling it. The picker
is absent from production builds: the signed-out screen asks for production
SSO/OIDC, which is not implemented. Browser-session storage is accessible to
JavaScript. See the [authentication scope](../../README.md#authentication-scope)
before using this outside local development.

## Routes and behavior

[The router](src/App.tsx) places these pages behind the same identity boundary:

| Route | Current functionality |
| --- | --- |
| `/` | KYC queue, status totals, status/risk filters, debounced search, sorting and pagination. |
| `/cases/:id` | Customer details, recorded risk explanation and supporting evidence, permitted KYC actions, and audit history. |
| `/refunds` | Refund queue, UTC dashboard totals, status/risk/amount filters, search, sorting and pagination. |
| `/refunds/:id` | Customer and original transaction, exact USD amount, request reason, risk indicators, permitted decisions and audit history. |
| `/policy` | Approval-note policy and its audit history; compliance managers can change the low/medium-risk note requirement. |
| `/policy/risk` | Risk weights, thresholds and change history; compliance managers can edit and restore defaults in the draft. Saving re-scores open KYC cases through the API. |

Unknown routes render a not-found page. Queue filter, sort and page state lives
in URL query parameters. KYC and Refunds share the table, filter chips, search,
pagination, decision dialog and audit timeline components; policy sections keep
separate settings and histories and do not change refund rules.

Both detail pages render the API's `allowedActions`. KYC supports `start_review`,
`approve`, `reject` and `escalate`; refunds support `approve` and `reject` only.
The [shared note validator](src/lib/actionRules.ts) uses the server's
`approvalNoteRequired` flag. Required notes are 10–1000 characters after trimming;
optional notes are capped at 1000. KYC rejection/escalation and high-risk approval
always require notes; low/medium approval follows policy. Both refund decisions
require notes. Refund approval records a decision and does not move money.

Approval-note policy changes require the current version and a 10–1000 character
reason; conflicts or lost permission require a reload. Risk-policy edits use a
separate patch: whole-number weights 0–100, thresholds 1–100, with medium below
high. See the [KYC](../../docs/API_CONTRACT.md) and
[refund](../../docs/REFUNDS_API.md) API contracts for server-enforced rules.

## Checks and build

Run from the repository root:

```sh
npm run test:web
npm run lint:web
npm run typecheck:web
npm run build:web
npm run preview -w packages/web   # inspect the built assets after build
```

Build runs TypeScript checking and Vite, emitting `dist/` in this workspace.
Preview serves that production build, so it does not provide the development
role picker. A deployment needs same-origin `/api` routing and a fallback to
`index.html` for client-side routes, as well as production authentication.

Vitest runs in Node and covers pure filter/note/policy helpers, KYC/refund audit
hashing, API authorization and session lifecycle with mocked fetch/storage, and
server-rendered component checks for identity, policy sections, refund details
and risk warnings. These are not live-API or interactive browser tests; no
fixed test count or bundle size is asserted here.

## Dependencies

Runtime:

- `react`, `react-dom` — UI framework.
- `react-router-dom` — routing + `useSearchParams` for URL-driven filter state.

Dev:

- `vite` — dev server (including `/api` proxy) and bundler.
- `@vitejs/plugin-react` — JSX transform + fast refresh.
- `typescript` — static typing (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- `vitest` — Node-based unit, mocked API/session and rendering tests.
- `@types/react`, `@types/react-dom` — React typings.
- `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals` — linting, mirroring the server config plus react-hooks rules and browser globals.

## Trade-offs of this approach

- The small [useApi hook](src/api/useApi.ts) has no shared cache, request
  deduplication, automatic retries or optimistic updates. Navigation refetches;
  mutations explicitly reload relevant data, and error panels offer manual retries.
- No UI library: consistent look is maintained by hand via CSS variables; no
  accessibility-tested widgets beyond native elements.
- Native `<dialog>` needs a fairly recent browser (no Safari <15.4 / old Chrome).
- URL filters use shared parsing helpers plus domain-specific KYC/refund options.
- The KYC detail page's case and risk-explanation requests load independently.
- More features (bulk actions, saved views, websockets) would add boilerplate
  quickly; a query library would pay off past this scope.

This was selected as Approach A during the original KYC UI comparison. That
selection predates Refund Operations and the current policy/session UI; the
[reference variants](../../variants/README.md) do not have current feature parity.
