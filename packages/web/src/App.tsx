import { BrowserRouter, Link, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AnalystProvider, useAnalyst } from './analyst/AnalystContext';
import { CasePage } from './pages/CasePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { QueuePage } from './pages/QueuePage';
import { PolicyPage } from './pages/PolicyPage';

function Layout() {
  const { analystId, setAnalystId, analysts } = useAnalyst();
  const { pathname } = useLocation();
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
        <Link to="/policy">Policy</Link>
        <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          Demo identity
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
      <Outlet key={`${analystId}:${pathname}`} />
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
            <Route path="/policy" element={<PolicyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AnalystProvider>
  );
}
