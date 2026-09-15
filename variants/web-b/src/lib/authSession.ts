import type { QueryClient } from '@tanstack/react-query';
import {
  apiFetch,
  ApiRequestError,
  isSessionToken,
  signInRequest,
  type ApiCredential,
  type ApiRequest,
} from '@/api/client';
import type { CurrentAnalyst } from '@/api/types';

export interface AuthState {
  status: 'signed_out' | 'signing_in' | 'restoring' | 'authenticated';
  user: CurrentAnalyst | null;
  error: string | null;
  generation: number;
  request: ApiRequest;
}

const unauthenticatedRequest: ApiRequest = (path, init) => apiFetch(path, null, init);
export const SESSION_STORAGE_KEY = 'kyc.web-b.session';
type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ActiveSession = { credential: ApiCredential; controller: AbortController };

function browserStorage(): SessionStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function sessionToken(value: unknown): string | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    'session' in value &&
    typeof value.session === 'object' &&
    value.session !== null &&
    'token' in value.session &&
    isSessionToken(value.session.token)
  )
    return value.session.token;
  return null;
}

function isSignInResponse(
  value: unknown,
): value is { analyst: CurrentAnalyst; session: { token: string } } {
  return (
    sessionToken(value) !== null &&
    typeof value === 'object' &&
    value !== null &&
    'analyst' in value &&
    isCurrentAnalyst(value.analyst) &&
    'session' in value &&
    typeof value.session === 'object' &&
    value.session !== null &&
    'expiresAt' in value.session &&
    typeof value.session.expiresAt === 'string' &&
    Number.isFinite(Date.parse(value.session.expiresAt)) &&
    'idleTimeoutMs' in value.session &&
    typeof value.session.idleTimeoutMs === 'number' &&
    Number.isFinite(value.session.idleTimeoutMs) &&
    value.session.idleTimeoutMs > 0
  );
}

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
    status: 'restoring',
    user: null,
    error: null,
    generation: 0,
    request: unauthenticatedRequest,
  };
  private active: ActiveSession | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private queryClient: QueryClient,
    private clearFeedback: () => void,
    private storage: SessionStorage | null = browserStorage(),
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

  private readToken(): string | null {
    try {
      return this.storage?.getItem(SESSION_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private storeToken(token: string | null): boolean {
    try {
      if (!this.storage) return false;
      if (token) this.storage.setItem(SESSION_STORAGE_KEY, token);
      else this.storage.removeItem(SESSION_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  private clearLocal(error: string | null = null, preserveStorage = false) {
    if (this.active) {
      this.active.controller.abort();
      this.active.credential.token = '';
      this.active = null;
    }
    void this.queryClient.cancelQueries();
    this.queryClient.clear();
    this.clearFeedback();
    if (!preserveStorage) this.storeToken(null);
    this.publish({
      status: 'signed_out',
      user: null,
      error,
      generation: this.state.generation + 1,
      request: unauthenticatedRequest,
    });
  }

  dispose = () => {
    this.clearLocal(null, true);
    this.publish({ ...this.state, status: 'restoring' });
  };

  private revoke(token: string): Promise<unknown> {
    return apiFetch(
      '/api/auth/sign-out',
      { token, signal: AbortSignal.timeout(10_000) },
      {
        method: 'POST',
      },
    );
  }

  signOut = async (): Promise<void> => {
    const token = this.active?.credential.token || this.readToken();
    this.clearLocal(
      isSessionToken(token)
        ? 'Signed out in this tab. Confirming server session revocation…'
        : null,
    );
    const generation = this.state.generation;
    if (!isSessionToken(token)) return;
    let error: string | null = null;
    try {
      await this.revoke(token);
    } catch {
      error =
        'Signed out in this tab, but server session revocation could not be confirmed. The session may remain active until it expires.';
    }
    if (this.state.generation === generation) this.publish({ ...this.state, error });
  };

  private start(token = ''): ActiveSession {
    const controller = new AbortController();
    const credential: ApiCredential = {
      token,
      signal: controller.signal,
    };
    const active = { credential, controller };
    this.active = active;
    return active;
  }

  private authenticate(active: ActiveSession, user: CurrentAnalyst) {
    const { credential, controller } = active;
    credential.expectedAnalystId = user.id;
    const persisted = this.storeToken(credential.token);
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
          this.clearLocal('Your session has expired or been revoked. Please sign in again.');
        }
        throw error;
      }
    };
    this.publish({
      ...this.state,
      status: 'authenticated',
      user,
      request,
      error: persisted
        ? null
        : 'Session storage is unavailable. Refreshing will require signing in again.',
    });
  }

  restore = async (): Promise<void> => {
    if (this.state.status !== 'restoring' || this.active) return;
    const token = this.readToken();
    if (!isSessionToken(token)) {
      this.clearLocal();
      return;
    }
    this.clearLocal(null, true);
    const active = this.start(token);
    this.publish({ ...this.state, status: 'restoring' });
    try {
      const user = await apiFetch<unknown>('/api/me', active.credential);
      if (this.active !== active) return;
      if (!isCurrentAnalyst(user))
        throw new ApiRequestError('Unable to verify the current identity.', 502);
      this.authenticate(active, user);
    } catch (error) {
      if (this.active !== active) return;
      this.clearLocal(
        error instanceof ApiRequestError && error.status === 401
          ? 'Your session has expired or been revoked. Please sign in again.'
          : 'Unable to verify your identity. Check the API connection and sign in again.',
      );
    }
  };

  signIn = async (email: string, password: string): Promise<void> => {
    const previousToken = this.active?.credential.token || this.readToken();
    this.clearLocal();
    const active = this.start();
    this.publish({ ...this.state, status: 'signing_in' });
    if (isSessionToken(previousToken)) void this.revoke(previousToken).catch(() => {});
    try {
      const response = await signInRequest(email.trim(), password, active.controller.signal);
      const token = sessionToken(response);
      if (this.active !== active || !isSignInResponse(response)) {
        if (token) void this.revoke(token).catch(() => {});
        if (this.active !== active) return;
        throw new ApiRequestError('Unable to verify the current identity.', 502);
      }
      active.credential.token = response.session.token;
      this.authenticate(active, response.analyst);
    } catch (error) {
      if (this.active !== active) return;
      this.clearLocal(
        error instanceof ApiRequestError && error.status === 401
          ? 'Incorrect email or password.'
          : error instanceof ApiRequestError && error.status === 400
            ? 'Enter a valid email address and password.'
            : error instanceof ApiRequestError && error.status === 429
              ? 'Too many sign-in attempts. Wait a few minutes and try again.'
              : error instanceof ApiRequestError && error.code === 'LOCAL_AUTH_DISABLED'
                ? 'Local demo sign-in is disabled. For local development, start the API with npm run dev:server. This authentication mode is not available in production.'
                : 'Unable to verify your identity. Check the API connection and try again.',
      );
    }
  };
}
