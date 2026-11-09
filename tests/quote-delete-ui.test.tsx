// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import History from '../src/components/History';
import type { QuoteListItem, QuoteRecord } from '../src/lib/types';
import { quoteListItemFromRecord } from '../src/lib/quote-list';
import { quoteInput, quotePage, quoteRecord, uiCustomer } from './fixtures/quotation';

const original: QuoteRecord = { ...quoteRecord(), id: 'original-quote' };
const revised: QuoteRecord = {
  ...quoteRecord(quoteInput({ revisionOfId: original.id })), id: 'revised-quote',
  number: `${original.number}-R002`, revision: 2, rootId: original.id,
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const deleted = (quote = original) => response({ id: quote.id, number: quote.number, revision: quote.revision });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function harness(options: {
  selectedId?: string | null;
  deleteRequest?: (resource: string | URL | Request, init?: RequestInit) => Promise<Response>;
  onDeleted?: (quote: QuoteListItem) => void;
  onChanged?: () => Promise<void>;
} = {}) {
  const onDeleted = options.onDeleted ?? vi.fn();
  const onChanged = options.onChanged ?? vi.fn(async () => {});
  const deleteRequest = vi.fn(options.deleteRequest ?? (async (resource: string | URL | Request) => deleted(String(resource).endsWith(revised.id) ? revised : original)));
  let records = [original, revised];
  const fetch = vi.fn(async (resource: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(resource);
    if (init?.method === 'DELETE') {
      const result = await deleteRequest(resource, init);
      if (result.ok) records = records.filter(quote => !path.endsWith(`/${quote.id}`));
      return result;
    }
    if (path.startsWith('/api/quotes?')) return response(quotePage(records));
    const quote = records.find(item => path === `/api/quotes/${item.id}`);
    if (quote) return response(quote);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  function ControlledHistory() {
    const [selectedId, setSelectedId] = useState(options.selectedId ?? null);
    return <History customers={[uiCustomer]} customerFilter="" onFilter={vi.fn()} onRevise={vi.fn()}
      selectedId={selectedId} onSelect={setSelectedId} onDeleted={quote => {
        onDeleted(quote);
        setSelectedId(current => current === quote.id ? null : current);
      }} onChanged={onChanged} />;
  }
  return { ...render(<ControlledHistory />), onDeleted, onChanged, fetch, deleteRequest };
}
async function choose(quote = original) {
  fireEvent.click(await screen.findByRole('button', { name: `刪除 ${quote.number} Rev. ${quote.revision}` }));
  return screen.getByRole('dialog');
}
function confirm() { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' })); }
function quoteRow(quote = original) { return screen.queryAllByRole('row').find(row => within(row).queryByText(quote.number, { exact: true }) && row.textContent?.includes(`Rev. ${quote.revision}`)) ?? null; }

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('quotation deletion confirmation and display', () => {
  it('identifies the selected revision and cancels without sending a DELETE request', async () => {
    const { deleteRequest } = harness();
    const dialog = await choose(revised);
    expect(dialog.textContent).toContain(revised.number);
    expect(dialog.textContent).toContain('2');
    expect(dialog.textContent).toContain(uiCustomer.name);
    expect(dialog.textContent).toMatch(/其他.*修訂.*保留/);
    expect(dialog.textContent).toMatch(/無法.*復原/);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteRequest).not.toHaveBeenCalled();
    expect(quoteRow(original)).toBeTruthy(); expect(quoteRow(revised)).toBeTruthy();
  });

  it('provides the same confirmation action from an on-demand quotation detail', async () => {
    const { fetch } = harness({ selectedId: revised.id });
    const detail = await screen.findByRole('article');
    fireEvent.click(within(detail).getByRole('button', { name: `刪除 ${revised.number} Rev. 2` }));
    expect(screen.getByRole('dialog').textContent).toContain(revised.number);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' })).toBeTruthy();
    expect(fetch.mock.calls.some(([path]) => path === `/api/quotes/${revised.id}`)).toBe(true);
  });

  it('locks confirmation and all delete actions while sending exactly one bodyless DELETE', async () => {
    const deleting = deferred<Response>();
    const { onDeleted, deleteRequest } = harness({ deleteRequest: () => deleting.promise });
    await choose();
    const button = within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' });
    fireEvent.click(button); fireEvent.click(button);
    expect(deleteRequest).toHaveBeenCalledTimes(1);
    expect(deleteRequest.mock.calls[0][0]).toBe(`/api/quotes/${original.id}`);
    const request = deleteRequest.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe('DELETE'); expect(request.body).toBeUndefined();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }).matches(':disabled')).toBe(true);
    for (const control of screen.getAllByRole('button', { name: /^刪除 AFQ-/ })) expect(control.matches(':disabled')).toBe(true);
    await act(async () => { deleting.resolve(deleted()); await deleting.promise; });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(quoteListItemFromRecord(original)));
    expect(quoteRow(original)).toBeNull(); expect(quoteRow(revised)).toBeTruthy();
  });

  it('keeps the exact failed target available to retry without claiming it was deleted', async () => {
    const request = vi.fn().mockResolvedValueOnce(response({ error: 'DELETE_FAILED' }, 500)).mockResolvedValueOnce(deleted(revised));
    const { onDeleted, onChanged, deleteRequest } = harness({ deleteRequest: request });
    await choose(revised); confirm();
    await screen.findByText('DELETE_FAILED');
    expect(screen.getByRole('dialog').textContent).toContain(revised.number);
    expect(onDeleted).not.toHaveBeenCalled(); expect(onChanged).not.toHaveBeenCalled();
    expect(quoteRow(original)).toBeTruthy(); expect(quoteRow(revised)).toBeTruthy();
    confirm();
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(quoteListItemFromRecord(revised)));
    expect(deleteRequest.mock.calls.map(call => call[0])).toEqual([`/api/quotes/${revised.id}`, `/api/quotes/${revised.id}`]);
    expect(quoteRow(original)).toBeTruthy(); expect(quoteRow(revised)).toBeNull();
  });

  it('removes only the acknowledged quotation immediately while a follow-up refresh is still pending', async () => {
    const refreshing = deferred<void>();
    const onChanged = vi.fn(() => refreshing.promise);
    const { onDeleted } = harness({ selectedId: original.id, onChanged });
    await screen.findByRole('article');
    await waitFor(() => expect(quoteRow(original)).toBeTruthy());
    fireEvent.click(within(quoteRow(original)!).getByRole('button', { name: `刪除 ${original.number} Rev. 1` }));
    confirm();
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(quoteListItemFromRecord(original)));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('article')).toBeNull();
    expect(quoteRow(original)).toBeNull(); expect(quoteRow(revised)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('已刪除');
    await act(async () => { refreshing.resolve(); await refreshing.promise; });
  });

  it('separates a failed refresh from the successful delete and retries reads without another DELETE', async () => {
    const onChanged = vi.fn().mockRejectedValueOnce(new Error('REFRESH_FAILED')).mockResolvedValueOnce(undefined);
    const { deleteRequest } = harness({ onChanged }); await choose(); confirm();
    await screen.findByText(/報價已刪除，但重新讀取資料失敗/);
    expect(quoteRow(original)).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重新整理資料' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/REFRESH_FAILED/)).toBeNull());
    expect(deleteRequest).toHaveBeenCalledTimes(1); expect(quoteRow(revised)).toBeTruthy();
  });

  it('hides a committed deletion even when the parent display callback fails', async () => {
    const onDeleted = vi.fn(() => { throw new Error('DISPLAY_FAILED'); });
    const { deleteRequest } = harness({ onDeleted }); await choose(); confirm();
    await screen.findByText(/報價已刪除，但畫面更新失敗/);
    expect(quoteRow(original)).toBeNull(); expect(quoteRow(revised)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull(); expect(deleteRequest).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith(quoteListItemFromRecord(original));
  });

  it('still notifies its parent after leaving the screen before the deletion acknowledgement arrives', async () => {
    const deleting = deferred<Response>();
    const onDeleted = vi.fn(); const onChanged = vi.fn(async () => {});
    const { unmount, deleteRequest } = harness({ deleteRequest: () => deleting.promise, onDeleted, onChanged });
    await choose(); confirm(); unmount();
    await act(async () => { deleting.resolve(deleted()); await deleting.promise; });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(quoteListItemFromRecord(original)));
    expect(onChanged).toHaveBeenCalledTimes(1); expect(deleteRequest).toHaveBeenCalledTimes(1);
  });
});
