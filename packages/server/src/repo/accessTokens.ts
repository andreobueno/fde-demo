import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import type { Analyst } from '../types.js';
import { getAnalyst } from './analysts.js';

export const DEFAULT_TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1000;

export interface AccessTokenMetadata {
  analystId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface IssuedAccessToken extends AccessTokenMetadata {
  token: string;
}

export interface IssueAccessTokenOptions {
  now?: Date;
  expiresInMs?: number;
}

function requireAnalyst(db: Db, analystId: string): Analyst {
  if (!analystId || analystId.trim() !== analystId) {
    throw new Error('A valid analyst ID is required.');
  }
  const analyst = getAnalyst(db, analystId);
  if (!analyst) throw new Error('Analyst not found.');
  return analyst;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueAccessToken(
  db: Db,
  analystId: string,
  options: IssueAccessTokenOptions = {},
): IssuedAccessToken {
  const now = options.now ?? new Date();
  const lifetime = options.expiresInMs ?? DEFAULT_TOKEN_LIFETIME_MS;
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0 ||
    !Number.isFinite(now.getTime()) || !Number.isFinite(new Date(now.getTime() + lifetime).getTime())) {
    throw new Error('A valid issuance time and positive token lifetime are required.');
  }
  return db.transaction(() => {
    requireAnalyst(db, analystId);
    const token = randomBytes(32).toString('base64url');
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + lifetime).toISOString();
    db.prepare(`INSERT INTO access_tokens (token_hash, analyst_id, issued_at, expires_at)
      VALUES (?, ?, ?, ?)`).run(hashToken(token), analystId, issuedAt, expiresAt);
    return { token, analystId, issuedAt, expiresAt };
  }).immediate();
}

export function revokeAccessTokens(db: Db, analystId: string): number {
  return db.transaction(() => {
    requireAnalyst(db, analystId);
    return db.prepare('DELETE FROM access_tokens WHERE analyst_id = ?').run(analystId).changes;
  }).immediate();
}

export function authenticateAccessToken(db: Db, token: string, now = new Date()): Analyst | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) ||
    Buffer.from(token, 'base64url').toString('base64url') !== token) return null;
  const row = db.prepare<[string, string, string], { analyst_id: string }>(`
    SELECT analyst_id FROM access_tokens
    WHERE token_hash = ? AND issued_at <= ? AND expires_at > ?
  `).get(hashToken(token), now.toISOString(), now.toISOString());
  return row ? getAnalyst(db, row.analyst_id) : null;
}
