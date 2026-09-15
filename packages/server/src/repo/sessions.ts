import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import type { Analyst } from '../types.js';
import { getAnalyst } from './analysts.js';

/** Sessions end this long after sign-in regardless of activity. */
export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
/** Sessions end this long after the last authenticated request. */
export const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

export interface SessionMetadata {
  analystId: string;
  createdAt: string;
  expiresAt: string;
  idleTimeoutMs: number;
}

export interface IssuedSession extends SessionMetadata {
  token: string;
}

interface SessionRow {
  analyst_id: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(
  db: Db,
  analystId: string,
  options: { now?: Date; lifetimeMs?: number } = {},
): IssuedSession {
  const now = options.now ?? new Date();
  const lifetime = options.lifetimeMs ?? SESSION_LIFETIME_MS;
  return db.transaction(() => {
    if (!getAnalyst(db, analystId)) throw new Error('Unknown analyst.');
    const token = randomBytes(32).toString('base64url');
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + lifetime).toISOString();
    db.prepare(`
      INSERT INTO sessions (token_hash, analyst_id, created_at, last_used_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(hashToken(token), analystId, createdAt, createdAt, expiresAt);
    return { token, analystId, createdAt, expiresAt, idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS };
  }).immediate();
}

/**
 * Resolves the current actor from a session token, sliding the idle window forward.
 * Expired and idle-timed-out sessions are removed rather than returned.
 */
export function authenticateSession(db: Db, token: string, now = new Date()): Analyst | null {
  const tokenHash = hashToken(token);
  return db.transaction(() => {
    const row = db
      .prepare<[string], SessionRow>('SELECT * FROM sessions WHERE token_hash = ?')
      .get(tokenHash);
    if (!row) return null;
    const timestamp = now.getTime();
    const idleDeadline = Date.parse(row.last_used_at) + SESSION_IDLE_TIMEOUT_MS;
    if (timestamp >= Date.parse(row.expires_at) || timestamp >= idleDeadline) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?')
      .run(now.toISOString(), tokenHash);
    return getAnalyst(db, row.analyst_id);
  }).immediate();
}

export function revokeSession(db: Db, token: string): boolean {
  return db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token)).changes > 0;
}

export function revokeSessionsFor(db: Db, analystId: string): number {
  return db.prepare('DELETE FROM sessions WHERE analyst_id = ?').run(analystId).changes;
}
