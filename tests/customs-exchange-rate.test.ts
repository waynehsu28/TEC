import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCustomsExchangeRateClient, CUSTOMS_EXCHANGE_RATE_URL } from '../src/lib/customs-exchange-rate';

// Reduced, unmodified fields from the GC331 archive at kurorido/tw-gc331,
// commit 5890f477f5c03b9a945e2b5d46a56a0f586b3ad5. Runtime never reads that archive.
const dataset = {
  start: '20261101', end: '20261110', items: [
    { code: 'TWD', buyValue: '1', sellValue: '1' },
    { code: 'USD', buyValue: '32.455', sellValue: '32.555' },
  ],
};
const json = (value: unknown = dataset) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const valid = () => vi.fn(async () => json());
const epoch = Date.UTC(2026, 10, 5, 1, 2, 3);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('official customs three-period exchange rate client', () => {
  it('selects the official buy/export and sell/import values, without losing decimal precision', async () => {
    const fetcher = valid();
    const get = createCustomsExchangeRateClient({ fetcher, now: () => epoch });
    expect(await get('2026-11-05', 'EXPORT')).toEqual({ currency: 'USD', date: '2026-11-05', side: 'EXPORT', rate: '32.455',
      validFrom: '2026-11-01', validTo: '2026-11-10', sourceUrl: CUSTOMS_EXCHANGE_RATE_URL, fetchedAt: '2026-11-05T01:02:03.000Z' });
    expect(await get('2026-11-05', 'IMPORT')).toMatchObject({ side: 'IMPORT', rate: '32.555' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(CUSTOMS_EXCHANGE_RATE_URL, expect.objectContaining({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal), headers: { Accept: 'application/json' } }));
  });

  it('includes both boundaries but refuses dates from another period instead of reusing the latest rate', async () => {
    const fetcher = valid();
    const get = createCustomsExchangeRateClient({ fetcher });
    expect((await get('2026-11-01', 'EXPORT')).date).toBe('2026-11-01');
    expect((await get('2026-11-10', 'EXPORT')).date).toBe('2026-11-10');
    await expect(get('2026-10-31', 'EXPORT')).rejects.toThrow('不包含 2026-10-31');
    await expect(get('2026-11-11', 'IMPORT')).rejects.toThrow('不包含 2026-11-11');
  });

  it.each([
    ['20240221', '20240229', '2024-02-29'],
    ['20260221', '20260228', '2026-02-28'],
    ['20261111', '20261120', '2026-11-20'],
    ['20261221', '20261231', '2026-12-31'],
  ])('accepts the real calendar period %s to %s', async (start, end, date) => {
    const get = createCustomsExchangeRateClient({ fetcher: async () => json({ ...dataset, start, end }) });
    expect((await get(date, 'EXPORT')).validTo).toBe(date);
  });

  it('validates requests before making any network call', async () => {
    const fetcher = valid();
    const get = createCustomsExchangeRateClient({ fetcher });
    for (const date of ['2026-02-29', '2026-11-31', '20261105', '2026-11-05?currency=EUR']) await expect(get(date, 'EXPORT')).rejects.toMatchObject({ status: 400 });
    await expect(get('2026-11-05', 'BUY' as 'EXPORT')).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ...dataset, start: '2026-11-01' },
    { ...dataset, start: '20260229', end: '20260310' },
    { ...dataset, start: '20261111', end: '20261110' },
    { ...dataset, start: '20261101', end: '20261210' },
    { ...dataset, start: '20261102' },
    { ...dataset, end: '20261109' },
  ])('rejects malformed or incomplete published periods %#', async value => {
    const get = createCustomsExchangeRateClient({ fetcher: async () => json(value) });
    await expect(get('2026-11-05', 'EXPORT')).rejects.toThrow('海關匯率');
  });

  it.each([32.455, '-32.455', '0', '1e3', '', 'NaN'])('rejects an invalid official numeric value %s', async rate => {
    const get = createCustomsExchangeRateClient({ fetcher: async () => json({ ...dataset, items: [{ code: 'USD', buyValue: rate, sellValue: '32.555' }] }) });
    await expect(get('2026-11-05', 'EXPORT')).rejects.toThrow('無效');
  });

  it('rejects absent or duplicated USD and invalid rate fields on another currency', async () => {
    for (const items of [[], [dataset.items[0]], [dataset.items[1], dataset.items[1]], [{ code: 'USD', buyValue: '32', sellValue: '0' }], [dataset.items[1], { code: 'EUR', buyValue: '1', sellValue: '-1' }]]) {
      const get = createCustomsExchangeRateClient({ fetcher: async () => json({ ...dataset, items }) });
      await expect(get('2026-11-05', 'EXPORT')).rejects.toThrow('海關匯率');
    }
  });

  it('reports HTTP, HTML, connection and empty-body failures without turning them into a rate', async () => {
    for (const fetcher of [
      async () => new Response('Unavailable', { status: 503 }),
      async () => new Response('<html>Temporary block</html>'),
      async () => new Response(null, { status: 204 }),
      async () => { throw new Error('transport failure'); },
    ]) {
      const get = createCustomsExchangeRateClient({ fetcher });
      await expect(get('2026-11-05', 'EXPORT')).rejects.toMatchObject({ status: 502 });
    }
  });

  it('enforces the body limit even when the server omits or understates Content-Length', async () => {
    const oversized = ' '.repeat(256 * 1024 + 1);
    const cases: Record<string, string>[] = [{}, { 'content-length': '2' }, { 'content-length': '999999' }];
    for (const headers of cases) {
      const get = createCustomsExchangeRateClient({ fetcher: async () => new Response(oversized, { headers }) });
      await expect(get('2026-11-05', 'EXPORT')).rejects.toThrow('大小限制');
    }
  });

  it('does not cache failures and shares only a successful fetch across simultaneous requests', async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('down', { status: 503 })).mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    const get = createCustomsExchangeRateClient({ fetcher, now: () => epoch });
    await expect(get('2026-11-05', 'EXPORT')).rejects.toThrow('503');
    const first = get('2026-11-05', 'EXPORT');
    const second = get('2026-11-06', 'IMPORT');
    release(json());
    expect((await first).rate).toBe('32.455');
    expect((await second).rate).toBe('32.555');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('expires its five-minute cache and refuses a stale fallback after a refresh fails', async () => {
    let clock = epoch;
    const fetcher = vi.fn().mockResolvedValueOnce(json()).mockResolvedValueOnce(new Response('down', { status: 503 })).mockResolvedValueOnce(json({ ...dataset, items: [{ code: 'USD', buyValue: '33.001', sellValue: '33.101' }] }));
    const get = createCustomsExchangeRateClient({ fetcher, now: () => clock });
    expect((await get('2026-11-05', 'EXPORT')).rate).toBe('32.455');
    clock += 299_999;
    expect((await get('2026-11-05', 'EXPORT')).rate).toBe('32.455');
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 1;
    await expect(get('2026-11-05', 'EXPORT')).rejects.toThrow('503');
    expect((await get('2026-11-05', 'EXPORT')).rate).toBe('33.001');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('times out even when transport ignores cancellation and never caches its late result', async () => {
    vi.useFakeTimers(); vi.setSystemTime(epoch);
    let release!: (response: Response) => void;
    let signal!: AbortSignal;
    const fetcher = vi.fn().mockImplementationOnce((_url, options) => { signal = options.signal; return new Promise<Response>(resolve => { release = resolve; }); }).mockResolvedValueOnce(json({ ...dataset, items: [{ code: 'USD', buyValue: '33.001', sellValue: '33.101' }] }));
    const get = createCustomsExchangeRateClient({ fetcher });
    const timedOut = expect(get('2026-11-05', 'EXPORT')).rejects.toThrow('逾時');
    await vi.advanceTimersByTimeAsync(10_000); await timedOut;
    expect(signal.aborted).toBe(true);
    expect((await get('2026-11-05', 'EXPORT')).rate).toBe('33.001');
    release(json()); await Promise.resolve(); await Promise.resolve();
    expect((await get('2026-11-05', 'EXPORT')).rate).toBe('33.001');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
