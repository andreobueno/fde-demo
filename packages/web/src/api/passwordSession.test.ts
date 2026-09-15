import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMe, restoreSession, signIn, signOut } from './client';
import { clearIdentity, getIdentity } from './identity';
import { storedSession } from './sessionStorage';
import type { CurrentAnalyst } from './types';

const fetchMock = vi.fn<typeof fetch>();
const token = 's'.repeat(43);
const otherToken = 'm'.repeat(43);
const analyst: CurrentAnalyst = {
  id: 'analyst', name: 'Fictional Analyst', role: 'analyst', permissions: ['cases:read'],
};
const manager: CurrentAnalyst = {
  id: 'manager', name: 'Fictional Manager', role: 'compliance_manager', permissions: ['policy:manage'],
};
const password = 'local-test-password';
let storage: Map<string, string>;
const login = (user = analyst, credential = token) => Response.json({
  analyst: user,
  session: { token: credential, expiresAt: '2026-12-01T00:00:00Z', idleTimeoutMs: 3600000 },
}, { status: 201 });

function useStorage(entries = new Map<string, string>()) {
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
    localStorage: { setItem: () => { throw new Error('Local storage must not be used'); } },
  });
  return entries;
}

beforeEach(() => {
  clearIdentity();
  storage = useStorage();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { clearIdentity(); vi.unstubAllGlobals(); });

describe('local password sessions', () => {
  it('uses normal credentials and stores only the issued token in this tab', async () => {
    fetchMock.mockResolvedValueOnce(login());
    await signIn('  analyst@example.test  ', password);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-in', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ email: 'analyst@example.test', password }),
      headers: { 'content-type': 'application/json' },
      credentials: 'omit', redirect: 'error',
    }));
    expect([...storage.values()]).toEqual([token]);
    expect(getIdentity()?.analyst).toEqual(analyst);
  });

  it.each([400, 401, 429, 500])('does not save credentials or a session after HTTP %s', async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'FAILED', message: 'Sign-in failed' } }, { status }));
    await expect(signIn('analyst@example.test', password)).rejects.toMatchObject({ status });
    expect(getIdentity()).toBeNull();
    expect(storage.size).toBe(0);
  });

  it('restores identity from the server after a refresh and reloads its current role', async () => {
    fetchMock.mockResolvedValueOnce(login());
    await signIn('analyst@example.test', password);
    clearIdentity(true);
    fetchMock.mockResolvedValueOnce(Response.json({ ...analyst, role: 'senior_analyst' }));
    const restoring = restoreSession();
    expect(getIdentity()).toBeNull();
    await restoring;
    expect(getIdentity()?.analyst.role).toBe('senior_analyst');
    expect(storedSession()).toBe(token);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/me', expect.objectContaining({
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    }));
  });

  it('removes expired sessions without rendering their previous identity', async () => {
    storage.set('operations.session', token);
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await restoreSession();
    expect(getIdentity()).toBeNull();
    expect(storedSession()).toBeNull();
  });

  it('preserves the token for retry on network errors without trusting it as identity', async () => {
    storage.set('operations.session', token);
    fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'));
    await expect(restoreSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(getIdentity()).toBeNull();
    expect(storedSession()).toBe(token);
  });

  it('revokes only the current session and discards the local view immediately', async () => {
    fetchMock.mockResolvedValueOnce(login());
    await signIn('analyst@example.test', password);
    const previous = getIdentity();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const leaving = signOut();
    expect(getIdentity()).toBeNull();
    expect(previous?.signal.aborted).toBe(true);
    expect(storedSession()).toBeNull();
    await leaving;
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/sign-out', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    }));
  });

  it('reports failed revocation rather than claiming the server session has ended', async () => {
    fetchMock.mockResolvedValueOnce(login());
    await signIn('analyst@example.test', password);
    fetchMock.mockRejectedValueOnce(new TypeError('Offline'));
    await expect(signOut()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(getIdentity()).toBeNull();
    expect(storedSession()).toBeNull();
  });

  it('does not let a pending logout clear a newer login', async () => {
    fetchMock.mockResolvedValueOnce(login());
    await signIn('analyst@example.test', password);
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    const leaving = signOut();
    fetchMock.mockResolvedValueOnce(login(manager, otherToken));
    await signIn('manager@example.test', password);
    respond(new Response(null, { status: 204 }));
    await leaving;
    expect(getIdentity()?.analyst).toEqual(manager);
    expect(storedSession()).toBe(otherToken);
  });

  it('discards and revokes a late password sign-in without changing a newer identity', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    const first = signIn('analyst@example.test', password);
    fetchMock.mockResolvedValueOnce(login(manager, otherToken));
    await signIn('manager@example.test', password);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    respond(login());
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(getIdentity()?.analyst).toEqual(manager);
    expect(storedSession()).toBe(otherToken);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/sign-out', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
    }));
  });

  it('isolates credentials in different origin/tab storage areas', async () => {
    fetchMock.mockResolvedValueOnce(login());
    await signIn('analyst@example.test', password);
    const firstOrigin = storage;
    clearIdentity(true);
    const secondOrigin = useStorage();
    fetchMock.mockResolvedValueOnce(login(manager, otherToken));
    await signIn('manager@example.test', password);
    expect([...secondOrigin.values()]).toEqual([otherToken]);
    expect([...firstOrigin.values()]).toEqual([token]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await signOut();
    expect([...firstOrigin.values()]).toEqual([token]);
    expect(secondOrigin.size).toBe(0);
    useStorage(firstOrigin);
    fetchMock.mockResolvedValueOnce(Response.json(analyst));
    await restoreSession();
    fetchMock.mockResolvedValueOnce(Response.json(analyst));
    await getMe(analyst.id);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/me', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
    }));
  });
});
