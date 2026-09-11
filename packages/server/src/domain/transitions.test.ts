import { describe, expect, it } from 'vitest';
import { getAllowedActions, validateAction } from './transitions.js';
import type { AnalystRole, CaseStatus } from '../types.js';

const v = (status: CaseStatus, role: AnalystRole, riskLevel: 'low' | 'medium' | 'high',
  action: 'approve' | 'reject' | 'escalate' | 'start_review', note?: string) =>
  validateAction({ status, role, riskLevel, action, note });

const NOTE = 'This note is long enough.';

describe('getAllowedActions', () => {
  it('pending allows all four actions', () => {
    expect(getAllowedActions('pending', 'analyst')).toEqual([
      'start_review', 'approve', 'reject', 'escalate',
    ]);
  });
  it('in_review allows approve/reject/escalate', () => {
    expect(getAllowedActions('in_review', 'analyst')).toEqual(['approve', 'reject', 'escalate']);
  });
  it('escalated allows approve/reject only for senior', () => {
    expect(getAllowedActions('escalated', 'senior_analyst')).toEqual(['approve', 'reject']);
    expect(getAllowedActions('escalated', 'analyst')).toEqual([]);
  });
  it('terminal states allow nothing', () => {
    expect(getAllowedActions('approved', 'senior_analyst')).toEqual([]);
    expect(getAllowedActions('rejected', 'senior_analyst')).toEqual([]);
  });
});

describe('validateAction transitions', () => {
  it('start_review only from pending', () => {
    expect(v('pending', 'analyst', 'low', 'start_review')).toEqual({ ok: true, toStatus: 'in_review' });
    const r = v('in_review', 'analyst', 'low', 'start_review');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it.each(['approve', 'reject', 'escalate'] as const)(
    '%s allowed from pending and in_review',
    (action) => {
      for (const status of ['pending', 'in_review'] as const) {
        const note = action === 'approve' ? undefined : NOTE;
        expect(v(status, 'analyst', 'low', action, note).ok).toBe(true);
      }
    },
  );

  it.each(['approve', 'reject', 'escalate'] as const)(
    '%s rejected from terminal states as INVALID_TRANSITION',
    (action) => {
      for (const status of ['approved', 'rejected'] as const) {
        const r = v(status, 'senior_analyst', 'low', action, NOTE);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
      }
    },
  );

  it('escalate from escalated is an invalid transition', () => {
    const r = v('escalated', 'senior_analyst', 'high', 'escalate', NOTE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('validateAction roles', () => {
  it('analyst cannot resolve escalated case (FORBIDDEN)', () => {
    const r = v('escalated', 'analyst', 'low', 'approve');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });
  it('senior can resolve escalated case', () => {
    expect(v('escalated', 'senior_analyst', 'low', 'approve').ok).toBe(true);
    expect(v('escalated', 'senior_analyst', 'low', 'reject', NOTE).ok).toBe(true);
  });
});

describe('validateAction notes', () => {
  it('reject requires note 10..1000', () => {
    const missing = v('pending', 'analyst', 'low', 'reject');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('VALIDATION_ERROR');
    const short = v('pending', 'analyst', 'low', 'reject', 'too short');
    expect(short.ok).toBe(false);
    const long = v('pending', 'analyst', 'low', 'reject', 'x'.repeat(1001));
    expect(long.ok).toBe(false);
    expect(v('pending', 'analyst', 'low', 'reject', NOTE).ok).toBe(true);
  });

  it('escalate requires note 10..1000', () => {
    const r = v('in_review', 'analyst', 'low', 'escalate', 'short');
    expect(r.ok).toBe(false);
    expect(v('in_review', 'analyst', 'low', 'escalate', NOTE).ok).toBe(true);
  });

  it('approve note optional but ≤1000', () => {
    expect(v('pending', 'analyst', 'low', 'approve').ok).toBe(true);
    expect(v('pending', 'analyst', 'low', 'approve', 'ok note here').ok).toBe(true);
    const long = v('pending', 'analyst', 'low', 'approve', 'x'.repeat(1001));
    expect(long.ok).toBe(false);
  });

  it('approving high-risk from pending/in_review requires a note', () => {
    const noNote = v('in_review', 'analyst', 'high', 'approve');
    expect(noNote.ok).toBe(false);
    if (!noNote.ok) expect(noNote.error.code).toBe('VALIDATION_ERROR');
    expect(v('pending', 'analyst', 'high', 'approve', NOTE).ok).toBe(true);
    // note not required when resolving an escalated high-risk case
    expect(v('escalated', 'senior_analyst', 'high', 'approve').ok).toBe(true);
    // medium/low do not need a note
    expect(v('in_review', 'analyst', 'medium', 'approve').ok).toBe(true);
  });
});
