import { describe, expect, it } from 'vitest';
import { validateActionNote } from './actionRules';

describe('validateActionNote', () => {
  it('rejects a five-character reject note', () => {
    expect(validateActionNote('reject', 'short', 'low')).toBeTruthy();
  });

  it('accepts a ten-character reject note', () => {
    expect(validateActionNote('reject', '1234567890', 'low')).toBeNull();
  });

  it('rejects an oversized escalation note', () => {
    expect(validateActionNote('escalate', 'x'.repeat(1001), 'low')).toBeTruthy();
  });

  it('requires a note for high-risk approval', () => {
    expect(validateActionNote('approve', '', 'high')).toBeTruthy();
  });

  it('allows an empty note for medium-risk approval', () => {
    expect(validateActionNote('approve', '', 'medium')).toBeNull();
  });

  it('rejects an oversized approval note', () => {
    expect(validateActionNote('approve', 'x'.repeat(1001), 'low')).toBeTruthy();
  });

  it('allows an empty start-review note', () => {
    expect(validateActionNote('start_review', '', 'low')).toBeNull();
  });
});
