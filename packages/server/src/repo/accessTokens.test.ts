import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db.js';
import { addRefund, refundFixtureContext, REFUND_ACTORS } from '../refundFixtures.js';
import {
  authenticateAccessToken, DEFAULT_TOKEN_LIFETIME_MS, issueAccessToken, revokeAccessTokens,
} from './accessTokens.js';

let db: Db;
let directory: string | undefined;
const actor = REFUND_ACTORS.analyst;
const NOW = new Date('2026-09-11T12:00:00.000Z');

beforeEach(() => {
  db = openDb(':memory:');
  refundFixtureContext(db);
});
afterEach(() => {
  if (db.open) db.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('persisted access tokens', () => {
  it('issues independent 256-bit credentials once and stores only their SHA-256 hashes', () => {
    const first = issueAccessToken(db, actor.id, { now: NOW });
    const second = issueAccessToken(db, actor.id, { now: NOW });
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
    expect(second.token).not.toBe(first.token);
    expect(first).toEqual({
      token: first.token, analystId: actor.id, issuedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + DEFAULT_TOKEN_LIFETIME_MS).toISOString(),
    });
    expect(db.prepare('SELECT * FROM access_tokens ORDER BY token_hash').all()).toEqual(
      [first, second].map((issued) => ({
        token_hash: createHash('sha256').update(issued.token).digest('hex'),
        analyst_id: actor.id, issued_at: issued.issuedAt, expires_at: issued.expiresAt,
      })).sort((a, b) => a.token_hash.localeCompare(b.token_hash)),
    );
    for (const { token } of [first, second]) {
      expect(db.serialize().includes(Buffer.from(token))).toBe(false);
      expect(authenticateAccessToken(db, token, NOW)).toEqual(actor);
    }
  });

  it('validates lifetimes, issuance dates and analysts without inserting anything on failure', () => {
    for (const id of ['', ' ', ` ${actor.id}`, 'missing']) {
      expect(() => issueAccessToken(db, id)).toThrow();
      expect(() => revokeAccessTokens(db, id)).toThrow();
    }
    for (const expiresInMs of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
      expect(() => issueAccessToken(db, actor.id, { expiresInMs })).toThrow();
    }
    expect(() => issueAccessToken(db, actor.id, { now: new Date(NaN) })).toThrow();
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
  });

  it('uses expiry strictly and rejects credentials before issuance', () => {
    const issued = issueAccessToken(db, actor.id, { now: NOW, expiresInMs: 1000 });
    expect(authenticateAccessToken(db, issued.token, new Date(NOW.getTime() - 1))).toBeNull();
    expect(authenticateAccessToken(db, issued.token, NOW)).toEqual(actor);
    expect(authenticateAccessToken(db, issued.token, new Date(NOW.getTime() + 999))).toEqual(actor);
    expect(authenticateAccessToken(db, issued.token, new Date(issued.expiresAt))).toBeNull();
  });

  it('revokes all of one actor’s tokens without affecting other actors or audits', () => {
    addRefund(db);
    const audit = db.prepare('SELECT * FROM audit_events').all();
    const first = issueAccessToken(db, actor.id);
    const second = issueAccessToken(db, actor.id);
    const manager = issueAccessToken(db, REFUND_ACTORS.compliance_manager.id);
    expect(revokeAccessTokens(db, actor.id)).toBe(2);
    expect(revokeAccessTokens(db, actor.id)).toBe(0);
    expect(authenticateAccessToken(db, first.token)).toBeNull();
    expect(authenticateAccessToken(db, second.token)).toBeNull();
    expect(authenticateAccessToken(db, manager.token)?.id).toBe(REFUND_ACTORS.compliance_manager.id);
    expect(db.prepare('SELECT * FROM audit_events').all()).toEqual(audit);
  });

  it('adds an empty credential table on existing databases and preserves audits across restarts', () => {
    directory = mkdtempSync(path.join(homedir(), '.kyc-token-migration-'));
    const filename = path.join(directory, 'legacy.db');
    db.close();
    db = openDb(filename);
    refundFixtureContext(db);
    addRefund(db);
    db.exec('DROP TABLE access_tokens');
    const audit = db.prepare('SELECT * FROM audit_events').all();
    const analysts = db.prepare('SELECT * FROM analysts').all();
    db.close();
    db = openDb(filename);
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM audit_events').all()).toEqual(audit);
    expect(db.prepare('SELECT * FROM analysts').all()).toEqual(analysts);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const issued = issueAccessToken(db, actor.id);
    db.close();
    db = openDb(filename);
    expect(authenticateAccessToken(db, issued.token)).toEqual(actor);
    expect(db.prepare('SELECT * FROM audit_events').all()).toEqual(audit);
    expect(() => db.exec("UPDATE audit_events SET note = 'forged'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM audit_events')).toThrow(/append-only/);
  });

  it('enforces hashed storage and the analyst foreign key', () => {
    const insert = db.prepare('INSERT INTO access_tokens VALUES (?, ?, ?, ?)');
    expect(() => insert.run('raw-token', actor.id, NOW.toISOString(), '2027-01-01')).toThrow(/CHECK/);
    expect(() => insert.run('z'.repeat(64), actor.id, NOW.toISOString(), '2027-01-01')).toThrow(/CHECK/);
    expect(() => insert.run('a'.repeat(64), 'missing', NOW.toISOString(), '2027-01-01')).toThrow(/FOREIGN KEY/);
    issueAccessToken(db, actor.id);
    db.prepare('DELETE FROM analysts WHERE id = ?').run(actor.id);
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
  });
});
