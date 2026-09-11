import type { CaseSort, CaseStatus, RiskLevel, SortOrder } from '../api/types';

export const PAGE_SIZE = 25;

export interface QueueFilters {
  status: CaseStatus[];
  riskLevel: RiskLevel[];
  q: string;
  sort: CaseSort;
  order: SortOrder;
  page: number;
}

const ALL_STATUSES: CaseStatus[] = ['pending', 'in_review', 'approved', 'rejected', 'escalated'];
const ALL_RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high'];
export const ALL_SORTS: CaseSort[] = [
  'createdAt',
  'updatedAt',
  'riskScore',
  'reference',
  'customer',
  'country',
  'status',
  'assignedTo',
];

export function defaultOrderFor(sort: CaseSort): SortOrder {
  return sort === 'createdAt' || sort === 'updatedAt' || sort === 'riskScore' ? 'desc' : 'asc';
}
const ALL_ORDERS: SortOrder[] = ['asc', 'desc'];

export const DEFAULT_FILTERS: QueueFilters = {
  status: [],
  riskLevel: [],
  q: '',
  sort: 'createdAt',
  order: 'desc',
  page: 1,
};

function parseMulti<T extends string>(raw: string | null, allowed: T[]): T[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v): v is T => (allowed as string[]).includes(v));
}

export function parseQueueFilters(params: URLSearchParams): QueueFilters {
  const sortRaw = params.get('sort') ?? '';
  const orderRaw = params.get('order') ?? '';
  const pageRaw = Number.parseInt(params.get('page') ?? '', 10);
  return {
    status: parseMulti(params.get('status'), ALL_STATUSES),
    riskLevel: parseMulti(params.get('riskLevel'), ALL_RISK_LEVELS),
    q: params.get('q') ?? '',
    sort: (ALL_SORTS as string[]).includes(sortRaw) ? (sortRaw as CaseSort) : 'createdAt',
    order: (ALL_ORDERS as string[]).includes(orderRaw) ? (orderRaw as SortOrder) : 'desc',
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
  };
}

export function serializeQueueFilters(f: QueueFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.status.length > 0) {
    params.set('status', f.status.join(','));
  }
  if (f.riskLevel.length > 0) {
    params.set('riskLevel', f.riskLevel.join(','));
  }
  if (f.q.trim() !== '') {
    params.set('q', f.q);
  }
  if (f.sort !== DEFAULT_FILTERS.sort) {
    params.set('sort', f.sort);
  }
  if (f.order !== DEFAULT_FILTERS.order) {
    params.set('order', f.order);
  }
  if (f.page !== DEFAULT_FILTERS.page) {
    params.set('page', String(f.page));
  }
  return params;
}

export function queueFiltersToQuery(f: QueueFilters): string {
  const params = serializeQueueFilters(f);
  params.set('page', String(f.page));
  params.set('pageSize', String(PAGE_SIZE));
  return params.toString();
}
