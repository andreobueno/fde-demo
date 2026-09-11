import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRefund, getRefundAudit, getRefundStats, listRefunds, postRefundAction } from './refunds';
import { DEFAULT_REFUND_FILTERS } from '../lib/refundFilters';
import { authenticateAccessToken } from './client';
import { clearIdentity } from './identity';

const fetchMock = vi.fn<typeof fetch>();

const token = 'r'.repeat(43);

async function signIn(id: string) {
  fetchMock.mockResolvedValueOnce(Response.json({ id, name: id, role: 'analyst', permissions: [] }));
  await authenticateAccessToken(token);
  fetchMock.mockClear();
}

beforeEach(async () => {
  fetchMock.mockReset().mockImplementation(async () => Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
  await signIn('ana-001');
});
afterEach(() => { clearIdentity(); vi.unstubAllGlobals(); });

const endpoints = [
  { path: '/api/refunds?page=1&pageSize=25', call: (id: string, signal: AbortSignal) => listRefunds(DEFAULT_REFUND_FILTERS, id, signal) },
  { path: '/api/refunds/stats', call: getRefundStats },
  { path: '/api/refunds/r-1', call: (id: string, signal: AbortSignal) => getRefund('r-1', id, signal) },
  { path: '/api/refunds/r-1/audit', call: (id: string, signal: AbortSignal) => getRefundAudit('r-1', id, signal) },
  { path: '/api/refunds/r-1/actions', call: (id: string, signal: AbortSignal) => postRefundAction('r-1', 'approve', 'Reviewed transaction', id, signal) },
];

describe('refund API identity and authorization contract', () => {
  it.each(endpoints)('$path sends the selected identity and cancellation signal', async ({ path, call }) => {
    for (const id of ['ana-003', 'ana-001', 'ana-006']) {
      await signIn(id);
      const controller = new AbortController();
      await call(id, controller.signal);
      expect(fetchMock).toHaveBeenLastCalledWith(path, expect.objectContaining({
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, 'x-analyst-id': id },
        signal: expect.any(AbortSignal),
      }));
    }
  });

  it.each(endpoints)('$path refuses a request after identity invalidation', async ({ call }) => {
    const controller = new AbortController();
    controller.abort();
    await expect(call('ana-006', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only the action and trimmed reason, never client permission fields', async () => {
    await postRefundAction('r-1', 'reject', '  Receipt did not match  ', 'ana-001');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/refunds/r-1/actions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'reject', note: 'Receipt did not match' }),
    }));
  });

  it('preserves allowedActions, exact cents and audit evidence from the server', async () => {
    const response = { allowedActions: [], amountCents: 500001, audit: [{ refundId: 'r-1', hash: 'test-hash' }] };
    fetchMock.mockResolvedValueOnce(Response.json(response));
    await expect(getRefund('r-1', 'ana-001')).resolves.toEqual(response);
  });

  it.each([400, 401, 403, 409])('surfaces %i without retrying a financial decision', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'REFUSED', message: 'Decision refused' } }, { status }));
    await expect(postRefundAction('r-1', 'approve', 'Reviewed transaction', 'ana-001'))
      .rejects.toMatchObject({ status, code: 'REFUSED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
