# @kyc/server

Backend for the KYC Review Console prototype. Express + better-sqlite3, implements `docs/API_CONTRACT.md`.

## Setup

```bash
npm install          # at repo root (npm workspaces)
npm run seed         # drop + recreate + populate packages/server/data/kyc.db (deterministic)
npm run dev:server   # start API on http://localhost:4000 (PORT env to override)
```

## Test / checks

```bash
npm test             # vitest (domain + service + http)
npm run typecheck
npm run lint
```

## Notes

- DB path defaults to `packages/server/data/kyc.db`; override with `KYC_DB_PATH` (`:memory:` supported, used by tests).
- Send `x-analyst-id: ana-001` (senior) or `ana-003`..`ana-005` on mutations; reads default to `ana-001`.
- `audit_events` is append-only (SQLite triggers reject UPDATE/DELETE) and hash-chained per case.
