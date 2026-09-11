import { describe, expect, it } from 'vitest';
import { actionBodySchema, getAllowedActions, validateAction } from './transitions.js';
import type { AnalystRole, CaseAction, CaseStatus, RiskLevel } from '../types.js';

const NOTE = 'This note is long enough.';
const STATUSES: CaseStatus[] = ['pending', 'in_review', 'escalated', 'approved', 'rejected'];
const ACTIONS: CaseAction[] = ['start_review', 'approve', 'reject', 'escalate'];
const TARGETS: Record<CaseAction, CaseStatus> = {
  start_review: 'in_review',
  approve: 'approved',
  reject: 'rejected',
  escalate: 'escalated',
};
const REVIEWER_ACTIONS: Record<CaseStatus, CaseAction[]> = {
  pending: ['start_review', 'escalate'],
  in_review: ['escalate'],
  escalated: [],
  approved: [],
  rejected: [],
};
const DECIDER_ACTIONS: Record<CaseStatus, CaseAction[]> = {
  pending: ['start_review', 'approve', 'reject', 'escalate'],
  in_review: ['approve', 'reject', 'escalate'],
  escalated: ['approve', 'reject'],
  approved: [],
  rejected: [],
};
const POLICIES: Array<{
  role: AnalystRole;
  riskLevel: RiskLevel;
  allowed: Record<CaseStatus, CaseAction[]>;
}> = [
  { role: 'analyst', riskLevel: 'low', allowed: REVIEWER_ACTIONS },
  { role: 'analyst', riskLevel: 'medium', allowed: REVIEWER_ACTIONS },
  { role: 'analyst', riskLevel: 'high', allowed: REVIEWER_ACTIONS },
  { role: 'senior_analyst', riskLevel: 'low', allowed: DECIDER_ACTIONS },
  { role: 'senior_analyst', riskLevel: 'medium', allowed: DECIDER_ACTIONS },
  { role: 'senior_analyst', riskLevel: 'high', allowed: REVIEWER_ACTIONS },
  { role: 'compliance_manager', riskLevel: 'low', allowed: DECIDER_ACTIONS },
  { role: 'compliance_manager', riskLevel: 'medium', allowed: DECIDER_ACTIONS },
  { role: 'compliance_manager', riskLevel: 'high', allowed: DECIDER_ACTIONS },
];
const NOTE_BOUNDARIES = [
  { name: 'missing', note: undefined, length: 0 },
  { name: 'empty', note: '', length: 0 },
  { name: 'whitespace', note: ' \t\n ', length: 0 },
  { name: 'one character', note: 'x', length: 1 },
  { name: 'nine trimmed characters', note: ' \t123456789\n ', length: 9 },
  { name: 'ten trimmed characters', note: ' \t1234567890\n ', length: 10 },
  { name: '1000 trimmed characters', note: ` \t${'x'.repeat(1000)}\n `, length: 1000 },
  { name: '1001 trimmed characters', note: ` ${'x'.repeat(1001)} `, length: 1001 },
];
const NOTE_POLICIES = [
  { name: 'default', options: {} },
  { name: 'enabled', options: { requireApprovalNote: true } },
  { name: 'disabled', options: { requireApprovalNote: false } },
];

describe.each(POLICIES)('$role / $riskLevel', ({ role, riskLevel, allowed }) => {
  describe.each(STATUSES)('%s', (status) => {
    it('returns precisely the permitted actions in their existing order without a note', () => {
      expect(getAllowedActions(status, role, riskLevel)).toEqual(allowed[status]);
    });

    it.each(ACTIONS)('validates %s with transition and permission precedence', (action) => {
      const input = { status, role, riskLevel, action };
      if (!DECIDER_ACTIONS[status].includes(action)) {
        for (const note of [undefined, NOTE, 'x'.repeat(1001)]) {
          expect(validateAction({ ...input, note })).toMatchObject({
            ok: false, error: { code: 'INVALID_TRANSITION' },
          });
        }
      } else if (!allowed[status].includes(action)) {
        for (const note of [undefined, NOTE, 'x'.repeat(1001)]) {
          expect(validateAction({ ...input, note })).toMatchObject({
            ok: false, error: { code: 'FORBIDDEN' },
          });
        }
      } else {
        expect(validateAction({ ...input, note: NOTE })).toEqual({
          ok: true, toStatus: TARGETS[action],
        });
      }
    });

    describe.each(allowed[status])('%s notes', (action) => {
      it.each(NOTE_POLICIES)('enforces trimmed boundaries with approval notes $name', ({ options }) => {
        const requiresNote =
          action === 'reject' ||
          action === 'escalate' ||
          (action === 'approve' && (riskLevel === 'high' || options.requireApprovalNote !== false));
        for (const { name, note, length } of NOTE_BOUNDARIES) {
          const result = validateAction({ status, role, riskLevel, action, note, ...options });
          if (length > 1000 || (requiresNote && length < 10)) {
            expect(result, name).toMatchObject({
              ok: false, error: { code: 'VALIDATION_ERROR' },
            });
          } else {
            expect(result, name).toEqual({ ok: true, toStatus: TARGETS[action] });
          }
        }
      });
    });
  });
});

describe('runtime authorization boundaries', () => {
  it.each([
    'unknown', '', 'manager', 'ANALYST', '__proto__', 'constructor', 'toString',
    null, undefined, {}, ['compliance_manager'], Symbol('compliance_manager'),
  ])('fails closed for runtime role %s', (runtimeRole) => {
    const role = runtimeRole as AnalystRole;
    for (const riskLevel of ['low', 'medium', 'high'] as const) {
      for (const status of STATUSES) {
        expect(getAllowedActions(status, role, riskLevel)).toEqual([]);
        for (const action of ACTIONS) {
          expect(validateAction({ status, role, riskLevel, action })).toMatchObject({
            ok: false,
            error: {
              code: DECIDER_ACTIONS[status].includes(action) ? 'FORBIDDEN' : 'INVALID_TRANSITION',
            },
          });
        }
      }
    }
  });

  it('does not permit decisions without a recognized runtime risk level', () => {
    for (const riskLevel of [undefined, 'critical', '__proto__'] as unknown as RiskLevel[]) {
      for (const role of ['senior_analyst', 'compliance_manager'] as const) {
        expect(getAllowedActions('pending', role, riskLevel)).toEqual(['start_review', 'escalate']);
        for (const action of ['approve', 'reject'] as const) {
          expect(validateAction({ status: 'pending', role, riskLevel, action, note: NOTE }))
            .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
        }
      }
    }
  });
});

describe('actionBodySchema', () => {
  it.each(ACTIONS)('accepts %s and normalizes surrounding note whitespace', (action) => {
    expect(actionBodySchema.parse({ action })).toEqual({ action });
    expect(actionBodySchema.parse({ action, note: ` \t${NOTE}\n ` })).toEqual({ action, note: NOTE });
  });

  it.each(NOTE_BOUNDARIES)('checks the schema maximum using $name', ({ note, length }) => {
    expect(actionBodySchema.safeParse({ action: 'start_review', note }).success).toBe(length <= 1000);
  });

  it.each([
    ['actor', { id: 'ana-001', role: 'compliance_manager' }],
    ['actorId', 'ana-001'],
    ['analystId', 'ana-001'],
    ['role', 'compliance_manager'],
    ['status', 'approved'],
    ['state', 'approved'],
    ['fromStatus', 'pending'],
    ['toStatus', 'approved'],
    ['riskLevel', 'low'],
    ['requireApprovalNote', false],
    ['unknown', true],
    ['__proto__', { role: 'compliance_manager' }],
    ['constructor', { role: 'compliance_manager' }],
  ])('rejects injected %s rather than silently stripping it', (key, value) => {
    const result = actionBodySchema.safeParse({ action: 'approve', note: NOTE, [String(key)]: value });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({ code: 'unrecognized_keys' }));
    }
  });

  it.each([
    null, [], 'approve', {}, { note: NOTE }, { action: 'reopen' },
    { action: 'approve', note: 10 }, { action: 'approve', note: null },
    { action: 'approve', note: { role: 'compliance_manager' } },
  ])('rejects malformed body %j', (body) => {
    expect(actionBodySchema.safeParse(body).success).toBe(false);
  });
});
