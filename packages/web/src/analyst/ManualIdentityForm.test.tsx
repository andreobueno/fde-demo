import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAnalyst } from '../api/types';
import { ManualIdentityForm, selectKnownAnalyst } from './ManualIdentityForm';

const fetchMock = vi.fn<typeof fetch>();
const analyst: CurrentAnalyst = {
  id: 'retained-analyst',
  name: 'Existing analyst',
  role: 'analyst',
  permissions: ['cases:read'],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('manual demo identity recovery', () => {
  it('offers a labeled manual entry without needing the analyst list', () => {
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(
      <ManualIdentityForm identitySignal={new AbortController().signal} onSelect={onSelect} />,
    );
    expect(html).toContain('<summary>Enter a known demo identity</summary>');
    expect(html).toContain('<label for="manual-analyst-id">Demo identity ID</label>');
    expect(html).toContain('Use identity</button>');
    expect(onSelect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates a custom ID through /api/me before changing the selection', async () => {
    let respond: (response: Response) => void = () => { throw new Error('Request has not started'); };
    fetchMock.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const onSelect = vi.fn();
    const signal = new AbortController().signal;

    const pending = selectKnownAnalyst(`  ${analyst.id}  `, signal, onSelect);
    expect(onSelect).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/me', {
      method: 'GET',
      headers: { 'content-type': 'application/json', 'x-analyst-id': analyst.id },
      body: null,
      signal,
    });

    respond(Response.json(analyst));
    await pending;
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(analyst.id);
  });

  it.each(['', '   '])('rejects empty input %j without changing identity or calling the API', async (id) => {
    const onSelect = vi.fn();
    await expect(selectKnownAnalyst(id, new AbortController().signal, onSelect))
      .rejects.toThrow('Enter a known demo identity ID.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])('preserves the current identity on HTTP %i without trying a fallback', async (status) => {
    fetchMock.mockResolvedValue(Response.json(
      { error: { code: 'REJECTED', message: 'Identity lookup failed' } },
      { status },
    ));
    const onSelect = vi.fn();
    await expect(selectKnownAnalyst(analyst.id, new AbortController().signal, onSelect))
      .rejects.toMatchObject({ status });
    expect(onSelect).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the current identity when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const onSelect = vi.fn();
    await expect(selectKnownAnalyst(analyst.id, new AbortController().signal, onSelect))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not validate from an already canceled identity session', async () => {
    const controller = new AbortController();
    controller.abort();
    const onSelect = vi.fn();
    await expect(selectKnownAnalyst(analyst.id, controller.signal, onSelect))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not replace a newer selection when canceled validation returns late', async () => {
    let respond: (response: Response) => void = () => { throw new Error('Request has not started'); };
    fetchMock.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const controller = new AbortController();
    const onSelect = vi.fn();
    const pending = selectKnownAnalyst(analyst.id, controller.signal, onSelect);
    controller.abort();
    respond(Response.json(analyst));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
