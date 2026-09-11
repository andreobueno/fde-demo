import { AlertCircle, Check, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { riskLabel, statusLabel } from '@/lib/format';
import type { CaseStatus, RiskLevel } from '@/api/types';

const statusColors: Record<CaseStatus, string> = {
  pending: 'bg-slate-100 text-slate-700 border-slate-200',
  in_review: 'bg-blue-50 text-blue-700 border-blue-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  escalated: 'bg-purple-50 text-purple-700 border-purple-200',
};
const riskColors: Record<RiskLevel, string> = {
  low: 'bg-green-50 text-green-700 border-green-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
};
export function StatusBadge({
  status,
  small = false,
}: {
  status: CaseStatus | null;
  small?: boolean;
}) {
  return (
    <Badge
      className={cn(
        status ? statusColors[status] : 'bg-slate-50 text-slate-500',
        small && 'text-[10px]',
      )}
    >
      {statusLabel(status)}
    </Badge>
  );
}
export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Badge className={riskColors[risk]}>{riskLabel(risk)}</Badge>;
}
export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-100 bg-red-50 p-10 text-center">
      <AlertCircle className="h-8 w-8 text-red-500" />
      <p className="text-sm text-red-700">{message}</p>
      <Button variant="outline" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 7 }, (_, i) => (
        <Skeleton className="h-14 w-full" key={i} />
      ))}
    </div>
  );
}
export function VerifyIcon({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex items-center gap-1 text-green-700">
      <Check className="h-4 w-4" />
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-red-600">
      <X className="h-4 w-4" />
      No
    </span>
  );
}
export function ChainIcon({ state }: { state: 'checking' | 'verified' | 'broken' }) {
  return state === 'verified' ? (
    <ShieldCheck className="h-4 w-4 text-green-600" />
  ) : state === 'broken' ? (
    <ShieldAlert className="h-4 w-4 text-red-600" />
  ) : (
    <ShieldCheck className="h-4 w-4 text-slate-400" />
  );
}
