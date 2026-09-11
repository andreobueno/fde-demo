import type {
  ActionResponse,
  Analyst,
  ApiErrorBody,
  CaseAction,
  CaseDetail,
  CaseListResponse,
  CaseStats,
  RiskExplanation,
} from './types.js';
import type { QueueFilters } from '../lib/filters.js';
import { filtersToApiQuery } from '../lib/filters.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super('The KYC API is unreachable');
    this.name = 'ApiUnreachableError';
    this.cause = cause;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClient {
  analysts(): Promise<Analyst[]>;
  me(analystId: string): Promise<Analyst>;
  stats(): Promise<CaseStats>;
  listCases(filters: QueueFilters): Promise<CaseListResponse>;
  getCase(id: string): Promise<CaseDetail>;
  riskExplanation(id: string): Promise<RiskExplanation>;
  performAction(
    id: string,
    analystId: string,
    action: CaseAction,
    note: string | undefined,
  ): Promise<ActionResponse>;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

export function createApiClient(baseUrl: string, fetchImpl: FetchLike = fetch): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, init);
    } catch (cause) {
      throw new ApiUnreachableError(cause);
    }
    const text = await res.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!res.ok) {
      if (isApiErrorBody(body)) {
        throw new ApiError(res.status, body.error.code, body.error.message);
      }
      throw new ApiError(res.status, 'HTTP_ERROR', `API responded with HTTP ${res.status}`);
    }
    return body as T;
  }

  return {
    analysts: () => request<Analyst[]>('/api/analysts'),
    me: (analystId) => request<Analyst>('/api/me', { headers: { 'x-analyst-id': analystId } }),
    stats: () => request<CaseStats>('/api/cases/stats'),
    listCases: (filters) => {
      const qs = filtersToApiQuery(filters).toString();
      return request<CaseListResponse>(`/api/cases${qs ? `?${qs}` : ''}`);
    },
    getCase: (id) => request<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`),
    riskExplanation: (id) =>
      request<RiskExplanation>(`/api/cases/${encodeURIComponent(id)}/risk-explanation`),
    performAction: (id, analystId, action, note) =>
      request<ActionResponse>(`/api/cases/${encodeURIComponent(id)}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-analyst-id': analystId },
        body: JSON.stringify(note === undefined ? { action } : { action, note }),
      }),
  };
}
