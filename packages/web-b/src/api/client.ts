import type { ApiError } from './types';

const ANALYST_KEY = 'kyc.analystId';

export function getAnalystId(): string {
  return localStorage.getItem(ANALYST_KEY) ?? 'ana-001';
}

export function setAnalystId(id: string): void {
  localStorage.setItem(ANALYST_KEY, id);
}

export class ApiRequestError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(message: string, status: number, code = 'API_ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-analyst-id', getAnalystId());
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiRequestError('API unreachable', 0, 'API_UNREACHABLE');
  }
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) as unknown : undefined; } catch { body = undefined; }
  if (!response.ok) {
    const errorBody = body as ApiError | undefined;
    throw new ApiRequestError(
      errorBody?.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      errorBody?.error?.code ?? 'API_ERROR',
      errorBody?.error?.details,
    );
  }
  return body as T;
}
