import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AnalystProvider } from '@/lib/analyst';
import { AppLayout } from '@/components/AppLayout';
import { QueuePage } from '@/pages/QueuePage';
import { CaseDetailPage } from '@/pages/CaseDetailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
const queryClient = new QueryClient();
export function App() { return <QueryClientProvider client={queryClient}><AnalystProvider><TooltipProvider><BrowserRouter><Routes><Route element={<AppLayout />}><Route path="/" element={<QueuePage />} /><Route path="/cases/:id" element={<CaseDetailPage />} /><Route path="*" element={<NotFoundPage />} /></Route></Routes></BrowserRouter><Toaster /></TooltipProvider></AnalystProvider></QueryClientProvider>; }
