import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCaseStats, listCases } from '../api/client';
import { useApi } from '../api/useApi';
import { useAnalyst } from '../analyst/AnalystContext';
import type { CaseSort, CaseStats, CaseStatus, KycCase, RiskLevel } from '../api/types';
import { Badge } from '../components/Badge';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';
import { formatDateTime } from '../lib/format';
import {
  defaultOrderFor,
  parseQueueFilters,
  serializeQueueFilters,
  type QueueFilters,
} from '../lib/queueFilters';
import styles from './QueuePage.module.css';

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
          <CaseTable
            items={listResult.data.items}
            filters={filters}
            onSort={setSort}
            onOpen={(id) => navigate(`/cases/${id}`)}
            analystName={analystName}
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
  const [searchInput, setSearchInput] = useState(filters.q);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q]);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      onChange({ ...filters, q: value, page: 1 });
    }, 300);
  };

  const hasFilters =
    filters.status.length > 0 ||
    filters.riskLevel.length > 0 ||
    filters.q !== '' ||
    filters.sort !== 'createdAt' ||
    filters.order !== 'desc';

  return (
    <div className={styles.filterBar}>
      <div className={styles.chipGroup}>
        <span className={styles.chipGroupLabel}>Status</span>
        {ALL_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={`${styles.chip} ${filters.status.includes(status) ? styles.active : ''}`}
            onClick={() => onToggleStatus(status)}
          >
            {status.replace('_', ' ')}
          </button>
        ))}
      </div>
      <div className={styles.chipGroup}>
        <span className={styles.chipGroupLabel}>Risk</span>
        {ALL_RISK_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`${styles.chip} ${filters.riskLevel.includes(level) ? styles.active : ''}`}
            onClick={() => onToggleRisk(level)}
          >
            {level}
          </button>
        ))}
      </div>
      <input
        type="search"
        placeholder="Search reference, name, email…"
        value={searchInput}
        onChange={(e) => handleSearchChange(e.target.value)}
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

interface CaseTableProps {
  items: KycCase[];
  filters: QueueFilters;
  onSort: (sort: CaseSort) => void;
  onOpen: (id: string) => void;
  analystName: (id: string | null) => string;
}

function CaseTable({ items, filters, onSort, onOpen, analystName }: CaseTableProps) {
  if (items.length === 0) {
    return <div className={styles.empty}>No cases match these filters.</div>;
  }
  const header = (col: CaseSort, extraClass?: string) => {
    const active = filters.sort === col;
    const className = extraClass ? `${styles.sortable} ${extraClass}` : styles.sortable;
    return (
      <th
        className={className}
        aria-sort={active ? (filters.order === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button type="button" className={styles.sortButton} onClick={() => onSort(col)}>
          {SORT_LABELS[col]}
          {active ? (
            <span className={styles.sortArrow} aria-hidden="true">
              {filters.order === 'asc' ? '▲' : '▼'}
            </span>
          ) : (
            <span className={styles.sortArrowInactive} aria-hidden="true">
              ↕
            </span>
          )}
        </button>
      </th>
    );
  };
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            {header('reference')}
            {header('customer')}
            {header('country', styles.colCountry)}
            {header('riskScore')}
            {header('status')}
            {header('assignedTo', styles.colAssigned)}
            {header('createdAt')}
            {header('updatedAt')}
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr
              key={c.id}
              tabIndex={0}
              onClick={() => onOpen(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onOpen(c.id);
                }
              }}
            >
              <td className="mono">{c.reference}</td>
              <td>{c.customer.fullName}</td>
              <td className={styles.colCountry}>{c.customer.countryOfResidence}</td>
              <td>
                <Badge kind="risk" value={c.riskLevel} /> {c.riskScore}
              </td>
              <td>
                <Badge kind="status" value={c.status} />
              </td>
              <td className={styles.colAssigned}>{analystName(c.assignedTo)}</td>
              <td>{formatDateTime(c.createdAt)}</td>
              <td>{formatDateTime(c.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
}

function Pagination({ total, page, pageSize, onPage }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={styles.pagination}>
      <span>
        Showing {from}–{to} of {total}
      </span>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Prev
      </button>
      <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next
      </button>
      <span>
        Page {page} of {pageCount}
      </span>
    </div>
  );
}
