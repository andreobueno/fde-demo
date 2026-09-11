# @kyc/web — KYC Review Console — default UI

Vite + React 18 + react-router-dom v6 + CSS Modules. No UI kit, no data-fetching library.

## How to run

From the repo root:

```sh
npm install
npm run seed          # idempotent; recreates the demo DB in packages/server
npm run dev:server    # API on http://localhost:4000
npm run dev:web     # this app on http://localhost:5173
```

Vite proxies `/api/*` to `http://localhost:4000` (see `vite.config.ts`), so the SPA
makes same-origin requests and no CORS setup is needed. Analyst identity is sent via
the `x-analyst-id` header, selected in the header dropdown (persisted in localStorage).

Other scripts: `npm run build:web`, `npm run lint:web`, `npm run typecheck:web`,
`npm run test:web` (also `preview` inside this workspace).

## Approach

Approach A — Minimal SPA: two routes (`/` queue, `/cases/:id` detail) rendered by
react-router-dom, server state fetched through a small hand-rolled `useApi` hook, and
plain CSS Modules for styling. Filter/sort/page state lives in the URL query string.

## Dependencies

Runtime:

- `react`, `react-dom` — UI framework.
- `react-router-dom` — routing + `useSearchParams` for URL-driven filter state.

Dev:

- `vite` — dev server (incl. `/api` proxy) and bundler.
- `@vitejs/plugin-react` — JSX transform + fast refresh.
- `typescript` — static typing (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- `vitest` — unit tests for the pure libs (node environment; WebCrypto is on `globalThis.crypto` in Node 20).
- `@types/react`, `@types/react-dom` — React typings.
- `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals` — linting, mirroring the server config plus react-hooks rules and browser globals.

## Tests

`npm run test:web` runs vitest suites under `src/lib/` covering action-note
validation, queue-filter URL parsing/serialization, and the client-side audit-chain
verifier (checked against a real seeded fixture).

## Trade-offs of this approach

- Hand-rolled fetching means no caching, request deduplication, retries, or
  optimistic updates — each navigation refetches, and mutations just reload.
- No UI library: consistent look is maintained by hand via CSS variables; no
  accessibility-tested widgets beyond native elements.
- Native `<dialog>` needs a fairly recent browser (no Safari <15.4 / old Chrome).
- URL filter state is parsed/serialized manually — fine for one page, would get
  tedious with more routes sharing state.
- Two `useApi` calls on the detail page are independent (no coordinated loading).
- More features (bulk actions, saved views, websockets) would add boilerplate
  quickly; a query library would pay off past this scope.
