import type { CaseStatus } from '../api/types.js';

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC',
});

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${dateTimeFmt.format(d)} UTC`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function formatUsd(value: number): string {
  return usdFmt.format(value);
}

export function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

/** `cash_intensive_business` → `Cash intensive business` */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const STATUS_LABELS: Record<CaseStatus, string> = {
  pending: 'Pending',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  escalated: 'Escalated',
};

export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
