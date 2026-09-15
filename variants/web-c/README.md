# @kyc/web-c — server-rendered KYC Review Console (Approach C)

Express + React (`renderToStaticMarkup`) as the template engine + vendored htmx for interactivity.
There is no client-side React, no bundler and no hydration: every screen is HTML produced on the
server from the backend's JSON API. htmx swaps HTML fragments for the queue table, the action
dialog and the post-action refresh; every interaction also works as a plain form + full page load.

## Run

```bash
npm install                 # repo root
npm run seed                # populate packages/server/data/kyc.db
npm run seed:logins         # non-destructively provision fictional local users
npm run dev:server          # API on http://localhost:4000
npm run dev:local -w variants/web-c  # explicit local HTTP opt-in on http://localhost:3000
PORT=3001 npm run dev:local -w variants/web-c  # independent second console
```

Sign in with email and password. The API's local demo authentication must be explicitly enabled with
`LOCAL_DEMO_AUTH=true` (`dev:server` enables it for local development). Fictional local users share the
public password `demo-password-2026`:

- `grete.lindholm@northwind-demo.example` — analyst
- `marta.ellison@northwind-demo.example` — senior analyst
- `sofia.chen@northwind-demo.example` — compliance manager

The `dev:local` script enables HTTP cookies and shows public demo credential help. The ordinary
`dev` and `start` scripts keep secure defaults. Neither local opt-in is permitted in production.
All identities, permissions and case actions are still authorized by the API.

Cookies are not port scoped. Each process instead uses `kyc_session_<PORT>` (default
`kyc_session_3000`), so signing in or out on port 3001 does not change port 3000's session.
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
Use `PORT` and `KYC_API_URL` to override the listener port and API URL; use a protected transport to the
API when it is not on the same local machine.

Checks: `npm run typecheck:web-c`, `npm run lint:web-c`, `npm run test:web-c`, `npm run build:web-c`
(`build` type-checks and emits `dist/`; the dev/start scripts run the TypeScript sources with `tsx`).

## Approach

- `src/app.tsx` is the whole UI surface: Express routes that fetch from the API (`src/api/client.ts`,
  base URL from `KYC_API_URL`) and render React components from `src/views/*` to static HTML.
- The same route serves a full page or just a fragment depending on the `HX-Request` header:
  - `GET /` renders the queue; with htmx it returns only `#queue-results` and sets `HX-Push-Url` to the
    canonical filter URL, so filter/search/sort/pagination state lives in the URL and is shareable.
  - `GET /cases/:id/actions/:action` returns the confirm `<dialog>` fragment (or the case page with the
    dialog inline when JS is off).
  - `POST /cases/:id/actions/:action` makes a preliminary note check (current policy is enforced by the API), forwards
    to the API with `Authorization: Bearer <token>`, and on success swaps `#case-main` plus out-of-band swaps that close the
    dialog and show a toast. Validation/403/409 messages from the API are re-rendered inside the dialog
    (`HX-Retarget`). Without JS the POST redirects back to the case with `?done=<action>`.
- `POST /sign-in` sends email/password server-to-server to `POST /api/auth/sign-in`. Only the returned
  session token is stored in the instance cookie (`HttpOnly`, `SameSite=Strict`, `Secure`, `Path=/`,
  maximum age from the API's absolute `expiresAt`). Session and analyst payloads are validated before use.
  Every protected request rechecks `/api/me`, derives the displayed user from that response and forwards
  the token in API authorization headers. The analysts directory supplies labels and filters only.
  Passwords and tokens are never included in rendered HTML, links or hidden form fields (except the
  explicitly public demo password in local help). Legacy `analyst_id` and `kyc_access_token` cookies
  are cleared and cannot authenticate. Invalid, expired or revoked sessions clear the browser cookie
  and return HTTP 401 with sign-in UI; htmx receives `HX-Redirect: /sign-in` for a full-page navigation.
- `POST /sign-out` revokes only this session with `POST /api/auth/sign-out` and clears its browser
  cookie. Failed revocation still clears the cookie and displays an explicit warning, including on
  htmx redirects. To switch users, sign out and enter the other user's email/password.
  Action and sign-out forms include an expected-identity consistency guard; stale forms are rejected
  when their user no longer matches `/api/me`. Mutations also forward the verified actor as
  `x-analyst-id`; this is never used as authentication. No request retries under a fallback identity.
- Audit chain verification is computed in Node (`src/lib/audit.ts`, mirrors `packages/server/src/domain/audit.ts`).
- Security headers: a CSP of `default-src 'self'; script-src 'self'; style-src 'self'; ...` (no inline
  scripts or styles — the risk meters use `<meter>` instead of inline widths), `X-Content-Type-Options`,
  `Cache-Control: no-store`. All output is escaped by React; `dangerouslySetInnerHTML` is never used.
- Sensitive pages opt out of htmx history storage and discard existing htmx snapshots on page load.
  History cache misses and browser back/forward cache restores reload from the server so the active
  credential is revalidated.
- `public/app.js` (~60 lines of vanilla JS) is the only custom client code: it turns the swapped
  `<dialog>` into a modal (`showModal()` → Esc closes, focus lands in the textarea), makes queue rows
  clickable, auto-hides the toast and reports htmx network errors. The app is fully usable without it.

## Dependencies (runtime)

| Package     | Why                                                                                   |
| ----------- | ------------------------------------------------------------------------------------- |
| `express`   | HTTP server, static files, form body parsing (same version as `packages/server`).      |
| `react`     | JSX as a typed, auto-escaping HTML template language.                                  |
| `react-dom` | `renderToStaticMarkup` — server rendering without hydration markers.                   |

htmx 2.0.10 is vendored as `public/htmx.min.js` (not an npm dependency, no CDN).

Dev-only: `typescript`, `tsx` (run TS directly), `vitest` + `supertest` (route tests with a fetch stub),
`eslint` + `@eslint/js` + `typescript-eslint` (same lint setup as the server), `@types/*`.

## Tests

`test/routes.test.ts` drives the Express app with supertest against a stubbed `fetch` (queue rendering,
htmx fragment + `HX-Push-Url`, unreachable API page, case page formatting and chain indicator, 404 page,
dialog fragment, action POST forwarding note + bearer credential, client-side and server-side validation
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
- The full page is rendered from scratch on each request, so the analysts list is fetched per request
  and the case page issues two API calls (`case` + `risk-explanation`) in parallel.
- Out-of-band swaps (`hx-swap-oob`) and `HX-Retarget` are powerful but implicit; the coupling between
  route responses and element ids (`#case-main`, `#dialog-slot`, `#toast`) is a convention, not typed.
- No hydration means React features like state/effects are unavailable; components are pure functions of
  API data, which keeps them trivially testable but means no client-side form state (e.g. live character
  counts rely on native `maxlength`/`minlength`).
- Progressive enhancement doubles some paths (fragment vs. full page, redirect vs. swap), which is the price
  of working without JavaScript.
