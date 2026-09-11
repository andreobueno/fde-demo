# KYC Review Console (web-b)

## How to run

From the repository root, start the API with `npm run dev:server`, then run `npm run dev:web-b`. The SPA is available at `http://localhost:5173`.

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
- Vitest — pure logic tests.
- ESLint, typescript-eslint, React Hooks, and React Refresh plugins — code quality checks.

## Trade-offs of this approach

- There are many small dependencies and Radix versions can change independently.
- Copied shadcn-style code is owned code that must be maintained.
- Tailwind can produce dense class strings in complex screens.
- TanStack Table is more machinery than one table requires, but scales to richer queues.
- Radix and query/table libraries increase bundle size over bespoke controls.
- Contributors need familiarity with several composable APIs.
