import { openDb } from './db.js';
import { createApp } from './http/app.js';

const port = Number(process.env.PORT ?? 4000);
const db = openDb();

// Demo impersonation only. This trusts the `x-analyst-id` header as identity and
// must never be enabled in production; production requires validated SSO/OIDC.
// See docs/SECURITY_REVIEW.md. Opt in explicitly, e.g. KYC_TRUST_ANALYST_HEADER=1.
const trustAnalystHeader = process.env.KYC_TRUST_ANALYST_HEADER === '1';
if (trustAnalystHeader) {
  console.warn(
    'WARNING: KYC_TRUST_ANALYST_HEADER is enabled. The x-analyst-id header is ' +
      'trusted as identity (demo impersonation). Do not use this in production.',
  );
}
const app = createApp(db, { trustAnalystHeader });

app.listen(port, () => {
  console.log(`KYC server listening on http://localhost:${port}`);
});
