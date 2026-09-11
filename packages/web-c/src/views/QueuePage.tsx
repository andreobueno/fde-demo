import type { Analyst, CaseListResponse, CaseStats, KycCase } from '../api/types.js';
import { CASE_STATUSES, RISK_LEVELS } from '../api/types.js';
import type { QueueFilters, SortField } from '../lib/filters.js';
import { PAGE_SIZE, queueUrl, toggleSort } from '../lib/filters.js';
import { STATUS_LABELS, formatDateTime } from '../lib/format.js';
import { RiskBadge, StatusBadge } from './components.js';

export interface QueuePageProps {
  filters: QueueFilters;
  stats: CaseStats;
  result: CaseListResponse;
  analysts: Analyst[];
}

const HX_TABLE = {
  'hx-target': '#queue-results',
  'hx-swap': 'outerHTML',
} as const;

function analystName(analysts: Analyst[], id: string | null): string {
  if (id === null) return '—';
  return analysts.find((a) => a.id === id)?.name ?? id;
}

function SortHeader({
  filters,
  field,
  label,
  className,
}: {
  filters: QueueFilters;
  field: SortField;
  label: string;
  className?: string;
}) {
  const active = filters.sort === field;
  const next = toggleSort(filters, field);
  const arrow = active ? (filters.order === 'desc' ? ' ▼' : ' ▲') : '';
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (filters.order === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <a className="sort-link" href={queueUrl(next)} hx-get={queueUrl(next)} {...HX_TABLE}>
        {label}
        {arrow}
      </a>
    </th>
  );
}

export function QueueResults({ filters, result, analysts }: Omit<QueuePageProps, 'stats'>) {
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const from = result.total === 0 ? 0 : (result.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(result.total, result.page * PAGE_SIZE);
  const prev = result.page > 1 ? queueUrl({ ...filters, page: result.page - 1 }) : null;
  const next = result.page < totalPages ? queueUrl({ ...filters, page: result.page + 1 }) : null;

  return (
    <section id="queue-results" className="panel" aria-busy="false">
      <div className="table-wrap">
        <table className="cases">
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Customer</th>
              <th scope="col" className="col-optional">
                Country
              </th>
              <th scope="col">Risk</th>
              <SortHeader filters={filters} field="riskScore" label="Score" />
              <th scope="col">Status</th>
              <th scope="col" className="col-optional">
                Assigned to
              </th>
              <SortHeader filters={filters} field="updatedAt" label="Updated" className="col-optional" />
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty">
                  No cases match the current filters.{' '}
                  <a href="/" hx-get="/" {...HX_TABLE}>
                    Clear filters
                  </a>
                </td>
              </tr>
            ) : (
              result.items.map((c: KycCase) => (
                <tr key={c.id} data-href={`/cases/${encodeURIComponent(c.id)}`}>
                  <td>
                    <a className="ref-link" href={`/cases/${encodeURIComponent(c.id)}`}>
                      {c.reference}
                    </a>
                  </td>
                  <td>{c.customer.fullName}</td>
                  <td className="col-optional">{c.customer.countryOfResidence}</td>
                  <td>
                    <RiskBadge level={c.riskLevel} />
                  </td>
                  <td className="num">{c.riskScore}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="col-optional">{analystName(analysts, c.assignedTo)}</td>
                  <td className="col-optional muted">{formatDateTime(c.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <nav className="pagination" aria-label="Pagination">
        <span className="muted">
          Showing {from}–{to} of {result.total} cases
        </span>
        <span className="pager">
          {prev ? (
            <a className="btn btn-small" href={prev} hx-get={prev} {...HX_TABLE}>
              ‹ Previous
            </a>
          ) : (
            <span className="btn btn-small disabled">‹ Previous</span>
          )}
          <span>
            Page {result.page} of {totalPages}
          </span>
          {next ? (
            <a className="btn btn-small" href={next} hx-get={next} {...HX_TABLE}>
              Next ›
            </a>
          ) : (
            <span className="btn btn-small disabled">Next ›</span>
          )}
        </span>
      </nav>
    </section>
  );
}

export function QueuePage({ filters, stats, result, analysts }: QueuePageProps) {
  return (
    <>
      <div className="page-head">
        <h1>Case queue</h1>
        <ul className="stats" aria-label="Cases by status">
          {CASE_STATUSES.map((s) => (
            <li key={s} className={`stat stat-${s}`}>
              <span className="stat-value">{stats.byStatus[s]}</span>
              <span className="stat-label">{STATUS_LABELS[s]}</span>
            </li>
          ))}
          <li className="stat">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Total</span>
          </li>
        </ul>
      </div>

      <form
        id="queue-filters"
        className="panel filters"
        method="get"
        action="/"
        hx-get="/"
        hx-trigger="submit, change, input changed delay:300ms from:find input[name='q']"
        hx-indicator="#queue-results"
        {...HX_TABLE}
      >
        <div className="filter-group">
          <label htmlFor="q">Search</label>
          <input
            id="q"
            type="search"
            name="q"
            placeholder="Reference, name or email"
            defaultValue={filters.q}
            autoComplete="off"
          />
        </div>
        <fieldset className="filter-group chips">
          <legend>Status</legend>
          {CASE_STATUSES.map((s) => (
            <label key={s} className="chip">
              <input type="checkbox" name="status" value={s} defaultChecked={filters.status.includes(s)} />
              {STATUS_LABELS[s]}
            </label>
          ))}
        </fieldset>
        <fieldset className="filter-group chips">
          <legend>Risk level</legend>
          {RISK_LEVELS.map((r) => (
            <label key={r} className={`chip chip-risk-${r}`}>
              <input type="checkbox" name="riskLevel" value={r} defaultChecked={filters.riskLevel.includes(r)} />
              {r}
            </label>
          ))}
        </fieldset>
        <div className="filter-group">
          <label htmlFor="sort">Sort by</label>
          <span className="inline">
            <select id="sort" name="sort" defaultValue={filters.sort}>
              <option value="createdAt">Created</option>
              <option value="updatedAt">Updated</option>
              <option value="riskScore">Risk score</option>
            </select>
            <select name="order" aria-label="Sort order" defaultValue={filters.order}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </span>
        </div>
        <div className="filter-group filter-actions">
          <button type="submit" className="btn no-js-only">
            Apply
          </button>
          <a className="btn btn-link" href="/">
            Reset
          </a>
        </div>
      </form>

      <QueueResults filters={filters} result={result} analysts={analysts} />
    </>
  );
}
