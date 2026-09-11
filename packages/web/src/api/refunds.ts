import { apiRequest } from './client';
import type { RefundAction, RefundAuditEvent, RefundDetail, RefundListResponse, RefundStats } from './types';
import { refundFiltersToQuery, type RefundFilters } from '../lib/refundFilters';

export function listRefunds(filters: RefundFilters, analystId: string, signal?: AbortSignal): Promise<RefundListResponse> {
  return apiRequest(`/api/refunds?${refundFiltersToQuery(filters)}`, { analystId, signal });
}

export function getRefundStats(analystId: string, signal?: AbortSignal): Promise<RefundStats> {
  return apiRequest('/api/refunds/stats', { analystId, signal });
}

export function getRefund(id: string, analystId: string, signal?: AbortSignal): Promise<RefundDetail> {
  return apiRequest(`/api/refunds/${encodeURIComponent(id)}`, { analystId, signal });
}

export function getRefundAudit(id: string, analystId: string, signal?: AbortSignal): Promise<RefundAuditEvent[]> {
  return apiRequest(`/api/refunds/${encodeURIComponent(id)}/audit`, { analystId, signal });
}

export function postRefundAction(
  id: string, action: RefundAction, note: string, analystId: string, signal?: AbortSignal,
): Promise<RefundDetail> {
  return apiRequest(`/api/refunds/${encodeURIComponent(id)}/actions`, {
    method: 'POST',
    body: { action, note: note.trim() },
    analystId,
    signal,
  });
}
