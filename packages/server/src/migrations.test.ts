import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db.js';
import { schemaSql } from './schema.js';
import { migrateAnalystRoles } from './migrations.js';
import { getPolicy } from './repo/policy.js';

let db: Db | undefined;
let directory: string | undefined;
afterEach(() => {
  if (db?.open) db.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  db = undefined;
  directory = undefined;
});

function legacyDatabase(filename: string): Db {
  const legacy = new Database(filename);
  legacy.exec(schemaSql().split('CREATE TABLE IF NOT EXISTS review_policy')[0]!
    .replace("'analyst', 'senior_analyst', 'compliance_manager'", "'analyst', 'senior_analyst'")
    .replace('case_id TEXT REFERENCES cases(id)', 'case_id TEXT NOT NULL REFERENCES cases(id)')
    .replace('  refund_id TEXT REFERENCES refunds(id),\n', '')
    .replace('  CHECK ((case_id IS NOT NULL) + (refund_id IS NOT NULL) = 1),\n', '')
    .replace('  UNIQUE (case_id, sequence),\n  UNIQUE (refund_id, sequence)', '  UNIQUE (case_id, sequence)'));
  legacy.prepare('INSERT INTO analysts VALUES (?, ?, ?)').run('senior', 'Original Name', 'senior_analyst');
  legacy.exec(`
    INSERT INTO customers VALUES (
      'customer', 'Fictional Customer', '1990-01-01', 'US', 'US', 'teacher',
      'fictional@example.test', '2020-01-01', 1000, 'salary', 'passport', 1, 1, 0, 0, 0
    );
    INSERT INTO cases VALUES (
      'case', 'REF-1', 'customer', 'pending', 'low', 10, 'senior', '2026-01-01', '2026-01-01'
    );
    INSERT INTO audit_events VALUES (
      'event', 'case', 1, 'senior', 'Original Name', 'CASE_CREATED', NULL, 'pending',
      'Historical note.', '2026-01-01', 'original-prev-hash', 'original-hash'
    );
  `);
  return legacy;
}

describe('role migration', () => {
  it('upgrades a persisted legacy database without rewriting identities, cases or audit bytes', () => {
    directory = mkdtempSync(path.join(homedir(), '.kyc-migration-test-'));
    const filename = path.join(directory, 'legacy.db');
    db = legacyDatabase(filename);
    const cases = db.prepare('SELECT * FROM cases').all();
    const audit = db.prepare('SELECT *, NULL AS refund_id FROM audit_events').all();
    const analysts = db.prepare('SELECT * FROM analysts').all();
    db.close();

    db = openDb(filename);
    expect(db.prepare('SELECT * FROM cases').all()).toEqual(cases);
    expect(db.prepare('SELECT * FROM audit_events').all()).toEqual(audit);
    expect(db.prepare('SELECT * FROM analysts').all()).toEqual(analysts);
    expect(getPolicy(db)).toMatchObject({ version: 1, requireApprovalNote: true, updatedBy: null });
    db.prepare('INSERT INTO analysts VALUES (?, ?, ?)').run('manager', 'New Manager', 'compliance_manager');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => db?.exec("UPDATE audit_events SET note = 'forged'")).toThrow(/append-only/);
    expect(() => db?.exec('DELETE FROM audit_events')).toThrow(/append-only/);
    const initialPolicy = getPolicy(db);
    db.close();

    db = openDb(filename);
    expect(getPolicy(db)).toEqual(initialPolicy);
    expect(db.prepare('SELECT * FROM audit_events').all()).toEqual(audit);
    expect(db.prepare('SELECT id FROM analysts').all()).toHaveLength(2);
  });

  it('rolls back a failed role migration and restores foreign key enforcement', () => {
    db = legacyDatabase(':memory:');
    db.pragma('foreign_keys = OFF');
    db.exec("UPDATE cases SET assigned_to = 'nonexistent'");
    db.pragma('foreign_keys = ON');
    const connection = db;
    expect(() => migrateAnalystRoles(connection)).toThrow(/Foreign key check failed/);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare('SELECT id FROM analysts').all()).toEqual([{ id: 'senior' }]);
    expect(() => connection.prepare('INSERT INTO analysts VALUES (?, ?, ?)').run(
      'manager', 'Manager', 'compliance_manager',
    )).toThrow(/CHECK/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'analysts_expanded'").all()).toEqual([]);
  });
});
