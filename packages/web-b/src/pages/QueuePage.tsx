import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Header,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';

import { ApiRequestError } from '@/api/client';
import { useAnalysts, useCaseStats, useCases } from '@/api/queries';
import type { CaseStatus, KycCase, RiskLevel } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState, RiskBadge, StatusBadge } from '@/components/common';
import { DEFAULT_FILTERS, parseFilters, serializeFilters, type QueueFilters } from '@/lib/filters';
import { formatDateTime } from '@/lib/format';

const STATUSES: CaseStatus[] = ['pending', 'in_review', 'approved', 'rejected', 'escalated'];
const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high'];
const SORTABLE_COLUMNS = ['riskScore', 'updatedAt', 'createdAt'] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

interface ColumnMeta {
  hide?: boolean;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

function useDebouncedSearch(
  search: string,
  currentSearch: string,
  onSearch: (value: string) => void,
) {
  useEffect(() => {
    if (search === currentSearch) return;

    const timer = window.setTimeout(() => onSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [currentSearch, onSearch, search]);
}

function isColumnHidden(header: Header<KycCase, unknown>) {
  return Boolean((header.column.columnDef.meta as ColumnMeta | undefined)?.hide);
}

function StatChips({
  counts,
  onToggle,
}: {
  counts: Record<CaseStatus, number>;
  onToggle: (status: CaseStatus) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {STATUSES.map((status) => (
        <button
          key={status}
          className="rounded-full border bg-white px-3 py-1.5 text-xs hover:bg-slate-100"
          onClick={() => onToggle(status)}
        >
          <span className="font-medium">{status.replace('_', ' ')}</span>
          <span className="ml-2 text-slate-500">{counts[status]}</span>
        </button>
      ))}
    </div>
  );
}

function FilterChips({
  filters,
  onToggleStatus,
  onToggleRisk,
}: {
  filters: QueueFilters;
  onToggleStatus: (status: CaseStatus) => void;
  onToggleRisk: (risk: RiskLevel) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUSES.map((status) => (
        <Button
          key={status}
          size="sm"
          variant={filters.status.includes(status) ? 'default' : 'outline'}
          onClick={() => onToggleStatus(status)}
        >
          {status.replace('_', ' ')}
        </Button>
      ))}
      {RISK_LEVELS.map((risk) => (
        <Button
          key={risk}
          size="sm"
          variant={filters.riskLevel.includes(risk) ? 'default' : 'outline'}
          onClick={() => onToggleRisk(risk)}
        >
          {risk}
        </Button>
      ))}
    </div>
  );
}

function SortIcon({ filters, column }: { filters: QueueFilters; column: string }) {
  if (filters.sort !== column) return null;
  return filters.order === 'desc' ? (
    <ArrowDown className="h-3 w-3" />
  ) : (
    <ArrowUp className="h-3 w-3" />
  );
}

function QueueTable({
  table,
  filters,
  onSort,
  onOpenCase,
}: {
  table: ReturnType<typeof useReactTable<KycCase>>;
  filters: QueueFilters;
  onSort: (column: string) => void;
  onOpenCase: (id: string) => void;
}) {
  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="border-b bg-slate-50">
          <tr>
            {headers.map((header) => (
              <th
                key={header.id}
                className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                  isColumnHidden(header) ? 'hidden' : ''
                }`}
              >
                <button
                  className="flex items-center gap-1"
                  onClick={() => onSort(header.column.id)}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  <SortIcon filters={filters} column={header.column.id} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              tabIndex={0}
              className="cursor-pointer border-b hover:bg-slate-50 focus:bg-slate-50"
              onClick={() => onOpenCase(row.original.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onOpenCase(row.original.id);
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={`whitespace-nowrap px-4 py-3 ${
                    (cell.column.columnDef.meta as ColumnMeta | undefined)?.hide ? 'hidden' : ''
                  }`}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <span>
        Showing {firstItem}–{lastItem} of {total}
      </span>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Prev
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function QueuePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams.toString());
  const [search, setSearch] = useState(filters.q);
  const wide = useMediaQuery('(min-width: 1280px)');
  const { data: stats } = useCaseStats();
  const { data: analysts = [] } = useAnalysts();
  const cases = useCases(filters);

  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);

  const updateSearch = useCallback(
    (value: string) => {
      setSearchParams(
        (previous) => {
          const next = parseFilters(previous.toString());
          next.q = value;
          next.page = 1;
          return serializeFilters(next);
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  useDebouncedSearch(search, filters.q, updateSearch);

  const updateFilters = (changes: Partial<QueueFilters>, replace = false) => {
    setSearchParams(serializeFilters({ ...filters, ...changes }), { replace });
  };

  const toggleStatus = (status: CaseStatus) => {
    const nextStatus = filters.status.includes(status)
      ? filters.status.filter((item) => item !== status)
      : [...filters.status, status];
    updateFilters({ status: nextStatus, page: 1 });
  };

  const toggleRisk = (risk: RiskLevel) => {
    const nextRisk = filters.riskLevel.includes(risk)
      ? filters.riskLevel.filter((item) => item !== risk)
      : [...filters.riskLevel, risk];
    updateFilters({ riskLevel: nextRisk, page: 1 });
  };

  const clearFilters = () => {
    setSearch('');
    updateFilters(DEFAULT_FILTERS);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
  };

  const handleOpenCase = (id: string) => {
    navigate(`/cases/${id}`);
  };

  const handleSort = (column: string) => {
    if (!SORTABLE_COLUMNS.includes(column as SortableColumn)) return;
    const selected = column as SortableColumn;
    const order = filters.sort === selected && filters.order === 'desc' ? 'asc' : 'desc';
    updateFilters({ sort: selected, order, page: 1 });
  };

  const columns = useMemo<ColumnDef<KycCase>[]>(
    () => [
      {
        accessorKey: 'reference',
        header: 'Reference',
        cell: ({ row }) => <span className="font-medium">{row.original.reference}</span>,
      },
      {
        accessorKey: 'customer.fullName',
        header: 'Customer',
        cell: ({ row }) => row.original.customer.fullName,
      },
      {
        id: 'country',
        accessorFn: (row) => row.customer.countryOfResidence,
        header: 'Country',
        meta: { hide: !wide },
      },
      {
        accessorKey: 'riskLevel',
        header: 'Risk level',
        cell: ({ row }) => <RiskBadge risk={row.original.riskLevel} />,
      },
      { accessorKey: 'riskScore', header: 'Risk score', enableSorting: true },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'assignedTo',
        accessorKey: 'assignedTo',
        header: 'Assigned to',
        meta: { hide: !wide },
        cell: ({ row }) => analysts.find((a) => a.id === row.original.assignedTo)?.name ?? '—',
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated at',
        cell: ({ row }) => formatDateTime(row.original.updatedAt),
        enableSorting: true,
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => formatDateTime(row.original.createdAt),
        enableSorting: true,
        meta: { hide: !wide },
      },
    ],
    [analysts, wide],
  );

  const table = useReactTable({
    data: cases.data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: {
      columnVisibility: { country: wide, assignedTo: wide, createdAt: wide },
    },
  });
  const totalPages = cases.data
    ? Math.max(1, Math.ceil(cases.data.total / cases.data.pageSize))
    : 1;
  const handlePageChange = (page: number) => {
    updateFilters({ page });
  };
  const caseError = cases.error instanceof ApiRequestError ? cases.error : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">Operations</p>
          <h1 className="text-2xl font-semibold">Case queue</h1>
        </div>
        {stats && <StatChips counts={stats.byStatus} onToggle={toggleStatus} />}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Search cases, customers, email..."
            />
          </div>
          <FilterChips filters={filters} onToggleStatus={toggleStatus} onToggleRisk={toggleRisk} />
          {(filters.status.length > 0 || filters.riskLevel.length > 0 || filters.q.length > 0) && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {cases.isLoading ? (
        <LoadingState />
      ) : cases.isError ? (
        <ErrorState
          message={
            caseError?.status === 0
              ? 'Cannot reach the API. Is the server running on port 4000?'
              : (caseError?.message ?? 'Unable to load cases')
          }
          retry={() => void cases.refetch()}
        />
      ) : !cases.data?.items.length ? (
        <EmptyState message="No cases match these filters" />
      ) : (
        <>
          <QueueTable
            table={table}
            filters={filters}
            onSort={handleSort}
            onOpenCase={handleOpenCase}
          />
          <Pagination
            page={filters.page}
            totalPages={totalPages}
            pageSize={cases.data.pageSize}
            total={cases.data.total}
            onPageChange={handlePageChange}
          />
        </>
      )}
    </div>
  );
}
