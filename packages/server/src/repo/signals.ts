import type { Db } from '../db.js';
import type { RiskSignal } from '../types.js';
import { rowToRiskSignal } from './mappers.js';

export function listSignals(db: Db, caseId: string): RiskSignal[] {
  return db
    .prepare('SELECT * FROM risk_signals WHERE case_id = ? ORDER BY weight DESC, code ASC')
    .all(caseId)
    .map(rowToRiskSignal);
}
