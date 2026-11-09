// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import History from '../src/components/History';
import { quoteListItemFromRecord } from '../src/lib/quote-list';
import type { Customer, QuoteListItem, QuoteRecord } from '../src/lib/types';
import { quoteInput, quotePage, quoteRecord, uiCustomer } from './fixtures/quotation';

type Fetch = (resource: string | URL | Request, init?: RequestInit) => Promise<Response>;
const secondCustomer: Customer = { ...uiCustomer, id: 'second-customer', code: 'SECOND', name: '第二客戶' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const urlOf = (resource: string | URL | Request) => new URL(String(resource), 'http://localhost');
function record(index: number, patch: Partial<QuoteRecord> = {}): QuoteRecord {
  return { ...quoteRecord(), id: `page-quote-${index}`, number: `PAGE-${String(index).padStart(4, '0')}`, ...patch };
}
function rows(count = 45) { return Array.from({ length: count }, (_, index) => record(index + 1)); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function pageResponse(records: QuoteRecord[], url: URL) {
  return response(quotePage(records, Number(url.searchParams.get('page') ?? '1'), Number(url.searchParams.get('pageSize') ?? '20')));
}
function requests(fetch: { mock: { calls: [resource: string | URL | Request, init?: RequestInit][] } }) {
  return fetch.mock.calls.filter(([resource, init]) => urlOf(resource).pathname === '/api/quotes' && (!init?.method || init.method === 'GET')).map(([resource]) => urlOf(resource));
}
function harness(options: { selectedId?: string | null; onChanged?: () => Promise<void> } = {}) {
  const onRevise = vi.fn(), onDeleted = vi.fn<(item: QuoteListItem) => void>(), onSelect = vi.fn();
  const onChanged = options.onChanged ?? vi.fn(async () => {});
  function ControlledHistory() {
    const [selectedId, setSelectedId] = useState(options.selectedId ?? null);
    const [customerFilter, setCustomerFilter] = useState('');
    return <History customers={[uiCustomer, secondCustomer]} customerFilter={customerFilter} onFilter={setCustomerFilter}
      onRevise={onRevise} selectedId={selectedId} onSelect={id => { onSelect(id); setSelectedId(id); }}
      onDeleted={item => { onDeleted(item); setSelectedId(current => current === item.id ? null : current); }} onChanged={onChanged} />;
  }
  return { ...render(<ControlledHistory />), onRevise, onDeleted, onSelect, onChanged };
}
function tableRow(quote: QuoteRecord) { return screen.getByRole('row', { name: new RegExp(quote.number) }); }
function button(name: string) { return screen.getByRole('button', { name }); }

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('server-paged quotation history', () => {
  it('requests bounded pages and changes page size through the server instead of loading every snapshot', async () => {
    const records = rows();
    const fetch = vi.fn<Fetch>(async resource => pageResponse(records, urlOf(resource)));
    vi.stubGlobal('fetch', fetch); harness();
    await screen.findByText(records[0].number, { exact: true });
    expect(within(tableRow(records[0])).getByText('有效至 2026-11-30')).toBeTruthy();
    expect(screen.queryByText(records[20].number, { exact: true })).toBeNull();
    expect(requests(fetch)[0].searchParams.get('page')).toBe('1');
    expect(requests(fetch)[0].searchParams.get('pageSize')).toBe('20');
    expect(fetch.mock.calls.every(([resource]) => urlOf(resource).pathname === '/api/quotes')).toBe(true);

    fireEvent.click(button('下一頁'));
    await screen.findByText(records[20].number, { exact: true });
    expect(screen.queryByText(records[0].number, { exact: true })).toBeNull();
    expect(requests(fetch).at(-1)?.searchParams.get('page')).toBe('2');

    fireEvent.change(screen.getByLabelText('每頁筆數'), { target: { value: '50' } });
    await screen.findByText(records[0].number, { exact: true });
    expect(requests(fetch).at(-1)?.searchParams.get('page')).toBe('1');
    expect(requests(fetch).at(-1)?.searchParams.get('pageSize')).toBe('50');
    expect(screen.getByText(records[44].number, { exact: true })).toBeTruthy();
    expect(button('下一頁').matches(':disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('每頁筆數'), { target: { value: '100' } });
    await waitFor(() => expect(requests(fetch).at(-1)?.searchParams.get('pageSize')).toBe('100'));
    expect(requests(fetch).every(url => ['20', '50', '100'].includes(url.searchParams.get('pageSize') ?? ''))).toBe(true);
  });

  it('debounces search and resets the server page when search, mode, status or customer filters change', async () => {
    const records = rows(); const found = record(99, { number: 'SERVER-ONLY-MATCH' });
    const fetch = vi.fn<Fetch>(async resource => {
      const url = urlOf(resource);
      return pageResponse(url.searchParams.get('q') ? [found] : records, url);
    });
    vi.stubGlobal('fetch', fetch); harness();
    await screen.findByText(records[0].number, { exact: true });
    fireEvent.click(button('下一頁')); await screen.findByText(records[20].number, { exact: true });
    fireEvent.change(screen.getByLabelText('搜尋歷史報價'), { target: { value: 'needle' } });
    expect(requests(fetch).some(url => url.searchParams.get('q') === 'needle')).toBe(false);
    await screen.findByText(found.number, { exact: true });
    expect(requests(fetch).at(-1)?.searchParams.get('q')).toBe('needle');
    expect(requests(fetch).at(-1)?.searchParams.get('page')).toBe('1');

    fireEvent.change(screen.getByLabelText('搜尋歷史報價'), { target: { value: '' } });
    await screen.findByText(records[0].number, { exact: true });
    for (const [label, key, value] of [
      ['歷史運輸方式', 'transportMode', 'SEA'],
      ['報價狀態篩選', 'status', 'Accepted'],
      ['歷史客戶篩選', 'customerId', secondCustomer.id],
    ]) {
      fireEvent.click(button('下一頁')); await screen.findByText(records[20].number, { exact: true });
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      await screen.findByText(records[0].number, { exact: true });
      expect(requests(fetch).at(-1)?.searchParams.get(key)).toBe(value);
      expect(requests(fetch).at(-1)?.searchParams.get('page')).toBe('1');
    }
  });

  it('ignores an old page response after a newer filter result has arrived', async () => {
    const oldPage = deferred<Response>(), records = rows(); const sea = record(88, { number: 'LATEST-SEA' });
    const fetch = vi.fn<Fetch>(async resource => {
      const url = urlOf(resource);
      if (url.searchParams.get('transportMode') === 'SEA') return pageResponse([sea], url);
      if (url.searchParams.get('page') === '2') return oldPage.promise;
      return pageResponse(records, url);
    });
    vi.stubGlobal('fetch', fetch); harness();
    await screen.findByText(records[0].number, { exact: true });
    fireEvent.click(button('下一頁'));
    fireEvent.change(screen.getByLabelText('歷史運輸方式'), { target: { value: 'SEA' } });
    await screen.findByText(sea.number, { exact: true });
    await act(async () => { oldPage.resolve(pageResponse(records, new URL('http://localhost/api/quotes?page=2&pageSize=20'))); await oldPage.promise; });
    expect(screen.getByText(sea.number, { exact: true })).toBeTruthy();
    expect(screen.queryByText(records[20].number, { exact: true })).toBeNull();
    expect(screen.queryByText(records[0].number, { exact: true })).toBeNull();
  });

  it('loads a full snapshot only when a detail is opened and sends revision selection as an ID', async () => {
    const records = rows(2);
    const fetch = vi.fn<Fetch>(async resource => {
      const url = urlOf(resource);
      if (url.pathname === '/api/quotes') return pageResponse(records, url);
      return response(records.find(quote => url.pathname.endsWith('/' + quote.id)));
    });
    vi.stubGlobal('fetch', fetch); const { onRevise, onSelect } = harness();
    await screen.findByText(records[0].number, { exact: true });
    expect(fetch.mock.calls.every(([resource]) => urlOf(resource).pathname === '/api/quotes')).toBe(true);
    fireEvent.click(within(tableRow(records[0])).getByRole('button', { name: '明細' }));
    const article = await screen.findByRole('article');
    expect(within(article).getByText('Carrier Cost')).toBeTruthy();
    expect(onSelect).toHaveBeenCalledWith(records[0].id);
    expect(fetch.mock.calls.filter(([resource]) => urlOf(resource).pathname.endsWith('/' + records[0].id))).toHaveLength(1);
    fireEvent.click(within(article).getByRole('button', { name: '關閉' }));
    fireEvent.click(within(tableRow(records[1])).getByRole('button', { name: '修訂 / 變更狀態' }));
    expect(onRevise).toHaveBeenCalledWith(records[1].id);
    expect(fetch.mock.calls.some(([resource]) => urlOf(resource).pathname.endsWith('/' + records[1].id))).toBe(false);
  });

  it('shows a missing detail explicitly and can retry without turning it into a new quotation', async () => {
    const records = rows(1); const recovered = record(50, { id: 'missing-id', number: 'RECOVERED-DETAIL' }); let attempts = 0;
    const fetch = vi.fn<Fetch>(async resource => {
      const url = urlOf(resource);
      if (url.pathname === '/api/quotes') return pageResponse(records, url);
      attempts++;
      return attempts === 1 ? response({ error: 'DETAIL_NOT_FOUND' }, 404) : response(recovered);
    });
    vi.stubGlobal('fetch', fetch); const { onRevise } = harness({ selectedId: 'missing-id' });
    await screen.findByText(/DETAIL_NOT_FOUND/);
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText(records[0].number, { exact: true })).toBeTruthy();
    expect(onRevise).not.toHaveBeenCalled();
    fireEvent.click(button('重新讀取明細'));
    const article = await screen.findByRole('article');
    expect(within(article).getByRole('heading', { name: /RECOVERED-DETAIL/ })).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it('uses the clamped previous page after deleting the only row on the final page', async () => {
    let records = rows(21); const target = records[20];
    const fetch = vi.fn<Fetch>(async (resource, init) => {
      const url = urlOf(resource);
      if (init?.method === 'DELETE') {
        records = records.filter(quote => quote.id !== target.id);
        return response({ id: target.id, number: target.number, revision: target.revision });
      }
      return pageResponse(records, url);
    });
    vi.stubGlobal('fetch', fetch); const { onDeleted } = harness();
    await screen.findByText(records[0].number, { exact: true });
    fireEvent.click(button('下一頁')); await screen.findByText(target.number, { exact: true });
    fireEvent.click(button(`刪除 ${target.number} Rev. 1`));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' }));
    await screen.findByText(records[0].number, { exact: true });
    expect(screen.queryByText(target.number, { exact: true })).toBeNull();
    expect(onDeleted).toHaveBeenCalledWith(quoteListItemFromRecord(target));
    expect(button('下一頁').matches(':disabled')).toBe(true);
    expect(screen.getByText(/第\s*1\s*\/\s*1\s*頁/)).toBeTruthy();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    expect(screen.queryAllByRole('row').filter(row => row.textContent?.includes('PAGE-'))).toHaveLength(20);
  });

  it('discards an emptied final page while refresh is pending or fails, then retries the server-clamped page', async () => {
    let records = rows(21); const first = records[0], target = records[20];
    const refreshing = deferred<Response>(); let deleted = false, retry = false;
    const fetch = vi.fn<Fetch>(async (resource, init) => {
      const url = urlOf(resource);
      if (init?.method === 'DELETE') {
        records = records.filter(quote => quote.id !== target.id); deleted = true;
        return response({ id: target.id, number: target.number, revision: target.revision });
      }
      if (deleted && !retry) return refreshing.promise;
      return pageResponse(records, url);
    });
    vi.stubGlobal('fetch', fetch); harness();
    await screen.findByText(first.number, { exact: true });
    fireEvent.click(button('下一頁')); await screen.findByText(target.number, { exact: true });
    fireEvent.click(button(`刪除 ${target.number} Rev. 1`));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' }));
    await screen.findByText(`報價 ${target.number} Rev. 1 已刪除。`);
    expect(screen.queryByText(target.number, { exact: true })).toBeNull();
    expect(screen.queryByText(first.number, { exact: true })).toBeNull();
    expect(screen.queryByText(/第\s*2\s*\/\s*1\s*頁/)).toBeNull();
    expect(screen.getByText('尚未取得頁面資料')).toBeTruthy();

    await act(async () => { refreshing.resolve(response({ error: 'LAST_PAGE_REFRESH_FAILED' }, 500)); await refreshing.promise; });
    await screen.findByText(/報價已刪除，但重新讀取資料失敗：LAST_PAGE_REFRESH_FAILED/);
    expect(screen.queryByText(/第\s*2\s*\/\s*1\s*頁/)).toBeNull();
    expect(screen.queryByText(first.number, { exact: true })).toBeNull();
    expect(screen.queryByText(/尚無符合條件的報價/)).toBeNull();
    expect(button('下一頁').matches(':disabled')).toBe(true);
    expect(button('上一頁').matches(':disabled')).toBe(true);

    retry = true;
    fireEvent.click(button('重新整理資料'));
    await screen.findByText(first.number, { exact: true });
    expect(screen.getByText(/第\s*1\s*\/\s*1\s*頁/)).toBeTruthy();
    expect(screen.queryByText(target.number, { exact: true })).toBeNull();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });

  it('reports a failed new page without presenting the previous page or a false empty result', async () => {
    const records = rows(); let attempts = 0;
    const fetch = vi.fn<Fetch>(async resource => {
      const url = urlOf(resource);
      if (url.searchParams.get('page') === '2' && attempts++ === 0) return response({ error: 'PAGE_FAILED' }, 500);
      return pageResponse(records, url);
    });
    vi.stubGlobal('fetch', fetch); harness();
    await screen.findByText(records[0].number, { exact: true });
    fireEvent.click(button('下一頁'));
    await screen.findByText(/PAGE_FAILED/);
    expect(screen.queryByText(records[0].number, { exact: true })).toBeNull();
    expect(screen.queryByText(/尚無符合條件的報價/)).toBeNull();
    fireEvent.click(button('重新讀取報價'));
    await screen.findByText(records[20].number, { exact: true });
    expect(screen.queryByText(/PAGE_FAILED/)).toBeNull();
  });
});
