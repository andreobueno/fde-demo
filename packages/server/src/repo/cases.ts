import type { Db } from '../db.js';
import type { CaseStatus, KycCase, RiskLevel, RiskThresholds } from '../types.js';
import { DEFAULT_THRESHOLDS } from '../domain/riskPolicy.js';
import { rowToKycCase } from './mappers.js';

const CASE_SELECT = `
  SELECT c.*, cu.id AS cust_id, cu.full_name AS cust_full_name,
         cu.country_of_residence AS cust_country_of_residence,
         cu.nationality AS cust_nationality
  FROM cases c JOIN customers cu ON cu.id = c.customer_id
  LEFT JOIN analysts a ON a.id = c.assigned_to
`;

export const CASE_SORTS = [
  'createdAt',
  'updatedAt',
  'riskScore',
  'reference',
  'customer',
  'country',
  'status',
  'assignedTo',
] as const;
export type CaseSort = (typeof CASE_SORTS)[number];

export interface CaseListQuery {
  status?: CaseStatus[];
  riskLevel?: RiskLevel[];
  q?: string;
  sort: CaseSort;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

const SORT_COLUMNS: Record<CaseSort, string> = {
  createdAt: 'c.created_at',
  updatedAt: 'c.updated_at',
  riskScore: 'c.risk_score',
  reference: 'c.reference',
  customer: 'cu.full_name COLLATE NOCASE',
  country: 'cu.country_of_residence',
  status: 'c.status',
  assignedTo: 'a.name COLLATE NOCASE',
};

export function listCases(
  db: Db,
  query: CaseListQuery,
): { items: KycCase[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.status && query.status.length > 0) {
    where.push(`c.status IN (${query.status.map(() => '?').join(',')})`);
    params.push(...query.status);
  }
  if (query.riskLevel && query.riskLevel.length > 0) {
    where.push(`c.risk_level IN (${query.riskLevel.map(() => '?').join(',')})`);
    params.push(...query.riskLevel);
  }
  if (query.q) {
    where.push('(c.reference LIKE ? OR cu.full_name LIKE ? OR cu.email LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like, like);
  }

  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const direction = query.order === 'asc' ? 'ASC' : 'DESC';
  const nullsLast = query.sort === 'assignedTo' ? '(a.name IS NULL) ASC, ' : '';
  const orderSql = ` ORDER BY ${nullsLast}${SORT_COLUMNS[query.sort]} ${direction}, c.id ASC`;

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM cases c JOIN customers cu ON cu.id = c.customer_id${whereSql}`,
      )
      .get(...params) as { n: number }
  ).n;

  const items = db
    .prepare(`${CASE_SELECT}${whereSql}${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, (query.page - 1) * query.pageSize)
    .map(rowToKycCase);

  return { items, total };
}

export function getCase(db: Db, id: string): KycCase | null {
  const row = db.prepare(`${CASE_SELECT} WHERE c.id = ?`).get(id);
  return row ? rowToKycCase(row) : null;
}

export function updateCaseStatus(
  db: Db,
  id: string,
  status: CaseStatus,
  assignedTo: string,
  updatedAt: string,
): void {
  db.prepare('UPDATE cases SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?').run(
    status,
    assignedTo,
    updatedAt,
    id,
  );
}

export function listOpenCases(db: Db): KycCase[] {
  return db
    .prepare(`${CASE_SELECT} WHERE c.status IN ('pending', 'in_review', 'escalated') ORDER BY c.id`)
    .all()
    .map(rowToKycCase);
}

export function updateCaseRisk(
  db: Db,
  id: string,
  riskScore: number,
  riskLevel: RiskLevel,
  updatedAt: string,
  thresholds: RiskThresholds,
): void {
  db.prepare('UPDATE cases SET risk_score = ?, risk_level = ?, updated_at = ? WHERE id = ?').run(
    riskScore,
    riskLevel,
    updatedAt,
    id,
  );
  db.prepare(`INSERT INTO case_risk_thresholds (case_id, medium, high) VALUES (?, ?, ?)
    ON CONFLICT(case_id) DO UPDATE SET medium = excluded.medium, high = excluded.high`)
    .run(id, thresholds.medium, thresholds.high);
}

export function getCaseRiskThresholds(db: Db, id: string): RiskThresholds {
  const row = db.prepare<[string], RiskThresholds>(
    'SELECT medium, high FROM case_risk_thresholds WHERE case_id = ?',
  ).get(id);
  return row ?? { ...DEFAULT_THRESHOLDS };
}

export function caseStats(db: Db): {
  byStatus: Record<CaseStatus, number>;
  byRiskLevel: Record<RiskLevel, number>;
  total: number;
} {
  const byStatus: Record<CaseStatus, number> = {
    pending: 0,
    in_review: 0,
    approved: 0,
    rejected: 0,
    escalated: 0,
  };
  for (const r of db
    .prepare('SELECT status, COUNT(*) AS n FROM cases GROUP BY status')
    .all() as Array<{ status: CaseStatus; n: number }>) {
    byStatus[r.status] = r.n;
  }
  const byRiskLevel: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0 };
  for (const r of db
    .prepare('SELECT risk_level, COUNT(*) AS n FROM cases GROUP BY risk_level')
    .all() as Array<{ risk_level: RiskLevel; n: number }>) {
    byRiskLevel[r.risk_level] = r.n;
  }
  const total = (db.prepare('SELECT COUNT(*) AS n FROM cases').get() as { n: number }).n;
  return { byStatus, byRiskLevel, total };
}
