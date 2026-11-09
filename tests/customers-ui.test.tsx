// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Home from '../src/app/page';
import Customers from '../src/components/Customers';
import type { Customer } from '../src/lib/types';
import { quoteOverview, uiCustomer, uiSettings } from './fixtures/quotation';

const created: Customer = { ...uiCustomer, id: 'new-customer', code: 'NEW', name: '新建立的客戶' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function harness(options: {
  customers?: Customer[];
  onSaved?: (customer: Customer) => void;
  onChanged?: () => Promise<void>;
} = {}) {
  const onSaved = options.onSaved ?? vi.fn();
  const onChanged = options.onChanged ?? vi.fn(async () => {});
  function ControlledCustomers() {
    const [customers, setCustomers] = useState(options.customers ?? [uiCustomer]);
    return <Customers customers={customers} onSaved={customer => {
      onSaved(customer);
      setCustomers(current => [...current.filter(row => row.id !== customer.id), customer]);
    }} onChanged={onChanged} onContracts={vi.fn()} onHistory={vi.fn()} />;
  }
  const view = render(<ControlledCustomers />);
  return { ...view, onSaved, onChanged };
}
function openAndFill(customer = created) {
  fireEvent.click(screen.getByRole('button', { name: /新增客戶/ }));
  fireEvent.change(screen.getByLabelText(/Customer Name/), { target: { value: customer.name } });
  fireEvent.change(screen.getByLabelText(/Customer Code/), { target: { value: customer.code } });
}
function submit() { fireEvent.click(screen.getByRole('button', { name: '儲存客戶' })); }
function customerRow(customer = created) {
  return screen.getByRole('row', { name: new RegExp(customer.name) });
}

beforeEach(() => { window.history.replaceState(null, '', '/'); window.sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('customer saving and list visibility', () => {
  it('clears both filters and displays a confirmed customer before its refresh completes', async () => {
    const refreshing = deferred<void>();
    const fetch = vi.fn(async (_resource: string | URL | Request, _init?: RequestInit) => response(created, 201));
    vi.stubGlobal('fetch', fetch);
    const { onSaved, onChanged } = harness({ onChanged: vi.fn(() => refreshing.promise) });
    fireEvent.change(screen.getByLabelText('搜尋客戶'), { target: { value: 'unrelated old search' } });
    fireEvent.change(screen.getByLabelText('客戶狀態'), { target: { value: 'INACTIVE' } });
    openAndFill(); submit();

    await screen.findByRole('row', { name: new RegExp(created.name) });
    expect(onSaved).toHaveBeenCalledWith(created);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('搜尋客戶') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('客戶狀態') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByLabelText(/Customer Name/)).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/已儲存|已新增/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', cache: 'no-store' });
    await act(async () => { refreshing.resolve(); await refreshing.promise; });
  });

  it('keeps entered data and reports a rejected POST without claiming success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: '客戶代碼已存在' }, 409)));
    const { onSaved, onChanged } = harness();
    openAndFill(); submit();

    expect((await screen.findByRole('alert')).textContent).toContain('客戶代碼已存在');
    expect((screen.getByLabelText(/Customer Name/) as HTMLInputElement).value).toBe(created.name);
    expect((screen.getByLabelText(/Customer Code/) as HTMLInputElement).value).toBe(created.code);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole('row', { name: new RegExp(created.name) })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: '儲存客戶' }).matches(':disabled')).toBe(false);
  });

  it('locks form controls and ignores another submit while the write is pending', async () => {
    const saving = deferred<Response>();
    const fetch = vi.fn(() => saving.promise);
    vi.stubGlobal('fetch', fetch);
    const { onSaved } = harness();
    openAndFill();
    const form = screen.getByLabelText(/Customer Name/).closest('form')!;
    fireEvent.submit(form);

    for (const control of form.querySelectorAll('input,select,textarea,button')) {
      expect(control.matches(':disabled')).toBe(true);
    }
    fireEvent.submit(form);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { saving.resolve(response(created, 201)); await saving.promise; });
    await screen.findByRole('row', { name: new RegExp(created.name) });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('does not close a new form when an older background refresh completes', async () => {
    const refreshing = deferred<void>();
    vi.stubGlobal('fetch', vi.fn(async () => response(created, 201)));
    harness({ onChanged: () => refreshing.promise });
    openAndFill(); submit();
    await screen.findByRole('row', { name: new RegExp(created.name) });
    const next = { ...created, code: 'NEXT', name: '下一位客戶' };
    openAndFill(next);
    await act(async () => { refreshing.resolve(); await refreshing.promise; });

    expect((screen.getByLabelText(/Customer Name/) as HTMLInputElement).value).toBe(next.name);
    expect((screen.getByLabelText(/Customer Code/) as HTMLInputElement).value).toBe(next.code);
    expect(customerRow()).toBeTruthy();
  });

  it.each(['edit', 'deactivate'] as const)('keeps a confirmed %s when refreshing fails', async operation => {
    const updated: Customer = operation === 'edit'
      ? { ...uiCustomer, name: '修改後的客戶名稱' }
      : { ...uiCustomer, status: 'INACTIVE' };
    const fetch = vi.fn(async (_resource: string | URL | Request, _init?: RequestInit) => response(updated));
    vi.stubGlobal('fetch', fetch);
    const { onSaved } = harness({ onChanged: async () => { throw new Error('REFRESH_UNAVAILABLE'); } });
    const row = customerRow(uiCustomer);
    if (operation === 'edit') {
      fireEvent.click(within(row).getByRole('button', { name: '編輯' }));
      fireEvent.change(screen.getByLabelText(/Customer Name/), { target: { value: updated.name } });
      submit();
    } else {
      fireEvent.click(within(row).getByRole('button', { name: '停用' }));
    }

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(customerRow(updated)).toBeTruthy();
    expect(screen.queryByLabelText(/Customer Name/)).toBeNull();
    expect((await screen.findByRole('alert')).textContent).toContain('REFRESH_UNAVAILABLE');
    expect(screen.getByRole('status').textContent).toMatch(/已儲存|已停用|已更新/);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'PUT' });
  });
});

describe('customer saving in the workspace', () => {
  it('retains the saved customer when the subsequent contracts request fails', async () => {
    let saved = false;
    const fetch = vi.fn(async (resource: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = String(resource);
      if (path === '/api/customers' && init?.method === 'POST') { saved = true; return response(created, 201); }
      if (path === '/api/customers') return response(saved ? [uiCustomer, created] : [uiCustomer]);
      if (path === '/api/contracts') return saved ? response({ error: 'CONTRACTS_RELOAD_FAILED' }, 500) : response([]);
      if (path === '/api/quotes/overview') return response(quoteOverview());
      if (path === '/api/settings') return response(uiSettings);
      throw new Error(`Unexpected test request: ${path}`);
    });
    vi.stubGlobal('fetch', fetch);
    window.history.replaceState(null, '', '/#customers');
    render(<Home />);
    await screen.findByRole('button', { name: /新增客戶/ });
    openAndFill(); submit();

    await screen.findByRole('row', { name: new RegExp(created.name) });
    await screen.findByText(/CONTRACTS_RELOAD_FAILED/);
    expect(screen.queryByLabelText(/Customer Name/)).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/已儲存|已新增/);
    expect(window.location.hash).toBe('#customers');
    expect(fetch.mock.calls.filter(([resource, init]) => resource === '/api/customers' && init?.method === 'POST')).toHaveLength(1);

    const nav = within(screen.getByRole('navigation'));
    fireEvent.click(nav.getByRole('button', { name: /營運總覽/ }));
    fireEvent.click(nav.getByRole('button', { name: /客戶資料/ }));
    expect(customerRow()).toBeTruthy();
  });

  it('updates shared customer state when its POST finishes after navigating away', async () => {
    const saving = deferred<Response>();
    let saved = false;
    vi.stubGlobal('fetch', vi.fn(async (resource: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = String(resource);
      if (path === '/api/customers' && init?.method === 'POST') {
        const result = await saving.promise;
        saved = result.ok;
        return result;
      }
      if (path === '/api/customers') return response([uiCustomer]);
      if (path === '/api/contracts') return saved ? response({ error: 'BACKGROUND_REFRESH_FAILED' }, 500) : response([]);
      if (path === '/api/quotes/overview') return response(quoteOverview());
      if (path === '/api/settings') return response(uiSettings);
      throw new Error(`Unexpected test request: ${path}`);
    }));
    window.history.replaceState(null, '', '/#customers');
    render(<Home />);
    await screen.findByRole('button', { name: /新增客戶/ });
    openAndFill(); submit();
    const nav = within(screen.getByRole('navigation'));
    fireEvent.click(nav.getByRole('button', { name: /營運總覽/ }));
    await act(async () => { saving.resolve(response(created, 201)); await saving.promise; });

    expect(window.location.hash).toBe('#dashboard');
    fireEvent.click(nav.getByRole('button', { name: /客戶資料/ }));
    await screen.findByRole('row', { name: new RegExp(created.name) });
  });
});
