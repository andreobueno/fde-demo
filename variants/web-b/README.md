# KYC Review Console (web-b)

## How to run

From the repository root, provision an existing fictional database's logins with `npm run seed:logins`. This resets demo passwords and browser sessions while preserving business data; a fresh `npm run seed` already includes logins. Start the API with `npm run dev:server`, then run `npm run dev:web-b`. The SPA is available at `http://localhost:5173`.

For simultaneous users, run another instance with `npm run dev -w variants/web-b -- --port 5174 --strictPort`. Sign in separately on each port; both frontends can use the API on port 4000. Independently opened tabs also have separate sessionStorage. Browser “duplicate tab” or opener-created tabs can initially copy sessionStorage: open a fresh tab independently for a different user, rather than duplicating an authenticated tab.

## Authenticated access

Sign in with email and password. For isolated local development, `npm run dev:server` explicitly enables `LOCAL_DEMO_AUTH=true`; production rejects this authentication mode. The sign-in page shows these publicly documented, fictional demo accounts in development builds:

| Role | Email |
| --- | --- |
| Analyst | `grete.lindholm@northwind-demo.example` |
| Senior analyst | `marta.ellison@northwind-demo.example` |
| Compliance manager | `sofia.chen@northwind-demo.example` |

All use the local-only password `demo-password-2026`. Other seeded analysts' emails follow `lowercase.full.name@northwind-demo.example`. These are not real credentials. Use the same database for seeding and the API (`KYC_DB_PATH` if configured). Local authentication still runs through the API; the frontend never chooses an actor or grants permissions.

The form posts `{email,password}` as JSON to `POST /api/auth/sign-in`. A successful response provides the verified analyst, permissions, and an opaque session token. Incorrect credentials receive a generic error; validation and throttling have separate guidance. The password field is cleared on submission. No password or analyst identity is saved by the app.

Only the session token is stored in this tab's sessionStorage, isolated by origin (including port) and tab. Refresh uses that token in `GET /api/me` before rendering protected content or starting queue, case, or directory queries; stored identity data is never trusted. Subsequent API calls use `Authorization: Bearer <token>` and the verified user's ID in `x-analyst-id` as a consistency guard. The directory only supplies display names. A 403 remains a permission error without an actor fallback. Server-side policy remains authoritative.

SessionStorage is accessible to page JavaScript, including injected scripts; this is a local prototype trade-off, not an HttpOnly session. Tokens are not saved in localStorage, URLs, query caches, or rendered HTML. Closing a tab normally ends its browser storage, but does not itself revoke the server session. The server enforces absolute and idle expiry; a 401 clears local state and requires sign-in again. If browser storage is unavailable, the app reports that refreshing requires a new sign-in.

**Sign out** immediately clears local identity, storage, query/mutation caches and feedback, aborts protected requests, unmounts protected pages/dialogs, and posts to `/api/auth/sign-out` to revoke only this session. A failed revocation is visibly reported: the server session may still exist until expiry. Other users' sessions are unaffected. Switching users and cancelled sign-ins use the same isolation protections. Late login, restoration, query, and logout responses cannot replace or erase a newer identity. If a cancelled sign-in still returns a token, the app makes a best-effort independent request to revoke it.

## Validation

From the repository root:

```sh
npm run test:web-b
npm run lint:web-b
npm run typecheck:web-b
npm run build:web-b
```

Vitest uses mocked fetch, isolated storage, real TanStack Query caches, and React server rendering to cover password sign-in, verified restoration, revocation, cancellation, session isolation, role resolution, and the sign-in boundary. These tests do not exercise a live authentication server or interactive browser dialogs.

## Approach

Approach B — a component-library SPA. The app uses a small set of owned, shadcn/ui-style primitives with Radix accessibility foundations, TanStack Query for server state, and TanStack Table for the review queue.

## Dependencies

### Runtime

- React and React DOM — UI runtime.
- React Router DOM — client-side routes.
- TanStack Query — API cache and mutations.
- TanStack Table — manual sorting and responsive queue table.
- Radix Dialog, Select, Tooltip, and Slot — accessible primitives.
- class-variance-authority, clsx, tailwind-merge — class composition.
- lucide-react — consistent interface icons.
- sonner — action feedback toasts.

### Development

- Vite and the React plugin — fast dev server and production bundling.
- TypeScript — strict static typing.
- Tailwind CSS, PostCSS, and Autoprefixer — utility styling.
- Vitest — logic, mocked API/session, and server-rendering tests.
- ESLint, typescript-eslint, React Hooks, and React Refresh plugins — code quality checks.
- Prettier — consistent source formatting.

## Trade-offs of this approach

- There are many small dependencies and Radix versions can change independently.
- Copied shadcn-style code is owned code that must be maintained.
- Tailwind can produce dense class strings in complex screens.
- TanStack Table is more machinery than one table requires, but scales to richer queues.
- Radix and query/table libraries increase bundle size over bespoke controls.
- Contributors need familiarity with several composable APIs.
