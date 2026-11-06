// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import QuoteEditor from '../src/components/QuoteEditor';
import type { CustomsExchangeRate, CustomsRateSide, QuoteInput, Settings } from '../src/lib/types';
import { readQuoteDraft, writeQuoteDraft } from '../src/lib/quote-draft';
import { quoteInput, quoteRecord, quoteSnapshot, uiCustomer, uiSettings } from './fixtures/quotation';

const sourceUrl = 'https://portal.sw.nat.gov.tw/APGQ/GC331!downLoad?formBean.downLoadFile=CURRENT_JSON';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function rate(date = '2026-11-05', side: CustomsRateSide = 'EXPORT'): CustomsExchangeRate {
  return { currency: 'USD', date, side, rate: side === 'IMPORT' ? '32.555' : '32.455', validFrom: '2026-11-01', validTo: '2026-11-10', sourceUrl, fetchedAt: '2026-11-05T00:00:00.000Z' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function harness(input: QuoteInput, options: {
  customs?: (date: string, side: CustomsRateSide) => Promise<Response>;
  saving?: Promise<Response>; settings?: Settings;
} = {}) {
  writeQuoteDraft(window.sessionStorage, input);
  const fetch = vi.fn(async (resource: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(resource);
    if (path.startsWith('/api/customs-exchange-rate?')) {
      const url = new URL(path, 'http://localhost');
      const date = url.searchParams.get('date')!;
      const side = url.searchParams.get('side') as CustomsRateSide;
      return options.customs?.(date, side) ?? response(rate(date, side));
    }
    if (path === '/api/match') return response([]);
    const body = init?.body ? JSON.parse(init.body as string) as QuoteInput : undefined;
    if (path === '/api/preview') return response(quoteSnapshot(body));
    if (path === '/api/quotes') return options.saving ?? response(quoteRecord(body));
    throw new Error(`Unexpected test request: ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  const onSaved = vi.fn();
  const view = render(<QuoteEditor customers={[uiCustomer]} settings={options.settings ?? uiSettings} initial={null} onSaved={onSaved} />);
  return { ...view, fetch, onSaved };
}
type FetchMock = ReturnType<typeof harness>['fetch'];
function calls(fetch: FetchMock, path: string) { return fetch.mock.calls.filter(([resource]) => String(resource).startsWith(path)); }
function body(fetch: FetchMock, path = '/api/preview'): QuoteInput {
  return JSON.parse(calls(fetch, path).at(-1)![1]!.body as string) as QuoteInput;
}
function button(name = '試算報價') { return screen.getByRole('button', { name }) as HTMLButtonElement; }
async function preview() {
  await waitFor(() => expect(button().disabled).toBe(false));
  fireEvent.click(button());
  await screen.findByText('報價試算結果', { exact: true });
}
const customsInput = () => quoteInput({ fxSource: 'CUSTOMS', customsRateSide: 'EXPORT', fxRate: '31', fxDate: '2026-10-31', customsRate: { ...rate(), rate: '31' } });

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('customs exchange rates in quotations', () => {
  it('loads the shipment-date rate before permitting calculation and preserves its source when saving', async () => {
    const loading = deferred<Response>();
    const saving = deferred<Response>();
    const { fetch, onSaved } = harness(customsInput(), { customs: () => loading.promise, saving: saving.promise });
    expect(calls(fetch, '/api/customs-exchange-rate').map(([path]) => path)).toEqual(['/api/customs-exchange-rate?date=2026-11-05&side=EXPORT']);
    await screen.findByLabelText('非合約基本運費（整票金額）');
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(calls(fetch, '/api/preview')).toHaveLength(0);

    await act(async () => { loading.resolve(response(rate())); await loading.promise; });
    await waitFor(() => expect((screen.getByLabelText('匯率：1 USD = ? TWD') as HTMLInputElement).value).toBe('32.455'));
    const rateInput = screen.getByLabelText('匯率：1 USD = ? TWD') as HTMLInputElement;
    const dateInput = screen.getByLabelText('匯率使用日期') as HTMLInputElement;
    expect(rateInput.readOnly).toBe(true);
    expect(dateInput.readOnly).toBe(true);
    expect(dateInput.value).toBe('2026-11-05');
    await preview();
    expect(body(fetch)).toMatchObject({ fxSource: 'CUSTOMS', customsRateSide: 'EXPORT', fxRate: '32.455', fxDate: '2026-11-05', customsRate: rate() });

    const submitted = body(fetch);
    fireEvent.click(button('儲存報價快照'));
    expect(rateInput.matches(':disabled')).toBe(true);
    expect(calls(fetch, '/api/customs-exchange-rate')).toHaveLength(1);
    await act(async () => { saving.resolve(response(quoteRecord(submitted))); await saving.promise; });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(body(fetch, '/api/quotes')).toMatchObject({ fxRate: '32.455', fxDate: '2026-11-05', customsRate: rate() });
    expect(screen.getByText(/已儲存 AFQ-20261105-0001/)).toBeTruthy();
    expect(button('儲存報價快照').disabled).toBe(true);
    expect(calls(fetch, '/api/customs-exchange-rate')).toHaveLength(1);
    expect(readQuoteDraft(window.sessionStorage, null)).toBeNull();
  });

  it('keeps stale rates unusable after a failed fetch, and allows an explicit manual fallback', async () => {
    const { fetch } = harness(customsInput(), { customs: async () => response({ error: '海關目前公告未涵蓋此日' }, 422) });
    await screen.findByRole('alert');
    await screen.findByLabelText('非合約基本運費（整票金額）');
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(calls(fetch, '/api/preview')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('匯率來源'), { target: { value: 'MANUAL' } });
    const rateInput = screen.getByLabelText('匯率：1 USD = ? TWD') as HTMLInputElement;
    const dateInput = screen.getByLabelText('匯率使用日期') as HTMLInputElement;
    expect(rateInput.value).toBe('31');
    expect(dateInput.value).toBe('2026-10-31');
    expect(rateInput.readOnly).toBe(false);
    expect(dateInput.readOnly).toBe(false);
    fireEvent.change(rateInput, { target: { value: '30.75' } });
    await preview();
    expect(body(fetch)).toMatchObject({ fxSource: 'MANUAL', fxRate: '30.75', fxDate: '2026-10-31' });
    expect(body(fetch)).not.toHaveProperty('customsRate');
    expect(screen.queryByLabelText('海關匯率類別')).toBeNull();
  });

  it('ignores responses for an older shipment date or side after the latest import rate arrives', async () => {
    const requests: { date: string; side: CustomsRateSide; gate: ReturnType<typeof deferred<Response>> }[] = [];
    const { fetch } = harness(customsInput(), { customs: (date, side) => {
      const gate = deferred<Response>(); requests.push({ date, side, gate }); return gate.promise;
    } });
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('出貨日期'), { target: { value: '2026-11-06' } });
    await waitFor(() => expect(requests).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('海關匯率類別'), { target: { value: 'IMPORT' } });
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(button().disabled).toBe(true);
    await act(async () => { requests[2].gate.resolve(response(rate('2026-11-06', 'IMPORT'))); await requests[2].gate.promise; });
    await waitFor(() => expect((screen.getByLabelText('匯率：1 USD = ? TWD') as HTMLInputElement).value).toBe('32.555'));
    await act(async () => {
      for (const request of requests.slice(0, 2)) request.gate.resolve(response(rate(request.date, request.side)));
      await Promise.all(requests.slice(0, 2).map(request => request.gate.promise));
    });
    expect((screen.getByLabelText('匯率：1 USD = ? TWD') as HTMLInputElement).value).toBe('32.555');
    expect((screen.getByLabelText('匯率使用日期') as HTMLInputElement).value).toBe('2026-11-06');
    const manualFreight = await screen.findByLabelText('非合約基本運費（整票金額）');
    fireEvent.change(manualFreight, { target: { value: '1806' } });
    await preview();
    expect(body(fetch)).toMatchObject({ fxSource: 'CUSTOMS', customsRateSide: 'IMPORT', fxRate: '32.555', fxDate: '2026-11-06', customsRate: rate('2026-11-06', 'IMPORT') });
  });

  it('preserves a legacy manual draft when the current settings default to customs rates', async () => {
    const { fetch } = harness(quoteInput({ fxRate: '31.25', fxDate: '2026-11-04' }), {
      settings: { ...uiSettings, exchangeRateSource: 'CUSTOMS', customsRateSide: 'IMPORT' },
    });
    expect((screen.getByLabelText('匯率來源') as HTMLSelectElement).value).toBe('MANUAL');
    expect((screen.getByLabelText('匯率：1 USD = ? TWD') as HTMLInputElement).readOnly).toBe(false);
    await preview();
    expect(calls(fetch, '/api/customs-exchange-rate')).toHaveLength(0);
    expect(body(fetch)).toMatchObject({ fxSource: 'MANUAL', fxRate: '31.25', fxDate: '2026-11-04' });
  });

  it('keeps the current official value when explicitly switching to manual after a successful load', async () => {
    const { fetch } = harness(customsInput());
    await waitFor(() => expect((screen.getByLabelText('匯率：1 USD = ? TWD') as HTMLInputElement).value).toBe('32.455'));
    fireEvent.change(screen.getByLabelText('匯率來源'), { target: { value: 'MANUAL' } });
    expect((screen.getByLabelText('匯率：1 USD = ? TWD') as HTMLInputElement).value).toBe('32.455');
    expect((screen.getByLabelText('匯率使用日期') as HTMLInputElement).value).toBe('2026-11-05');
    await preview();
    expect(body(fetch)).toMatchObject({ fxSource: 'MANUAL', fxRate: '32.455', fxDate: '2026-11-05' });
    expect(body(fetch)).not.toHaveProperty('customsRate');
  });

  it('rounds only the displayed volume weight while posting the original cargo dimensions and weights', async () => {
    const input = quoteInput({ cargo: [{ pieces: 1, length: '61', width: '41', height: '37', grossWeight: '1.23456789', weightMode: 'GROUP_TOTAL' }] });
    const { fetch } = harness(input);
    expect(within(screen.getByText('材積重量 Volume').parentElement!).getByText('15.42 kg')).toBeTruthy();
    expect(within(screen.getByText('實際總重 Gross').parentElement!).getByText('1.23456789 kg')).toBeTruthy();
    expect(within(screen.getByText('體積 CBM').parentElement!).getByText('0.092537')).toBeTruthy();
    expect(within(screen.getByText('計費重量 Chargeable').parentElement!).getByText('15.5 kg')).toBeTruthy();
    await preview();
    expect(body(fetch).cargo).toEqual(input.cargo);
  });
});
