import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalystProvider, useAnalyst } from './AnalystContext';

function SelectedIdentity() {
  const { analystId, analyst } = useAnalyst();
  return <span>{analyst ? analystId : 'Sign in required'}</span>;
}

afterEach(() => vi.unstubAllGlobals());

describe('initial authenticated identity', () => {
  it.each([null, 'ana-003', 'ana-006', 'removed-analyst'])(
    'never trusts a stored identity (%s) or loads a default actor', (stored) => {
      const getItem = vi.fn(() => stored);
      vi.stubGlobal('window', { localStorage: { getItem } });
      const html = renderToString(<AnalystProvider><SelectedIdentity /></AnalystProvider>);
      expect(html).toBe('<span>Sign in required</span>');
      expect(getItem).not.toHaveBeenCalled();
    },
  );
});
