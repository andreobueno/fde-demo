import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useAnalyst } from '@/lib/analyst';
import { AppLayout } from './AppLayout';

vi.mock('@/lib/analyst', () => ({ useAnalyst: vi.fn() }));

describe('verified identity header', () => {
  it.each(['analyst', 'senior_analyst', 'compliance_manager'] as const)(
    'renders the server-verified %s without a directory identity switcher',
    (role) => {
      vi.mocked(useAnalyst).mockReturnValue({
        status: 'authenticated',
        user: { id: 'ana-006', name: 'Verified user', role, permissions: ['cases:read'] },
        generation: 1,
        error: null,
        request: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
      });
      const html = renderToStaticMarkup(
        <StaticRouter location="/">
          <AppLayout />
        </StaticRouter>,
      );
      expect(html).toContain('Verified user');
      expect(html).toContain(role.replaceAll('_', ' '));
      expect(html).toContain('Sign out');
      expect(html).not.toContain('combobox');
    },
  );
});
