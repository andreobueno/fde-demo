import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCaseStats, listCases } from '../api/client';
import { useApi } from '../api/useApi';
import { useAnalyst } from '../analyst/AnalystContext';
import type { CaseSort, CaseStats, CaseStatus, KycCase, RiskLevel } from '../api/types';
import { Badge } from '../components/Badge';
import { DataTable, type TableColumn } from '../components/DataTable';
import { FilterChips } from '../components/FilterChips';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';
import { formatDateTime } from '../lib/format';
import {
  defaultOrderFor,
  parseQueueFilters,
  serializeQueueFilters,
  type QueueFilters,
} from '../lib/queueFilters';
import styles from '../components/Queue.module.css';

const ALL_STATUSES: CaseStatus[] = ['pending', 'in_review', 'approved', 'rejected', 'escalated'];
const ALL_RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high'];
const SORT_LABELS: Record<CaseSort, string> = {
  reference: 'Reference',
  customer: 'Customer',
  country: 'Country',
  riskScore: 'Risk',
  status: 'Status',
  assignedTo: 'Assigned to',
  createdAt: 'Created',
  updatedAt: 'Updated',
};

export function QueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseQueueFilters(searchParams), [searchParams]);
  const { analystId, analysts } = useAnalyst();
  const navigate = useNavigate();

  const setFilters = (next: QueueFilters) => {
    setSearchParams(serializeQueueFilters(next));
  };

  const listResult = useApi(
    (signal) => listCases(filters, analystId, signal),
    [JSON.stringify(filters), analystId],
  );
  const statsResult = useApi((signal) => getCaseStats(analystId, signal), [analystId]);

  const analystName = (id: string | null): string => {
    if (!id) {
      return '—';
    }
    return analysts.find((a) => a.id === id)?.name ?? id;
  };
  const columns: TableColumn<KycCase, CaseSort>[] = [
    { key: 'reference', label: 'Reference', render: (c) => <span className="mono">{c.reference}</span> },
    { key: 'customer', label: 'Customer', render: (c) => c.customer.fullName },
    { key: 'country', label: 'Country', className: styles.colCountry, render: (c) => c.customer.countryOfResidence },
    { key: 'riskScore', label: 'Risk', render: (c) => <><Badge kind="risk" value={c.riskLevel} /> {c.riskScore}</> },
    { key: 'status', label: 'Status', render: (c) => <Badge kind="status" value={c.status} /> },
    { key: 'assignedTo', label: 'Assigned to', className: styles.colAssigned, render: (c) => analystName(c.assignedTo) },
    { key: 'createdAt', label: 'Created', render: (c) => formatDateTime(c.createdAt) },
    { key: 'updatedAt', label: 'Updated', render: (c) => formatDateTime(c.updatedAt) },
  ];

  const toggleStatus = (status: CaseStatus) => {
    const next = filters.status.includes(status)
      ? filters.status.filter((s) => s !== status)
      : [...filters.status, status];
    setFilters({ ...filters, status: next, page: 1 });
  };

  const toggleRiskLevel = (level: RiskLevel) => {
    const next = filters.riskLevel.includes(level)
      ? filters.riskLevel.filter((r) => r !== level)
      : [...filters.riskLevel, level];
    setFilters({ ...filters, riskLevel: next, page: 1 });
  };

  const setSort = (sort: CaseSort) => {
    if (filters.sort === sort) {
      setFilters({ ...filters, order: filters.order === 'asc' ? 'desc' : 'asc', page: 1 });
    } else {
      setFilters({ ...filters, sort, order: defaultOrderFor(sort), page: 1 });
    }
  };

  return (
    <div className={styles.page}>
      <StatsBar
        stats={statsResult.data}
        activeStatuses={filters.status}
        onToggle={toggleStatus}
      />
      <FilterBar filters={filters} onChange={setFilters} onToggleStatus={toggleStatus} onToggleRisk={toggleRiskLevel} />
      {listResult.error ? (
        <ErrorState error={listResult.error} onRetry={listResult.reload} />
      ) : listResult.loading && !listResult.data ? (
        <Loading />
      ) : listResult.data ? (
        <>
          <DataTable
            items={listResult.data.items}
            columns={columns}
            sort={filters.sort}
            order={filters.order}
            onSort={setSort}
            onOpen={(id) => navigate(`/cases/${id}`)}
            label="KYC cases"
            emptyMessage="No cases match these filters."
          />
          <Pagination
            total={listResult.data.total}
            page={listResult.data.page}
            pageSize={listResult.data.pageSize}
            onPage={(page) => setFilters({ ...filters, page })}
          />
        </>
      ) : null}
    </div>
  );
}

interface StatsBarProps {
  stats: CaseStats | null;
  activeStatuses: CaseStatus[];
  onToggle: (status: CaseStatus) => void;
}

function StatsBar({ stats, activeStatuses, onToggle }: StatsBarProps) {
  if (!stats) {
    return null;
  }
  return (
    <div className={styles.statsBar}>
      <span className={styles.chipGroupLabel}>Total: {stats.total}</span>
      {ALL_STATUSES.map((status) => {
        const count = stats.byStatus[status] ?? 0;
        const active = activeStatuses.includes(status);
        return (
          <button
            key={status}
            type="button"
            className={`${styles.chip} ${styles.statChip} ${active ? styles.active : ''}`}
            onClick={() => onToggle(status)}
          >
            {status.replace('_', ' ')}: {count}
          </button>
        );
      })}
    </div>
  );
}

interface FilterBarProps {
  filters: QueueFilters;
  onChange: (next: QueueFilters) => void;
  onToggleStatus: (status: CaseStatus) => void;
  onToggleRisk: (level: RiskLevel) => void;
}

function FilterBar({ filters, onChange, onToggleStatus, onToggleRisk }: FilterBarProps) {
  const hasFilters =
    filters.status.length > 0 ||
    filters.riskLevel.length > 0 ||
    filters.q !== '' ||
    filters.sort !== 'createdAt' ||
    filters.order !== 'desc';

  return (
    <div className={styles.filterBar}>
      <FilterChips label="Status" options={ALL_STATUSES} selected={filters.status} onToggle={onToggleStatus} />
      <FilterChips label="Risk" options={ALL_RISK_LEVELS} selected={filters.riskLevel} onToggle={onToggleRisk} />
      <SearchInput
        placeholder="Search reference, name, email…"
        value={filters.q}
        onChange={(q) => onChange({ ...filters, q, page: 1 })}
      />
      <select
        value={filters.sort}
        onChange={(e) => onChange({ ...filters, sort: e.target.value as CaseSort, page: 1 })}
        aria-label="Sort by"
      >
        {(Object.keys(SORT_LABELS) as CaseSort[]).map((key) => (
          <option key={key} value={key}>
            Sort: {SORT_LABELS[key]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() =>
          onChange({ ...filters, order: filters.order === 'asc' ? 'desc' : 'asc', page: 1 })
        }
        title="Toggle sort direction"
      >
        {filters.order === 'asc' ? '▲ Asc' : '▼ Desc'}
      </button>
      {hasFilters ? (
        <button
          type="button"
          onClick={() =>
            onChange({ status: [], riskLevel: [], q: '', sort: 'createdAt', order: 'desc', page: 1 })
          }
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
