import type { Db } from '../db.js';
import { randomUUID } from 'node:crypto';
import type { RiskSignal } from '../types.js';
import { rowToRiskSignal } from './mappers.js';

export function listSignals(db: Db, caseId: string): RiskSignal[] {
  return db
    .prepare('SELECT * FROM risk_signals WHERE case_id = ? ORDER BY weight DESC, code ASC')
    .all(caseId)
    .map(rowToRiskSignal);
}

export function replaceSignals(
  db: Db,
  caseId: string,
  signals: Omit<RiskSignal, 'id' | 'caseId'>[],
): void {
  db.prepare('DELETE FROM risk_signals WHERE case_id = ?').run(caseId);
  const insert = db.prepare(
    `INSERT INTO risk_signals (id, case_id, code, title, description, severity, weight)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of signals) {
    insert.run(randomUUID(), caseId, s.code, s.title, s.description, s.severity, s.weight);
  }
}
