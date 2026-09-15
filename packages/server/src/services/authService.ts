import { ApiError } from '../errors.js';
import type { Db } from '../db.js';
import { permissionsFor, type Permission } from '../domain/authorization.js';
import { spendVerificationWork, verifyPassword } from '../domain/password.js';
import { getAnalyst } from '../repo/analysts.js';
import { recordAuthEvent } from '../repo/authEvents.js';
import { findCredentialByEmail, normaliseEmail } from '../repo/credentials.js';
import { createSession, revokeSession, type IssuedSession } from '../repo/sessions.js';
import type { Analyst } from '../types.js';

export const MAX_FAILED_ATTEMPTS = 8;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export interface SignInResult {
  analyst: Analyst & { permissions: Permission[] };
  session: IssuedSession;
}

/** Counts recent failures per email so guessing a seeded account is not free. */
export class SignInThrottle {
  private failures = new Map<string, number[]>();

  private recent(key: string, now: Date): number[] {
    const attempts = (this.failures.get(key) ?? []).filter(
      (at) => now.getTime() - at < ATTEMPT_WINDOW_MS,
    );
    if (attempts.length === 0) this.failures.delete(key);
    else this.failures.set(key, attempts);
    return attempts;
  }

  isBlocked(email: string, now: Date): boolean {
    return this.recent(normaliseEmail(email), now).length >= MAX_FAILED_ATTEMPTS;
  }

  recordFailure(email: string, now: Date): void {
    const key = normaliseEmail(email);
    this.failures.set(key, [...this.recent(key, now), now.getTime()]);
  }

  clear(email: string): void {
    this.failures.delete(normaliseEmail(email));
  }
}

const invalidCredentials = () =>
  new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

export function signIn(
  db: Db,
  throttle: SignInThrottle,
  input: { email: string; password: string },
  now = new Date(),
): SignInResult {
  const email = normaliseEmail(input.email);
  if (throttle.isBlocked(email, now)) {
    recordAuthEvent(db, 'sign_in_throttled', { email, now });
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again later.');
  }

  const credential = findCredentialByEmail(db, email);
  if (!credential) {
    spendVerificationWork(input.password);
    throttle.recordFailure(email, now);
    recordAuthEvent(db, 'sign_in_failed', { email, reason: 'unknown_email', now });
    throw invalidCredentials();
  }

  if (!verifyPassword(input.password, credential.passwordHash)) {
    throttle.recordFailure(email, now);
    recordAuthEvent(db, 'sign_in_failed', {
      email,
      analystId: credential.analystId,
      reason: 'incorrect_password',
      now,
    });
    throw invalidCredentials();
  }

  const analyst = getAnalyst(db, credential.analystId);
  if (!analyst) {
    recordAuthEvent(db, 'sign_in_failed', { email, reason: 'missing_analyst', now });
    throw invalidCredentials();
  }

  const session = createSession(db, analyst.id, { now });
  throttle.clear(email);
  recordAuthEvent(db, 'sign_in_succeeded', { email, analystId: analyst.id, now });
  return { analyst: { ...analyst, permissions: permissionsFor(analyst.role) }, session };
}

export function signOut(db: Db, token: string, analystId: string | null, now = new Date()): void {
  const revoked = revokeSession(db, token);
  if (revoked) recordAuthEvent(db, 'sign_out', { analystId, now });
}
