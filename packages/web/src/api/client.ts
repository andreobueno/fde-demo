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
import { beginAuthentication, clearIdentity, completeAuthentication, credentialFor, getIdentity } from './identity';
import { storedSession } from './sessionStorage';
import { DEMO_USERS } from './demoUsers';

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
  const credential = credentialFor(options.analystId);
  if (!credential) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  }
  const signal = AbortSignal.any([credential.signal, ...(options.signal ? [options.signal] : [])]);
  try {
    return await request<T>(path, credential.token, signal, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && !credential.signal.aborted) clearIdentity();
    throw error;
  }
}

export async function authenticateAccessToken(token: string, signal?: AbortSignal): Promise<CurrentAnalyst> {
  signal?.throwIfAborted();
  const trimmed = token.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(trimmed)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Enter a valid access token provided by your administrator.');
  }
  const authentication = beginAuthentication();
  const combined = AbortSignal.any([authentication, ...(signal ? [signal] : [])]);
  const analyst = await request<CurrentAnalyst>('/api/me', trimmed, combined);
  combined.throwIfAborted();
  completeAuthentication(analyst, trimmed, authentication);
  return analyst;
}

interface SignInResponse {
  analyst: CurrentAnalyst;
  session: { token: string; expiresAt: string; idleTimeoutMs: number };
}

async function establishPasswordSession(
  email: string,
  password: string,
  signal?: AbortSignal,
  verifySession = false,
): Promise<void> {
  signal?.throwIfAborted();
  const authentication = beginAuthentication();
  const combined = AbortSignal.any([authentication, ...(signal ? [signal] : [])]);
  const result = await request<SignInResponse>(
    '/api/auth/sign-in', '', new AbortController().signal,
    { method: 'POST', body: { email: email.trim(), password } },
  );
  if (combined.aborted) {
    void revokeSession(result.session.token).catch(() => undefined);
    combined.throwIfAborted();
  }
  try {
    const analyst = verifySession
      ? await request<CurrentAnalyst>('/api/me', result.session.token, combined)
      : result.analyst;
    completeAuthentication(analyst, result.session.token, authentication, true);
  } catch (error) {
    await revokeSession(result.session.token).catch(() => undefined);
    throw error;
  }
}

export function signIn(email: string, password: string, signal?: AbortSignal): Promise<void> {
  return establishPasswordSession(email, password, signal);
}

export function signInDemoUser(userId: string, signal?: AbortSignal): Promise<void> {
  if (!import.meta.env.DEV) {
    return Promise.reject(new ApiError(404, 'LOCAL_AUTH_DISABLED', 'Mock-user sign-in is available only in local development.'));
  }
  const user = DEMO_USERS.find(({ id }) => id === userId);
  if (!user) {
    return Promise.reject(new ApiError(400, 'VALIDATION_ERROR', 'Choose a valid mock user.'));
  }
  return establishPasswordSession(user.email, 'demo-password-2026', signal, true);
}

export async function restoreSession(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const token = storedSession();
  if (!token) return;
  const authentication = beginAuthentication(true);
  const combined = AbortSignal.any([authentication, ...(signal ? [signal] : [])]);
  try {
    const analyst = await request<CurrentAnalyst>('/api/me', token, combined);
    completeAuthentication(analyst, token, authentication, true);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && !combined.aborted) {
      clearIdentity();
      return;
    }
    throw error;
  }
}

function revokeSession(token: string): Promise<void> {
  return request<void>('/api/auth/sign-out', token, new AbortController().signal, { method: 'POST' });
}

export async function signOut(): Promise<void> {
  const identity = getIdentity();
  const token = identity ? credentialFor(identity.analyst.id)?.token : null;
  clearIdentity();
  if (token) await revokeSession(token);
}

async function request<T>(
  path: string,
  token: string,
  signal: AbortSignal,
  options: Partial<ApiRequestOptions> = {},
): Promise<T> {
  signal.throwIfAborted();
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.analystId ? { 'x-analyst-id': options.analystId } : {}),
  };

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
      signal,
      credentials: 'omit',
      redirect: 'error',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the API server');
  }

  signal.throwIfAborted();
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

  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as T;
  signal.throwIfAborted();
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
