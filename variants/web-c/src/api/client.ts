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
  SignInResponse,
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
  signIn(email: string, password: string): Promise<SignInResponse>;
  signOut(accessToken: string): Promise<void>;
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
    expectedAnalystId?: string,
  ): Promise<ActionResponse>;
}

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function isAuthenticatedAnalyst(value: unknown): value is AuthenticatedAnalyst {
  if (typeof value !== 'object' || value === null) return false;
  const actor = value as Partial<AuthenticatedAnalyst>;
  return typeof actor.id === 'string' && actor.id.length > 0 &&
    typeof actor.name === 'string' && actor.name.length > 0 &&
    ['analyst', 'senior_analyst', 'compliance_manager'].includes(actor.role ?? '') &&
    Array.isArray(actor.permissions) && actor.permissions.every((permission: unknown) => typeof permission === 'string');
}

function isSignInResponse(value: unknown): value is SignInResponse {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<SignInResponse>;
  const session = result.session;
  return isAuthenticatedAnalyst(result.analyst) &&
    typeof session === 'object' && session !== null &&
    typeof session.token === 'string' && SESSION_TOKEN_PATTERN.test(session.token) &&
    typeof session.expiresAt === 'string' && Date.parse(session.expiresAt) > Date.now() &&
    Number.isSafeInteger(session.idleTimeoutMs) && session.idleTimeoutMs > 0;
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
    accessToken: string | undefined,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
    expectedStatus?: number,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      });
    } catch (cause) {
      throw new ApiUnreachableError(cause);
    }
    if (res.status === 401) {
      throw new ApiError(401, accessToken ? 'UNAUTHORIZED' : 'INVALID_CREDENTIALS',
        accessToken ? 'Your session has ended. Please sign in again.' : 'Incorrect email or password.');
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
      if (accessToken && isApiErrorBody(body)) {
        throw new ApiError(res.status, body.error.code, body.error.message.replaceAll(accessToken, '[redacted]'));
      }
      throw new ApiError(res.status, 'HTTP_ERROR', `API responded with HTTP ${res.status}`);
    }
    if (expectedStatus !== undefined && res.status !== expectedStatus) {
      throw new ApiError(502, 'INVALID_RESPONSE', 'The API returned an invalid response.');
    }
    return body as T;
  }

  return {
    signIn: async (email, password) => {
      const body = await request<unknown>('/api/auth/sign-in', undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }, 201);
      if (!isSignInResponse(body)) {
        throw new ApiError(502, 'INVALID_RESPONSE', 'The API returned an invalid session.');
      }
      return body;
    },
    signOut: (accessToken) => request<void>('/api/auth/sign-out', accessToken, { method: 'POST' }, 204),
    analysts: (accessToken) => request<Analyst[]>('/api/analysts', accessToken),
    me: async (accessToken) => {
      const actor = await request<unknown>('/api/me', accessToken);
      if (!isAuthenticatedAnalyst(actor)) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Your session has ended. Please sign in again.');
      }
      return actor;
    },
    stats: (accessToken) => request<CaseStats>('/api/cases/stats', accessToken),
    listCases: (filters, accessToken) => {
      const qs = filtersToApiQuery(filters).toString();
      return request<CaseListResponse>(`/api/cases${qs ? `?${qs}` : ''}`, accessToken);
    },
    getCase: (id, accessToken) => request<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`, accessToken),
    riskExplanation: (id, accessToken) =>
      request<RiskExplanation>(`/api/cases/${encodeURIComponent(id)}/risk-explanation`, accessToken),
    performAction: (id, accessToken, action, note, expectedAnalystId) =>
      request<ActionResponse>(`/api/cases/${encodeURIComponent(id)}/actions`, accessToken, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(expectedAnalystId ? { 'x-analyst-id': expectedAnalystId } : {}),
        },
        body: JSON.stringify(note === undefined ? { action } : { action, note }),
      }),
  };
}
