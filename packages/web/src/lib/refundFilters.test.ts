import { describe, expect, it } from 'vitest';
import {
  AMOUNT_BANDS, DEFAULT_REFUND_FILTERS, REFUND_SORTS,
  parseRefundFilters, refundFiltersToQuery, serializeRefundFilters, type RefundFilters,
} from './refundFilters';

describe('refund URL filters', () => {
  it('starts with all records and stable newest-first pagination', () => {
    expect(parseRefundFilters(new URLSearchParams())).toEqual(DEFAULT_REFUND_FILTERS);
    expect(refundFiltersToQuery(DEFAULT_REFUND_FILTERS)).toBe('page=1&pageSize=25');
  });

  it.each(AMOUNT_BANDS)('roundtrips the $value amount band alongside search, multi-filters and sort', ({ value }) => {
    const filters: RefundFilters = {
      status: ['pending', 'approved'], riskLevel: ['medium', 'high'], amountBand: value,
      q: 'RF-1023 & customer', sort: 'amountCents', order: 'asc', page: 2,
    };
    expect(parseRefundFilters(serializeRefundFilters(filters))).toEqual(filters);
    const query = new URLSearchParams(refundFiltersToQuery(filters));
    expect(query.get('q')).toBe(filters.q);
    expect(query.get('page')).toBe('2');
    expect(query.get('pageSize')).toBe('25');
  });

  it.each(REFUND_SORTS)('supports the %s table sort key in bookmarked filters', (sort) => {
    const filters = { ...DEFAULT_REFUND_FILTERS, sort };
    expect(parseRefundFilters(serializeRefundFilters(filters)).sort).toBe(sort);
  });

  it('ignores unknown enum values and caps search to the server contract', () => {
    const parsed = parseRefundFilters(new URLSearchParams({
      status: 'bogus,pending,in_review', riskLevel: 'high,unknown',
      amountBand: 'negative', sort: 'DROP TABLE refunds', order: 'bad', q: 'a'.repeat(200),
    }));
    expect(parsed).toEqual({
      ...DEFAULT_REFUND_FILTERS, status: ['pending'], riskLevel: ['high'], q: 'a'.repeat(100),
    });
  });

  it.each(['-1', '0', '2.5', '12oops', 'Infinity', '9007199254740992'])('rejects invalid page %s', (page) => {
    expect(parseRefundFilters(new URLSearchParams({ page })).page).toBe(1);
  });
});
