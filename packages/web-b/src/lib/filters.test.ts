import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, filtersToApiQuery, parseFilters, serializeFilters, type QueueFilters } from './filters';
describe('filters', () => {
  it('parses and serializes queue filters', () => {
    expect(parseFilters('?status=pending,in_review&riskLevel=high&q=abc&sort=riskScore&order=asc&page=3')).toEqual({ status: ['pending', 'in_review'], riskLevel: ['high'], q: 'abc', sort: 'riskScore', order: 'asc', page: 3 });
    expect(parseFilters('?status=bogus&page=-2').status).toEqual([]);
    expect(parseFilters('?page=-2').page).toBe(1);
    expect(serializeFilters(DEFAULT_FILTERS)).toBe('');
    const f: QueueFilters = { status: ['pending'], riskLevel: ['medium'], q: 'x', sort: 'updatedAt', order: 'asc', page: 3 };
    expect(parseFilters(`?${serializeFilters(f)}`)).toEqual(f);
    expect(filtersToApiQuery(DEFAULT_FILTERS)).toContain('pageSize=25');
  });
});
