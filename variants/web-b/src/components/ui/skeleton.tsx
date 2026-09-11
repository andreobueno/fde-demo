import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
export function Skeleton({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200', className)} {...p} />;
}
