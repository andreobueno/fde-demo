import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAnalyst } from '@/api/types';
import { AuthSession } from './authSession';

const token = 'a'.repeat(43);
const otherToken = 'b'.repeat(43);
const user: CurrentAnalyst = {
  id: 'ana-006',
  name: 'Sofia Chen',
  role: 'compliance_manager',
  permissions: ['cases:read', 'policy:manage'],
};
const otherUser: CurrentAnalyst = {
  id: 'ana-003',
  name: 'Grete Lindholm',
  role: 'analyst',
  permissions: ['cases:read'],
};
const fetchMock = vi.fn<typeof fetch>();
const clearFeedback = vi.fn();
let queryClient: QueryClient;
let session: AuthSession;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => Response.json(user));
  clearFeedback.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  session = new AuthSession(queryClient, clearFeedback);
});

afterEach(() => {
  session.signOut();
  vi.unstubAllGlobals();
});

describe('in-memory authenticated sessions', () => {
  it('starts signed out without requesting any API or using a default actor', async () => {
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    await expect(session.getSnapshot().request('/api/analysts')).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not allow directory or case requests while identity verification is pending', async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const login = session.signIn(token);
    expect(session.getSnapshot()).toMatchObject({ status: 'signing_in', user: null });
    await expect(session.getSnapshot().request('/api/cases')).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/me');
    response.resolve(Response.json(user));
    await login;
    expect(session.getSnapshot().status).toBe('authenticated');
  });

  it.each(['analyst', 'senior_analyst', 'compliance_manager'] as const)(
    'resolves the %s role and permissions only from /api/me',
    async (role) => {
      const current = { ...user, role };
      fetchMock.mockResolvedValueOnce(Response.json(current));
      await session.signIn(token);
      expect(session.getSnapshot().user).toEqual(current);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe('/api/me');
      const loginHeaders = new Headers(fetchMock.mock.calls[0]![1]?.headers);
      expect(loginHeaders.get('Authorization')).toBe(`Bearer ${token}`);
      expect(loginHeaders.has('x-analyst-id')).toBe(false);
      fetchMock.mockResolvedValueOnce(Response.json([otherUser]));
      await session.getSnapshot().request('/api/analysts');
      expect(session.getSnapshot().user).toEqual(current);
      const headers = new Headers(fetchMock.mock.calls[1]![1]?.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ${token}`);
      expect(headers.get('x-analyst-id')).toBe(current.id);
    },
  );

  it.each([
    null,
    {},
    { ...user, id: '' },
    { ...user, role: 'owner' },
    { ...user, permissions: null },
  ])('refuses an unverifiable identity (%j)', async (body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));
    await session.signIn(token);
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    expect(session.getSnapshot().error).toContain('Unable to verify');
  });

  it('rejects an invalid token with a useful error and no identity fallback', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, { status: 401 }),
    );
    await session.signIn(token);
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    expect(session.getSnapshot().error).toContain('invalid, expired, or revoked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can retry a rejected login with another administrator-provisioned token', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await session.signIn(token);
    fetchMock.mockResolvedValueOnce(Response.json(otherUser));
    await session.signIn(otherToken);
    expect(session.getSnapshot()).toMatchObject({
      status: 'authenticated',
      user: otherUser,
      error: null,
    });
  });

  it.each([403, 200])(
    'fails closed on an expected identity mismatch (status %s)',
    async (status) => {
      fetchMock.mockResolvedValueOnce(Response.json(status === 200 ? otherUser : {}, { status }));
      await session.signIn(token, user.id);
      expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('x-analyst-id')).toBe(user.id);
      expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
      expect(session.getSnapshot().error).toContain('does not match');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('ignores late login success after sign-out even if transport ignores cancellation', async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const login = session.signIn(token);
    session.signOut();
    response.resolve(Response.json(user));
    await login;
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null, error: null });
  });

  it.each([200, 401])(
    'does not let an older login replace a newer login (status %s)',
    async (status) => {
      const response = deferred<Response>();
      fetchMock.mockReturnValueOnce(response.promise);
      const oldLogin = session.signIn(token);
      fetchMock.mockResolvedValueOnce(Response.json(otherUser));
      await session.signIn(otherToken);
      response.resolve(Response.json(user, { status }));
      await oldLogin;
      expect(session.getSnapshot()).toMatchObject({
        status: 'authenticated',
        user: otherUser,
        error: null,
      });
    },
  );

  it('clears identity, queries, mutations, and feedback when signing out', async () => {
    await session.signIn(token);
    queryClient.setQueryData(['cases'], { customer: 'Private customer' });
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async (note: string) => ({ note }),
    });
    await mutation.execute('Private case note');
    const oldRequest = session.getSnapshot().request;
    const generation = session.getSnapshot().generation;
    clearFeedback.mockClear();
    session.signOut();
    expect(session.getSnapshot()).toMatchObject({
      status: 'signed_out',
      user: null,
      generation: generation + 1,
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(clearFeedback).toHaveBeenCalledOnce();
    await expect(
      oldRequest('/api/cases/case-001/actions', { method: 'POST' }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears old user state immediately when a new token is submitted', async () => {
    await session.signIn(token);
    const oldRequest = session.getSnapshot().request;
    const generation = session.getSnapshot().generation;
    queryClient.setQueryData(['case', 'case-001'], { allowedActions: ['approve'] });
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const login = session.signIn(otherToken);
    expect(session.getSnapshot()).toMatchObject({
      status: 'signing_in',
      user: null,
      generation: generation + 1,
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    await expect(oldRequest('/api/cases')).rejects.toMatchObject({ name: 'AbortError' });
    response.resolve(Response.json(otherUser));
    await login;
    expect(session.getSnapshot().user).toEqual(otherUser);
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Authorization')).toBe(
      `Bearer ${otherToken}`,
    );
  });

  it('cancels pending reads and writes and never restores their cache or success callbacks', async () => {
    await session.signIn(token);
    const request = session.getSnapshot().request;
    const readResponse = deferred<Response>();
    const writeResponse = deferred<Response>();
    const writeStarted = deferred<void>();
    fetchMock.mockReturnValueOnce(readResponse.promise).mockImplementationOnce(() => {
      writeStarted.resolve();
      return writeResponse.promise;
    });
    const read = queryClient.fetchQuery({
      queryKey: ['cases'],
      queryFn: ({ signal }) => request('/api/cases', { signal }),
    });
    const readResult = read.catch((error: unknown) => error);
    const onSuccess = vi.fn();
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => request('/api/cases/case-001/actions', { method: 'POST' }),
      onSuccess,
    });
    const write = mutation.execute(undefined);
    const writeResult = write.catch((error: unknown) => error);
    await writeStarted.promise;
    session.signOut();
    expect(fetchMock.mock.calls[1]![1]?.signal?.aborted).toBe(true);
    expect(fetchMock.mock.calls[2]![1]?.signal?.aborted).toBe(true);
    readResponse.resolve(Response.json({ items: ['Private case'] }));
    writeResponse.resolve(Response.json({ allowedActions: ['approve'] }));
    await readResult;
    expect(await writeResult).toMatchObject({ name: 'AbortError' });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('signs out and clears both caches on expiry or revocation without retrying', async () => {
    await session.signIn(token);
    queryClient.setQueryData(['cases'], { customer: 'Private customer' });
    queryClient.getMutationCache().build(queryClient, { mutationFn: async () => 'private note' });
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await expect(session.getSnapshot().request('/api/cases')).rejects.toMatchObject({
      status: 401,
    });
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    expect(session.getSnapshot().error).toContain('expired or been revoked');
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale request failure sign out a newer identity', async () => {
    await session.signIn(token);
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const oldRequest = session.getSnapshot().request('/api/cases');
    fetchMock.mockResolvedValueOnce(Response.json(otherUser));
    await session.signIn(otherToken);
    response.resolve(Response.json({}, { status: 401 }));
    await expect(oldRequest).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.getSnapshot()).toMatchObject({
      status: 'authenticated',
      user: otherUser,
      error: null,
    });
  });

  it('keeps the verified identity on a forbidden business action, without switching actors', async () => {
    await session.signIn(token);
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 403 }));
    await expect(
      session.getSnapshot().request('/api/cases/case-001/actions', { method: 'POST' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(session.getSnapshot()).toMatchObject({ status: 'authenticated', user });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never persists a token or identity and requires sign-in for a fresh instance', async () => {
    const storage = { getItem: vi.fn(() => token), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    await session.signIn(token);
    expect(JSON.stringify(session.getSnapshot())).not.toContain(token);
    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(token);
    const freshSession = new AuthSession(queryClient, clearFeedback);
    expect(freshSession.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    session.signOut();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('reports network failures without leaking server response text into sign-in errors', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: token } }, { status: 500 }));
    await session.signIn(token);
    expect(session.getSnapshot().error).toContain('Check the API connection');
    expect(session.getSnapshot().error).not.toContain(token);
  });
});
