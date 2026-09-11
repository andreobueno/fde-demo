import { BrowserRouter, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AnalystProvider, useAnalyst } from './analyst/AnalystContext';
import { CasePage } from './pages/CasePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { QueuePage } from './pages/QueuePage';
import { PolicyPage } from './pages/PolicyPage';
import { RefundQueuePage } from './pages/RefundQueuePage';
import { RefundPage } from './pages/RefundPage';

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
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <nav aria-label="Internal tools" style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <strong>Operations</strong>
          <NavLink to="/" end>KYC</NavLink>
          <NavLink to="/refunds">Refunds</NavLink>
          <NavLink to="/policy">KYC policy</NavLink>
        </nav>
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
            <Route path="/refunds" element={<RefundQueuePage />} />
            <Route path="/refunds/:id" element={<RefundPage />} />
            <Route path="/policy" element={<PolicyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AnalystProvider>
  );
}
