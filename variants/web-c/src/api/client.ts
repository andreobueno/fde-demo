import type {
  ActionResponse,
  Analyst,
  AuthenticatedAnalyst,
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
  analysts(accessToken: string): Promise<Analyst[]>;
  me(accessToken: string): Promise<AuthenticatedAnalyst>;
  stats(accessToken: string): Promise<CaseStats>;
  listCases(filters: QueueFilters, accessToken: string): Promise<CaseListResponse>;
  getCase(id: string, accessToken: string): Promise<CaseDetail>;
  riskExplanation(id: string, accessToken: string): Promise<RiskExplanation>;
  performAction(
    id: string,
    accessToken: string,
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
  async function request<T>(
    path: string,
    accessToken: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${accessToken}` },
      });
    } catch (cause) {
      throw new ApiUnreachableError(cause);
    }
    if (res.status === 401) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in with a valid access token.');
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
        throw new ApiError(res.status, body.error.code, body.error.message.replaceAll(accessToken, '[redacted]'));
      }
      throw new ApiError(res.status, 'HTTP_ERROR', `API responded with HTTP ${res.status}`);
    }
    return body as T;
  }

  return {
    analysts: (accessToken) => request<Analyst[]>('/api/analysts', accessToken),
    me: (accessToken) => request<AuthenticatedAnalyst>('/api/me', accessToken),
    stats: (accessToken) => request<CaseStats>('/api/cases/stats', accessToken),
    listCases: (filters, accessToken) => {
      const qs = filtersToApiQuery(filters).toString();
      return request<CaseListResponse>(`/api/cases${qs ? `?${qs}` : ''}`, accessToken);
    },
    getCase: (id, accessToken) => request<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`, accessToken),
    riskExplanation: (id, accessToken) =>
      request<RiskExplanation>(`/api/cases/${encodeURIComponent(id)}/risk-explanation`, accessToken),
    performAction: (id, accessToken, action, note) =>
      request<ActionResponse>(`/api/cases/${encodeURIComponent(id)}/actions`, accessToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(note === undefined ? { action } : { action, note }),
      }),
  };
}
