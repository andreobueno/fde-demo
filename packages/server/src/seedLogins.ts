import type { Db } from './db.js';
import { listAnalysts } from './repo/analysts.js';
import { setAnalystPassword } from './repo/credentials.js';
import { revokeSessionsFor } from './repo/sessions.js';
import type { AnalystRole } from './types.js';

/**
 * Shared password for the fictional seeded identities. It exists so the local demo has a
 * normal sign-in screen; production deployments authenticate through the identity provider
 * instead and never seed credentials.
 */
export const DEMO_PASSWORD = 'demo-password-2026';
export const DEMO_EMAIL_DOMAIN = 'northwind-demo.example';

export interface SeededLogin {
  analystId: string;
  name: string;
  role: AnalystRole;
  email: string;
}

function demoEmailLocalPart(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z ]/g, '')
    .trim()
    .replace(/ +/g, '.') || 'analyst';
}

export function demoEmail(name: string): string {
  return `${demoEmailLocalPart(name)}@${DEMO_EMAIL_DOMAIN}`;
}

export function seedDemoLogins(
  db: Db,
  options: { password?: string; now?: Date } = {},
): SeededLogin[] {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo logins cannot be seeded in production.');
  }
  const password = options.password ?? DEMO_PASSWORD;
  const analysts = listAnalysts(db);
  const localPartCounts = new Map<string, number>();
  for (const { name } of analysts) {
    const local = demoEmailLocalPart(name);
    localPartCounts.set(local, (localPartCounts.get(local) ?? 0) + 1);
  }
  const logins = analysts.map(({ id, name, role }) => {
    const local = demoEmailLocalPart(name);
    const uniqueLocal = localPartCounts.get(local) === 1
      ? local
      : `${local}.${Buffer.from(id).toString('hex')}`;
    return {
      analystId: id,
      name,
      role,
      email: `${uniqueLocal}@${DEMO_EMAIL_DOMAIN}`,
    };
  });
  if (new Set(logins.map(({ email }) => email)).size !== logins.length) {
    throw new Error('Could not generate unique demo email addresses.');
  }
  return db.transaction(() => {
    db.prepare('DELETE FROM analyst_credentials').run();
    return logins.map((login) => {
      setAnalystPassword(
        db,
        login.analystId,
        login.email,
        password,
        options.now ? { now: options.now } : {},
      );
      revokeSessionsFor(db, login.analystId);
      return login;
    });
  }).immediate();
}
