import type { CaseStatus, RiskLevel } from '@/api/types';
export interface QueueFilters {
  status: CaseStatus[];
  riskLevel: RiskLevel[];
  q: string;
  sort: 'createdAt' | 'updatedAt' | 'riskScore';
  order: 'asc' | 'desc';
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
const statuses: CaseStatus[] = ['pending', 'in_review', 'approved', 'rejected', 'escalated'];
const risks: RiskLevel[] = ['low', 'medium', 'high'];
const isStatus = (v: string): v is CaseStatus => statuses.includes(v as CaseStatus);
const isRisk = (v: string): v is RiskLevel => risks.includes(v as RiskLevel);
export function parseFilters(search: string): QueueFilters {
  const p = new URLSearchParams(search);
  const status = (p.get('status') ?? '').split(',').filter(isStatus);
  const riskLevel = (p.get('riskLevel') ?? '').split(',').filter(isRisk);
  const sortValue = p.get('sort');
  const sort = sortValue === 'updatedAt' || sortValue === 'riskScore' ? sortValue : 'createdAt';
  const order = p.get('order') === 'asc' ? 'asc' : 'desc';
  const parsedPage = Number(p.get('page'));
  return {
    status,
    riskLevel,
    q: p.get('q') ?? '',
    sort,
    order,
    page: Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1,
  };
}
export function serializeFilters(f: QueueFilters): string {
  const p = new URLSearchParams();
  if (f.status.length) p.set('status', f.status.join(','));
  if (f.riskLevel.length) p.set('riskLevel', f.riskLevel.join(','));
  if (f.q) p.set('q', f.q);
  if (f.sort !== 'createdAt') p.set('sort', f.sort);
  if (f.order !== 'desc') p.set('order', f.order);
  if (f.page !== 1) p.set('page', String(Math.max(1, Math.floor(f.page))));
  return p.toString();
}
export function filtersToApiQuery(f: QueueFilters, pageSize = 25): string {
  const p = new URLSearchParams(serializeFilters(f));
  p.set('page', String(f.page));
  p.set('pageSize', String(pageSize));
  return p.toString();
}
