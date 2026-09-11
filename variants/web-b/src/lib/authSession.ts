import type { QueryClient } from '@tanstack/react-query';
import { apiFetch, ApiRequestError, type ApiCredential, type ApiRequest } from '@/api/client';
import type { CurrentAnalyst } from '@/api/types';

export interface AuthState {
  status: 'signed_out' | 'signing_in' | 'authenticated';
  user: CurrentAnalyst | null;
  error: string | null;
  generation: number;
  request: ApiRequest;
}

const unauthenticatedRequest: ApiRequest = (path, init) => apiFetch(path, null, init);

function isCurrentAnalyst(value: unknown): value is CurrentAnalyst {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'name' in value &&
    typeof value.name === 'string' &&
    'role' in value &&
    (value.role === 'analyst' ||
      value.role === 'senior_analyst' ||
      value.role === 'compliance_manager') &&
    'permissions' in value &&
    Array.isArray(value.permissions) &&
    value.permissions.every((permission: unknown) => typeof permission === 'string')
  );
}

export class AuthSession {
  private state: AuthState = {
    status: 'signed_out',
    user: null,
    error: null,
    generation: 0,
    request: unauthenticatedRequest,
  };
  private active: { credential: ApiCredential; controller: AbortController } | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private queryClient: QueryClient,
    private clearFeedback: () => void,
  ) {}

  getSnapshot = (): AuthState => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(state: AuthState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  signOut = (error: string | null = null) => {
    if (this.active) {
      this.active.controller.abort();
      this.active.credential.token = '';
      this.active = null;
    }
    void this.queryClient.cancelQueries();
    this.queryClient.clear();
    this.clearFeedback();
    this.publish({
      status: 'signed_out',
      user: null,
      error,
      generation: this.state.generation + 1,
      request: unauthenticatedRequest,
    });
  };

  signIn = async (token: string, expectedAnalystId?: string): Promise<void> => {
    this.signOut();
    const controller = new AbortController();
    const credential: ApiCredential = {
      token,
      signal: controller.signal,
      ...(expectedAnalystId ? { expectedAnalystId } : {}),
    };
    const active = { credential, controller };
    this.active = active;
    this.publish({ ...this.state, status: 'signing_in' });

    const request: ApiRequest = async <T>(path: string, init?: RequestInit) => {
      try {
        const result = await apiFetch<T>(path, credential, init);
        if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
        return result;
      } catch (error) {
        if (
          this.active === active &&
          this.state.status === 'authenticated' &&
          error instanceof ApiRequestError &&
          error.status === 401
        ) {
          this.signOut('Your access token has expired or been revoked. Please sign in again.');
        }
        throw error;
      }
    };

    try {
      const user = await request<unknown>('/api/me');
      if (this.active !== active) return;
      if (!isCurrentAnalyst(user))
        throw new ApiRequestError('Unable to verify the current identity.', 502);
      if (expectedAnalystId && user.id !== expectedAnalystId)
        throw new ApiRequestError('The token does not match the expected identity.', 403);
      credential.expectedAnalystId = user.id;
      this.publish({ ...this.state, status: 'authenticated', user, request });
    } catch (error) {
      if (this.active !== active) return;
      this.signOut(
        error instanceof ApiRequestError && error.status === 401
          ? 'The access token is invalid, expired, or revoked. Ask an administrator for a token.'
          : error instanceof ApiRequestError && error.status === 403
            ? 'The token does not match the expected identity. Sign in with the correct token.'
            : 'Unable to verify your identity. Check the API connection and try again.',
      );
    }
  };
}
