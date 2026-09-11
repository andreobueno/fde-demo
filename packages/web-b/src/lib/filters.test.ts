import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filtersToApiQuery,
  parseFilters,
  serializeFilters,
  type QueueFilters,
} from './filters';

describe('filters', () => {
  it('parses all supported filter values', () => {
    expect(
      parseFilters(
        '?status=pending,in_review&riskLevel=high&q=abc&sort=riskScore&order=asc&page=3',
      ),
    ).toEqual({
      status: ['pending', 'in_review'],
      riskLevel: ['high'],
      q: 'abc',
      sort: 'riskScore',
      order: 'asc',
      page: 3,
    });
  });

  it('drops unknown status values', () => {
    expect(parseFilters('?status=bogus,pending').status).toEqual(['pending']);
  });

  it('clamps invalid pages to one', () => {
    expect(parseFilters('?page=-2').page).toBe(1);
  });

  it('omits defaults during serialization', () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe('');
  });

  it('round-trips non-default filters', () => {
    const filters: QueueFilters = {
      status: ['pending'],
      riskLevel: ['medium'],
      q: 'x',
      sort: 'updatedAt',
      order: 'asc',
      page: 3,
    };

    expect(parseFilters(`?${serializeFilters(filters)}`)).toEqual(filters);
  });

  it('includes the page size in API queries', () => {
    expect(filtersToApiQuery(DEFAULT_FILTERS)).toContain('pageSize=25');
  });
});
