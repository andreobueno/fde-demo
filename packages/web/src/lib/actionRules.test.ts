import { describe, expect, it } from 'vitest';
import { noteIsRequired, validateActionNote, validateNote } from './actionRules';

describe('validateActionNote', () => {
  it.each(['reject', 'escalate', 'approve'] as const)(
    '%s requires 10–1000 trimmed characters when approval notes are required',
    (action) => {
      for (const note of ['', '   ', 'x'.repeat(9), ` ${'x'.repeat(9)} `, 'x'.repeat(1001)]) {
        expect(validateActionNote(action, true, note)).not.toBeNull();
      }
      for (const note of ['x'.repeat(10), 'x'.repeat(1000), ` ${'x'.repeat(10)} `]) {
        expect(validateActionNote(action, true, note)).toBeNull();
      }
    },
  );

  it.each(['reject', 'escalate'] as const)(
    '%s still requires 10–1000 characters when approval notes are optional',
    (action) => {
      expect(validateActionNote(action, false, '')).not.toBeNull();
      expect(validateActionNote(action, false, 'x'.repeat(9))).not.toBeNull();
      expect(validateActionNote(action, false, 'x'.repeat(10))).toBeNull();
      expect(validateActionNote(action, false, 'x'.repeat(1000))).toBeNull();
      expect(validateActionNote(action, false, 'x'.repeat(1001))).not.toBeNull();
    },
  );

  it('uses the server approval requirement rather than inferring it from risk', () => {
    expect(validateActionNote('approve', true, '')).not.toBeNull();
    expect(validateActionNote('approve', true, 'ok')).not.toBeNull();
    expect(validateActionNote('approve', false, '')).toBeNull();
    expect(validateActionNote('approve', false, 'ok')).toBeNull();
    expect(validateActionNote('approve', false, 'x'.repeat(1000))).toBeNull();
    expect(validateActionNote('approve', false, 'x'.repeat(1001))).not.toBeNull();
  });

  it.each([true, false])('start_review notes are optional with approvalNoteRequired=%s', (required) => {
    expect(validateActionNote('start_review', required, '')).toBeNull();
    expect(validateActionNote('start_review', required, 'ok')).toBeNull();
    expect(validateActionNote('start_review', required, 'x'.repeat(1000))).toBeNull();
    expect(validateActionNote('start_review', required, 'x'.repeat(1001))).not.toBeNull();
  });
});

describe('noteIsRequired', () => {
  it('reject and escalate always require a note', () => {
    expect(noteIsRequired('reject', false)).toBe(true);
    expect(noteIsRequired('escalate', false)).toBe(true);
  });

  it('approve uses the backend approvalNoteRequired flag', () => {
    expect(noteIsRequired('approve', true)).toBe(true);
    expect(noteIsRequired('approve', false)).toBe(false);
  });

  it('start_review never requires a note', () => {
    expect(noteIsRequired('start_review', true)).toBe(false);
  });
});

describe('policy reason validation', () => {
  it('requires 10–1000 trimmed characters and identifies the reason field', () => {
    expect(validateNote('   ', true, 'Reason')).toBe('Reason is required.');
    expect(validateNote(' short ', true, 'Reason')).toBe('Reason must be at least 10 characters.');
    expect(validateNote('x'.repeat(1001), true, 'Reason')).toBe('Reason must be at most 1000 characters.');
    expect(validateNote(` ${'x'.repeat(10)} `, true, 'Reason')).toBeNull();
    expect(validateNote('x'.repeat(1000), true, 'Reason')).toBeNull();
  });
});
