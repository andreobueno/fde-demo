import type { Db } from '../db.js';
import type { Refund, RefundStatus, RiskLevel } from '../types.js';
import {
  refundIndicatorsSchema, refundRecordSchema,
  type RefundAmountBand, type RefundRecord, type RefundSort,
} from '../domain/refunds.js';

interface RefundRow {
  id: string;
  reference: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  amount_cents: number;
  currency: 'USD';
  status: RefundStatus;
  risk_level: RiskLevel;
  reason: string;
  transaction_reference: string;
  transaction_amount_cents: number;
  transaction_occurred_at: string;
  risk_indicators: string;
  created_at: string;
  updated_at: string;
}

function rowToRefund(row: RefundRow): Refund {
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customer_id,
    customer: { id: row.customer_id, fullName: row.customer_name, email: row.customer_email },
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    riskLevel: row.risk_level,
    reason: row.reason,
    originalTransaction: {
      reference: row.transaction_reference,
      amountCents: row.transaction_amount_cents,
      occurredAt: row.transaction_occurred_at,
    },
    riskIndicators: refundIndicatorsSchema.parse(JSON.parse(row.risk_indicators)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const REFUND_SELECT = `SELECT r.*, cu.full_name AS customer_name, cu.email AS customer_email
  FROM refunds r JOIN customers cu ON cu.id = r.customer_id`;

const SORT_COLUMNS: Record<RefundSort, string> = {
  reference: 'r.reference',
  customer: 'cu.full_name COLLATE NOCASE',
  amountCents: 'r.amount_cents',
  status: 'r.status',
  riskLevel: "CASE r.risk_level WHEN 'low' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
  createdAt: 'r.created_at',
};

export interface RefundListQuery {
  q?: string | undefined;
  status?: RefundStatus[] | undefined;
  riskLevel?: RiskLevel[] | undefined;
  amountBand: RefundAmountBand;
  sort: RefundSort;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export function listRefunds(db: Db, query: RefundListQuery): { items: Refund[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.status?.length) {
    where.push(`r.status IN (${query.status.map(() => '?').join(',')})`);
    params.push(...query.status);
  }
  if (query.riskLevel?.length) {
    where.push(`r.risk_level IN (${query.riskLevel.map(() => '?').join(',')})`);
    params.push(...query.riskLevel);
  }
  if (query.q) {
    where.push(`(r.reference LIKE ? ESCAPE '\\' OR cu.full_name LIKE ? ESCAPE '\\'
      OR cu.email LIKE ? ESCAPE '\\' OR r.transaction_reference LIKE ? ESCAPE '\\')`);
    const like = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like, like, like, like);
  }
  switch (query.amountBand) {
    case 'under_1000': where.push('r.amount_cents < 100000'); break;
    case '1000_to_5000': where.push('r.amount_cents BETWEEN 100000 AND 500000'); break;
    case 'over_5000': where.push('r.amount_cents > 500000'); break;
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const direction = query.order === 'asc' ? 'ASC' : 'DESC';
  const orderSql = ` ORDER BY ${SORT_COLUMNS[query.sort]} ${direction}, r.id ASC`;
  const total = db.prepare<(string | number)[], { n: number }>(
    `SELECT COUNT(*) AS n FROM refunds r JOIN customers cu ON cu.id = r.customer_id${whereSql}`,
  ).get(...params)!.n;
  const items = db.prepare<(string | number)[], RefundRow>(
    `${REFUND_SELECT}${whereSql}${orderSql} LIMIT ? OFFSET ?`,
  ).all(...params, query.pageSize, (query.page - 1) * query.pageSize).map(rowToRefund);
  return { items, total };
}

export function getRefund(db: Db, id: string): Refund | null {
  const row = db.prepare<[string], RefundRow>(`${REFUND_SELECT} WHERE r.id = ?`).get(id);
  return row ? rowToRefund(row) : null;
}

export function insertRefund(db: Db, input: RefundRecord): void {
  const refund = refundRecordSchema.parse(input);
  db.prepare(`INSERT INTO refunds
    (id, reference, customer_id, amount_cents, currency, status, risk_level, reason,
     transaction_reference, transaction_amount_cents, transaction_occurred_at,
     risk_indicators, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    refund.id, refund.reference, refund.customerId, refund.amountCents, refund.currency,
    refund.status, refund.riskLevel, refund.reason, refund.originalTransaction.reference,
    refund.originalTransaction.amountCents, refund.originalTransaction.occurredAt,
    JSON.stringify(refund.riskIndicators), refund.createdAt, refund.updatedAt,
  );
}

export function updateRefundStatus(db: Db, id: string, status: RefundStatus, updatedAt: string): void {
  db.prepare('UPDATE refunds SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, updatedAt, id);
}

export interface RefundStats {
  pendingCount: number;
  pendingAmountCents: number;
  approvedToday: number;
  rejectedToday: number;
}

export function refundStats(db: Db, now = new Date()): RefundStats {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  const pending = db.prepare<[], Pick<RefundStats, 'pendingCount' | 'pendingAmountCents'>>(
    `SELECT COUNT(*) AS pendingCount, COALESCE(SUM(amount_cents), 0) AS pendingAmountCents
     FROM refunds WHERE status = 'pending'`,
  ).get()!;
  const decisions = db.prepare<[string, string], Pick<RefundStats, 'approvedToday' | 'rejectedToday'>>(
    `SELECT
       COUNT(DISTINCT CASE WHEN action = 'approve' AND to_status = 'approved' THEN refund_id END) AS approvedToday,
       COUNT(DISTINCT CASE WHEN action = 'reject' AND to_status = 'rejected' THEN refund_id END) AS rejectedToday
     FROM audit_events
     WHERE refund_id IS NOT NULL AND from_status = 'pending'
       AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)`,
  ).get(start.toISOString(), end.toISOString())!;
  return { ...pending, ...decisions };
}
