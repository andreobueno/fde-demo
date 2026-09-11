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

  it('renders a password input with no serialized credential and useful sign-in guidance', () => {
    const html = renderToStaticMarkup(
      <SignInPage pending={false} error={null} onSignIn={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).not.toMatch(/\bvalue=/);
    expect(html).toContain('administrator');
    expect(html).toContain('memory only');
    expect(html).toContain('switch users');
    expect(html).not.toContain('combobox');
  });

  it('allows cancellation while verifying and renders rejected-token guidance', () => {
    const pendingHtml = renderToStaticMarkup(
      <SignInPage pending error={null} onSignIn={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(pendingHtml).toContain('Verifying');
    expect(pendingHtml).toContain('Cancel');
    expect(pendingHtml).toContain('disabled=""');
    const errorHtml = renderToStaticMarkup(
      <SignInPage
        pending={false}
        error="Token expired. Please sign in again."
        onSignIn={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('Token expired');
  });
});
