import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAnalyst } from '../analyst/AnalystContext';
import { getRefundStats, listRefunds } from '../api/refunds';
import type { Refund, RefundSort, RefundStats } from '../api/types';
import { useApi } from '../api/useApi';
import { Badge } from '../components/Badge';
import { DataTable, type TableColumn } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { FilterChips } from '../components/FilterChips';
import { Loading } from '../components/Loading';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { formatDateTime, formatUsdCents } from '../lib/format';
import {
  AMOUNT_BANDS, DEFAULT_REFUND_FILTERS, REFUND_STATUSES, RISK_LEVELS,
  parseRefundFilters, serializeRefundFilters, type RefundFilters,
} from '../lib/refundFilters';
import styles from '../components/Queue.module.css';

const columns: TableColumn<Refund, RefundSort>[] = [
  { key: 'reference', label: 'Refund', render: (refund) => <span className="mono">{refund.reference}</span> },
  { key: 'customer', label: 'Customer', render: (refund) => refund.customer.fullName },
  { key: 'amountCents', label: 'Amount', render: (refund) => formatUsdCents(refund.amountCents) },
  { key: 'status', label: 'Status', render: (refund) => <Badge kind="status" value={refund.status} /> },
  { key: 'riskLevel', label: 'Risk', render: (refund) => <Badge kind="risk" value={refund.riskLevel} /> },
  { key: 'createdAt', label: 'Created', render: (refund) => formatDateTime(refund.createdAt) },
];

export function RefundQueuePage() {
  const { analystId } = useAnalyst();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseRefundFilters(params), [params]);
  const navigate = useNavigate();
  const list = useApi((signal) => listRefunds(filters, analystId, signal), [JSON.stringify(filters), analystId]);
  const stats = useApi((signal) => getRefundStats(analystId, signal), [analystId]);
  const setFilters = (next: RefundFilters) => setParams(serializeRefundFilters(next));
  const onSort = (sort: RefundSort) => setFilters({
    ...filters,
    sort,
    order: sort === filters.sort ? (filters.order === 'asc' ? 'desc' : 'asc')
      : ['amountCents', 'createdAt', 'riskLevel'].includes(sort) ? 'desc' : 'asc',
    page: 1,
  });

  return (
    <div className={styles.page}>
      <h1>Refunds</h1>
      <p>Approval decisions only. No money is moved by this prototype.</p>
      {stats.error ? <ErrorState error={stats.error} onRetry={stats.reload} /> : stats.data ? (
        <RefundStatsBar stats={stats.data} onPending={() => setFilters({ ...filters, status: ['pending'], page: 1 })} />
      ) : <Loading />}
      <div className={styles.filterBar}>
        <SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q, page: 1 })} placeholder="Search refund, customer, transaction…" />
        <FilterChips
          label="Status"
          options={REFUND_STATUSES}
          selected={filters.status}
          onToggle={(status) => setFilters({
            ...filters,
            status: filters.status.includes(status) ? filters.status.filter((s) => s !== status) : [...filters.status, status],
            page: 1,
          })}
        />
        <label>
          Amount{' '}
          <select
            value={filters.amountBand}
            onChange={(event) => setFilters({
              ...filters,
              amountBand: AMOUNT_BANDS.find((band) => band.value === event.target.value)?.value ?? 'all',
              page: 1,
            })}
          >
            {AMOUNT_BANDS.map((band) => <option key={band.value} value={band.value}>{band.label}</option>)}
          </select>
        </label>
        <FilterChips
          label="Risk"
          options={RISK_LEVELS}
          selected={filters.riskLevel}
          onToggle={(riskLevel) => setFilters({
            ...filters,
            riskLevel: filters.riskLevel.includes(riskLevel) ? filters.riskLevel.filter((r) => r !== riskLevel) : [...filters.riskLevel, riskLevel],
            page: 1,
          })}
        />
        {params.size > 0 ? <button type="button" onClick={() => setFilters(DEFAULT_REFUND_FILTERS)}>Clear filters</button> : null}
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading || !list.data ? (
        <Loading />
      ) : (
        <>
          <DataTable
            items={list.data.items}
            columns={columns}
            sort={filters.sort}
            order={filters.order}
            onSort={onSort}
            onOpen={(id) => navigate(`/refunds/${encodeURIComponent(id)}`)}
            label="Refunds"
            emptyMessage="No refunds match these filters."
          />
          <Pagination total={list.data.total} page={list.data.page} pageSize={list.data.pageSize} onPage={(page) => setFilters({ ...filters, page })} />
        </>
      )}
    </div>
  );
}

export function RefundStatsBar({ stats, onPending }: { stats: RefundStats; onPending: () => void }) {
  return (
    <div className={styles.statsBar} aria-label="All refunds summary">
      <button type="button" onClick={onPending}>Pending approval: {stats.pendingCount}</button>
      <span>Pending amount: <strong>{formatUsdCents(stats.pendingAmountCents)}</strong></span>
      <span>Approved today: <strong>{stats.approvedToday}</strong></span>
      <span>Rejected today: <strong>{stats.rejectedToday}</strong></span>
      <span className={styles.chipGroupLabel}>All refunds · Today uses UTC</span>
    </div>
  );
}
