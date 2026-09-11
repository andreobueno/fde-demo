# @kyc/web-c — server-rendered KYC Review Console (Approach C)

Express + React (`renderToStaticMarkup`) as the template engine + vendored htmx for interactivity.
There is no client-side React, no bundler and no hydration: every screen is HTML produced on the
server from the backend's JSON API. htmx swaps HTML fragments for the queue table, the action
dialog and the post-action refresh; every interaction also works as a plain form + full page load.

## Run

```bash
npm install                 # repo root
npm run seed                # populate packages/server/data/kyc.db
npm run dev:server          # API on http://localhost:4000
npm run dev:web-c           # web console on http://localhost:3000 (PORT / KYC_API_URL env to override)
```

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
    to the API with `x-analyst-id`, and on success swaps `#case-main` plus out-of-band swaps that close the
    dialog and show a toast. Validation/403/409 messages from the API are re-rendered inside the dialog
    (`HX-Retarget`). Without JS the POST redirects back to the case with `?done=<action>`.
- Analyst identity is an `analyst_id` cookie (HttpOnly, SameSite=Lax) set by `POST /switch-analyst`; the
  header select submits on change via htmx (`HX-Refresh`) or via the visible "Switch" button without JS.
  Every API call forwards this identity, including reads and identity-list bootstrap. New visitors
  use `ana-003` (analyst). An invalid persisted ID can recover through a GET or the identity switcher;
  case mutations with an invalid ID fail without retrying as another user. This remains demo impersonation.
- Audit chain verification is computed in Node (`src/lib/audit.ts`, mirrors `packages/server/src/domain/audit.ts`).
- Security headers: a CSP of `default-src 'self'; script-src 'self'; style-src 'self'; ...` (no inline
  scripts or styles — the risk meters use `<meter>` instead of inline widths), `X-Content-Type-Options`,
  `Cache-Control: no-store`. All output is escaped by React; `dangerouslySetInnerHTML` is never used.
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
dialog fragment, action POST forwarding note + `x-analyst-id`, client-side and server-side validation
errors rendered in the dialog, analyst cookie). `test/filters.test.ts` covers URL ↔ filter state,
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
