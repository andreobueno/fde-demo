import type { Db } from './db.js';

export function migrateRiskPolicy(db: Db): void {
  db.transaction(() => {
    const customerColumns = db.prepare<[], { name: string }>('PRAGMA table_info(customers)').all();
    if (!customerColumns.some((column) => column.name === 'id_document_expires_at')) {
      db.exec('ALTER TABLE customers ADD COLUMN id_document_expires_at TEXT');
    }
  }).immediate();
}

export function migrateRefundAudit(db: Db): void {
  db.transaction(() => {
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(audit_events)').all();
    if (!columns.some((column) => column.name === 'refund_id')) {
      db.exec(`
        CREATE TABLE audit_events_expanded (
          id TEXT PRIMARY KEY,
          case_id TEXT REFERENCES cases(id),
          refund_id TEXT REFERENCES refunds(id),
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
          CHECK ((case_id IS NOT NULL) + (refund_id IS NOT NULL) = 1),
          UNIQUE (case_id, sequence),
          UNIQUE (refund_id, sequence)
        );
        INSERT INTO audit_events_expanded
          (id, case_id, sequence, actor_id, actor_name, action, from_status, to_status,
           note, created_at, prev_hash, hash)
        SELECT id, case_id, sequence, actor_id, actor_name, action, from_status, to_status,
          note, created_at, prev_hash, hash FROM audit_events;
        DROP TABLE audit_events;
        ALTER TABLE audit_events_expanded RENAME TO audit_events;
      `);
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS audit_events_no_update
      BEFORE UPDATE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
      BEFORE DELETE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
      CREATE INDEX IF NOT EXISTS audit_events_refund_decisions
        ON audit_events(created_at, refund_id) WHERE refund_id IS NOT NULL;
    `);
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new Error('Foreign key check failed during refund audit migration.');
    }
  }).immediate();
}

export function migrateAnalystRoles(db: Db): void {
  const table = db.prepare<[], { sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'analysts'",
  ).get();
  if (!table || table.sql.includes("'compliance_manager'")) return;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE analysts_expanded (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('analyst', 'senior_analyst', 'compliance_manager'))
        );
        INSERT INTO analysts_expanded SELECT id, name, role FROM analysts;
        DROP TABLE analysts;
        ALTER TABLE analysts_expanded RENAME TO analysts;
      `);
      if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
        throw new Error('Foreign key check failed during analyst role migration.');
      }
    }).immediate();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
