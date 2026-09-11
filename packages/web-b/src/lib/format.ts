import type { CaseStatus, RiskLevel } from '@/api/types';
export const formatDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
export const formatDateTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
export const yesNo = (b: boolean) => b ? 'Yes' : 'No';
export const formatUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export const statusLabel = (s: CaseStatus | null) => s ? s.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—';
export const riskLabel = (s: RiskLevel) => s.charAt(0).toUpperCase() + s.slice(1);
