import { describe, expect, it } from 'vitest';
import { validateActionNote } from './actionRules';
describe('validateActionNote', () => {
  it('validates action note rules', () => {
    expect(validateActionNote('reject', 'short', 'low')).toBeTruthy();
    expect(validateActionNote('reject', '1234567890', 'low')).toBeNull();
    expect(validateActionNote('escalate', 'x'.repeat(1001), 'low')).toBeTruthy();
    expect(validateActionNote('approve', '', 'high')).toBeTruthy();
    expect(validateActionNote('approve', '', 'medium')).toBeNull();
    expect(validateActionNote('approve', 'x'.repeat(1001), 'low')).toBeTruthy();
    expect(validateActionNote('start_review', '', 'low')).toBeNull();
  });
});
