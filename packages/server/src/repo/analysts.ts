import type { Db } from '../db.js';
import type { Analyst } from '../types.js';
import { rowToAnalyst } from './mappers.js';

export function listAnalysts(db: Db): Analyst[] {
  return db
    .prepare('SELECT * FROM analysts ORDER BY id')
    .all()
    .map(rowToAnalyst);
}

export function getAnalyst(db: Db, id: string): Analyst | null {
  const row = db.prepare('SELECT * FROM analysts WHERE id = ?').get(id);
  return row ? rowToAnalyst(row) : null;
}
