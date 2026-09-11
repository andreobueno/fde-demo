import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) { return <input className={cn('flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-400', className)} {...p} />; }
