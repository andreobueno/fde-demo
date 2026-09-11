import { describe, expect, it } from 'vitest';
import { normaliseNote, noteRule, validateNote } from '../src/lib/validation.js';

describe('client-side action validation', () => {
  it('requires a 10–1000 char note for reject and escalate', () => {
    expect(validateNote('reject', 'low', '')).toMatch(/at least 10/);
    expect(validateNote('escalate', 'low', 'too short')).toMatch(/at least 10/);
    expect(validateNote('reject', 'low', 'x'.repeat(1001))).toMatch(/at most 1000/);
    expect(validateNote('reject', 'low', 'This is long enough.')).toBeNull();
    expect(validateNote('escalate', 'high', 'Needs senior sign-off.')).toBeNull();
  });

  it('requires a note when approving a high-risk case only', () => {
    expect(validateNote('approve', 'high', '   ')).toMatch(/high-risk/);
    expect(validateNote('approve', 'high', 'ok')).toBeNull();
    expect(validateNote('approve', 'medium', '')).toBeNull();
    expect(validateNote('approve', 'low', undefined)).toBeNull();
    expect(validateNote('approve', 'low', 'x'.repeat(1001))).toMatch(/at most 1000/);
  });

  it('never requires a note to start a review', () => {
    expect(validateNote('start_review', 'high', '')).toBeNull();
    expect(noteRule('start_review', 'high').required).toBe(false);
    expect(noteRule('approve', 'high').required).toBe(true);
    expect(noteRule('approve', 'low').required).toBe(false);
  });

  it('omits empty optional notes from the request body', () => {
    expect(normaliseNote('  ')).toBeUndefined();
    expect(normaliseNote(' keep me ')).toBe('keep me');
  });
});
