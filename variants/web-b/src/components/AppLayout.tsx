import { Link, Outlet } from 'react-router-dom';
import { useAnalyst } from '@/lib/analyst';
import { Button } from '@/components/ui/button';
export function AppLayout() {
  const { user, signOut } = useAnalyst();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-lg font-semibold tracking-tight">
              KYC Review Console
            </Link>
            <Link to="/" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Queue
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              {user?.name} ({user?.role.replaceAll('_', ' ')})
            </span>
            <Button variant="outline" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
