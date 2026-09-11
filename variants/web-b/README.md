# KYC Review Console (web-b)

## How to run

From the repository root, start the API with `npm run dev:server`, then run `npm run dev:web-b`. The SPA is available at `http://localhost:5173`.

## Authenticated access

Sign in with an access token provisioned by an administrator through the main API's token-management tooling. There is no default or demo credential. Tokens contain 43 base64url characters (32 random bytes), expire after eight hours, and can be revoked.

The password-type sign-in field submits the token only in an `Authorization: Bearer <token>` header to `GET /api/me`. The returned identity, role, and permissions establish the session; no queue, case, or identity-directory queries run before verification. Subsequent API calls include the bearer token and the verified user's ID in `x-analyst-id` as an expected-identity guard. A mismatched guard receives a 403 and cannot select another actor. The analyst directory is used only for display names.

Credentials remain in memory and are never written to localStorage, sessionStorage, URLs, or rendered HTML attributes. The password field is cleared on submission. Reloading requires sign-in again. To switch users, choose **Sign out**, then enter the other user's token. Signing out, switching users, or receiving a 401 clears identity, cached queries, mutation state, and feedback, aborts pending requests, and unmounts protected pages and dialogs. Late responses cannot restore a previous session. A 403 remains a permission error; it never causes an actor fallback.

## Validation

From the repository root:

```sh
npm run test:web-b
npm run lint:web-b
npm run typecheck:web-b
npm run build:web-b
```

Vitest uses mocked fetch, real TanStack Query caches, and React server rendering to cover authentication dispatch, cancellation, session isolation, role resolution, and the sign-in boundary. These tests do not exercise a live authentication server or interactive browser dialogs.

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
