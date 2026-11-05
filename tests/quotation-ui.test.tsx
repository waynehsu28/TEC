// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Home from '../src/app/page';
import { renderToString } from 'react-dom/server';
import ModuleBoundary from '../src/components/ModuleBoundary';
import QuoteEditor from '../src/components/QuoteEditor';
import { readQuoteDraft, writeQuoteDraft } from '../src/lib/quote-draft';
import { quoteInput, quoteRecord, quoteSnapshot, uiCustomer, uiSettings } from './fixtures/quotation';
import type { QuoteInput } from '../src/lib/types';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { window.history.replaceState(null, '', '/'); window.sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function apiMock(options: { preview?: Promise<Response>; save?: Promise<Response> } = {}) {
  let saved = false;
  const mock = vi.fn(async (resource: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(resource);
    if (path.endsWith('/api/match')) return response([]);
    if (path.endsWith('/api/preview')) return options.preview ?? response(quoteSnapshot(JSON.parse(init!.body as string) as QuoteInput));
    if (path.endsWith('/api/quotes') && init?.method === 'POST') { const result = await (options.save ?? Promise.resolve(response(quoteRecord(JSON.parse(init.body as string)))));saved = result.ok;return result; }
    if (path.endsWith('/api/customers')) return response([uiCustomer]);
    if (path.endsWith('/api/contracts')) return response([]);
    if (path.endsWith('/api/quotes')) return response(saved ? [quoteRecord()] : []);
    if (path.endsWith('/api/settings')) return response(uiSettings);
    throw new Error(`Unexpected test request: ${path}`);
  });
  vi.stubGlobal('fetch', mock);return mock;
}
async function previewReady() {
  const button = screen.getByRole('button', { name: '試算報價' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByText('報價試算結果', { exact: true });
}
describe('quotation navigation and reload recovery', () => {
  it('does not flash the dashboard before the URL can be restored during hydration', () => {
    const html = renderToString(<Home />);
    expect(html).toContain('正在恢復工作區');
    expect(html).not.toContain('營運總覽');
  });

  it('keeps a direct quote URL and restores entered values after remount/reload', async () => {
    apiMock(); window.history.replaceState(null, '', '/#quote');
    const first = render(<Home />);
    await screen.findByLabelText('目的地／港口（選填）');
    fireEvent.change(screen.getByLabelText('目的地／港口（選填）'), { target: { value: 'Seattle draft' } });
    await waitFor(() => expect(readQuoteDraft(window.sessionStorage, null)?.destination).toBe('Seattle draft'));
    first.unmount(); render(<Home />);
    await screen.findByLabelText('目的地／港口（選填）');
    expect(screen.getByRole('heading', { name: '新增報價' })).toBeTruthy();
    expect((screen.getByLabelText('目的地／港口（選填）') as HTMLInputElement).value).toBe('Seattle draft');
    expect(window.location.hash).toBe('#quote');
  });
  it('returns to the previous module with browser Back and keeps the draft', async () => {
    apiMock();render(<Home />);await screen.findByText('開始第一份報價', { exact: true });
    const nav = within(screen.getByRole('navigation'));
    fireEvent.click(nav.getByRole('button', { name: /新增報價/ }));
    await screen.findByLabelText('目的地／港口（選填）');
    fireEvent.change(screen.getByLabelText('目的地／港口（選填）'), { target: { value: 'Back draft' } });
    fireEvent.click(nav.getByRole('button', { name: /客戶資料/ }));
    expect(screen.getByRole('heading', { name: '客戶資料' })).toBeTruthy();
    act(() => window.history.back());
    await screen.findByRole('heading', { name: '新增報價' });
    expect((screen.getByLabelText('目的地／港口（選填）') as HTMLInputElement).value).toBe('Back draft');
  });
  it('never steals a different module when a background save finishes', async () => {
    const saving = deferred<Response>();apiMock({ save: saving.promise });writeQuoteDraft(window.sessionStorage, quoteInput());window.history.replaceState(null, '', '/#quote');render(<Home />);
    await screen.findByRole('button', { name: '試算報價' });await previewReady();
    fireEvent.click(screen.getByRole('button', { name: '儲存報價快照' }));
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /客戶資料/ }));
    await act(async () => { saving.resolve(response(quoteRecord()));await saving.promise; });
    await waitFor(() => expect(screen.getByRole('heading', { name: '客戶資料' })).toBeTruthy());
    expect(window.location.hash).toBe('#customers');
  });
  it('does not clear or navigate away from a newer draft after leaving and returning', async () => {
    const saving = deferred<Response>();apiMock({ save: saving.promise });writeQuoteDraft(window.sessionStorage, quoteInput());window.history.replaceState(null, '', '/#quote');render(<Home />);
    await screen.findByRole('button', { name: '試算報價' });await previewReady();fireEvent.click(screen.getByRole('button', { name: '儲存報價快照' }));
    const nav = within(screen.getByRole('navigation'));
    fireEvent.click(nav.getByRole('button', { name: /客戶資料/ }));fireEvent.click(nav.getByRole('button', { name: /新增報價/ }));
    await screen.findByLabelText('目的地／港口（選填）');fireEvent.change(screen.getByLabelText('目的地／港口（選填）'), { target: { value: 'Newer city draft' } });
    await act(async () => { saving.resolve(response(quoteRecord()));await saving.promise; });
    await waitFor(() => expect(readQuoteDraft(window.sessionStorage, null)?.destination).toBe('Newer city draft'));
    expect(screen.getByRole('heading', { name: '新增報價' })).toBeTruthy();
    expect(window.location.hash).toBe('#quote');
  });
});
describe('quotation form request races', () => {
  it('reports a post-save display failure accurately without treating it as a database failure', async () => {
    apiMock();writeQuoteDraft(window.sessionStorage, quoteInput());
    render(<QuoteEditor customers={[uiCustomer]} settings={uiSettings} initial={null} onSaved={() => { throw new Error('display callback failed'); }} />);
    await previewReady();fireEvent.click(screen.getByRole('button', { name: '儲存報價快照' }));
    await screen.findByText('報價已儲存，但畫面更新失敗。請到報價紀錄查看，避免重複儲存。');
    expect(readQuoteDraft(window.sessionStorage, null)).toBeNull();
    expect((screen.getByRole('button', { name: '儲存報價快照' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('locks all form fields while saving and clears its completed draft', async () => {
    const saving = deferred<Response>();apiMock({ save: saving.promise });writeQuoteDraft(window.sessionStorage, quoteInput());const onSaved = vi.fn();render(<QuoteEditor customers={[uiCustomer]} settings={uiSettings} initial={null} onSaved={onSaved} />);
    await previewReady();fireEvent.click(screen.getByRole('button', { name: '儲存報價快照' }));
    expect(screen.getByLabelText('目的地／港口（選填）').matches(':disabled')).toBe(true);
    await act(async () => { saving.resolve(response(quoteRecord()));await saving.promise; });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));expect(readQuoteDraft(window.sessionStorage, null)).toBeNull();
  });
  it('ignores an old preview error after the shipment input changes', async () => {
    const preview = deferred<Response>();apiMock({ preview: preview.promise });writeQuoteDraft(window.sessionStorage, quoteInput());render(<QuoteEditor customers={[uiCustomer]} settings={uiSettings} initial={null} onSaved={vi.fn()} />);
    const button = screen.getByRole('button', { name: '試算報價' });await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));fireEvent.click(button);
    fireEvent.change(screen.getByLabelText('目的地／港口（選填）'), { target: { value: 'Changed city' } });
    await act(async () => { preview.resolve(response({ error: 'STALE_PREVIEW_ERROR' }, 400));await preview.promise; });
    expect(screen.queryByText('STALE_PREVIEW_ERROR')).toBeNull();expect(screen.queryByText('報價試算結果', { exact: true })).toBeNull();
  });
});

describe('module rendering failures', () => {
  it('keeps the current route and offers retry instead of returning to dashboard', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState(null, '', '/#quote');
    function Failing() { throw new Error('test screen error'); return null; }
    render(<ModuleBoundary resetKey="quote:new"><Failing /></ModuleBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('目前頁面已保留');
    expect(screen.getByRole('button', {name: '重試這個畫面'})).toBeTruthy();
    expect(window.location.hash).toBe('#quote');
  });
});
