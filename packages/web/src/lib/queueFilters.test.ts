import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  defaultOrderFor,
  parseQueueFilters,
  queueFiltersToQuery,
  serializeQueueFilters,
  type QueueFilters,
} from './queueFilters';

describe('parseQueueFilters', () => {
  it('parses a full query string', () => {
    const params = new URLSearchParams(
      'status=pending,in_review&riskLevel=high&q=abc&sort=riskScore&order=asc&page=3',
    );
    expect(parseQueueFilters(params)).toEqual({
      status: ['pending', 'in_review'],
      riskLevel: ['high'],
      q: 'abc',
      sort: 'riskScore',
      order: 'asc',
      page: 3,
    });
  });

  it('parses the column sort keys', () => {
    const f = parseQueueFilters(new URLSearchParams('sort=customer&order=asc'));
    expect(f.sort).toBe('customer');
    expect(f.order).toBe('asc');
    for (const sort of ['reference', 'country', 'status', 'assignedTo'] as const) {
      expect(parseQueueFilters(new URLSearchParams(`sort=${sort}`)).sort).toBe(sort);
    }
  });

  it('defaultOrderFor is desc for numeric/date columns and asc for text columns', () => {
    expect(defaultOrderFor('createdAt')).toBe('desc');
    expect(defaultOrderFor('riskScore')).toBe('desc');
    expect(defaultOrderFor('customer')).toBe('asc');
    expect(defaultOrderFor('assignedTo')).toBe('asc');
  });

  it('falls back on unknown values', () => {
    const params = new URLSearchParams('status=bogus&page=-2&sort=foo&order=sideways');
    expect(parseQueueFilters(params)).toEqual(DEFAULT_FILTERS);
  });

  it('drops unknown enum values but keeps valid ones', () => {
    const params = new URLSearchParams('status=pending,bogus&riskLevel=high,nope');
    const f = parseQueueFilters(params);
    expect(f.status).toEqual(['pending']);
    expect(f.riskLevel).toEqual(['high']);
  });

  it('defaults everything when params are empty', () => {
    expect(parseQueueFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });
});

describe('serializeQueueFilters', () => {
  it('omits defaults and empties', () => {
    expect(serializeQueueFilters(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('round-trips a non-default filter set', () => {
    const f: QueueFilters = {
      status: ['pending', 'escalated'],
      riskLevel: ['high'],
      q: 'smith',
      sort: 'riskScore',
      order: 'asc',
      page: 4,
    };
    expect(parseQueueFilters(serializeQueueFilters(f))).toEqual(f);
  });
});

describe('queueFiltersToQuery', () => {
  it('always includes page and pageSize=25', () => {
    const query = queueFiltersToQuery(DEFAULT_FILTERS);
    const params = new URLSearchParams(query);
    expect(params.get('page')).toBe('1');
    expect(params.get('pageSize')).toBe('25');
  });
});
