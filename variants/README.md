# UI variants (reference implementations)

Three UI implementations of the KYC Review Console were built in parallel and evaluated
against the same backend (`packages/server`, contract in `docs/API_CONTRACT.md`):

- **`packages/web`** (selected, was `web-a`) — Vite + React 18 + react-router-dom, plain
  CSS. Chosen as the default UI: it covers the same features with the simplest stack and
  the fewest dependencies (3 runtime deps, ~62 kB gzipped JS).
- **`variants/web-b`** — component-library SPA: Tailwind CSS, shadcn-style primitives on
  Radix, TanStack Query + TanStack Table. Richest component model; heaviest bundle.
- **`variants/web-c`** — server-rendered: Express SSR + React 19 `renderToString` + htmx,
  no client router or build step for the app code. Fewest client-side moving parts.

## Run a variant

```sh
npm install              # at repo root — installs all workspaces incl. variants/*
npm run seed && npm run dev:server    # API on http://127.0.0.1:4000

npm run dev:web-b        # web-b on http://localhost:5173
npm run dev:local -w variants/web-c    # web-c, explicit local HTTP on port 3000
```

Both variants now use the [local demo email/password accounts](../README.md#setup--run),
server sessions and API-enforced roles. Refresh verifies the saved session; signing out revokes
only that session. Web-b uses origin/tab-scoped sessionStorage. Web-c uses HttpOnly cookies
whose names are derived from the configured port, because cookies themselves are not port scoped.
Use distinct ports to evaluate different users simultaneously; see each variant's README.

Each variant has its own scripts: `npm run {dev,build,lint,typecheck,test}:web-b` and
`...:web-c`. See each variant's `README.md` for details.
