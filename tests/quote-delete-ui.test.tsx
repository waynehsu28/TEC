// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import History from '../src/components/History';
import type { QuoteRecord } from '../src/lib/types';
import { quoteInput, quoteRecord, uiCustomer } from './fixtures/quotation';

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
  onDeleted?: (id: string) => void;
  onChanged?: () => Promise<void>;
} = {}) {
  const onDeleted = options.onDeleted ?? vi.fn();
  const onChanged = options.onChanged ?? vi.fn(async () => {});
  function ControlledHistory() {
    const [quotes, setQuotes] = useState([original, revised]);
    const [selectedId, setSelectedId] = useState(options.selectedId ?? null);
    return <History quotes={quotes} customers={[uiCustomer]} customerFilter="" onFilter={vi.fn()} onRevise={vi.fn()}
      selectedId={selectedId} onSelect={setSelectedId} onDeleted={id => {
        onDeleted(id);
        setQuotes(current => current.filter(quote => quote.id !== id));
        setSelectedId(current => current === id ? null : current);
      }} onChanged={onChanged} />;
  }
  return { ...render(<ControlledHistory />), onDeleted, onChanged };
}
function choose(quote = original) {
  fireEvent.click(screen.getByRole('button', { name: `刪除 ${quote.number} Rev. ${quote.revision}` }));
  return screen.getByRole('dialog');
}
function confirm() { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' })); }
function quoteRow(quote = original) { return screen.queryAllByRole('row').find(row => within(row).queryByText(quote.number, { exact: true }) && row.textContent?.includes(`Rev. ${quote.revision}`)) ?? null; }

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('quotation deletion confirmation and display', () => {
  it('identifies the selected revision and cancels without sending a request', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    harness();
    const dialog = choose(revised);
    expect(dialog.textContent).toContain(revised.number);
    expect(dialog.textContent).toContain('2');
    expect(dialog.textContent).toContain(uiCustomer.name);
    expect(dialog.textContent).toMatch(/其他.*修訂.*保留/);
    expect(dialog.textContent).toMatch(/無法.*復原/);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(quoteRow(original)).toBeTruthy(); expect(quoteRow(revised)).toBeTruthy();
  });

  it('provides the same confirmation action from an opened quotation detail', () => {
    vi.stubGlobal('fetch', vi.fn());
    harness({ selectedId: revised.id });
    const detail = screen.getByRole('article');
    fireEvent.click(within(detail).getByRole('button', { name: `刪除 ${revised.number} Rev. 2` }));
    expect(screen.getByRole('dialog').textContent).toContain(revised.number);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' })).toBeTruthy();
  });

  it('locks confirmation and all delete actions while sending exactly one bodyless DELETE', async () => {
    const deleting = deferred<Response>();
    const fetch = vi.fn<(_resource: string | URL | Request, _init?: RequestInit) => Promise<Response>>(() => deleting.promise); vi.stubGlobal('fetch', fetch);
    const { onDeleted } = harness();
    choose();
    const button = within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`/api/quotes/${original.id}`);
    const request = fetch.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe('DELETE'); expect(request.body).toBeUndefined();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }).matches(':disabled')).toBe(true);
    for (const control of screen.getAllByRole('button', { name: /^刪除 AFQ-/ })) expect(control.matches(':disabled')).toBe(true);
    await act(async () => { deleting.resolve(deleted()); await deleting.promise; });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(original.id));
    expect(quoteRow(original)).toBeNull(); expect(quoteRow(revised)).toBeTruthy();
  });

  it('keeps the exact failed target available to retry without claiming it was deleted', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ error: 'DELETE_FAILED' }, 500)).mockResolvedValueOnce(deleted(revised));
    vi.stubGlobal('fetch', fetch);
    const { onDeleted, onChanged } = harness();
    choose(revised); confirm();
    await screen.findByText('DELETE_FAILED');
    expect(screen.getByRole('dialog').textContent).toContain(revised.number);
    expect(onDeleted).not.toHaveBeenCalled(); expect(onChanged).not.toHaveBeenCalled();
    expect(quoteRow(original)).toBeTruthy(); expect(quoteRow(revised)).toBeTruthy();
    confirm();
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(revised.id));
    expect(fetch.mock.calls.map(call => call[0])).toEqual([`/api/quotes/${revised.id}`, `/api/quotes/${revised.id}`]);
    expect(quoteRow(original)).toBeTruthy(); expect(quoteRow(revised)).toBeNull();
  });

  it('removes only the acknowledged quotation immediately while a follow-up refresh is still pending', async () => {
    const refreshing = deferred<void>();
    const fetch = vi.fn(async () => deleted()); vi.stubGlobal('fetch', fetch);
    const onChanged = vi.fn(() => refreshing.promise);
    const { onDeleted } = harness({ selectedId: original.id, onChanged });
    fireEvent.click(within(quoteRow(original)!).getByRole('button', { name: `刪除 ${original.number} Rev. 1` }));
    confirm();
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(original.id));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('article')).toBeNull();
    expect(quoteRow(original)).toBeNull(); expect(quoteRow(revised)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('已刪除');
    await act(async () => { refreshing.resolve(); await refreshing.promise; });
  });

  it('separates a failed refresh from the successful delete and retries reads without another DELETE', async () => {
    const fetch = vi.fn(async () => deleted()); vi.stubGlobal('fetch', fetch);
    const onChanged = vi.fn().mockRejectedValueOnce(new Error('REFRESH_FAILED')).mockResolvedValueOnce(undefined);
    harness({ onChanged }); choose(); confirm();
    await screen.findByText(/報價已刪除，但重新讀取資料失敗/);
    expect(quoteRow(original)).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重新整理資料' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/REFRESH_FAILED/)).toBeNull());
    expect(fetch).toHaveBeenCalledTimes(1); expect(quoteRow(revised)).toBeTruthy();
  });

  it('hides a committed deletion even when the parent display callback fails', async () => {
    const fetch = vi.fn(async () => deleted()); vi.stubGlobal('fetch', fetch);
    const onDeleted = vi.fn(() => { throw new Error('DISPLAY_FAILED'); });
    harness({ onDeleted }); choose(); confirm();
    await screen.findByText(/報價已刪除，但畫面更新失敗/);
    expect(quoteRow(original)).toBeNull(); expect(quoteRow(revised)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith(original.id);
  });

  it('still notifies its parent after leaving the screen before the deletion acknowledgement arrives', async () => {
    const deleting = deferred<Response>();
    const fetch = vi.fn<(_resource: string | URL | Request, _init?: RequestInit) => Promise<Response>>(() => deleting.promise); vi.stubGlobal('fetch', fetch);
    const onDeleted = vi.fn(); const onChanged = vi.fn(async () => {});
    const view = render(<History quotes={[original, revised]} customers={[uiCustomer]} customerFilter="" onFilter={vi.fn()} onRevise={vi.fn()}
      selectedId={null} onSelect={vi.fn()} onDeleted={onDeleted} onChanged={onChanged} />);
    choose(); confirm(); view.unmount();
    await act(async () => { deleting.resolve(deleted()); await deleting.promise; });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(original.id));
    expect(onChanged).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
