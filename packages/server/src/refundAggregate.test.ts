import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db.js';
import { schemaSql } from './schema.js';
import { createApp } from './http/app.js';
import { addRefund, refundFixtureContext, REFUND_ACTORS, REFUND_NOTE } from './refundFixtures.js';
import { insertRefund, refundStats } from './repo/refunds.js';
import { listRefundAuditEvents } from './repo/audit.js';
import { verifyChain } from './domain/audit.js';
import { applyRefundAction } from './services/refundService.js';
import { seedRefunds } from './seedRefunds.js';

const LIMIT = Number.MAX_SAFE_INTEGER;
const LIMIT_ERROR = /Pending refund total exceeds 9007199254740991 cents/;
let db: Db;
let directory: string | undefined;
beforeEach(() => { db = openDb(':memory:'); refundFixtureContext(db); });
afterEach(() => {
  if (db.open) db.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

function addPending(id: string, amountCents: number) {
  return addRefund(db, {
    id, reference: `RFD-${id}`, amountCents,
    originalTransaction: {
      reference: `TXN-${id}`, amountCents: LIMIT, occurredAt: '2026-08-01T00:00:00.000Z',
    },
  });
}

describe('pending refund aggregate constraint', () => {
  it('returns the exact numeric limit and rejects an additional cent without appending history', async () => {
    addPending('large', LIMIT - 2);
    addPending('small-1', 1);
    addPending('small-2', 1);
    const history = db.prepare('SELECT * FROM audit_events ORDER BY id').all();
    expect(() => addPending('excess', 1)).toThrow(LIMIT_ERROR);
    expect(db.prepare('SELECT * FROM audit_events ORDER BY id').all()).toEqual(history);
    const response = await request(createApp(db)).get('/api/refunds/stats')
      .set('x-analyst-id', REFUND_ACTORS.analyst.id).expect(200);
    expect(response.body).toEqual({
      pendingCount: 3, pendingAmountCents: LIMIT, approvedToday: 0, rejectedToday: 0,
    });
    expect(Number.isSafeInteger(response.body.pendingAmountCents)).toBe(true);
  });

  it.each([
    "UPDATE refunds SET amount_cents = 2 WHERE id = 'small'",
    "UPDATE OR IGNORE refunds SET amount_cents = 2 WHERE id = 'small'",
    "UPDATE refunds SET status = 'pending' WHERE id = 'terminal'",
    `INSERT INTO refunds SELECT * FROM refunds WHERE id = 'terminal'
      ON CONFLICT(id) DO UPDATE SET status = 'pending'`,
    `INSERT OR REPLACE INTO refunds
      SELECT id, reference, customer_id, 2, currency, status, risk_level, reason,
        transaction_reference, transaction_amount_cents, transaction_occurred_at,
        risk_indicators, created_at, updated_at FROM refunds WHERE id = 'small'`,
  ])('rejects over-limit mutations and preserves rows: %s', (statement) => {
    const record = addPending('large', LIMIT - 1);
    addPending('small', 1);
    insertRefund(db, { ...record, id: 'terminal', reference: 'RFD-terminal', status: 'approved' });
    const before = db.prepare('SELECT * FROM refunds ORDER BY id').all();
    const history = db.prepare('SELECT * FROM audit_events ORDER BY id').all();
    expect(() => db.exec(statement)).toThrow(LIMIT_ERROR);
    expect(db.prepare('SELECT * FROM refunds ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM audit_events ORDER BY id').all()).toEqual(history);
    expect(refundStats(db).pendingAmountCents).toBe(LIMIT);
  });

  it('allows unchanged replacements at capacity and checks the resulting set of refunds', () => {
    addPending('large', LIMIT);
    const history = listRefundAuditEvents(db, 'large');
    db.exec("INSERT OR REPLACE INTO refunds SELECT * FROM refunds WHERE id = 'large'");
    expect(refundStats(db).pendingAmountCents).toBe(LIMIT);
    expect(listRefundAuditEvents(db, 'large')).toEqual(history);
  });

  it('rolls back the entire multirow update when a later row exceeds capacity', () => {
    addPending('large', LIMIT - 3);
    addPending('small-1', 1);
    addPending('small-2', 1);
    const before = db.prepare('SELECT * FROM refunds ORDER BY id').all();
    expect(() => db.exec("UPDATE refunds SET amount_cents = 2 WHERE id IN ('small-1', 'small-2')"))
      .toThrow(LIMIT_ERROR);
    expect(db.prepare('SELECT * FROM refunds ORDER BY id').all()).toEqual(before);
    expect(refundStats(db).pendingAmountCents).toBe(LIMIT - 1);
  });

  it.each(['approve', 'reject'] as const)('%s releases capacity with valid audit history', (action) => {
    addPending('large', LIMIT);
    applyRefundAction(db, 'large', REFUND_ACTORS.compliance_manager, action, REFUND_NOTE);
    expect(refundStats(db).pendingAmountCents).toBe(0);
    addPending('next', LIMIT);
    expect(refundStats(db)).toMatchObject({ pendingCount: 1, pendingAmountCents: LIMIT });
    expect(verifyChain(listRefundAuditEvents(db, 'large'))).toBe(true);
    expect(verifyChain(listRefundAuditEvents(db, 'next'))).toBe(true);
  });

  it('keeps capacity occupied when a decision audit append fails', () => {
    addPending('large', LIMIT);
    const history = listRefundAuditEvents(db, 'large');
    db.exec(`CREATE TRIGGER fail_decision BEFORE INSERT ON audit_events
      WHEN NEW.action = 'approve'
      BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;`);
    expect(() => applyRefundAction(db, 'large', REFUND_ACTORS.compliance_manager, 'approve', REFUND_NOTE))
      .toThrow(/simulated audit failure/);
    expect(() => addPending('excess', 1)).toThrow(LIMIT_ERROR);
    expect(refundStats(db).pendingAmountCents).toBe(LIMIT);
    expect(listRefundAuditEvents(db, 'large')).toEqual(history);
  });

  it('rolls back additive seeding and its history when the batch exceeds capacity', () => {
    addPending('existing', LIMIT - 100000);
    const before = db.prepare('SELECT * FROM refunds ORDER BY id').all();
    const history = db.prepare('SELECT * FROM audit_events ORDER BY id').all();
    expect(() => seedRefunds(db)).toThrow(LIMIT_ERROR);
    expect(db.prepare('SELECT * FROM refunds ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM audit_events ORDER BY id').all()).toEqual(history);
  });
});

describe('pending refund aggregate migration', () => {
  function legacyDatabase() {
    directory = mkdtempSync(path.join(homedir(), '.refund-total-test-'));
    const filename = path.join(directory, 'legacy.db');
    db.close();
    db = new Database(filename);
    db.pragma('foreign_keys = ON');
    db.pragma('recursive_triggers = ON');
    db.exec(schemaSql());
    refundFixtureContext(db);
    return filename;
  }

  it('preserves a valid legacy database at the limit across repeated startup', () => {
    const filename = legacyDatabase();
    addPending('large', LIMIT - 1);
    addPending('small', 1);
    const before = db.prepare('SELECT * FROM refunds ORDER BY id').all();
    const history = db.prepare('SELECT * FROM audit_events ORDER BY id').all();
    for (let attempt = 0; attempt < 2; attempt++) {
      db.close();
      db = openDb(filename);
      expect(db.prepare('SELECT * FROM refunds ORDER BY id').all()).toEqual(before);
      expect(db.prepare('SELECT * FROM audit_events ORDER BY id').all()).toEqual(history);
      expect(refundStats(db).pendingAmountCents).toBe(LIMIT);
      expect(() => addPending('excess', 1)).toThrow(LIMIT_ERROR);
      expect(() => db.exec("UPDATE refunds SET amount_cents = 2 WHERE id = 'small'")).toThrow(LIMIT_ERROR);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    }
  });

  it.each([
    [2, 1],
    [3, LIMIT],
    [1025, LIMIT],
  ])('refuses unsafe legacy data (%i rows, subsequent amount %i) without rewriting it', (count, amount) => {
    const filename = legacyDatabase();
    db.transaction(() => {
      addPending('large', LIMIT);
      for (let index = 1; index < count; index++) addPending(`existing-${index}`, amount);
    })();
    const before = db.prepare('SELECT * FROM refunds ORDER BY id').all();
    const history = db.prepare('SELECT * FROM audit_events ORDER BY id').all();
    db.close();
    expect(() => openDb(filename)).toThrow(/Reconcile the existing refunds before restarting/);
    db = new Database(filename);
    expect(db.prepare('SELECT * FROM refunds ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM audit_events ORDER BY id').all()).toEqual(history);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'refunds_pending_total_%'").all())
      .toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('enforces capacity across separate database connections', () => {
    const filename = legacyDatabase();
    addPending('large', LIMIT - 1);
    db.close();
    db = openDb(filename);
    const other = openDb(filename);
    try {
      const record = addPending('small', 1);
      expect(() => insertRefund(other, { ...record, id: 'excess', reference: 'RFD-excess' }))
        .toThrow(LIMIT_ERROR);
      expect(refundStats(other)).toMatchObject({ pendingCount: 2, pendingAmountCents: LIMIT });
    } finally {
      other.close();
    }
  });
});
