import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalystProvider, useAnalyst } from './AnalystContext';

function SelectedIdentity() {
  return <span>{useAnalyst().analystId}</span>;
}

function renderIdentity() {
  return renderToString(<AnalystProvider><SelectedIdentity /></AnalystProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe('initial demo identity', () => {
  it('defaults new visitors to ana-003, never a senior analyst', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    expect(renderIdentity()).toBe('<span>ana-003</span>');
  });

  it('defaults to ana-003 when storage is unavailable', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('Storage blocked'); } } });
    expect(renderIdentity()).toBe('<span>ana-003</span>');
  });

  it('retains an explicitly selected demo identity', () => {
    const getItem = vi.fn(() => 'ana-006');
    vi.stubGlobal('window', { localStorage: { getItem } });
    expect(renderIdentity()).toBe('<span>ana-006</span>');
    expect(getItem).toHaveBeenCalledWith('kyc.analystId');
  });
});
