import { describe, expect, it } from 'vitest';
import { noteIsRequired, validateActionNote } from './actionRules';

describe('validateActionNote', () => {
  it('reject with 5-char note → error', () => {
    expect(validateActionNote('reject', 'low', '12345')).not.toBeNull();
  });

  it('reject with 10-char note → ok', () => {
    expect(validateActionNote('reject', 'low', '1234567890')).toBeNull();
  });

  it('escalate with empty note → error', () => {
    expect(validateActionNote('escalate', 'medium', '   ')).not.toBeNull();
  });

  it('escalate with 1001-char note → error', () => {
    expect(validateActionNote('escalate', 'medium', 'x'.repeat(1001))).not.toBeNull();
  });

  it('approve high-risk with empty note → error', () => {
    expect(validateActionNote('approve', 'high', '')).not.toBeNull();
  });

  it('approve high-risk with note → ok', () => {
    expect(validateActionNote('approve', 'high', 'ok')).toBeNull();
  });

  it('approve low-risk with empty note → ok', () => {
    expect(validateActionNote('approve', 'low', '')).toBeNull();
  });

  it('approve with 1001-char note → error', () => {
    expect(validateActionNote('approve', 'low', 'x'.repeat(1001))).not.toBeNull();
  });

  it('start_review with empty note → ok', () => {
    expect(validateActionNote('start_review', 'high', '')).toBeNull();
  });
});

describe('noteIsRequired', () => {
  it('reject and escalate always require a note', () => {
    expect(noteIsRequired('reject', 'low')).toBe(true);
    expect(noteIsRequired('escalate', 'low')).toBe(true);
  });

  it('approve requires a note only for high risk', () => {
    expect(noteIsRequired('approve', 'high')).toBe(true);
    expect(noteIsRequired('approve', 'low')).toBe(false);
  });

  it('start_review never requires a note', () => {
    expect(noteIsRequired('start_review', 'high')).toBe(false);
  });
});
