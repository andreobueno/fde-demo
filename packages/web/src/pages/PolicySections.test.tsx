import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApi } from '../api/useApi';
import type { AnalystRole, CurrentAnalyst, Policy, RiskPolicy } from '../api/types';
import { PolicyPage } from './PolicyPage';
import { RiskPolicyPage } from './RiskPolicyPage';

vi.mock('../api/useApi', () => ({ useApi: vi.fn() }));
vi.mock('../analyst/AnalystContext', () => ({
  useAnalyst: () => ({ analystId: 'selected', identitySignal: new AbortController().signal }),
}));

afterEach(() => vi.resetAllMocks());

const approval: Policy = {
  version: 2, requireApprovalNote: false, updatedAt: '2026-09-11T12:00:00Z', updatedBy: 'selected',
};
const risk: RiskPolicy = {
  rules: [{ code: 'PEP', title: 'PEP match', description: 'Saved rule', weight: 45, defaultWeight: 30 }],
  thresholds: { medium: 30, high: 70 }, defaultThresholds: { medium: 30, high: 60 },
  version: 4, updatedAt: null, updatedBy: null,
};

function result(data: unknown) {
  return { data, error: null, loading: false, reload: vi.fn() };
}

describe('independent policy section presentation', () => {
  it.each(['analyst', 'senior_analyst', 'compliance_manager'] as const)(
    'renders separate settings and server-authorized controls for %s', (role: AnalystRole) => {
      const me: CurrentAnalyst = {
        id: 'selected', name: 'Selected identity', role,
        permissions: role === 'compliance_manager' ? ['policy:read', 'policy:manage'] : ['policy:read'],
      };
      vi.mocked(useApi)
        .mockReturnValueOnce(result(approval))
        .mockReturnValueOnce(result([]))
        .mockReturnValueOnce(result(me));
      const approvalHtml = renderToStaticMarkup(<StaticRouter location="/policy"><PolicyPage /></StaticRouter>);
      expect(approvalHtml).toContain('Approval-note policy');
      expect(approvalHtml).toContain('Optional (up to 1000 characters)');
      expect(approvalHtml).not.toContain('Rule weights');
      expect(approvalHtml.includes('Save policy')).toBe(role === 'compliance_manager');

      vi.mocked(useApi)
        .mockReturnValueOnce(result(me))
        .mockReturnValueOnce(result(risk))
        .mockReturnValueOnce(result([]));
      const riskHtml = renderToStaticMarkup(<StaticRouter location="/policy/risk"><RiskPolicyPage /></StaticRouter>);
      expect(riskHtml).toContain('Rule weights');
      expect(riskHtml).toContain('value="45"');
      expect(riskHtml).toContain('value="70"');
      expect(riskHtml).not.toContain('Approval justification');
      expect(riskHtml.includes('Save policy')).toBe(role === 'compliance_manager');
      expect(riskHtml.includes('Read-only:')).toBe(role !== 'compliance_manager');
    },
  );
});
