import type { ApiError } from './types';

export interface ApiCredential {
  token: string;
  signal: AbortSignal;
  expectedAnalystId?: string;
}

export type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

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

export async function apiFetch<T>(
  path: string,
  credential: ApiCredential | null,
  init: RequestInit = {},
): Promise<T> {
  if (credential?.signal.aborted || init.signal?.aborted)
    throw new DOMException('Request cancelled', 'AbortError');
  if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential.token))
    throw new ApiRequestError(
      'A valid access token is required. Please sign in.',
      401,
      'UNAUTHORIZED',
    );

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${credential.token}`);
  headers.delete('x-analyst-id');
  if (credential.expectedAnalystId) headers.set('x-analyst-id', credential.expectedAnalystId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const controller = new AbortController();
  const abort = () => controller.abort();
  const signals = [credential.signal, ...(init.signal ? [init.signal] : [])];
  signals.forEach((signal) => signal.addEventListener('abort', abort, { once: true }));
  const checkCancelled = () => {
    if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
  };
  try {
    let response: Response;
    let text: string;
    try {
      response = await fetch(path, {
        ...init,
        headers,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
      checkCancelled();
      text = await response.text();
      checkCancelled();
    } catch {
      checkCancelled();
      throw new ApiRequestError('API unreachable', 0, 'API_UNREACHABLE');
    }
    let body: unknown;
    try {
      body = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      body = undefined;
    }
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
  } finally {
    signals.forEach((signal) => signal.removeEventListener('abort', abort));
  }
}
