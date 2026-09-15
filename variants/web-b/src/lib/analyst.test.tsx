import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalystProvider } from './analyst';
import { SignInPage } from '@/pages/SignInPage';

afterEach(() => vi.unstubAllGlobals());

describe('sign-in boundary', () => {
  it('renders no protected page or query before sign-in, even with a stored demo identity', () => {
    const storage = { getItem: vi.fn(() => 'ana-001'), setItem: vi.fn() };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('fetch', fetchMock);
    const ProtectedPage = vi.fn(() => <div>Private case details</div>);
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AnalystProvider>
          <ProtectedPage />
        </AnalystProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain('Sign in');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('Private case details');
    expect(ProtectedPage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('renders accessible email/password inputs with no serialized credential and local guidance', () => {
    const html = renderToStaticMarkup(
      <SignInPage pending={false} error={null} onSignIn={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('type="email"');
    expect(html).toContain('for="email"');
    expect(html).toContain('for="password"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).not.toMatch(/\bvalue=/);
    expect(html).not.toContain('access-token');
    expect(html).toContain('sessionStorage');
    expect(html).toContain('JavaScript');
    expect(html).toContain('switch users');
    expect(html).toContain('grete.lindholm@northwind-demo.example');
    expect(html).toContain('marta.ellison@northwind-demo.example');
    expect(html).toContain('sofia.chen@northwind-demo.example');
    expect(html).toContain('demo-password-2026');
    expect(html).toContain('rejected in production');
    expect(html).not.toContain('combobox');
  });

  it('allows cancellation during sign-in and renders incorrect-credentials guidance', () => {
    const pendingHtml = renderToStaticMarkup(
      <SignInPage pending error={null} onSignIn={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(pendingHtml).toContain('Signing in');
    expect(pendingHtml).toContain('Cancel');
    expect(pendingHtml).toContain('disabled=""');
    const errorHtml = renderToStaticMarkup(
      <SignInPage
        pending={false}
        error="Incorrect email or password."
        onSignIn={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('Incorrect email or password');
  });

  it('announces restoration and prevents a competing form submission until cancelled', () => {
    const html = renderToStaticMarkup(
      <SignInPage restoring pending={false} error={null} onSignIn={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Restoring your session');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Cancel');
  });

  it('renders revocation failure on the signed-out screen', () => {
    const html = renderToStaticMarkup(
      <SignInPage
        pending={false}
        error="Server session revocation could not be confirmed."
        onSignIn={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('revocation could not be confirmed');
  });
});
