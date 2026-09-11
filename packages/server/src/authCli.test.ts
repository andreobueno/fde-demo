import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db.js';
import { refundFixtureContext, REFUND_ACTORS } from './refundFixtures.js';
import { authenticateAccessToken, issueAccessToken } from './repo/accessTokens.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const analyst = REFUND_ACTORS.analyst;
let db: Db;
let directory: string;
let filename: string;
let output: string;

function cli(script: string, args: string[] = []) {
  return spawnSync('npm', ['run', script, '-w', 'packages/server', '--', ...args], {
    cwd: root, env: { ...process.env, KYC_DB_PATH: filename }, encoding: 'utf8',
  });
}

beforeEach(() => {
  directory = mkdtempSync(path.join(homedir(), '.kyc-auth-cli-'));
  filename = path.join(directory, 'credentials.db');
  output = path.join(directory, 'token.txt');
  db = openDb(filename);
  refundFixtureContext(db);
});
afterEach(() => {
  if (db.open) db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('credential administration CLIs', () => {
  it('honors KYC_DB_PATH and issues a credential only to a new 0600 file, logging path and expiry', () => {
    const result = cli('auth:issue', [analyst.id, output]);
    expect(result.status).toBe(0);
    const contents = readFileSync(output, 'utf8');
    expect(contents).toMatch(/^[A-Za-z0-9_-]{43}\n$/);
    const token = contents.trim();
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(authenticateAccessToken(db, token)).toEqual(analyst);
    const row = db.prepare<[], { expires_at: string }>('SELECT expires_at FROM access_tokens').get()!;
    expect(result.stdout).toContain(`Token written to ${output}; expires at ${row.expires_at}.`);
    expect(result.stdout).not.toContain(token);
    expect(result.stderr).not.toContain(token);
    expect(result.stderr).toBe('');
  });

  it('refuses to overwrite an existing credential without creating another usable credential', () => {
    expect(cli('auth:issue', [analyst.id, output]).status).toBe(0);
    const contents = readFileSync(output, 'utf8');
    const before = db.prepare('SELECT * FROM access_tokens').all();
    const result = cli('auth:issue', [analyst.id, output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Token issuance failed.');
    expect(result.stdout + result.stderr).not.toContain(contents.trim());
    expect(readFileSync(output, 'utf8')).toBe(contents);
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual(before);
  });

  it('refuses symlinks and preserves their target without persisting a credential', () => {
    const target = path.join(directory, 'target.txt');
    writeFileSync(target, 'Existing private contents');
    symlinkSync(target, output);
    expect(cli('auth:issue', [analyst.id, output]).status).toBe(1);
    expect(readFileSync(target, 'utf8')).toBe('Existing private contents');
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
  });

  it.each(['missing analyst', 'no arguments', 'missing file', 'extra argument', 'whitespace', 'unknown directory'])(
    'rejects %s without leaving credentials or an output file',
    (kind) => {
      const args = {
        'missing analyst': ['unknown', output],
        'no arguments': [],
        'missing file': [analyst.id],
        'extra argument': [analyst.id, output, 'extra'],
        whitespace: [' ', output],
        'unknown directory': [analyst.id, path.join(directory, 'absent', 'token.txt')],
      }[kind]!;
      const result = cli('auth:issue', args);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toMatch(/\b[A-Za-z0-9_-]{43}\b/);
      expect(existsSync(output)).toBe(false);
      expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
    },
  );

  it('revokes all credentials for the explicit analyst while retaining other actors’ credentials', () => {
    const first = issueAccessToken(db, analyst.id);
    const second = issueAccessToken(db, analyst.id);
    const manager = issueAccessToken(db, REFUND_ACTORS.compliance_manager.id);
    const result = cli('auth:revoke', [analyst.id]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Revoked 2 access token(s) for analyst ${analyst.id}.`);
    for (const issued of [first, second, manager]) {
      expect(result.stdout + result.stderr).not.toContain(issued.token);
    }
    expect(authenticateAccessToken(db, first.token)).toBeNull();
    expect(authenticateAccessToken(db, second.token)).toBeNull();
    expect(authenticateAccessToken(db, manager.token)?.id).toBe(REFUND_ACTORS.compliance_manager.id);
    const repeated = cli('auth:revoke', [analyst.id]);
    expect(repeated.status).toBe(0);
    expect(repeated.stdout).toContain('Revoked 0 access token(s)');
  });

  it.each([
    { args: [] }, { args: ['unknown'] }, { args: [' '] }, { args: [analyst.id, 'extra'] },
  ])('refuses invalid revocation arguments $args', ({ args }) => {
    const issued = issueAccessToken(db, analyst.id);
    const result = cli('auth:revoke', args);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(issued.token);
    expect(authenticateAccessToken(db, issued.token)).toEqual(analyst);
  });

  it('seeds no credentials and invalidates old credentials on destructive reseeding', () => {
    db.close();
    expect(cli('seed').status).toBe(0);
    db = openDb(filename);
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
    expect(db.prepare('SELECT id FROM audit_events').all().length).toBeGreaterThan(0);
    const issued = issueAccessToken(db, analyst.id);
    db.close();
    const result = cli('seed');
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(issued.token);
    db = openDb(filename);
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
    expect(authenticateAccessToken(db, issued.token)).toBeNull();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  }, 15000);
});
