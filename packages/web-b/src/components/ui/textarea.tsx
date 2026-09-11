import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={cn('min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-400', className)} {...p} />; }
