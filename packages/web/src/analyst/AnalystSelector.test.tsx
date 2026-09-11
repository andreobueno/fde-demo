import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalystProvider, useAnalyst } from './AnalystContext';
import { AnalystSelector } from './AnalystSelector';

function ConnectedSelector() {
  const { analystId, analysts, setAnalystId } = useAnalyst();
  return <AnalystSelector analystId={analystId} analysts={analysts} onChange={setAnalystId} />;
}

afterEach(() => vi.unstubAllGlobals());

describe('demo identity recovery', () => {
  it.each(['removed-analyst', 'ana-006'])(
    'offers safe recovery without silently changing the stored %s selection when no list is available',
    (storedId) => {
      const setItem = vi.fn();
      vi.stubGlobal('window', { localStorage: { getItem: () => storedId, setItem } });
      const html = renderToStaticMarkup(<AnalystProvider><ConnectedSelector /></AnalystProvider>);
      expect(html).toContain(`<option value="${storedId}" selected="">${storedId}</option>`);
      expect(html).toContain('<option value="ana-003">Default demo identity (ana-003)</option>');
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it('does not duplicate the default identity when already selected', () => {
    const html = renderToStaticMarkup(<AnalystSelector analystId="ana-003" analysts={[]} onChange={vi.fn()} />);
    expect(html.match(/<option /g)).toHaveLength(1);
    expect(html).toContain('<option value="ana-003" selected="">ana-003</option>');
  });

  it('uses the fetched default analyst details without adding a duplicate recovery option', () => {
    const html = renderToStaticMarkup(
      <AnalystSelector
        analystId="removed-analyst"
        analysts={[
          { id: 'ana-003', name: 'Grete Lindholm', role: 'analyst' },
          { id: 'ana-006', name: 'Sofia Chen', role: 'compliance_manager' },
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(html.match(/value="ana-003"/g)).toHaveLength(1);
    expect(html).toContain('Grete Lindholm (analyst)');
    expect(html).toContain('Sofia Chen (compliance_manager)');
    expect(html).toContain('<option value="removed-analyst" selected="">');
  });
});
