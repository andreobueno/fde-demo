# UI variants (reference implementations)

Three UI implementations of the original KYC Review Console were built in parallel and
evaluated against the same [backend](../packages/server/README.md) and
[KYC API contract](../docs/API_CONTRACT.md). Their current feature sets differ:

| UI | Stack | Current scope |
| --- | --- | --- |
| [Default (`packages/web`, formerly `web-a`)](../packages/web/README.md) | Vite 6, React 18, React Router 6, CSS Modules | KYC, Refund Operations, approval-note policy and risk-scoring policy; local role picker. |
| [web-b](web-b/README.md) | Vite 6, React 18, Tailwind CSS, owned shadcn-style Radix primitives, TanStack Query + Table | KYC queue and case detail only; email/password sign-in. |
| [web-c](web-c/README.md) | Express, React 19 `renderToStaticMarkup`, vendored htmx | KYC queue and case detail only; email/password sign-in, HTML forms and optional fragment swaps. |

Both reference UIs show KYC customer/risk information, API-permitted actions and
audit history. Neither implements Refunds, either policy editor, or the default
SPA's role picker. Their queues sort by creation time, update time or risk score,
rather than every displayed column. They still use the current API's permission
checks and policy enforcement. Web-c consumes `approvalNoteRequired`; web-b retains
older preliminary note rules that can allow a submission the API rejects. See
[web-b's limitation](web-b/README.md#actions-and-note-validation).

## Historical selection

Approach A was selected for the original KYC evaluation because it met that
evaluation's feature scope with the simplest stack and fewest direct runtime
dependencies. Web-b explored richer component/query/table abstractions; web-c
explored server-rendered forms with little browser code. This is historical
selection reasoning, not a claim of current feature parity or measured bundle
rankings. Rebuild to compare current output sizes. Web-c needs no browser bundler
or hydration, but it does have a TypeScript build command.

## Run a reference variant

From the repository root, use Node 22.x at least 22.13, or Node 24+. The locked
`eslint-visitor-keys@5.0.1` engine range is `^20.19.0 || ^22.13.0 || >=24`
(Node 20.x therefore needs at least 20.19). Install and seed once:

```sh
npm ci                  # installs every workspace, including the reference UIs
npm run seed            # destructive reset of fictional data, credentials and sessions
```

For an existing fictional database, `npm run seed:logins` resets demo passwords
and browser sessions while preserving business data. Keep seeding and the API on
the same `KYC_DB_PATH` if overriding the default. Start the API and each desired
UI in separate terminals:

```sh
npm run dev:server                    # loopback API on http://127.0.0.1:4000
npm run dev:web-b                     # default http://localhost:5173
npm run dev:local -w variants/web-c   # explicit local HTTP on http://localhost:3000
```

Web-b proxies `/api` to port 4000 in its Vite configuration. Its default startup
can select the next free port; when the main SPA already uses 5173, choose an
explicit free port and make conflicts fail:

```sh
npm run dev -w variants/web-b -- --port 5174 --strictPort
```

Web-c calls the API server-to-server (`KYC_API_URL`, default
`http://127.0.0.1:4000`) and defaults to port 3000 (`PORT`). The root
`npm run dev:web-c` command uses secure cookie defaults; it does **not** opt into
HTTP sign-in. `dev:local` sets `ALLOW_INSECURE_LOCAL_AUTH=true LOCAL_DEMO_AUTH=true`
using `cross-env`. The API's development command also uses `cross-env` to set
loopback binding and local demo auth on Windows, macOS and Linux.

Both variants retain password forms using [fictional demo accounts](../README.md#setup-and-run).
They save server session tokens and verify identity again on refresh. Signing out
revokes only the current session. Web-b uses origin/tab-scoped `sessionStorage`.
Web-c uses HttpOnly cookies named from the configured port; cookies themselves
are not port-scoped, and all tabs of one instance share that session.
See each variant's README for multi-user setup and retained-database credentials.

Production rejects the API's local authentication adapter. Web-b hides its demo
credential help in a production build but retains the password form; web-c
rejects either local opt-in in production and keeps Secure cookies. Neither
reference UI supplies a production SSO/OIDC integration.

## Checks

The root `npm test`, `npm run lint` and `npm run typecheck` cover the server and
default SPA only. Check reference workspaces explicitly:

```sh
npm run test:web-b
npm run lint:web-b
npm run typecheck:web-b
npm run build:web-b
npm run test:web-c
npm run lint:web-c
npm run typecheck:web-c
npm run build:web-c
```

These suites use fixtures/mocked API responses; they do not replace live-API or
browser testing. See the individual READMEs for coverage and build output.
