import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RefundDetail } from '../api/types';
import { RefundRecord } from './RefundPage';
import { RefundStatsBar } from './RefundQueuePage';
import { formatUsdCents } from '../lib/format';

const refund: RefundDetail = {
  id: 'r-1', reference: 'RF-1023', customerId: 'c-1',
  customer: { id: 'c-1', fullName: 'Fictional Customer', email: 'refund@example.com' },
  amountCents: 243001, currency: 'USD', status: 'pending', riskLevel: 'medium',
  reason: 'Duplicate purchase',
  originalTransaction: { reference: 'TX-123', amountCents: 300099, occurredAt: '2026-09-10T12:00:00Z' },
  riskIndicators: [{ code: 'VELOCITY', title: 'Repeated requests', description: 'Three prior requests recorded.', severity: 'medium' }],
  createdAt: '2026-09-11T12:00:00Z', updatedAt: '2026-09-11T12:00:00Z',
  allowedActions: [], approvalNoteRequired: true, audit: [],
};

describe('refund detail presentation', () => {
  it('preserves exact cents, transaction context, reason and structured risk evidence', () => {
    const markup = renderToStaticMarkup(<RefundRecord refund={refund} onAction={() => {}} />);
    for (const text of ['RF-1023', 'Fictional Customer', 'TX-123', '$2,430.01', '$3,000.99', 'Duplicate purchase', 'Three prior requests recorded.']) {
      expect(markup).toContain(text);
    }
  });

  it('does not render decision buttons when the server denies actions', () => {
    const markup = renderToStaticMarkup(<RefundRecord refund={refund} onAction={() => {}} />);
    expect(markup).toContain('Your role has no permitted decisions');
    expect(markup).not.toContain('<button');
  });

  it('renders only actions explicitly granted by the server', () => {
    const markup = renderToStaticMarkup(<RefundRecord refund={{ ...refund, allowedActions: ['reject'] }} onAction={() => {}} />);
    expect(markup).toContain('>Reject</button>');
    expect(markup).not.toContain('>Approve</button>');
  });

  it.each(['approved', 'rejected'] as const)('explains the terminal %s state', (status) => {
    const markup = renderToStaticMarkup(<RefundRecord refund={{ ...refund, status }} onAction={() => {}} />);
    expect(markup).toContain('Refund closed');
    expect(markup).not.toContain('<button');
  });

  it('renders live statistics with their UTC scope and without rounding pending cents', () => {
    const markup = renderToStaticMarkup(<RefundStatsBar
      stats={{ pendingCount: 0, pendingAmountCents: 12345, approvedToday: 3, rejectedToday: 1 }}
      onPending={() => {}}
    />);
    expect(markup).toContain('Pending approval: 0');
    expect(markup).toContain('$123.45');
    expect(markup).toContain('Approved today: <strong>3</strong>');
    expect(markup).toContain('Today uses UTC');
  });

  it.each([[0, '$0.00'], [1, '$0.01'], [99999, '$999.99'], [100000, '$1,000.00'], [500001, '$5,000.01']] as const)(
    'formats %i cents without losing precision', (cents, formatted) => {
      expect(formatUsdCents(cents)).toBe(formatted);
    },
  );
});
