import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  getAnalysts,
  getAudit,
  getCase,
  getCaseStats,
  getMe,
  getPolicy,
  getPolicyAudit,
  getRiskExplanation,
  listCases,
  postCaseAction,
  updatePolicy,
} from './client';
import type { Policy, PolicyAuditEvent } from './types';
import { DEFAULT_FILTERS, queueFiltersToQuery } from '../lib/queueFilters';

const fetchMock = vi.fn<typeof fetch>();
const policy: Policy = {
  version: 2,
  requireApprovalNote: false,
  updatedAt: '2026-09-11T16:00:00.000Z',
  updatedBy: 'ana-006',
};
const update = { version: 1, requireApprovalNote: false, reason: '  Reviewed approval requirements  ' };

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('explicit demo identity on every API request', () => {
  const endpoints: Array<{
    path: string;
    method: string;
    request: (id: string, signal: AbortSignal) => Promise<unknown>;
  }> = [
    { path: '/api/analysts', method: 'GET', request: getAnalysts },
    { path: '/api/me', method: 'GET', request: getMe },
    { path: '/api/cases/stats', method: 'GET', request: getCaseStats },
    { path: `/api/cases?${queueFiltersToQuery(DEFAULT_FILTERS)}`, method: 'GET', request: (id, signal) => listCases(DEFAULT_FILTERS, id, signal) },
    { path: '/api/cases/case-001', method: 'GET', request: (id, signal) => getCase('case-001', id, signal) },
    { path: '/api/cases/case-001/risk-explanation', method: 'GET', request: (id, signal) => getRiskExplanation('case-001', id, signal) },
    { path: '/api/cases/case-001/audit', method: 'GET', request: (id, signal) => getAudit('case-001', id, signal) },
    { path: '/api/cases/case-001/actions', method: 'POST', request: (id, signal) => postCaseAction('case-001', 'approve', 'Reviewed evidence', id, signal) },
    { path: '/api/policy', method: 'GET', request: getPolicy },
    { path: '/api/policy/audit', method: 'GET', request: getPolicyAudit },
    { path: '/api/policy', method: 'PUT', request: (id, signal) => updatePolicy(update, id, signal) },
  ];

  it.each(endpoints)('$method $path uses the supplied identity and cancellation signal', async ({ request, path, method }) => {
    for (const id of ['ana-006', 'ana-003']) {
      const controller = new AbortController();
      await request(id, controller.signal);
      expect(fetchMock).toHaveBeenLastCalledWith(path, {
        method,
        headers: { 'content-type': 'application/json', 'x-analyst-id': id },
        body: method === 'GET' ? null : expect.any(String),
        signal: controller.signal,
      });
    }
  });

  it('does not fall back to an implicit identity for an empty id', async () => {
    await expect(getMe('   ')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry unauthorized requests as another identity', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'UNAUTHORIZED', message: 'Unknown analyst' } }, { status: 401 }));
    await expect(getAnalysts('missing-id')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not submit an action from an invalidated identity session', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(postCaseAction('case-001', 'approve', 'Reviewed evidence', 'ana-006', controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    await expect(updatePolicy(update, 'ana-006', controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a late response after identity cancellation even if transport completes', async () => {
    const controller = new AbortController();
    let respond: (response: Response) => void = () => { throw new Error('Request has not started'); };
    fetchMock.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const request = getMe('ana-006', controller.signal);
    controller.abort();
    respond(Response.json({ id: 'ana-006', role: 'compliance_manager', permissions: [] }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('RBAC and policy contracts', () => {
  it('preserves the database identity role and permissions', async () => {
    const me = { id: 'ana-006', name: 'Sofia Chen', role: 'compliance_manager', permissions: ['policy:write'] };
    fetchMock.mockResolvedValueOnce(Response.json(me));
    await expect(getMe('ana-006')).resolves.toEqual(me);
    fetchMock.mockResolvedValueOnce(Response.json([me]));
    await expect(getAnalysts('ana-003')).resolves.toEqual([me]);
  });

  it('preserves server-calculated action availability and approval-note requirements', async () => {
    const result = { allowedActions: ['escalate'], approvalNoteRequired: true };
    fetchMock.mockResolvedValueOnce(Response.json(result));
    await expect(getCase('case-001', 'ana-003')).resolves.toEqual(result);
    fetchMock.mockResolvedValueOnce(Response.json({ ...result, allowedActions: [], approvalNoteRequired: false }));
    await expect(postCaseAction('case-001', 'escalate', 'Needs senior review', 'ana-003'))
      .resolves.toEqual({ allowedActions: [], approvalNoteRequired: false });
  });

  it('sends only the strict versioned policy body with a trimmed reason', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(policy));
    await expect(updatePolicy(update, 'ana-006')).resolves.toEqual(policy);
    expect(fetchMock).toHaveBeenCalledWith('/api/policy', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ version: 1, requireApprovalNote: false, reason: 'Reviewed approval requirements' }),
    }));
  });

  it('reads policy and complete audit snapshots without discarding provenance', async () => {
    const event: PolicyAuditEvent = {
      id: 'policy-audit-001',
      actorId: 'ana-006',
      actorName: 'Sofia Chen',
      actorRole: 'compliance_manager',
      action: 'policy_updated',
      createdAt: policy.updatedAt,
      reason: update.reason.trim(),
      previousState: { version: 1, requireApprovalNote: true, updatedAt: '2026-09-11T15:00:00.000Z', updatedBy: null },
      newState: policy,
      prevHash: '0'.repeat(64),
      hash: 'a'.repeat(64),
    };
    fetchMock.mockResolvedValueOnce(Response.json(policy));
    await expect(getPolicy('ana-003')).resolves.toEqual(policy);
    fetchMock.mockResolvedValueOnce(Response.json([event]));
    await expect(getPolicyAudit('ana-003')).resolves.toEqual([event]);
  });

  it.each([
    { status: 400, code: 'VALIDATION_ERROR' },
    { status: 403, code: 'FORBIDDEN' },
    { status: 409, code: 'VERSION_CONFLICT' },
  ])('surfaces $status errors without retrying policy writes', async ({ status, code }) => {
    fetchMock.mockResolvedValueOnce(Response.json({
      error: { code, message: 'Policy update refused', details: { version: 2 } },
    }, { status }));
    await expect(updatePolicy(update, 'ana-003')).rejects.toMatchObject({
      status, code, message: 'Policy update refused', details: { version: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('omits blank optional notes and trims supplied notes without sending a client role', async () => {
    await postCaseAction('case-001', 'start_review', '   ', 'ana-003');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/cases/case-001/actions', expect.objectContaining({
      body: JSON.stringify({ action: 'start_review' }),
    }));
    await postCaseAction('case-001', 'reject', '  Reviewed evidence  ', 'ana-006');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/cases/case-001/actions', expect.objectContaining({
      body: JSON.stringify({ action: 'reject', note: 'Reviewed evidence' }),
    }));
  });

  it('retains a useful error for network failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiRequest('/api/me', { analystId: 'ana-003' }))
      .rejects.toEqual(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the API server'));
  });
});
