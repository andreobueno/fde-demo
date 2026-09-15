import { BrowserRouter, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AnalystProvider, useAnalyst } from './analyst/AnalystContext';
import { AnalystSelector } from './analyst/AnalystSelector';
import { ManualIdentityForm } from './analyst/ManualIdentityForm';
import { CasePage } from './pages/CasePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RiskPolicyPage } from './pages/RiskPolicyPage';
import { QueuePage } from './pages/QueuePage';
import { PolicyPage } from './pages/PolicyPage';
import { RefundQueuePage } from './pages/RefundQueuePage';
import { RefundPage } from './pages/RefundPage';

function Layout() {
  const { analystId, analyst, signOut, restoring, authError, retryRestore } = useAnalyst();
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
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {analyst ? <AnalystSelector analyst={analyst} onSignOut={signOut} /> : null}
        </div>
      </header>
      {authError ? (
        <div role="alert" style={{ padding: 24 }}>
          <p>{authError}</p>
          <button onClick={retryRestore}>Retry session check</button>
        </div>
      ) : null}
      {restoring ? <p role="status">Checking your session…</p>
        : analyst ? <Outlet key={`${analystId}:${pathname}`} /> : <ManualIdentityForm />}
    </div>
  );
}

function PolicyLayout() {
  return (
    <>
      <nav aria-label="KYC policy sections" style={{ display: 'flex', gap: 20, padding: '16px 24px' }}>
        <NavLink to="/policy" end>Approval notes</NavLink>
        <NavLink to="/policy/risk">Risk scoring</NavLink>
      </nav>
      <Outlet />
    </>
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
            <Route path="/policy" element={<PolicyLayout />}>
              <Route index element={<PolicyPage />} />
              <Route path="risk" element={<RiskPolicyPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AnalystProvider>
  );
}
