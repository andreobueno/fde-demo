import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AnalystSelector } from './AnalystSelector';

describe('authenticated identity controls', () => {
  it.each(['analyst', 'senior_analyst', 'compliance_manager'] as const)(
    'shows the authenticated %s and requires sign-out to switch identities', (role) => {
      const onSignOut = vi.fn();
      const html = renderToStaticMarkup(
        <AnalystSelector analyst={{ id: 'selected', name: 'Verified identity', role }} onSignOut={onSignOut} />,
      );
      expect(html).toContain(`Signed in as Verified identity (${role})`);
      expect(html).toContain('Sign out / switch user');
      expect(html).not.toContain('<select');
      expect(html).not.toContain('Default demo identity');
      expect(onSignOut).not.toHaveBeenCalled();
    },
  );
});
