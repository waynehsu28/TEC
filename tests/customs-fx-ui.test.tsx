// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CustomsRatePicker from '../src/components/CustomsRatePicker';
import SettingsForm from '../src/components/SettingsForm';
import { uiSettings } from './fixtures/quotation';
import type { CustomsExchangeRate, CustomsRateSide, Settings } from '../src/lib/types';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const rate = (patch: Partial<CustomsExchangeRate> = {}): CustomsExchangeRate => ({ currency: 'USD', date: '2026-11-05', side: 'EXPORT', rate: '32.455', validFrom: '2026-11-01', validTo: '2026-11-10', sourceUrl: 'https://portal.sw.nat.gov.tw/APGQ/GC331!downLoad?formBean.downLoadFile=CURRENT_JSON', fetchedAt: '2026-11-05T00:00:00.000Z', ...patch });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const inputValue = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const saving = () => screen.getByRole('button', { name: '儲存設定' }) as HTMLButtonElement;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('customs exchange-rate picker', () => {
  it('requests the chosen date/side, shows the effective period and does not refetch for new callback identities', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response(rate())); vi.stubGlobal('fetch', fetch);
    const onLoaded = vi.fn(); const onStatus = vi.fn();
    const view = render(<CustomsRatePicker date="2026-11-05" side="EXPORT" onSideChange={vi.fn()} onLoaded={onLoaded} onStatusChange={onStatus} />);
    await screen.findByText(/1 USD = 32.455 TWD/);
    expect(fetch.mock.calls[0][0]).toBe('/api/customs-exchange-rate?date=2026-11-05&side=EXPORT');
    expect(onLoaded).toHaveBeenCalledWith(rate());
    expect(screen.getByText(/2026-11-01 至 2026-11-10/)).toBeTruthy();
    view.rerender(<CustomsRatePicker date="2026-11-05" side="EXPORT" onSideChange={() => {}} onLoaded={() => {}} onStatusChange={() => {}} />);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls.map(call => call[0])).toEqual(['loading', 'ready']);
  });

  it('ignores an older request after the date or side changes, even when the transport ignores abort', async () => {
    const older = deferred<Response>();
    const fetch = vi.fn().mockImplementationOnce(() => older.promise).mockResolvedValue(response(rate({ date: '2026-11-06', side: 'IMPORT', rate: '32.555' })));
    vi.stubGlobal('fetch', fetch); const onLoaded = vi.fn();
    const view = render(<CustomsRatePicker date="2026-11-05" side="EXPORT" onSideChange={vi.fn()} onLoaded={onLoaded} />);
    view.rerender(<CustomsRatePicker date="2026-11-06" side="IMPORT" onSideChange={vi.fn()} onLoaded={onLoaded} />);
    await screen.findByText(/1 USD = 32.555 TWD/);
    await act(async () => { older.resolve(response(rate())); await older.promise; });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded.mock.calls[0][0]).toMatchObject({ date: '2026-11-06', side: 'IMPORT' });
    expect(screen.queryByText(/1 USD = 32.455 TWD/)).toBeNull();
    expect((fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  });

  it('reports an upstream failure and allows retry without returning a stale rate', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ error: '官方資料不含所選日期' }, 503)).mockResolvedValueOnce(response(rate()));
    vi.stubGlobal('fetch', fetch); const onLoaded = vi.fn();
    render(<CustomsRatePicker date="2026-11-05" side="EXPORT" onSideChange={vi.fn()} onLoaded={onLoaded} />);
    await screen.findByRole('alert'); expect(onLoaded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新取得海關匯率' }));
    await screen.findByText(/1 USD = 32.455 TWD/); expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('does not refetch or reapply a ready rate when controls resume after saving', async () => {
    const fetch = vi.fn(async () => response(rate())); vi.stubGlobal('fetch', fetch); const onLoaded = vi.fn();
    const props = { date: '2026-11-05', side: 'EXPORT' as CustomsRateSide, onSideChange: vi.fn(), onLoaded };
    const view = render(<CustomsRatePicker {...props} />); await screen.findByText(/1 USD = 32.455 TWD/);
    view.rerender(<CustomsRatePicker {...props} disabled />);
    view.rerender(<CustomsRatePicker {...props} />);
    expect(fetch).toHaveBeenCalledTimes(1); expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('fetches when returning to an earlier date instead of remaining stuck behind a canceled request', async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn().mockResolvedValueOnce(response(rate())).mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(response(rate()));
    vi.stubGlobal('fetch', fetch); const props = { side: 'EXPORT' as CustomsRateSide, onSideChange: vi.fn(), onLoaded: vi.fn() };
    const view = render(<CustomsRatePicker {...props} date="2026-11-05" />); await screen.findByText(/1 USD = 32.455 TWD/);
    view.rerender(<CustomsRatePicker {...props} date="2026-11-06" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    view.rerender(<CustomsRatePicker {...props} date="2026-11-05" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3)); await screen.findByText(/1 USD = 32.455 TWD/);
  });

  it('rejects malformed dates before fetching and rejects a response for the wrong period', async () => {
    const fetch = vi.fn(async () => response(rate({ validTo: '2026-10-31' }))); vi.stubGlobal('fetch', fetch);
    const onLoaded = vi.fn(); const props = { side: 'EXPORT' as CustomsRateSide, onSideChange: vi.fn(), onLoaded };
    const view = render(<CustomsRatePicker {...props} date="2026-02-30" />);
    await screen.findByText(/請先選擇有效/); expect(fetch).not.toHaveBeenCalled();
    view.rerender(<CustomsRatePicker {...props} date="2026-11-05" />);
    await screen.findByText(/所選日期或類別不符/); expect(onLoaded).not.toHaveBeenCalled();
  });
});

describe('settings customs FX source', () => {
  const automatic: Settings = { ...uiSettings, exchangeRateSource: 'CUSTOMS', customsRateSide: 'EXPORT', exchangeRateDate: '2026-11-05' };
  it('blocks saving while fetching, then submits the API rate and source without a second post-save fetch', async () => {
    const pending = deferred<Response>(); const saved = vi.fn(async () => {});
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT' ? response({}) : pending.promise);
    vi.stubGlobal('fetch', fetch); render(<SettingsForm settings={automatic} onSaved={saved} />);
    expect(saving().disabled).toBe(true);
    expect((screen.getByLabelText('匯率：1 USD = ? TWD') as HTMLInputElement).readOnly).toBe(true);
    await act(async () => { pending.resolve(response(rate())); await pending.promise; });
    await waitFor(() => expect(saving().disabled).toBe(false));
    fireEvent.click(saving()); await screen.findByText('設定已儲存；既有報價快照不受影響。');
    const put = fetch.mock.calls.find(call => call[1]?.method === 'PUT');
    expect(JSON.parse(put![1]!.body as string)).toMatchObject({ exchangeRate: '32.455', exchangeRateDate: '2026-11-05', exchangeRateSource: 'CUSTOMS', customsRateSide: 'EXPORT' });
    expect(saved).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.filter(call => call[1]?.method !== 'PUT')).toHaveLength(1);
  });

  it('retains manually entered rate/date after a customs failure and explicitly switching back to manual', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT' ? response({}) : response({ error: '海關暫時無法連線' }, 503));
    vi.stubGlobal('fetch', fetch); render(<SettingsForm settings={{ ...uiSettings, exchangeRate: '31.2', exchangeRateDate: '2026-11-04' }} onSaved={vi.fn(async () => {})} />);
    fireEvent.change(screen.getByLabelText('匯率：1 USD = ? TWD'), { target: { value: '31.8' } });
    fireEvent.change(screen.getByLabelText('匯率來源'), { target: { value: 'CUSTOMS' } });
    await screen.findByText(/海關暫時無法連線/); expect(saving().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('匯率來源'), { target: { value: 'MANUAL' } });
    expect(inputValue('匯率：1 USD = ? TWD')).toBe('31.8'); expect(inputValue('匯率使用日期')).toBe('2026-11-04');
    expect(saving().disabled).toBe(false); expect(screen.queryByText(/海關暫時無法連線/)).toBeNull();
    fireEvent.click(saving()); await screen.findByText('設定已儲存；既有報價快照不受影響。');
    expect(JSON.parse(fetch.mock.calls.find(call => call[1]?.method === 'PUT')![1]!.body as string)).toMatchObject({ exchangeRateSource: 'MANUAL', exchangeRate: '31.8' });
  });

  it('does not overwrite manual values when a canceled customs request finishes late', async () => {
    const pending = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    render(<SettingsForm settings={{ ...uiSettings, exchangeRate: '31.25', exchangeRateDate: '2026-11-05' }} onSaved={vi.fn(async () => {})} />);
    fireEvent.change(screen.getByLabelText('匯率來源'), { target: { value: 'CUSTOMS' } });
    fireEvent.change(screen.getByLabelText('匯率來源'), { target: { value: 'MANUAL' } });
    fireEvent.change(screen.getByLabelText('匯率：1 USD = ? TWD'), { target: { value: '33' } });
    await act(async () => { pending.resolve(response(rate())); await pending.promise; });
    expect(inputValue('匯率：1 USD = ? TWD')).toBe('33'); expect(inputValue('匯率來源')).toBe('MANUAL');
  });
});
