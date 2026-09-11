import { describe, expect, it } from 'vitest';
import { formatUsdCents } from './format';

describe('exact integer-cent formatting', () => {
  it.each([
    [Number.MAX_SAFE_INTEGER, '$90,071,992,547,409.91'],
    [9007199254740901, '$90,071,992,547,409.01'],
    [9007199254740899, '$90,071,992,547,408.99'],
    [-Number.MAX_SAFE_INTEGER, '-$90,071,992,547,409.91'],
    [-1, '-$0.01'],
  ] as const)('preserves the whole-dollar value and remainder for %i cents', (cents, formatted) => {
    expect(formatUsdCents(cents)).toBe(formatted);
  });
});
