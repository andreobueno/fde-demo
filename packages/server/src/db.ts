import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { schemaSql } from './schema.js';
import { migrateAnalystRoles } from './migrations.js';

export type Db = Database.Database;

const defaultDbPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'kyc.db',
);

export function openDb(dbPath?: string): Db {
  const target = dbPath ?? process.env.KYC_DB_PATH ?? defaultDbPath;
  if (target !== ':memory:') {
    mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new Database(target);
  if (target !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('recursive_triggers = ON');
  db.exec(schemaSql());
  migrateAnalystRoles(db);
  return db;
}
