import type { CurrentAnalyst } from './types';
import { storeSession } from './sessionStorage';

export interface AuthenticatedIdentity {
  analyst: CurrentAnalyst;
  signal: AbortSignal;
}

let identity: AuthenticatedIdentity | null = null;
let accessToken: string | null = null;
let controller = new AbortController();
const listeners = new Set<() => void>();

export function getIdentity(): AuthenticatedIdentity | null {
  return identity;
}

export function subscribeIdentity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearIdentity(preserveStoredSession = false): void {
  controller.abort();
  controller = new AbortController();
  identity = null;
  accessToken = null;
  if (!preserveStoredSession) storeSession(null);
  listeners.forEach((listener) => listener());
}

export function beginAuthentication(preserveStoredSession = false): AbortSignal {
  clearIdentity(preserveStoredSession);
  return controller.signal;
}

export function completeAuthentication(
  analyst: CurrentAnalyst,
  token: string,
  signal: AbortSignal,
  persist = false,
): void {
  signal.throwIfAborted();
  if (signal !== controller.signal) throw new DOMException('Authentication cancelled', 'AbortError');
  identity = { analyst, signal };
  accessToken = token;
  if (persist) storeSession(token);
  listeners.forEach((listener) => listener());
}

export function credentialFor(analystId: string): { token: string; signal: AbortSignal } | null {
  return identity?.analyst.id === analystId && accessToken
    ? { token: accessToken, signal: identity.signal }
    : null;
}
