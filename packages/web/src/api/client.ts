import type {
  ActionResponse,
  Analyst,
  ApiErrorBody,
  AuditEvent,
  CaseAction,
  CaseDetail,
  CaseListResponse,
  CaseStats,
  CurrentAnalyst,
  Policy,
  PolicyAuditEvent,
  PolicyUpdate,
  RiskExplanation,
  RiskPolicy,
  RiskPolicyChange,
  RiskPolicyPatch,
  RiskPolicyUpdateResponse,
} from './types';
import type { QueueFilters } from '../lib/queueFilters';
import { queueFiltersToQuery } from '../lib/queueFilters';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  analystId: string;
  signal?: AbortSignal | undefined;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions): Promise<T> {
  options.signal?.throwIfAborted();
  if (options.analystId.trim() === '') {
    throw new ApiError(401, 'UNAUTHORIZED', 'Select a demo identity to continue.');
  }
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-analyst-id': options.analystId,
  };

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
      signal: options.signal ?? null,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the API server');
  }

  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    let message = `Request failed (${response.status})`;
    let details: unknown;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body && typeof body === 'object' && body.error) {
        code = body.error.code;
        message = body.error.message;
        details = body.error.details;
      }
    } catch {
      // body was not JSON; keep fallback code/message
    }
    throw new ApiError(response.status, code, message, details);
  }

  const result = (await response.json()) as T;
  options.signal?.throwIfAborted();
  return result;
}

export function getAnalysts(analystId: string, signal?: AbortSignal): Promise<Analyst[]> {
  return apiRequest<Analyst[]>('/api/analysts', { analystId, signal });
}

export function getMe(analystId: string, signal?: AbortSignal): Promise<CurrentAnalyst> {
  return apiRequest<CurrentAnalyst>('/api/me', { analystId, signal });
}

export function getPolicy(analystId: string, signal?: AbortSignal): Promise<Policy> {
  return apiRequest<Policy>('/api/policy', { analystId, signal });
}

export function getPolicyAudit(analystId: string, signal?: AbortSignal): Promise<PolicyAuditEvent[]> {
  return apiRequest<PolicyAuditEvent[]>('/api/policy/audit', { analystId, signal });
}

export function updatePolicy(
  update: PolicyUpdate,
  analystId: string,
  signal?: AbortSignal,
): Promise<Policy> {
  return apiRequest<Policy>('/api/policy', {
    method: 'PUT',
    body: {
      version: update.version,
      requireApprovalNote: update.requireApprovalNote,
      reason: update.reason.trim(),
    },
    analystId,
    signal,
  });
}

export function getCaseStats(analystId: string, signal?: AbortSignal): Promise<CaseStats> {
  return apiRequest<CaseStats>('/api/cases/stats', { analystId, signal });
}

export function listCases(
  filters: QueueFilters,
  analystId: string,
  signal?: AbortSignal,
): Promise<CaseListResponse> {
  return apiRequest<CaseListResponse>(`/api/cases?${queueFiltersToQuery(filters)}`, {
    analystId,
    signal,
  });
}

export function getCase(id: string, analystId: string, signal?: AbortSignal): Promise<CaseDetail> {
  return apiRequest<CaseDetail>(`/api/cases/${id}`, { analystId, signal });
}

export function getRiskExplanation(
  id: string,
  analystId: string,
  signal?: AbortSignal,
): Promise<RiskExplanation> {
  return apiRequest<RiskExplanation>(`/api/cases/${id}/risk-explanation`, {
    analystId,
    signal,
  });
}

export function getAudit(
  id: string,
  analystId: string,
  signal?: AbortSignal,
): Promise<AuditEvent[]> {
  return apiRequest<AuditEvent[]>(`/api/cases/${id}/audit`, { analystId, signal });
}

export function getRiskPolicy(analystId: string, signal?: AbortSignal): Promise<RiskPolicy> {
  return apiRequest<RiskPolicy>('/api/risk-policy', { analystId, signal });
}

export function getRiskPolicyHistory(
  analystId: string,
  signal?: AbortSignal,
): Promise<RiskPolicyChange[]> {
  return apiRequest<RiskPolicyChange[]>('/api/risk-policy/history', { analystId, signal });
}

export function putRiskPolicy(
  patch: RiskPolicyPatch,
  analystId: string,
  signal?: AbortSignal,
): Promise<RiskPolicyUpdateResponse> {
  return apiRequest<RiskPolicyUpdateResponse>('/api/risk-policy', {
    method: 'PUT',
    body: patch,
    analystId,
    signal,
  });
}

export function postCaseAction(
  id: string,
  action: CaseAction,
  note: string,
  analystId: string,
  signal?: AbortSignal,
): Promise<ActionResponse> {
  return apiRequest<ActionResponse>(`/api/cases/${id}/actions`, {
    method: 'POST',
    body: note.trim() === '' ? { action } : { action, note: note.trim() },
    analystId,
    signal,
  });
}
