import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAnalyst } from '@/api/types';
import { AuthSession, SESSION_STORAGE_KEY } from './authSession';

const token = 'a'.repeat(43);
const otherToken = 'b'.repeat(43);
const email = 'sofia.chen@northwind-demo.example';
const password = 'demo-password-2026';
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
let storage: ReturnType<typeof mockStorage>;

function mockStorage(initial?: string) {
  const values = new Map<string, string>(initial ? [[SESSION_STORAGE_KEY, initial]] : []);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

function signedIn(analyst: unknown = user, issuedToken = token) {
  return {
    analyst,
    session: { token: issuedToken, expiresAt: '2099-01-01T00:00:00.000Z', idleTimeoutMs: 900_000 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function headers(index: number) {
  return new Headers(fetchMock.mock.calls[index]![1]?.headers);
}

beforeEach(async () => {
  fetchMock.mockReset().mockImplementation(async (path) => {
    if (path === '/api/auth/sign-out') return new Response(null, { status: 204 });
    if (path === '/api/auth/sign-in') return Response.json(signedIn(), { status: 201 });
    return Response.json(user);
  });
  clearFeedback.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  storage = mockStorage();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  session = new AuthSession(queryClient, clearFeedback, storage);
  await session.restore();
});

afterEach(() => {
  session.dispose();
  vi.unstubAllGlobals();
});

describe('password sessions', () => {
  it('starts signed out with no API requests or default actor when storage is empty', async () => {
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    await expect(session.getSnapshot().request('/api/analysts')).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks protected requests until the sign-in response is verified', async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const login = session.signIn(` ${email} `, password);
    expect(session.getSnapshot()).toMatchObject({ status: 'signing_in', user: null });
    await expect(session.getSnapshot().request('/api/cases')).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/auth/sign-in',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email, password }),
        credentials: 'omit',
        cache: 'no-store',
      }),
    ]);
    expect(headers(0).get('Content-Type')).toBe('application/json');
    expect(headers(0).has('Authorization')).toBe(false);
    expect(headers(0).has('x-analyst-id')).toBe(false);
    response.resolve(Response.json(signedIn(), { status: 201 }));
    await login;
    expect(session.getSnapshot().status).toBe('authenticated');
  });

  it.each(['analyst', 'senior_analyst', 'compliance_manager'] as const)(
    'resolves %s and permissions only from the authentication server',
    async (role) => {
      const current = { ...user, role, permissions: ['cases:read'] };
      fetchMock.mockResolvedValueOnce(Response.json(signedIn(current), { status: 201 }));
      await session.signIn(email, password);
      expect(session.getSnapshot().user).toEqual(current);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fetchMock.mockResolvedValueOnce(Response.json([otherUser]));
      await session.getSnapshot().request('/api/analysts');
      expect(session.getSnapshot().user).toEqual(current);
      expect(headers(1).get('Authorization')).toBe(`Bearer ${token}`);
      expect(headers(1).get('x-analyst-id')).toBe(current.id);
    },
  );

  it.each([
    null,
    {},
    { ...user, id: '' },
    { ...user, role: 'owner' },
    { ...user, permissions: null },
  ])('refuses an unverifiable identity and revokes the issued session (%j)', async (analyst) => {
    fetchMock.mockResolvedValueOnce(Response.json(signedIn(analyst), { status: 201 }));
    await session.signIn(email, password);
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    expect(session.getSnapshot().error).toContain('Unable to verify');
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/sign-out');
    expect(headers(1).get('Authorization')).toBe(`Bearer ${token}`);
  });

  it.each([
    {},
    { analyst: user },
    signedIn(user, 'ana-001'),
    { analyst: user, session: { token, expiresAt: 'not a date', idleTimeoutMs: 1 } },
    { analyst: user, session: { token, expiresAt: '2099-01-01', idleTimeoutMs: 0 } },
  ])('fails closed on a malformed session response (%j)', async (body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body, { status: 201 }));
    await session.signIn(email, password);
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it.each([
    [400, 'Enter a valid email address and password.'],
    [401, 'Incorrect email or password.'],
    [429, 'Too many sign-in attempts.'],
    [500, 'Check the API connection'],
  ] as const)(
    'handles status %s without leaking server error text or falling back',
    async (status, message) => {
      fetchMock.mockResolvedValueOnce(Response.json({ error: { message: token } }, { status }));
      await session.signIn(email, password);
      expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
      expect(session.getSnapshot().error).toContain(message);
      expect(session.getSnapshot().error).not.toContain(token);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('retries rejected credentials with another user', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await session.signIn(email, password);
    fetchMock.mockResolvedValueOnce(
      Response.json(signedIn(otherUser, otherToken), { status: 201 }),
    );
    await session.signIn('grete.lindholm@northwind-demo.example', password);
    expect(session.getSnapshot()).toMatchObject({
      status: 'authenticated',
      user: otherUser,
      error: null,
    });
  });

  it('explains explicitly disabled local authentication without exposing server response text', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'LOCAL_AUTH_DISABLED', message: token } }, { status: 404 }),
    );
    await session.signIn(email, password);
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    expect(session.getSnapshot().error).toContain('npm run dev:server');
    expect(session.getSnapshot().error).toContain('not available in production');
    expect(session.getSnapshot().error).not.toContain(token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('revokes a cancelled login token even when transport ignores cancellation', async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const login = session.signIn(email, password);
    await session.signOut();
    response.resolve(Response.json(signedIn(), { status: 201 }));
    await login;
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/sign-out');
    expect(headers(1).get('Authorization')).toBe(`Bearer ${token}`);
    expect(fetchMock.mock.calls[1]![1]?.signal?.aborted).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null, error: null });
  });

  it('revokes an orphan when cancellation occurs while reading the login body', async () => {
    const body = deferred<string>();
    const response = Response.json({});
    vi.spyOn(response, 'text').mockReturnValue(body.promise);
    fetchMock.mockResolvedValueOnce(response);
    const login = session.signIn(email, password);
    await Promise.resolve();
    await session.signOut();
    body.resolve(JSON.stringify(signedIn()));
    await login;
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/sign-out');
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it.each([201, 401])(
    'ignores an older login after a newer sign-in (status %s)',
    async (status) => {
      const response = deferred<Response>();
      fetchMock.mockReturnValueOnce(response.promise);
      const oldLogin = session.signIn(email, password);
      fetchMock.mockResolvedValueOnce(
        Response.json(signedIn(otherUser, otherToken), { status: 201 }),
      );
      await session.signIn('grete.lindholm@northwind-demo.example', password);
      response.resolve(Response.json(status === 201 ? signedIn() : {}, { status }));
      await oldLogin;
      expect(session.getSnapshot()).toMatchObject({
        status: 'authenticated',
        user: otherUser,
        error: null,
      });
      expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(otherToken);
      if (status === 201) expect(headers(2).get('Authorization')).toBe(`Bearer ${token}`);
    },
  );

  it('clears old user state immediately when another login is submitted', async () => {
    await session.signIn(email, password);
    const oldRequest = session.getSnapshot().request;
    const generation = session.getSnapshot().generation;
    queryClient.setQueryData(['case', 'case-001'], { allowedActions: ['approve'] });
    const response = deferred<Response>();
    fetchMock.mockImplementation(async (path) =>
      path === '/api/auth/sign-in' ? response.promise : new Response(null, { status: 204 }),
    );
    const login = session.signIn('grete.lindholm@northwind-demo.example', password);
    expect(session.getSnapshot()).toMatchObject({
      status: 'signing_in',
      user: null,
      generation: generation + 1,
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    await expect(oldRequest('/api/cases')).rejects.toMatchObject({ name: 'AbortError' });
    response.resolve(Response.json(signedIn(otherUser, otherToken), { status: 201 }));
    await login;
    expect(session.getSnapshot().user).toEqual(otherUser);
  });
});

describe('sessionStorage restoration and isolation', () => {
  it('stores only the token, never localStorage, identity, password, or query data', async () => {
    const local = mockStorage();
    vi.stubGlobal('localStorage', local);
    await session.signIn(email, password);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY, token);
    expect(JSON.stringify(session.getSnapshot())).not.toContain(token);
    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(token);
    expect(local.getItem).not.toHaveBeenCalled();
    expect(local.setItem).not.toHaveBeenCalled();
    expect(local.removeItem).not.toHaveBeenCalled();
  });

  it('restores on refresh using /api/me before exposing protected content', async () => {
    await session.signIn(email, password);
    session.dispose();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(token);
    const fresh = new AuthSession(queryClient, clearFeedback, storage);
    queryClient.setQueryData(['cases'], { customer: 'Previously cached customer' });
    queryClient.getMutationCache().build(queryClient, { mutationFn: async () => 'Previous note' });
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const restoring = fresh.restore();
    expect(fresh.getSnapshot()).toMatchObject({ status: 'restoring', user: null });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    await expect(fresh.getSnapshot().request('/api/cases')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/me');
    expect(headers(1).get('Authorization')).toBe(`Bearer ${token}`);
    expect(headers(1).has('x-analyst-id')).toBe(false);
    response.resolve(Response.json(otherUser));
    await restoring;
    expect(fresh.getSnapshot().user).toEqual(otherUser);
    await fresh.getSnapshot().request('/api/cases');
    expect(headers(2).get('x-analyst-id')).toBe(otherUser.id);
    fresh.dispose();
  });

  it.each([401, 403, 500, 200])(
    'fails closed on invalid restoration (status %s)',
    async (status) => {
      const saved = mockStorage(token);
      const fresh = new AuthSession(queryClient, clearFeedback, saved);
      fetchMock.mockResolvedValueOnce(Response.json({}, { status }));
      await fresh.restore();
      expect(fresh.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
      expect(fresh.getSnapshot().error).toBeTruthy();
      expect(saved.getItem(SESSION_STORAGE_KEY)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['ana-001', JSON.stringify(user), 'x'.repeat(44)])(
    'never trusts stored actor data (%s)',
    async (saved) => {
      const fresh = new AuthSession(queryClient, clearFeedback, mockStorage(saved));
      await fresh.restore();
      expect(fresh.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([200, 401])(
    'does not allow a stale restoration to replace a newer session (%s)',
    async (status) => {
      storage.setItem(SESSION_STORAGE_KEY, token);
      session.dispose();
      const response = deferred<Response>();
      fetchMock.mockReturnValueOnce(response.promise);
      const restoring = session.restore();
      fetchMock.mockImplementation(async (path) =>
        path === '/api/auth/sign-in'
          ? Response.json(signedIn(otherUser, otherToken), { status: 201 })
          : new Response(null, { status: 204 }),
      );
      await session.signIn('grete.lindholm@northwind-demo.example', password);
      response.resolve(Response.json(user, { status }));
      await restoring;
      expect(session.getSnapshot()).toMatchObject({
        status: 'authenticated',
        user: otherUser,
        error: null,
      });
      expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(otherToken);
    },
  );

  it('can restart restoration after StrictMode cleanup without removing the stored session', async () => {
    storage.setItem(SESSION_STORAGE_KEY, token);
    session.dispose();
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const first = session.restore();
    session.dispose();
    await session.restore();
    response.resolve(Response.json(otherUser));
    await first;
    expect(session.getSnapshot().user).toEqual(user);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(token);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/me', '/api/me']);
  });

  it('keeps separately stored tab/port sessions independent when one signs out', async () => {
    await session.signIn(email, password);
    const secondStorage = mockStorage(otherToken);
    const second = new AuthSession(new QueryClient(), vi.fn(), secondStorage);
    fetchMock.mockResolvedValueOnce(Response.json(otherUser));
    await second.restore();
    await session.signOut();
    expect(second.getSnapshot()).toMatchObject({ status: 'authenticated', user: otherUser });
    expect(secondStorage.getItem(SESSION_STORAGE_KEY)).toBe(otherToken);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(headers(2).get('Authorization')).toBe(`Bearer ${token}`);
    second.dispose();
  });

  it('reports unavailable storage while allowing a verified in-memory session', async () => {
    storage.setItem.mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    await session.signIn(email, password);
    expect(session.getSnapshot()).toMatchObject({ status: 'authenticated', user });
    expect(session.getSnapshot().error).toContain('Refreshing will require signing in again');
  });
});

describe('revocation and protected request boundaries', () => {
  it('clears identity, storage, queries, mutations, and feedback before revocation completes', async () => {
    await session.signIn(email, password);
    queryClient.setQueryData(['cases'], { customer: 'Private customer' });
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async (note: string) => ({ note }),
    });
    await mutation.execute('Private case note');
    const oldRequest = session.getSnapshot().request;
    const generation = session.getSnapshot().generation;
    clearFeedback.mockClear();
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const logout = session.signOut();
    expect(session.getSnapshot()).toMatchObject({
      status: 'signed_out',
      user: null,
      generation: generation + 1,
    });
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(clearFeedback).toHaveBeenCalledOnce();
    await expect(
      oldRequest('/api/cases/case-001/actions', { method: 'POST' }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/sign-out');
    expect(fetchMock.mock.calls[1]![1]?.method).toBe('POST');
    expect(headers(1).get('Authorization')).toBe(`Bearer ${token}`);
    expect(headers(1).has('x-analyst-id')).toBe(false);
    response.resolve(new Response(null, { status: 204 }));
    await logout;
    expect(session.getSnapshot().error).toBeNull();
  });

  it('reports server revocation failure visibly without restoring local identity', async () => {
    await session.signIn(email, password);
    fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'));
    await session.signOut();
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    expect(session.getSnapshot().error).toContain('revocation could not be confirmed');
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it.each([204, 500])(
    'cannot erase or report errors on a newer identity after stale logout (%s)',
    async (status) => {
      await session.signIn(email, password);
      const response = deferred<Response>();
      fetchMock.mockReturnValueOnce(response.promise);
      const logout = session.signOut();
      fetchMock.mockResolvedValueOnce(
        Response.json(signedIn(otherUser, otherToken), { status: 201 }),
      );
      await session.signIn('grete.lindholm@northwind-demo.example', password);
      response.resolve(new Response(null, { status }));
      await logout;
      expect(session.getSnapshot()).toMatchObject({
        status: 'authenticated',
        user: otherUser,
        error: null,
      });
      expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(otherToken);
    },
  );

  it('cancels pending reads and writes without restoring caches or success callbacks', async () => {
    await session.signIn(email, password);
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
    const writeResult = mutation.execute(undefined).catch((error: unknown) => error);
    await writeStarted.promise;
    await session.signOut();
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

  it('clears both caches and storage on expiry without retrying or fallback', async () => {
    await session.signIn(email, password);
    queryClient.setQueryData(['cases'], { customer: 'Private customer' });
    queryClient.getMutationCache().build(queryClient, { mutationFn: async () => 'private note' });
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await expect(session.getSnapshot().request('/api/cases')).rejects.toMatchObject({
      status: 401,
    });
    expect(session.getSnapshot()).toMatchObject({ status: 'signed_out', user: null });
    expect(session.getSnapshot().error).toContain('expired or been revoked');
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale request failure sign out a newer identity', async () => {
    await session.signIn(email, password);
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const oldRequest = session.getSnapshot().request('/api/cases');
    await session.signOut();
    fetchMock.mockResolvedValueOnce(
      Response.json(signedIn(otherUser, otherToken), { status: 201 }),
    );
    await session.signIn('grete.lindholm@northwind-demo.example', password);
    response.resolve(Response.json({}, { status: 401 }));
    await expect(oldRequest).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.getSnapshot()).toMatchObject({
      status: 'authenticated',
      user: otherUser,
      error: null,
    });
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(otherToken);
  });

  it('keeps the verified identity on forbidden business actions, without switching actors', async () => {
    await session.signIn(email, password);
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 403 }));
    await expect(
      session.getSnapshot().request('/api/cases/case-001/actions', { method: 'POST' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(session.getSnapshot()).toMatchObject({ status: 'authenticated', user });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
