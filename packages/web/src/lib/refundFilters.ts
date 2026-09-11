import type { RefundAmountBand, RefundSort, RefundStatus, RiskLevel, SortOrder } from '../api/types';
import { parseMulti } from './listFilters';
import { PAGE_SIZE } from './queueFilters';

export interface RefundFilters {
  status: RefundStatus[];
  riskLevel: RiskLevel[];
  amountBand: RefundAmountBand;
  q: string;
  sort: RefundSort;
  order: SortOrder;
  page: number;
}

export const REFUND_STATUSES: RefundStatus[] = ['pending', 'approved', 'rejected'];
export const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high'];
export const REFUND_SORTS: RefundSort[] = ['reference', 'customer', 'amountCents', 'status', 'riskLevel', 'createdAt'];
export const AMOUNT_BANDS: { value: RefundAmountBand; label: string }[] = [
  { value: 'all', label: 'All amounts' },
  { value: 'under_1000', label: 'Under $1,000' },
  { value: '1000_to_5000', label: '$1,000–$5,000' },
  { value: 'over_5000', label: 'Over $5,000' },
];

export const DEFAULT_REFUND_FILTERS: RefundFilters = {
  status: [], riskLevel: [], amountBand: 'all', q: '', sort: 'createdAt', order: 'desc', page: 1,
};

export function parseRefundFilters(params: URLSearchParams): RefundFilters {
  const page = Number(params.get('page'));
  return {
    status: parseMulti(params.get('status'), REFUND_STATUSES),
    riskLevel: parseMulti(params.get('riskLevel'), RISK_LEVELS),
    amountBand: AMOUNT_BANDS.find((band) => band.value === params.get('amountBand'))?.value ?? 'all',
    q: (params.get('q') ?? '').slice(0, 100),
    sort: REFUND_SORTS.find((sort) => sort === params.get('sort')) ?? 'createdAt',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

export function serializeRefundFilters(filters: RefundFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status.length) params.set('status', filters.status.join(','));
  if (filters.riskLevel.length) params.set('riskLevel', filters.riskLevel.join(','));
  if (filters.amountBand !== 'all') params.set('amountBand', filters.amountBand);
  if (filters.q.trim()) params.set('q', filters.q);
  if (filters.sort !== 'createdAt') params.set('sort', filters.sort);
  if (filters.order !== 'desc') params.set('order', filters.order);
  if (filters.page !== 1) params.set('page', String(filters.page));
  return params;
}

export function refundFiltersToQuery(filters: RefundFilters): string {
  const params = serializeRefundFilters(filters);
  params.set('page', String(filters.page));
  params.set('pageSize', String(PAGE_SIZE));
  return params.toString();
}
