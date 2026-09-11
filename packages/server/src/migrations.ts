import type { Db } from './db.js';

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
