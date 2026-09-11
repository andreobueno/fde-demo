import { describe, expect, it } from 'vitest';
import type { RiskLevel } from '../src/api/types.js';
import { normaliseNote, noteRule, validateNote } from '../src/lib/validation.js';

describe('client-side action validation', () => {
  it.each([
    { action: 'reject', riskLevel: 'low', approvalNoteRequired: false },
    { action: 'escalate', riskLevel: 'high', approvalNoteRequired: false },
    { action: 'approve', riskLevel: 'low', approvalNoteRequired: true },
    { action: 'approve', riskLevel: 'medium', approvalNoteRequired: true },
    { action: 'approve', riskLevel: 'high', approvalNoteRequired: true },
    { action: 'approve', riskLevel: 'high', approvalNoteRequired: false },
  ] as const)('requires trimmed 10–1000 characters for $action/$riskLevel/$approvalNoteRequired', ({
    action, riskLevel, approvalNoteRequired,
  }) => {
    expect(noteRule(action, riskLevel, approvalNoteRequired).required).toBe(true);
    for (const note of [undefined, '', ' \t\n ', 'ok', ' 123456789 ']) {
      expect(validateNote(action, riskLevel, note, approvalNoteRequired)).toMatch(/at least 10/);
    }
    for (const note of ['1234567890', ' \t1234567890\n ', 'x'.repeat(1000), ` ${'x'.repeat(1000)} `]) {
      expect(validateNote(action, riskLevel, note, approvalNoteRequired)).toBeNull();
    }
    expect(validateNote(action, riskLevel, ` ${'x'.repeat(1001)} `, approvalNoteRequired)).toMatch(/at most 1000/);
  });

  it.each(['low', 'medium'] as const)('allows optional approval notes for %s risk when policy permits', (riskLevel) => {
    expect(noteRule('approve', riskLevel, false).required).toBe(false);
    for (const note of [undefined, '', ' \t\n ', 'ok', ' 123456789 ', ` ${'x'.repeat(1000)} `]) {
      expect(validateNote('approve', riskLevel, note, false)).toBeNull();
    }
    expect(validateNote('approve', riskLevel, ` ${'x'.repeat(1001)} `, false)).toMatch(/at most 1000/);
  });

  it.each<RiskLevel>(['low', 'medium', 'high'])('keeps start_review optional at %s risk under either policy', (riskLevel) => {
    for (const approvalNoteRequired of [true, false]) {
      expect(noteRule('start_review', riskLevel, approvalNoteRequired).required).toBe(false);
      for (const note of [undefined, '', ' \t\n ', 'ok', ` ${'x'.repeat(1000)} `]) {
        expect(validateNote('start_review', riskLevel, note, approvalNoteRequired)).toBeNull();
      }
      expect(validateNote('start_review', riskLevel, 'x'.repeat(1001), approvalNoteRequired)).toMatch(/at most 1000/);
    }
  });

  it('omits empty optional notes from the request body', () => {
    expect(normaliseNote(undefined)).toBeUndefined();
    expect(normaliseNote(' \t\n ')).toBeUndefined();
    expect(normaliseNote(' \tkeep me\n ')).toBe('keep me');
  });
});
