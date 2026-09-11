import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { Analyst, AuditEvent, CaseAction, CaseDetail, CaseListResponse, CaseStats, RiskExplanation } from './types';
import type { QueueFilters } from '@/lib/filters';

export const queryKeys = {
  analysts: ['analysts'] as const,
  stats: ['stats'] as const,
  cases: (params: string) => ['cases', params] as const,
  case: (id: string) => ['case', id] as const,
  explanation: (id: string) => ['risk-explanation', id] as const,
  audit: (id: string) => ['audit', id] as const,
};

const readRetry = (failureCount: number, error: unknown): boolean => {
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404) return false;
  return failureCount < 1;
};

export function useAnalysts() {
  return useQuery({ queryKey: queryKeys.analysts, queryFn: () => apiFetch<Analyst[]>('/api/analysts'), retry: readRetry });
}
export function useCaseStats() {
  return useQuery({ queryKey: queryKeys.stats, queryFn: () => apiFetch<CaseStats>('/api/cases/stats'), retry: readRetry });
}
export function filtersToQuery(filters: QueueFilters, pageSize = 25): string {
  const params = new URLSearchParams();
  if (filters.status.length) params.set('status', filters.status.join(','));
  if (filters.riskLevel.length) params.set('riskLevel', filters.riskLevel.join(','));
  if (filters.q) params.set('q', filters.q);
  params.set('sort', filters.sort); params.set('order', filters.order);
  params.set('page', String(filters.page)); params.set('pageSize', String(pageSize));
  return params.toString();
}
export function useCases(params: QueueFilters) {
  const query = filtersToQuery(params);
  return useQuery({ queryKey: queryKeys.cases(query), queryFn: () => apiFetch<CaseListResponse>(`/api/cases?${query}`), retry: readRetry });
}
export function useCase(id: string) {
  return useQuery({ queryKey: queryKeys.case(id), queryFn: () => apiFetch<CaseDetail>(`/api/cases/${id}`), retry: readRetry, enabled: Boolean(id) });
}
export function useRiskExplanation(id: string) {
  return useQuery({ queryKey: queryKeys.explanation(id), queryFn: () => apiFetch<RiskExplanation>(`/api/cases/${id}/risk-explanation`), retry: readRetry, enabled: Boolean(id) });
}
export function useAudit(id: string) {
  return useQuery({ queryKey: queryKeys.audit(id), queryFn: () => apiFetch<AuditEvent[]>(`/api/cases/${id}/audit`), retry: readRetry, enabled: Boolean(id) });
}
export function useCaseAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, note }: { action: CaseAction; note?: string }) =>
      apiFetch<CaseDetail>(`/api/cases/${id}/actions`, { method: 'POST', body: JSON.stringify({ action, ...(note ? { note } : {}) }) }),
    retry: false,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.case(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit(id) }),
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
      ]);
    },
  });
}
