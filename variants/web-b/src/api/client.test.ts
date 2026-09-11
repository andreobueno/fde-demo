import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, type ApiCredential } from './client';

const token = 'a'.repeat(43);
const fetchMock = vi.fn<typeof fetch>();
let controller: AbortController;
let credential: ApiCredential;

beforeEach(() => {
  controller = new AbortController();
  credential = { token, signal: controller.signal };
  fetchMock.mockReset().mockResolvedValue(Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('authenticated API dispatch', () => {
  it.each([
    ['/api/me', 'GET'],
    ['/api/analysts', 'GET'],
    ['/api/cases/stats', 'GET'],
    ['/api/cases?page=1', 'GET'],
    ['/api/cases/case-001', 'GET'],
    ['/api/cases/case-001/audit', 'GET'],
    ['/api/cases/case-001/risk-explanation', 'GET'],
    ['/api/cases/case-001/actions', 'POST'],
  ])('sends the bearer token to %s with %s', async (path, method) => {
    await apiFetch(path, credential, {
      method,
      ...(method === 'POST'
        ? { body: JSON.stringify({ action: 'reject', note: 'Reviewed evidence' }) }
        : {}),
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(url).toBe(path);
    expect(url).not.toContain(token);
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(headers.has('x-analyst-id')).toBe(false);
    expect(init?.credentials).toBe('omit');
    expect(init?.cache).toBe('no-store');
    if (method === 'POST') {
      expect(headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toEqual({
        action: 'reject',
        note: 'Reviewed evidence',
      });
    }
  });

  it.each([null, '', ' ', 'ana-001', 'x'.repeat(42), 'x'.repeat(44), '!'.repeat(43)])(
    'rejects absent or malformed credentials without fetching (%s)',
    async (value) => {
      await expect(
        apiFetch('/api/me', value === null ? null : { ...credential, token: value }),
      ).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('does not permit identity headers or cookies to replace credentials', async () => {
    await expect(
      apiFetch('/api/cases', null, { headers: { 'x-analyst-id': 'ana-001' } }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only the explicit expected identity guard, preserving a mismatch rejection', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: { code: 'FORBIDDEN', message: 'Identity mismatch' } },
        { status: 403 },
      ),
    );
    await expect(
      apiFetch(
        '/api/me',
        { ...credential, expectedAnalystId: 'ana-003' },
        {
          headers: { 'x-analyst-id': 'ana-001', Authorization: 'Bearer ignored' },
        },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Identity mismatch' });
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.get('x-analyst-id')).toBe('ana-003');
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('removes unsolicited identity headers when no guard was verified', async () => {
    await apiFetch('/api/me', credential, { headers: { 'x-analyst-id': 'ana-001' } });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).has('x-analyst-id')).toBe(false);
  });

  it('surfaces rejected tokens without retrying or falling back', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'UNAUTHORIZED', message: 'Revoked token' } }, { status: 401 }),
    );
    await expect(apiFetch('/api/analysts', credential)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('captures the credential at dispatch and cancels a late response', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const request = apiFetch('/api/cases', credential);
    credential.token = 'b'.repeat(43);
    controller.abort();
    respond(Response.json({ items: ['private case'] }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    const init = fetchMock.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(init?.signal?.aborted).toBe(true);
  });

  it('cancels requests through the TanStack query signal', async () => {
    const queryController = new AbortController();
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const request = apiFetch('/api/cases', credential, { signal: queryController.signal });
    queryController.abort();
    respond(Response.json({}));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.signal.aborted).toBe(false);
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it('does not dispatch a write from an already cancelled session', async () => {
    controller.abort();
    await expect(
      apiFetch('/api/cases/case-001/actions', credential, { method: 'POST' }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards a response cancelled while its body is being read', async () => {
    let finishBody!: (body: string) => void;
    const response = Response.json({});
    vi.spyOn(response, 'text').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishBody = resolve;
        }),
    );
    fetchMock.mockResolvedValueOnce(response);
    const request = apiFetch('/api/cases', credential);
    await Promise.resolve();
    controller.abort();
    finishBody(JSON.stringify({ items: ['private case'] }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('preserves server-calculated action availability', async () => {
    const result = { allowedActions: ['escalate'], approvalNoteRequired: true };
    fetchMock.mockResolvedValueOnce(Response.json(result));
    await expect(apiFetch('/api/cases/case-001', credential)).resolves.toEqual(result);
  });

  it('preserves business errors and their details', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'NOTE_REQUIRED',
            message: 'A note is required',
            details: { minLength: 10 },
          },
        },
        { status: 400 },
      ),
    );
    await expect(
      apiFetch('/api/cases/case-001/actions', credential, { method: 'POST' }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'NOTE_REQUIRED',
      message: 'A note is required',
      details: { minLength: 10 },
    });
  });

  it('reports a useful connection error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiFetch('/api/me', credential)).rejects.toMatchObject({
      status: 0,
      code: 'API_UNREACHABLE',
      message: 'API unreachable',
    });
  });
});
