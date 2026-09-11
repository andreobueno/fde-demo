import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db.js';
import { schemaSql } from './schema.js';
import { migrateRefundAudit } from './migrations.js';
import { GENESIS_HASH, verifyChain } from './domain/audit.js';
import { listAuditEvents, listRefundAuditEvents } from './repo/audit.js';
import { addRefund, REFUND_ACTORS, REFUND_NOTE } from './refundFixtures.js';
import { applyRefundAction } from './services/refundService.js';

const LEGACY_AUDIT = `
  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id),
    sequence INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    UNIQUE (case_id, sequence)
  );
  CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
  CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
`;
let db: Db | undefined;
let directory: string | undefined;
afterEach(() => {
  if (db?.open) db.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  db = undefined;
  directory = undefined;
});

function legacyDb(filename: string): Db {
  const legacy = new Database(filename);
  legacy.pragma('foreign_keys = ON');
  legacy.pragma('recursive_triggers = ON');
  legacy.exec(schemaSql().split('CREATE TABLE IF NOT EXISTS refunds')[0]!);
  legacy.exec(LEGACY_AUDIT);
  legacy.exec(`
    INSERT INTO analysts VALUES ('ana-001', 'Historical Senior', 'senior_analyst');
    INSERT INTO customers VALUES ('cus-001', 'Fictional Customer', '1990-01-01', 'US', 'US',
      'teacher', 'fictional@example-mail.com', '2020-01-01', 1000, 'salary', 'passport', 1, 1, 0, 0, 0);
    INSERT INTO cases VALUES ('refund-test', 'KYC-OLD', 'cus-001', 'pending', 'low', 10, NULL,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  const fields = {
    action: 'CASE_CREATED', actorId: 'ana-001', caseId: 'refund-test',
    createdAt: '2026-01-01T00:00:00.000Z', fromStatus: null, note: '  Historical café\n"receipt"  ',
    sequence: 1, toStatus: 'pending',
  };
  const hash = createHash('sha256').update(GENESIS_HASH + JSON.stringify(fields)).digest('hex');
  legacy.prepare('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'legacy-event', fields.caseId, fields.sequence, fields.actorId, 'Historical Name',
    fields.action, fields.fromStatus, fields.toStatus, fields.note, fields.createdAt, GENESIS_HASH, hash,
  );
  return legacy;
}

describe('refund audit migration', () => {
  it('preserves every historical value/hash and API shape across idempotent startup', () => {
    directory = mkdtempSync(path.join(homedir(), '.refund-migration-test-'));
    const filename = path.join(directory, 'legacy.db');
    db = legacyDb(filename);
    const oldRows = db.prepare('SELECT *, NULL AS refund_id FROM audit_events').all();
    const oldApi = listAuditEvents(db, 'refund-test');
    expect(verifyChain(oldApi)).toBe(true);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'refunds'").all()).toEqual([]);
    db.close();
    db = openDb(filename);
    expect(db.prepare('SELECT * FROM audit_events').all()).toEqual(oldRows);
    expect(listAuditEvents(db, 'refund-test')).toEqual(oldApi);
    expect(verifyChain(listAuditEvents(db, 'refund-test'))).toBe(true);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('recursive_triggers', { simple: true })).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'audit_events_refund_decisions'").all()).toHaveLength(1);
    addRefund(db);
    applyRefundAction(db, 'refund-test', REFUND_ACTORS.senior_analyst, 'approve', REFUND_NOTE);
    expect(listAuditEvents(db, 'refund-test')).toEqual(oldApi);
    expect(listRefundAuditEvents(db, 'refund-test')).toHaveLength(2);
    const all = db.prepare('SELECT * FROM audit_events ORDER BY id').all();
    db.close();
    db = openDb(filename);
    expect(db.prepare('SELECT * FROM audit_events ORDER BY id').all()).toEqual(all);
    expect(listAuditEvents(db, 'refund-test')).toEqual(oldApi);
    expect(verifyChain(listRefundAuditEvents(db, 'refund-test'))).toBe(true);
    const connection = db;
    for (const statement of [
      "UPDATE audit_events SET note = 'forged'",
      'DELETE FROM audit_events',
      'INSERT OR REPLACE INTO audit_events SELECT * FROM audit_events',
    ]) expect(() => connection.exec(statement)).toThrow(/append-only/);
    expect(connection.pragma('foreign_key_check')).toEqual([]);
  });
  it('rolls back DDL, copied rows and triggers if FK verification fails', () => {
    db = legacyDb(':memory:');
    db.exec('CREATE TABLE refunds (id TEXT PRIMARY KEY)');
    db.pragma('foreign_keys = OFF');
    db.exec("UPDATE cases SET customer_id = 'missing-customer'");
    db.pragma('foreign_keys = ON');
    const before = db.prepare('SELECT * FROM audit_events').all();
    const connection = db;
    expect(() => migrateRefundAudit(connection)).toThrow(/Foreign key check failed/);
    expect(db.prepare('SELECT * FROM audit_events').all()).toEqual(before);
    expect(db.prepare<[], { name: string }>('PRAGMA table_info(audit_events)').all()
      .some((column) => column.name === 'refund_id')).toBe(false);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'audit_events_expanded'").all()).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() => connection.exec("UPDATE audit_events SET note = 'forged'")).toThrow(/append-only/);
    expect(() => connection.exec('DELETE FROM audit_events')).toThrow(/append-only/);
  });
});
