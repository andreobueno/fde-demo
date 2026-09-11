import { Link } from 'react-router-dom';
export function NotFoundPage() { return <div className="flex min-h-96 flex-col items-center justify-center gap-3"><h1 className="text-2xl font-semibold">Page not found</h1><p className="text-sm text-slate-500">The page you requested does not exist.</p><Link to="/" className="text-sm text-blue-700 hover:underline">Back to queue</Link></div>; }
