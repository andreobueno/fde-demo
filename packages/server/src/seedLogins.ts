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

export function demoEmail(name: string): string {
  const local = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z ]/g, '')
    .trim()
    .replace(/ +/g, '.');
  return `${local}@${DEMO_EMAIL_DOMAIN}`;
}

export function seedDemoLogins(
  db: Db,
  options: { password?: string; now?: Date } = {},
): SeededLogin[] {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo logins cannot be seeded in production.');
  }
  const password = options.password ?? DEMO_PASSWORD;
  return db.transaction(() =>
    listAnalysts(db).map(({ id, name, role }) => {
      const email = demoEmail(name);
      setAnalystPassword(db, id, email, password, options.now ? { now: options.now } : {});
      revokeSessionsFor(db, id);
      return { analystId: id, name, role, email };
    }),
  ).immediate();
}
