import { CASE_STATUSES, RISK_LEVELS } from '../api/types.js';
import type { CaseStatus, RiskLevel } from '../api/types.js';

export type SortField = 'createdAt' | 'updatedAt' | 'riskScore';
export type SortOrder = 'asc' | 'desc';

export const SORT_FIELDS: readonly SortField[] = ['createdAt', 'updatedAt', 'riskScore'];
export const PAGE_SIZE = 25;

export interface QueueFilters {
  status: CaseStatus[];
  riskLevel: RiskLevel[];
  q: string;
  sort: SortField;
  order: SortOrder;
  page: number;
}

export const DEFAULT_FILTERS: QueueFilters = {
  status: [],
  riskLevel: [],
  q: '',
  sort: 'createdAt',
  order: 'desc',
  page: 1,
};

/** Raw query values as Express exposes them (string, string[] or nested). */
export type RawQuery = Record<string, unknown>;

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v) => (typeof v === 'string' ? v.split(',') : []));
  }
  if (typeof value === 'string') return value.split(',');
  return [];
}

function pickValid<T extends string>(values: string[], allowed: readonly T[]): T[] {
  const out: T[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if ((allowed as readonly string[]).includes(trimmed) && !out.includes(trimmed as T)) {
      out.push(trimmed as T);
    }
  }
  return out;
}

/** Parse the browser URL query string into a validated filter state. */
export function parseFilters(query: RawQuery): QueueFilters {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const sortRaw = typeof query.sort === 'string' ? query.sort : '';
  const sort: SortField = (SORT_FIELDS as readonly string[]).includes(sortRaw)
    ? (sortRaw as SortField)
    : DEFAULT_FILTERS.sort;
  const order: SortOrder = query.order === 'asc' ? 'asc' : 'desc';
  const pageRaw = typeof query.page === 'string' ? Number.parseInt(query.page, 10) : NaN;
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  return {
    status: pickValid(toStringList(query.status), CASE_STATUSES),
    riskLevel: pickValid(toStringList(query.riskLevel), RISK_LEVELS),
    q,
    sort,
    order,
    page,
  };
}

/** Serialise filter state back into a shareable browser query string (defaults omitted). */
export function filtersToQueryString(filters: QueueFilters): string {
  const params = new URLSearchParams();
  for (const s of filters.status) params.append('status', s);
  for (const r of filters.riskLevel) params.append('riskLevel', r);
  if (filters.q) params.set('q', filters.q);
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.order !== DEFAULT_FILTERS.order) params.set('order', filters.order);
  if (filters.page > 1) params.set('page', String(filters.page));
  return params.toString();
}

/** Build the query for GET /api/cases (comma-separated multi-values, fixed page size). */
export function filtersToApiQuery(filters: QueueFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status.length) params.set('status', filters.status.join(','));
  if (filters.riskLevel.length) params.set('riskLevel', filters.riskLevel.join(','));
  if (filters.q) params.set('q', filters.q);
  params.set('sort', filters.sort);
  params.set('order', filters.order);
  params.set('page', String(filters.page));
  params.set('pageSize', String(PAGE_SIZE));
  return params;
}

export function queueUrl(filters: QueueFilters): string {
  const qs = filtersToQueryString(filters);
  return qs ? `/?${qs}` : '/';
}

/** Toggle sorting by a column: same column flips order, new column starts desc. */
export function toggleSort(filters: QueueFilters, field: SortField): QueueFilters {
  if (filters.sort === field) {
    return { ...filters, order: filters.order === 'desc' ? 'asc' : 'desc', page: 1 };
  }
  return { ...filters, sort: field, order: 'desc', page: 1 };
}
