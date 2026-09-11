import type { Db } from '../db.js';
import type { Customer } from '../types.js';
import { rowToCustomer } from './mappers.js';

export function getCustomer(db: Db, id: string): Customer | null {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  return row ? rowToCustomer(row) : null;
}
