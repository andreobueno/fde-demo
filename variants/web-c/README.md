# @kyc/web-c — server-rendered KYC Review Console (Approach C)

Express + React 19 (`renderToStaticMarkup`) as the template engine + vendored htmx for interactivity.
There is no client-side React, no browser bundler and no hydration: every screen is HTML produced on the
server from the backend's JSON API. htmx swaps HTML fragments for the queue table, the action
dialog and the post-action refresh; core workflows also have plain form/link + full-page paths.
This retained reference implements KYC only: no Refund Operations, either policy editor,
or local role picker. See the [workspace comparison](../README.md) for historical selection context.

## Run

Use Node 22.x at least 22.13, or Node 24+. The locked lint dependency
`eslint-visitor-keys@5.0.1` requires `^20.19.0 || ^22.13.0 || >=24`;
Node 20.x needs at least 20.19. From the repository root:

```sh
npm ci
npm run seed                # destructive reset of fictional data, credentials and sessions
```

For an existing fictional database, use `npm run seed:logins` instead: it resets
demo passwords and browser sessions while preserving business data. Use the same
`KYC_DB_PATH` for the seed and API if overriding the default. Start long-running
processes in separate terminals:

```sh
npm run dev:server                  # loopback API on http://127.0.0.1:4000
npm run dev:local -w variants/web-c # local HTTP console on http://localhost:3000
```

For an independent second local console, in another terminal:

```sh
npm exec -w variants/web-c -- cross-env PORT=3001 npm run dev:local
```

Sign in with email and password. The API's local demo authentication must be explicitly enabled with
`LOCAL_DEMO_AUTH=true` (`dev:server` enables it with `cross-env` for local development).
The help shown by this reference form lists fresh-seed accounts with the public password
`demo-password-2026`:

- `grete.lindholm@northwind-demo.example` — analyst
- `marta.ellison@northwind-demo.example` — senior analyst
- `sofia.chen@northwind-demo.example` — compliance manager

For retained databases, use the addresses printed by the login seeder. It derives
them from the stored names, with deterministic ID suffixes for collisions. This
form's help is static; it does not resolve role choices through `/api/auth/demo-users`.

The `dev:local` script uses `cross-env` for Windows, macOS and Linux. It enables HTTP cookies
with `ALLOW_INSECURE_LOCAL_AUTH=true` and shows public demo credential help with
`LOCAL_DEMO_AUTH=true`. The latter flag on this SSR process controls help text;
the API needs its own local adapter enabled. The ordinary `dev` (also invoked by
root `npm run dev:web-c`) and `start` scripts keep secure defaults. Neither local
opt-in is permitted in production. All identities, permissions and case actions
are still authorized by the API. Production authentication needs an SSO/OIDC
integration; neither this reference nor the API implements one.

Cookies are not port scoped. Each process instead uses `kyc_session_<PORT>` (default
`kyc_session_3000`), so signing in or out on port 3001 does not change port 3000's session.
All tabs using the same instance share its cookie and therefore its current session.
Override `SESSION_COOKIE_NAME` with a unique name for each instance if needed (letters, digits,
underscores and hyphens; legacy cookie names are reserved). The cookie name is captured from
process configuration at startup, never from the request host. Ports share a host's cookies and
are intended for trusted local console instances, not mutually untrusted applications.

The console uses `Secure` cookies by default and requires HTTPS for sign-in and other form submissions.
For local HTTP development only, set `ALLOW_INSECURE_LOCAL_AUTH=true` as above. This setting is refused
when `NODE_ENV=production`; other values do not disable `Secure`. For TLS deployments, terminate HTTPS
in front of the console and preserve the browser-facing `Host` header. The app checks `Origin` against
that host and HTTPS (or the direct request protocol with the local opt-in); it does not trust
`X-Forwarded-Host` or `X-Forwarded-Proto`. POST requests without a matching `Origin` are rejected.
[`src/index.ts`](src/index.ts) defaults to `PORT=3000` and
`KYC_API_URL=http://127.0.0.1:4000`. `PORT` must be an integer from 1 to 65535.
Unlike the loopback-bound API development script, this Express listener does not
specify a host binding. The browser contacts this SSR server; API requests originate
from Node, with no Vite proxy. Use `KYC_API_URL` when changing the API port and use a
protected transport when the API is not on the same local machine.

## Checks and build

Run from the repository root:

```sh
npm run typecheck:web-c
npm run lint:web-c
npm run test:web-c
npm run build:web-c
```

Root `npm test`, `npm run lint` and `npm run typecheck` exclude the reference
workspaces. `build` runs TypeScript and emits `dist/`; the dev/start scripts
still run the TypeScript sources with `tsx`, rather than the compiled output.
Static files stay in `public/`. There is no workspace preview command.

## Approach

- [`src/app.tsx`](src/app.tsx) is the route surface: Express routes that fetch from the API ([`src/api/client.ts`](src/api/client.ts),
  base URL from `KYC_API_URL`) and render React components from `src/views/*` to static HTML.
- `GET /cases/:id` renders customer data, recorded signals, the risk explanation,
  permitted actions and audit history. Unknown routes and missing cases get a
  not-found response. `GET /health` returns `{ "ok": true }` without authenticating
  or checking the upstream API; `GET /sign-in` renders the password form.
- The same route serves a full page or just a fragment depending on the `HX-Request` header:
  - `GET /` renders the queue; with htmx it returns only `#queue-results` and sets `HX-Push-Url` to the
    canonical filter URL, so filter/search/sort/pagination state lives in the URL and is shareable.
    Status/risk filters, text search and creation/update/risk-score sorting are supported;
    not every displayed column is sortable. Status totals load on the full-page path.
  - `GET /cases/:id/actions/:action` returns the confirm `<dialog>` fragment (or the case page with the
    dialog inline when JS is off).
  - `POST /cases/:id/actions/:action` makes a preliminary note check (current policy is enforced by the API), forwards
    to the API with `Authorization: Bearer <token>`, and on success swaps `#case-main` plus out-of-band swaps that close the
    dialog and show a toast. Validation/403/409 messages from the API are re-rendered inside the dialog
    (`HX-Retarget`). Without JS the POST redirects back to the case with `?done=<action>`.
- `POST /sign-in` sends email/password server-to-server to `POST /api/auth/sign-in`. Only the returned
  session token is stored in the instance cookie (`HttpOnly`, `SameSite=Strict`, `Secure`, `Path=/`,
  maximum age from the API's absolute `expiresAt`). Session and analyst payloads are validated before use.
  Every protected page/action request rechecks `/api/me`, derives the displayed user from that response and forwards
  the token in API authorization headers. The analysts directory supplies display labels only.
  Passwords and tokens are never included in rendered HTML, links or hidden form fields (except the
  explicitly public demo password in local help). Legacy `analyst_id` and `kyc_access_token` cookies
  are cleared and cannot authenticate. Invalid, expired or revoked sessions clear the browser cookie
  and return HTTP 401 with sign-in UI; htmx receives `HX-Redirect: /sign-in` for a full-page navigation.
- `POST /sign-out` revokes only this session with `POST /api/auth/sign-out` and clears its browser
  cookie. Failed revocation still clears the cookie and displays an explicit warning, including on
  htmx redirects. To switch users, sign out and enter the other user's email/password.
  Action and sign-out forms include an expected-identity consistency guard; stale forms are rejected
  when their user no longer matches `/api/me`. Case actions also forward the verified actor as
  `x-analyst-id`; this is never used as authentication. No request retries under a fallback identity.
- Audit chain verification is computed in Node ([`src/lib/audit.ts`](src/lib/audit.ts),
  mirroring the [server implementation](../../packages/server/src/domain/audit.ts)).
- Security headers: a CSP of `default-src 'self'; script-src 'self'; style-src 'self'; ...` (no inline
  scripts or styles — the risk meters use `<meter>` instead of inline widths), `X-Content-Type-Options`,
  `Cache-Control: no-store`. All output is escaped by React; `dangerouslySetInnerHTML` is never used.
- Sensitive pages opt out of htmx history storage and discard existing htmx snapshots on page load.
  History cache misses and browser back/forward cache restores reload from the server so the active
  credential is revalidated.
- [`public/app.js`](public/app.js) is the custom browser script: it turns the swapped
  `<dialog>` into a modal (`showModal()` → Esc closes, focus lands in the textarea), makes queue rows
  clickable, auto-hides the toast, handles history revalidation and reports htmx network errors.
  Plain links/forms provide the no-JavaScript workflow paths.

## Actions and note validation

The case page displays the API's `allowedActions`: `start_review`, `approve`,
`reject` and `escalate`. It distinguishes a closed case from a role with no
permitted actions. Every action POST reloads the case and checks the note in
[the SSR validator](src/lib/validation.ts) before sending it to the API:

- Reject/escalate and high-risk approval require 10–1000 trimmed characters.
- Low/medium approval uses the API's `approvalNoteRequired` flag, requiring
  10–1000 characters when enabled and otherwise allowing an optional note.
- Start-review notes are optional. All notes are capped at 1000 trimmed
  characters, and empty optional notes are omitted from the upstream request.

The form mirrors those requirements with native `required`, `minLength` and
`maxLength` attributes. The API remains authoritative and can reject a request
if the policy, role or case state changes after the form loads. Web-c consumes
approval policy but has no policy editor; change it through the default SPA.

## Dependencies (runtime)

| Package     | Why                                                                                   |
| ----------- | ------------------------------------------------------------------------------------- |
| `express` 4 | HTTP server, static files, form body parsing (same manifest range as `packages/server`). |
| `react` 19.2.8 | JSX as a typed, auto-escaping HTML template language.                                  |
| `react-dom` 19.2.8 | `renderToStaticMarkup` — server rendering without hydration markers.                   |

htmx 2.0.10 is vendored as [`public/htmx.min.js`](public/htmx.min.js) (not an npm dependency, no CDN).

Development dependencies: `typescript`, `tsx` (also required by the current `start` script),
`cross-env` (portable local-auth environment flags), `vitest` + `supertest` (route tests with a fetch stub),
`eslint` + `@eslint/js` + `typescript-eslint` (same lint setup as the server), `@types/*`.

## Tests

`test/routes.test.ts` drives the Express app with supertest against a stubbed `fetch` (queue rendering,
htmx fragment + `HX-Push-Url`, unreachable API page, case page formatting and chain indicator, 404 page,
dialog fragment, action POST forwarding note + bearer credential, preliminary SSR and upstream API validation
errors rendered in the dialog, password sign-in/sign-out and API revocation, expired/revoked sessions,
malformed API responses, stale forms, independent instance cookies, security attributes, local HTTP
opt-in, production fail-closed configuration and cross-site request rejection).
Synthetic fixture tokens and a stubbed API exercise the contract; these are not live-API or browser tests.
`test/filters.test.ts` covers URL ↔ filter state,
`test/validation.test.ts` the note rules, `test/audit.test.ts` the hash-chain verifier against a fixture
captured from the seeded DB (`test/fixtures-audit.json`).

## Trade-offs of this approach

- Every interaction is a round trip: filter changes, dialogs and actions all re-render on the server.
  Latency is fine on a LAN but there is no optimistic UI or offline state.
- Debounced search re-renders the whole table fragment (25 rows) rather than patching cells — simple,
  but wasteful for very large pages.
- Interactivity is limited to what htmx attributes express; anything richer (live counters, drag/drop,
  client-side sorting) would need bespoke JS, eroding the "no client complexity" benefit.
- Protected page/action requests revalidate `/api/me` and fetch the analysts list;
  case loading then issues `case` + `risk-explanation` calls in parallel. There is
  no shared API cache, and unavailable risk explanations render an error panel.
- Out-of-band swaps (`hx-swap-oob`) and `HX-Retarget` are powerful but implicit; the coupling between
  route responses and element ids (`#case-main`, `#dialog-slot`, `#toast`) is a convention, not typed.
- No hydration means React state/effects are unavailable; components are pure functions of
  API data. The form uses native length constraints and has no live character counter.
- Progressive enhancement doubles some paths (fragment vs. full page, redirect vs. swap), which is the price
  of working without JavaScript.
