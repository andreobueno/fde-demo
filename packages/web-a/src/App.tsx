import { BrowserRouter, Link, Outlet, Route, Routes } from 'react-router-dom';
import { AnalystProvider, useAnalyst } from './analyst/AnalystContext';
import { CasePage } from './pages/CasePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { QueuePage } from './pages/QueuePage';

function Layout() {
  const { analystId, setAnalystId, analysts } = useAnalyst();
  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 24px',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Link to="/" style={{ fontWeight: 700, color: 'var(--color-text)' }}>
          KYC Review Console
        </Link>
        <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          Analyst
          <select value={analystId} onChange={(e) => setAnalystId(e.target.value)}>
            {analysts.length === 0 ? <option value={analystId}>{analystId}</option> : null}
            {analysts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.role})
              </option>
            ))}
          </select>
        </label>
      </header>
      <Outlet />
    </div>
  );
}

export function App() {
  return (
    <AnalystProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<QueuePage />} />
            <Route path="/cases/:id" element={<CasePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AnalystProvider>
  );
}
