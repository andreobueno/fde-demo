import * as fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db.js';
import { refundFixtureContext, REFUND_ACTORS } from '../refundFixtures.js';
import { authenticateAccessToken } from '../repo/accessTokens.js';
import { issueAccessTokenFile } from './accessTokenService.js';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    writeFileSync: vi.fn(original.writeFileSync),
    fsyncSync: vi.fn(original.fsyncSync),
  };
});

let db: Db;
let directory: string;
let output: string;
const analyst = REFUND_ACTORS.analyst;

beforeEach(() => {
  db = openDb(':memory:');
  refundFixtureContext(db);
  directory = fs.mkdtempSync(path.join(homedir(), '.kyc-token-file-'));
  output = path.join(directory, 'token.txt');
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('transactional token file delivery', () => {
  it('returns only metadata to the CLI after securely writing the credential', () => {
    const metadata = issueAccessTokenFile(db, analyst.id, output);
    expect(Object.keys(metadata).sort()).toEqual(['analystId', 'expiresAt', 'issuedAt']);
    const token = fs.readFileSync(output, 'utf8').trim();
    expect(authenticateAccessToken(db, token)).toEqual(analyst);
    expect(fs.statSync(output).mode & 0o777).toBe(0o600);
  });

  it.each(['writeFileSync', 'fsyncSync'] as const)('rolls back credentials and removes the file when %s fails', (method) => {
    vi.mocked(fs[method]).mockImplementationOnce(() => { throw new Error('Simulated disk failure'); });
    expect(() => issueAccessTokenFile(db, analyst.id, output)).toThrow('Simulated disk failure');
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
    expect(fs.existsSync(output)).toBe(false);
  });

  it('removes a written credential and rolls back when the database commit fails', () => {
    db.exec(`
      CREATE TABLE commit_failure (
        analyst_id TEXT REFERENCES analysts(id) DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TRIGGER reject_token AFTER INSERT ON access_tokens
      BEGIN INSERT INTO commit_failure VALUES ('missing'); END;
    `);
    expect(() => issueAccessTokenFile(db, analyst.id, output)).toThrow(/FOREIGN KEY/);
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
    expect(fs.existsSync(output)).toBe(false);
    expect(db.inTransaction).toBe(false);
  });

  it('validates the analyst before creating a file and rejects blank paths', () => {
    expect(() => issueAccessTokenFile(db, 'missing', output)).toThrow(/Analyst not found/);
    expect(fs.existsSync(output)).toBe(false);
    expect(() => issueAccessTokenFile(db, analyst.id, ' ')).toThrow(/output file/);
    expect(db.prepare('SELECT * FROM access_tokens').all()).toEqual([]);
  });
});
