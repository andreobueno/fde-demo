import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) { return <section className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)} {...p} />; }
export function CardHeader({ className, ...p }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('border-b border-slate-100 px-5 py-4', className)} {...p} />; }
export function CardTitle({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) { return <h2 className={cn('text-sm font-semibold text-slate-900', className)} {...p} />; }
export function CardContent({ className, ...p }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('p-5', className)} {...p} />; }
