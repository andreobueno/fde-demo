import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAnalyst } from './types';
import { authenticateAccessToken, getAnalysts, getMe, postCaseAction } from './client';
import { clearIdentity, getIdentity } from './identity';
import { ManualIdentityForm } from '../analyst/ManualIdentityForm';

const fetchMock = vi.fn<typeof fetch>();
const token = 'a'.repeat(43);
const otherToken = 'b'.repeat(43);
const analyst: CurrentAnalyst = {
  id: 'retained-analyst', name: 'Existing analyst', role: 'analyst', permissions: ['cases:read'],
};

beforeEach(() => {
  clearIdentity();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { clearIdentity(); vi.unstubAllGlobals(); });

describe('credential-based sign-in', () => {
  it('offers local mock users without exposing credentials in the form', () => {
    const html = renderToStaticMarkup(<ManualIdentityForm />);
    expect(html).toContain('<label for="demo-user">Mock user</label>');
    expect(html).toContain('Analyst — Grete Lindholm');
    expect(html).toContain('Reviewer — Marta Ellison');
    expect(html).toContain('Admin — Sofia Chen');
    expect(html).not.toContain('Access token');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('demo-password-2026');
    expect(html).toContain('Log in</button>');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies the token before accepting the server identity and never persists credentials', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { setItem }, sessionStorage: { setItem } });
    let respond!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const pending = authenticateAccessToken(` ${token} `);
    expect(getIdentity()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'omit', redirect: 'error',
    }));
    respond(Response.json(analyst));
    await expect(pending).resolves.toEqual(analyst);
    expect(getIdentity()?.analyst).toEqual(analyst);
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'ana-006', 'a'.repeat(44)])('rejects invalid credential %j before calling the API', async (input) => {
    await expect(authenticateAccessToken(input)).rejects.toMatchObject({ status: 401 });
    expect(getIdentity()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])('does not authenticate or fall back on HTTP %i', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'REJECTED', message: 'Rejected' } }, { status }));
    await expect(authenticateAccessToken(token)).rejects.toMatchObject({ status });
    expect(getIdentity()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not authenticate on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(authenticateAccessToken(token)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(getIdentity()).toBeNull();
  });

  it('does not start a canceled authentication request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(authenticateAccessToken(token, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a late sign-in response after sign-out, even if transport completes', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const pending = authenticateAccessToken(token);
    const requestSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    clearIdentity();
    expect(requestSignal?.aborted).toBe(true);
    respond(Response.json(analyst));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(getIdentity()).toBeNull();
  });

  it('does not replace a new identity when an earlier sign-in returns late', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    const oldLogin = authenticateAccessToken(token);
    const manager = { ...analyst, id: 'manager', role: 'compliance_manager' };
    fetchMock.mockResolvedValueOnce(Response.json(manager));
    await authenticateAccessToken(otherToken);
    respond(Response.json(analyst));
    await expect(oldLogin).rejects.toMatchObject({ name: 'AbortError' });
    expect(getIdentity()?.analyst).toEqual(manager);
  });

  it('does not send the credential for a different selected identity', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(analyst));
    await authenticateAccessToken(token);
    fetchMock.mockClear();
    await expect(postCaseAction('case-001', 'approve', 'Reviewed case', 'ana-006'))
      .rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the authenticated view and cancels other requests on token expiry', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(analyst));
    await authenticateAccessToken(token);
    const oldIdentity = getIdentity();
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, { status: 401 }));
    await expect(getMe(analyst.id)).rejects.toMatchObject({ status: 401 });
    expect(oldIdentity?.signal.aborted).toBe(true);
    expect(getIdentity()).toBeNull();
    await expect(getAnalysts(analyst.id)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not clear the new identity when a previous request returns an unauthorized response', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(analyst));
    await authenticateAccessToken(token);
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    const previous = getMe(analyst.id);
    const manager = { ...analyst, id: 'manager', role: 'compliance_manager' };
    fetchMock.mockResolvedValueOnce(Response.json(manager));
    await authenticateAccessToken(otherToken);
    respond(Response.json({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, { status: 401 }));
    await expect(previous).rejects.toMatchObject({ name: 'AbortError' });
    expect(getIdentity()?.analyst).toEqual(manager);
  });
});
