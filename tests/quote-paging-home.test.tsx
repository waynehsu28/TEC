// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Home from '../src/app/page';
import { quoteListItemFromRecord } from '../src/lib/quote-list';
import { readQuoteDraft } from '../src/lib/quote-draft';
import type { QuoteOverview, QuoteRecord } from '../src/lib/types';
import { quoteInput, quoteRecord, uiCustomer, uiSettings } from './fixtures/quotation';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function record(id: string, destination = `${id} destination`): QuoteRecord {
  return { ...quoteRecord(quoteInput({ fxSource: 'MANUAL', destination })), id,
    number: `AFQ-${id}`, revision: 2, rootId: 'older-family' };
}
const emptyOverview: QuoteOverview = { total: 0, quoted: 0, accepted: 0, recent: [] };
function mockApi(options: {
  overview?: QuoteOverview;
  detail?: (id: string, init?: RequestInit) => Promise<Response>;
} = {}) {
  const mock = vi.fn(async (resource: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(resource);
    if (path === '/api/customers') return response([uiCustomer]);
    if (path === '/api/contracts') return response([]);
    if (path === '/api/settings') return response(uiSettings);
    if (path === '/api/quotes/overview') return response(options.overview ?? emptyOverview);
    if (path === '/api/match') return response([]);
    if (path.startsWith('/api/quotes/')) return options.detail?.(path.slice('/api/quotes/'.length), init)
      ?? response({ error: '找不到報價' }, 404);
    throw new Error(`Unexpected test request: ${path}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
function navigateHash(hash: string) {
  act(() => {
    window.history.pushState(window.history.state, '', hash);
    window.dispatchEvent(new Event('hashchange'));
  });
}

beforeEach(() => { window.history.replaceState(null, '', '/'); window.sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('bounded quotation loading in Home', () => {
  it('shows aggregate counts independently of the six recent summaries without fetching full quotation lists', async () => {
    const recent = Array.from({ length: 6 }, (_, i) => record(`recent-${i}`));
    const fetch = mockApi({ overview: { total: 42, quoted: 12, accepted: 8, recent: recent.map(quoteListItemFromRecord) } });
    render(<Home />);

    await screen.findByRole('heading', { name: /最近報價/ });
    const stats = screen.getByText('報價與修訂 Quotations').closest('.stat')!;
    expect(stats.textContent).toContain('42 筆');
    expect(stats.textContent).toContain('Quoted 12 · Accepted 8');
    expect(screen.getAllByRole('row')).toHaveLength(7);
    for (const quote of recent) expect(screen.getByRole('button', { name: quote.number })).toBeTruthy();
    const quoteRequests = fetch.mock.calls.map(([path]) => String(path)).filter(path => path.startsWith('/api/quotes'));
    expect(quoteRequests).toEqual(['/api/quotes/overview']);
  });

  it('loads a revision outside the recent six on demand and never renders a blank editor while waiting', async () => {
    const source = record('older-source', 'Older revision New York');
    const loading = deferred<Response>();
    const fetch = mockApi({ detail: () => loading.promise });
    window.history.replaceState(null, '', `/#quote?revision=${source.id}`);
    render(<Home />);

    await screen.findByText('正在載入修訂來源…');
    expect(screen.queryByLabelText('目的地／港口（選填）')).toBeNull();
    expect(screen.queryByRole('button', { name: '儲存報價快照' })).toBeNull();
    await act(async () => { loading.resolve(response(source)); await loading.promise; });

    const destination = await screen.findByLabelText('目的地／港口（選填）');
    expect((destination as HTMLInputElement).value).toBe(source.snapshot.input.destination);
    await waitFor(() => expect(readQuoteDraft(window.sessionStorage, source.id)?.revisionOfId).toBe(source.id));
    expect(readQuoteDraft(window.sessionStorage, source.id)?.cargo).toEqual(source.snapshot.input.cargo);
    expect(fetch.mock.calls.filter(([path]) => path === `/api/quotes/${source.id}`)).toHaveLength(1);
    expect(fetch.mock.calls.some(([path]) => String(path) === '/api/quotes' || String(path).startsWith('/api/quotes?'))).toBe(false);
  });

  it('offers retry for a failed revision lookup and keeps a 404 source from becoming a new quotation', async () => {
    const source = record('retry-source');
    let attempts = 0;
    mockApi({ detail: async id => {
      if (id === 'deleted-source') return response({ error: '找不到報價' }, 404);
      attempts++;
      return attempts === 1 ? response({ error: 'DETAIL_TEMPORARILY_UNAVAILABLE' }, 503) : response(source);
    } });
    window.history.replaceState(null, '', `/#quote?revision=${source.id}`);
    render(<Home />);

    await screen.findByRole('heading', { name: '找不到要修訂的報價' });
    expect(screen.getByRole('alert').textContent).toContain('DETAIL_TEMPORARILY_UNAVAILABLE');
    expect(screen.queryByLabelText('目的地／港口（選填）')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新載入修訂來源' }));
    expect((await screen.findByLabelText('目的地／港口（選填）') as HTMLInputElement).value).toBe(source.snapshot.input.destination);
    expect(attempts).toBe(2);

    navigateHash('#quote?revision=deleted-source');
    await screen.findByRole('heading', { name: '找不到要修訂的報價' });
    expect(screen.queryByLabelText('目的地／港口（選填）')).toBeNull();
    expect(screen.queryByRole('button', { name: '儲存報價快照' })).toBeNull();
    expect(readQuoteDraft(window.sessionStorage, null)).toBeNull();
    expect(window.location.hash).toBe('#quote?revision=deleted-source');
  });

  it('ignores an older revision response after navigation selects a different source', async () => {
    const older = record('revision-a', 'Old response city');
    const current = record('revision-b', 'Current response city');
    const pending = deferred<Response>();
    const signals: AbortSignal[] = [];
    mockApi({ detail: async (id, init) => {
      if (id === older.id) { signals.push(init!.signal!); return pending.promise; }
      return response(current);
    } });
    window.history.replaceState(null, '', `/#quote?revision=${older.id}`);
    render(<Home />);
    await screen.findByText('正在載入修訂來源…');
    navigateHash(`#quote?revision=${current.id}`);

    expect((await screen.findByLabelText('目的地／港口（選填）') as HTMLInputElement).value).toBe(current.snapshot.input.destination);
    expect(signals[0].aborted).toBe(true);
    await act(async () => { pending.resolve(response(older)); await pending.promise; });
    expect((screen.getByLabelText('目的地／港口（選填）') as HTMLInputElement).value).toBe(current.snapshot.input.destination);
    expect(readQuoteDraft(window.sessionStorage, current.id)?.revisionOfId).toBe(current.id);
    expect(readQuoteDraft(window.sessionStorage, older.id)).toBeNull();
    expect(window.location.hash).toBe(`#quote?revision=${current.id}`);
    const nav = within(screen.getByRole('navigation'));
    fireEvent.click(nav.getByRole('button', { name: /客戶資料/ }));
    expect(screen.getByRole('heading', { name: '客戶資料' })).toBeTruthy();
  });
});
