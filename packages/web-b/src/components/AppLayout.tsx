import { Link, Outlet } from 'react-router-dom';
import { useAnalysts } from '@/api/queries';
import { useAnalyst } from '@/lib/analyst';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
export function AppLayout() {
  const { data: analysts = [] } = useAnalysts();
  const { analystId, setAnalystId } = useAnalyst();
  return <div className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b bg-white"><div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-6"><div className="flex items-center gap-8"><Link to="/" className="text-lg font-semibold tracking-tight">KYC Review Console</Link><Link to="/" className="text-sm font-medium text-slate-600 hover:text-slate-900">Queue</Link></div><div className="flex items-center gap-3"><span className="text-xs text-slate-500">Analyst</span><Select value={analystId} onValueChange={setAnalystId}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent>{analysts.map((a) => <SelectItem value={a.id} key={a.id}>{a.name} ({a.role.replace('_', ' ')})</SelectItem>)}</SelectContent></Select></div></div></header><main className="mx-auto max-w-[1500px] px-6 py-8"><Outlet /></main></div>;
}
