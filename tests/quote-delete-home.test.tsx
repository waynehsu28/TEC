// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Home from '../src/app/page';
import { quoteOverview, quotePage, quoteRecord, uiCustomer, uiSettings } from './fixtures/quotation';
import type { QuoteRecord } from '../src/lib/types';

const original = { ...quoteRecord(), id: 'delete-original' };
const revision: QuoteRecord = { ...quoteRecord(), id: 'keep-revision', number: `${original.number}-R002`, revision: 2, rootId: original.id };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const deleted = () => response({ id: original.id, number: original.number, revision: original.revision });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function mockApi(options: { deletion?: Promise<Response>; readOverview?: (read: number) => Response | Promise<Response>; refreshContractsFailure?: boolean } = {}) {
  let reads = 0, contractsReads = 0;
  let records = [original, revision];
  const fetch = vi.fn(async (resource: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(resource);
    if (path === `/api/quotes/${original.id}` && init?.method === 'DELETE') {
      const result = await (options.deletion ?? Promise.resolve(deleted()));
      if (result.ok) records = records.filter(quote => quote.id !== original.id);
      return result;
    }
    if (path === '/api/quotes/overview') return options.readOverview?.(++reads) ?? response(quoteOverview(records));
    if (path.startsWith('/api/quotes?')) return response(quotePage(records));
    const detail = records.find(quote => path === `/api/quotes/${quote.id}`);
    if (detail) return response(detail);
    if (path === '/api/customers') return response([uiCustomer]);
    if (path === '/api/contracts') return options.refreshContractsFailure && ++contractsReads > 1 ? response({ error: 'CONTRACT_REFRESH_FAILURE' }, 500) : response([]);
    if (path === '/api/settings') return response(uiSettings);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, overviewReads: () => reads };
}
function navigate(name: RegExp) { fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name })); }
async function confirmDeletion() {
  fireEvent.click((await screen.findAllByRole('button', { name: `刪除 ${original.number} Rev. 1` }))[0]);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' }));
}
function expectOriginalAbsent() {
  expect(screen.queryByText(original.number, { exact: true })).toBeNull();
  expect(screen.queryByRole('link', { name: '下載客戶 PDF' })).toBeNull();
  expect(screen.getByText(revision.number, { exact: true })).toBeTruthy();
}
function expectDashboardCount(count: number) {
  const card = screen.getByText('報價與修訂 Quotations', { exact: true }).closest('.stat')!;
  expect(card.querySelector('strong')?.textContent).toMatch(new RegExp(`^${count}\\s*筆$`));
}

beforeEach(() => { window.history.replaceState(null, '', '/#history'); window.sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('confirmed quote deletion in the workspace', () => {
  it('removes the selected quote and PDF immediately despite pending reads and an unrelated refresh failure, preserving its customer filter and sibling revision', async () => {
    const reading = deferred<Response>();
    mockApi({ readOverview: read => read === 1 ? response(quoteOverview([original, revision])) : reading.promise, refreshContractsFailure: true });
    window.history.replaceState(null, '', `/#history?quote=${original.id}&customer=${uiCustomer.id}`);
    render(<Home />);
    await screen.findByRole('link', { name: '下載客戶 PDF' });
    await confirmDeletion();

    await screen.findByRole('alert');
    await waitFor(expectOriginalAbsent);
    expect(screen.getByRole('alert').textContent).toContain('報價已刪除');
    expect(screen.getByRole('alert').textContent).toContain('CONTRACT_REFRESH_FAILURE');
    expect(window.location.hash).toBe(`#history?customer=${uiCustomer.id}`);
    expect((screen.getByLabelText('歷史客戶篩選') as HTMLSelectElement).value).toBe(uiCustomer.id);
    await act(async () => { reading.resolve(response(quoteOverview([revision]))); await reading.promise; });
  });

  it('applies a late DELETE acknowledgement after leaving history without stealing the route, and updates dashboard totals before the read completes', async () => {
    const deleting = deferred<Response>(), reading = deferred<Response>();
    const { overviewReads } = mockApi({ deletion: deleting.promise, readOverview: read => read === 1 ? response(quoteOverview([original, revision])) : reading.promise });
    render(<Home />);
    await confirmDeletion();
    navigate(/客戶資料/);
    await screen.findByRole('heading', { name: '客戶資料' });
    await act(async () => { deleting.resolve(deleted()); await deleting.promise; });
    await waitFor(() => expect(overviewReads()).toBe(2));
    expect(window.location.hash).toBe('#customers');
    expect(screen.getByRole('heading', { name: '客戶資料' })).toBeTruthy();

    navigate(/營運總覽/);
    expectDashboardCount(1);
    navigate(/報價紀錄/);
    await waitFor(expectOriginalAbsent);
    await act(async () => { reading.resolve(response(quoteOverview([revision]))); await reading.promise; });
  });

  it('does not resurrect a deleted quote when an older settings-triggered refresh returns its pre-delete list', async () => {
    const older = deferred<Response>(), latest = deferred<Response>();
    const { overviewReads } = mockApi({ readOverview: read => read === 1 ? response(quoteOverview([original, revision])) : read === 2 ? older.promise : latest.promise });
    render(<Home />);
    await screen.findByText(original.number, { exact: true });
    navigate(/系統設定/);
    fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));
    await waitFor(() => expect(overviewReads()).toBe(2));
    navigate(/報價紀錄/);
    await confirmDeletion();
    await waitFor(() => expect(overviewReads()).toBe(3));
    await act(async () => { older.resolve(response(quoteOverview([original, revision]))); await older.promise; });

    navigate(/營運總覽/);
    expectDashboardCount(1);
    navigate(/報價紀錄/);
    await waitFor(expectOriginalAbsent);
    await act(async () => { latest.resolve(response(quoteOverview([revision]))); await latest.promise; });
  });
});
