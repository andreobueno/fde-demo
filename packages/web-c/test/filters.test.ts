import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filtersToApiQuery,
  filtersToQueryString,
  parseFilters,
  queueUrl,
  toggleSort,
} from '../src/lib/filters.js';

describe('URL ↔ filter state mapping', () => {
  it('returns defaults for an empty query', () => {
    expect(parseFilters({})).toEqual(DEFAULT_FILTERS);
    expect(filtersToQueryString(DEFAULT_FILTERS)).toBe('');
    expect(queueUrl(DEFAULT_FILTERS)).toBe('/');
  });

  it('parses repeated and comma-separated multi-values, dropping unknowns and duplicates', () => {
    const f = parseFilters({ status: ['pending', 'in_review,bogus', 'pending'], riskLevel: 'high,low' });
    expect(f.status).toEqual(['pending', 'in_review']);
    expect(f.riskLevel).toEqual(['high', 'low']);
  });

  it('validates sort, order and page', () => {
    expect(parseFilters({ sort: 'riskScore', order: 'asc', page: '3' })).toMatchObject({
      sort: 'riskScore',
      order: 'asc',
      page: 3,
    });
    expect(parseFilters({ sort: 'evil', order: 'sideways', page: '-2' })).toMatchObject({
      sort: 'createdAt',
      order: 'desc',
      page: 1,
    });
    expect(parseFilters({ page: 'abc' }).page).toBe(1);
  });

  it('round-trips through the browser query string', () => {
    const f = parseFilters({ status: 'escalated', riskLevel: 'high', q: '  Priya ', sort: 'updatedAt', page: '2' });
    const qs = filtersToQueryString(f);
    expect(qs).toBe('status=escalated&riskLevel=high&q=Priya&sort=updatedAt&page=2');
    expect(parseFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual(f);
  });

  it('builds the API query with comma-separated values and a fixed page size', () => {
    const f = parseFilters({ status: ['pending', 'in_review'], riskLevel: 'high', q: 'x' });
    expect(filtersToApiQuery(f).toString()).toBe(
      'status=pending%2Cin_review&riskLevel=high&q=x&sort=createdAt&order=desc&page=1&pageSize=25',
    );
  });

  it('toggles sort order and resets the page', () => {
    const f = { ...DEFAULT_FILTERS, page: 4 };
    const byScore = toggleSort(f, 'riskScore');
    expect(byScore).toMatchObject({ sort: 'riskScore', order: 'desc', page: 1 });
    expect(toggleSort(byScore, 'riskScore').order).toBe('asc');
  });
});
