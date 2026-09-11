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
npm run seed && npm run dev:server    # API on http://localhost:4000

npm run dev:web-b        # web-b on http://localhost:5173
npm run dev:web-c        # web-c on http://localhost:3000
```

Each variant has its own scripts: `npm run {dev,build,lint,typecheck,test}:web-b` and
`...:web-c`. See each variant's `README.md` for details.
