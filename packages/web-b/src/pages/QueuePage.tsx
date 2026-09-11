import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { useAnalysts, useCaseStats, useCases } from '@/api/queries';
import { ApiRequestError } from '@/api/client';
import type { CaseStatus, KycCase, RiskLevel } from '@/api/types';
import { DEFAULT_FILTERS, parseFilters, serializeFilters, type QueueFilters } from '@/lib/filters';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingState, EmptyState, ErrorState, RiskBadge, StatusBadge } from '@/components/common';

const statuses: CaseStatus[] = ['pending', 'in_review', 'approved', 'rejected', 'escalated'];
const risks: RiskLevel[] = ['low', 'medium', 'high'];
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => { const media = window.matchMedia(query); const update = () => setMatches(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, [query]);
  return matches;
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
  useEffect(() => setSearch(filters.q), [filters.q]);
  useEffect(() => { const timer = window.setTimeout(() => { if (search !== filters.q) setSearchParams((prev) => { const next = parseFilters(prev.toString()); next.q = search; next.page = 1; return serializeFilters(next); }, { replace: true }); }, 300); return () => window.clearTimeout(timer); }, [search, filters.q, setSearchParams]);
  const update = (changes: Partial<QueueFilters>, replace = false) => setSearchParams(serializeFilters({ ...filters, ...changes }), { replace });
  const toggle = <T extends string>(values: T[], value: T): T[] => values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  const columns = useMemo<ColumnDef<KycCase>[]>(() => [
    { accessorKey: 'reference', header: 'Reference', cell: ({ row }) => <span className="font-medium">{row.original.reference}</span> },
    { accessorKey: 'customer.fullName', header: 'Customer', cell: ({ row }) => row.original.customer.fullName },
    { id: 'country', accessorFn: (row) => row.customer.countryOfResidence, header: 'Country', meta: { hide: !wide } },
    { accessorKey: 'riskLevel', header: 'Risk level', cell: ({ row }) => <RiskBadge risk={row.original.riskLevel} /> },
    { accessorKey: 'riskScore', header: 'Risk score', enableSorting: true },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: 'assignedTo', accessorKey: 'assignedTo', header: 'Assigned to', meta: { hide: !wide }, cell: ({ row }) => analysts.find((a) => a.id === row.original.assignedTo)?.name ?? '—' },
    { accessorKey: 'updatedAt', header: 'Updated at', cell: ({ row }) => formatDateTime(row.original.updatedAt), enableSorting: true },
    { accessorKey: 'createdAt', header: 'Created', cell: ({ row }) => formatDateTime(row.original.createdAt), enableSorting: true, meta: { hide: !wide } },
  ], [analysts, wide]);
  const table = useReactTable({ data: cases.data?.items ?? [], columns, getCoreRowModel: getCoreRowModel(), manualSorting: true, state: { columnVisibility: { country: wide, assignedTo: wide, createdAt: wide } } });
  const totalPages = cases.data ? Math.max(1, Math.ceil(cases.data.total / cases.data.pageSize)) : 1;
  const sort = (column: string) => { const selected = column === 'riskScore' || column === 'updatedAt' || column === 'createdAt' ? column : null; if (!selected) return; update({ sort: selected, order: filters.sort === selected && filters.order === 'desc' ? 'asc' : 'desc', page: 1 }); };
  const caseError = cases.error instanceof ApiRequestError ? cases.error : undefined;
  return <div className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-slate-500">Operations</p><h1 className="text-2xl font-semibold">Case queue</h1></div>{stats && <div className="flex flex-wrap gap-2">{statuses.map((status) => <button key={status} className="rounded-full border bg-white px-3 py-1.5 text-xs hover:bg-slate-100" onClick={() => update({ status: toggle(filters.status, status), page: 1 })}><span className="font-medium">{status.replace('_', ' ')}</span><span className="ml-2 text-slate-500">{stats.byStatus[status]}</span></button>)}</div>}</div><Card><CardContent className="flex flex-wrap items-center gap-3 p-4"><div className="relative min-w-60 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cases, customers, email..." /></div><div className="flex flex-wrap gap-1.5">{statuses.map((status) => <Button key={status} size="sm" variant={filters.status.includes(status) ? 'default' : 'outline'} onClick={() => update({ status: toggle(filters.status, status), page: 1 })}>{status.replace('_', ' ')}</Button>)}{risks.map((risk) => <Button key={risk} size="sm" variant={filters.riskLevel.includes(risk) ? 'default' : 'outline'} onClick={() => update({ riskLevel: toggle(filters.riskLevel, risk), page: 1 })}>{risk}</Button>)}</div>{(filters.status.length || filters.riskLevel.length || filters.q) ? <Button size="sm" variant="ghost" onClick={() => { setSearch(''); update(DEFAULT_FILTERS); }}>Clear filters</Button> : null}</CardContent></Card>{cases.isLoading ? <LoadingState /> : cases.isError ? <ErrorState message={caseError?.status === 0 ? 'Cannot reach the API. Is the server running on port 4000?' : caseError?.message ?? 'Unable to load cases'} retry={() => void cases.refetch()} /> : !cases.data?.items.length ? <EmptyState message="No cases match these filters" /> : <><div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm"><thead className="border-b bg-slate-50"><tr>{table.getHeaderGroups()[0]?.headers.map((header) => <th key={header.id} className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${header.column.columnDef.meta && (header.column.columnDef.meta as { hide?: boolean }).hide ? 'hidden' : ''}`}><button className="flex items-center gap-1" onClick={() => sort(header.column.id)}>{flexRender(header.column.columnDef.header, header.getContext())}{filters.sort === header.column.id && (filters.order === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}</button></th>)}</tr></thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} tabIndex={0} className="cursor-pointer border-b hover:bg-slate-50 focus:bg-slate-50" onClick={() => navigate(`/cases/${row.original.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/cases/${row.original.id}`); }}>{row.getVisibleCells().map((cell) => <td key={cell.id} className={`whitespace-nowrap px-4 py-3 ${cell.column.columnDef.meta && (cell.column.columnDef.meta as { hide?: boolean }).hide ? 'hidden' : ''}`}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500"><span>Showing {((filters.page - 1) * 25) + 1}–{Math.min(filters.page * 25, cases.data.total)} of {cases.data.total}</span><div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}>Prev</Button><span>Page {filters.page} of {totalPages}</span><Button variant="outline" size="sm" disabled={filters.page >= totalPages} onClick={() => update({ page: filters.page + 1 })}>Next</Button></div></div></>}</div>;
}
