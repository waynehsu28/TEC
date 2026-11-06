import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { createDb } from '../src/lib/db';
import { createService, service } from '../src/lib/service';
import { GET } from '../src/app/api/[...path]/route';
import { quoteSchema, settingsSchema } from '../src/lib/validation';
import { readQuoteDraft, writeQuoteDraft } from '../src/lib/quote-draft';
import type { CustomsExchangeRate, CustomsRateSide } from '../src/lib/types';
import { quoteInput, quoteSnapshot, uiSettings } from './fixtures/quotation';
import { CustomsRateError } from '../src/lib/customs-exchange-rate';

const dir = mkdtempSync(path.join(tmpdir(), 'tec-customs-fx-'));
const databaseUrl = `file:${path.join(dir, 'rates.db')}`;
const client = createDb(databaseUrl);
const officialUrl = 'https://portal.sw.nat.gov.tw/APGQ/GC331!downLoad?formBean.downLoadFile=CURRENT_JSON';
function rate(date: string, side: CustomsRateSide): CustomsExchangeRate {
  return { currency: 'USD', date, side, rate: side === 'IMPORT' ? '32.555' : '32.455', validFrom: '2026-11-01', validTo: '2026-11-10', sourceUrl: officialUrl, fetchedAt: '2026-11-05T00:00:00.000Z' };
}
const fetchRate = vi.fn(async (date: string, side: CustomsRateSide) => rate(date, side));
const api = createService(client, { getCustomsExchangeRate: fetchRate });
let sequence = 0;
async function customer() {
  return api.createCustomer({ name: 'Demo customs FX', code: `DEMO-FX-${++sequence}`, contact: '', email: '', phone: '', defaultCurrency: 'USD', remarks: '', status: 'ACTIVE' });
}
function migrate(url: string, schema?: string) {
  execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', ...(schema ? ['--schema', schema] : [])], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
beforeAll(() => migrate(databaseUrl), 60_000);
afterEach(() => { vi.restoreAllMocks(); fetchRate.mockClear(); });
afterAll(async () => { await client.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

describe('authoritative customs exchange rates', () => {
  it('defaults newly initialized settings to Customs export rates', async () => {
    expect(await api.getSettings()).toMatchObject({ exchangeRateSource: 'CUSTOMS', customsRateSide: 'EXPORT' });
  });

  it.each([
    ['EXPORT', '32.455', '58613.73'],
    ['IMPORT', '32.555', '58794.33'],
  ] as const)('selects server-authoritative %s rates and persists source metadata', async (side, appliedRate, revenue) => {
    const savedCustomer = await customer();
    const input = quoteInput({ customerId: savedCustomer.id, analysisCurrency: 'TWD', fxSource: 'CUSTOMS', customsRateSide: side, fxRate: '0.01', fxDate: '2000-01-01', customsRate: { ...rate('2000-01-01', side), rate: '999' } });
    const quote = await api.createQuote(input);
    expect(fetchRate).toHaveBeenCalledWith(input.shipmentDate, side);
    expect(quote.snapshot.input).toMatchObject({ fxSource: 'CUSTOMS', fxRate: appliedRate, fxDate: input.shipmentDate, customsRateSide: side, customsRate: rate(input.shipmentDate, side) });
    expect(quote.snapshot.finance.revenue).toBe(revenue);
    const row = await client.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { exchangeRates: true } });
    expect(row.exchangeRates[0]).toMatchObject({ usdToTwd: appliedRate, rateDate: input.shipmentDate });
    const second = createDb(databaseUrl);
    try { expect((await createService(second).getQuote(quote.id)).snapshot).toEqual(quote.snapshot); }
    finally { await second.$disconnect(); }

    await api.updateSettings({ ...uiSettings, exchangeRateSource: 'MANUAL', exchangeRate: '99', exchangeRateDate: '2026-11-05' });
    expect((await client.quote.findUniqueOrThrow({ where: { id: quote.id } })).snapshot).toBe(row.snapshot);
  });

  it('allows Customs inputs with no browser rate while preserving legacy manual rates and stripping false provenance', async () => {
    const savedCustomer = await customer();
    const auto = await api.preview(quoteInput({ customerId: savedCustomer.id, fxSource: 'CUSTOMS', fxRate: '', fxDate: '' }));
    expect(auto.input.fxRate).toBe('32.455');
    expect(auto.input.customsRateSide).toBe('EXPORT');
    fetchRate.mockClear();
    const manual = await api.preview(quoteInput({ customerId: savedCustomer.id, fxRate: '31', fxDate: '2026-11-04', customsRate: rate('2026-11-05', 'EXPORT') }));
    expect(manual.input).toMatchObject({ fxSource: 'MANUAL', fxRate: '31', fxDate: '2026-11-04' });
    expect(manual.input).not.toHaveProperty('customsRate');
    expect(fetchRate).not.toHaveBeenCalled();
  });

  it('does not save a fabricated quote when Customs is unavailable and rejects inactive customers before fetching', async () => {
    const savedCustomer = await customer();
    const failing = vi.fn(async () => { throw new Error('海關匯率暫時無法取得，請稍後重試或改用手動匯率。'); });
    const failingApi = createService(client, { getCustomsExchangeRate: failing });
    const count = await client.quote.count();
    await expect(failingApi.createQuote(quoteInput({ customerId: savedCustomer.id, fxSource: 'CUSTOMS', fxRate: '999', fxDate: '2026-11-05' }))).rejects.toThrow('海關匯率');
    expect(await client.quote.count()).toBe(count);
    await client.customer.update({ where: { id: savedCustomer.id }, data: { status: 'INACTIVE' } });
    failing.mockClear();
    await expect(failingApi.preview(quoteInput({ customerId: savedCustomer.id, fxSource: 'CUSTOMS' }))).rejects.toThrow('停用');
    expect(failing).not.toHaveBeenCalled();
  });

  it('refreshes explicit Customs settings on the server while keeping old manual settings API behavior', async () => {
    const settings = await api.updateSettings({ ...uiSettings, exchangeRateSource: 'CUSTOMS', customsRateSide: 'IMPORT', exchangeRate: '1', exchangeRateDate: '2026-11-07' });
    expect(fetchRate).toHaveBeenCalledWith('2026-11-07', 'IMPORT');
    expect(settings).toMatchObject({ exchangeRate: '32.555', exchangeRateDate: '2026-11-07', exchangeRateSource: 'CUSTOMS', customsRateSide: 'IMPORT' });
    fetchRate.mockClear();
    const legacy = await api.updateSettings({ ...uiSettings, exchangeRate: '30', exchangeRateDate: '2026-11-05' });
    expect(legacy).toMatchObject({ exchangeRateSource: 'MANUAL', exchangeRate: '30' });
    expect(fetchRate).not.toHaveBeenCalled();
    expect(settingsSchema.safeParse({ ...uiSettings, exchangeRateSource: 'CUSTOMS', exchangeRate: '32', exchangeRateDate: '' }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...uiSettings, exchangeRateSource: 'MANUAL', exchangeRate: '32', exchangeRateDate: '' }).success).toBe(false);
  });

  it('upgrades existing settings and exact saved snapshot bytes without a Customs request', async () => {
    const legacyUrl = `file:${path.join(dir, 'legacy.db')}`;
    const schema = path.join(dir, 'legacy', 'schema.prisma');
    const prior = ['20261105000100_initial', '20261105000200_multimodal_country_rates', '20261105000300_tiered_charge_rates'];
    mkdirSync(path.dirname(schema), { recursive: true });
    copyFileSync(path.resolve('prisma/schema.prisma'), schema);
    for (const name of prior) {
      const target = path.join(path.dirname(schema), 'migrations', name); mkdirSync(target, { recursive: true });
      copyFileSync(path.resolve('prisma/migrations', name, 'migration.sql'), path.join(target, 'migration.sql'));
    }
    copyFileSync(path.resolve('prisma/migrations/migration_lock.toml'), path.join(path.dirname(schema), 'migrations/migration_lock.toml'));
    migrate(legacyUrl, schema);
    const before = new DatabaseSync(path.join(dir, 'legacy.db'));
    const snapshot = JSON.stringify(quoteSnapshot(), null, 2);
    before.prepare('INSERT INTO Customers(id,name,code,defaultCurrency) VALUES(?,?,?,?)').run('old-customer', 'Existing', 'OLD-FX', 'USD');
    before.prepare('INSERT INTO Quotes(id,number,customerId,status,snapshot) VALUES(?,?,?,?,?)').run('old-quote', 'OLD-FX-QUOTE', 'old-customer', 'Quoted', snapshot);
    before.prepare('INSERT INTO Settings(id,companyName,exchangeRate,exchangeRateDate) VALUES(?,?,?,?)').run(1, 'Existing company', '30.5', '2026-11-01');
    before.close();
    migrate(legacyUrl);
    const upgraded = createDb(legacyUrl);
    try {
      const oldApi = createService(upgraded, { getCustomsExchangeRate: fetchRate });
      expect((await oldApi.getSettings()).exchangeRate).toBe('30.5');
      expect((await upgraded.quote.findUniqueOrThrow({ where: { id: 'old-quote' } })).snapshot).toBe(snapshot);
      expect((await oldApi.getQuote('old-quote')).snapshot).toEqual(JSON.parse(snapshot));
      expect(await upgraded.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
      expect(fetchRate).not.toHaveBeenCalled();
    } finally { await upgraded.$disconnect(); }
  }, 60_000);
});

describe('Customs API and draft boundaries', () => {
  it('preserves the same private host guard and validates query fields before fetching', async () => {
    const fetch = vi.spyOn(service, 'getCustomsExchangeRate').mockResolvedValue(rate('2026-11-05', 'EXPORT'));
    const context = { params: Promise.resolve({ path: ['customs-exchange-rate'] }) };
    const request = (query: string, host = 'localhost:3000') => new NextRequest(`http://${host}/api/customs-exchange-rate?${query}`, { headers: { host } });
    expect((await GET(request('date=2026-11-05', 'outside.example'), context)).status).toBe(403);
    expect((await GET(request('date=2026-02-30'), context)).status).toBe(400);
    expect((await GET(request('date=2026-11-05&side=BUY'), context)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    const response = await GET(request('date=2026-11-05&side=EXPORT'), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rate('2026-11-05', 'EXPORT'));
  });

  it('validates source modes and keeps the manual-date requirement', () => {
    const base = quoteInput({ fxRate: '32', fxDate: '' });
    expect(quoteSchema.safeParse(base).success).toBe(false);
    expect(quoteSchema.safeParse({ ...base, fxSource: 'CUSTOMS' }).success).toBe(true);
    expect(quoteSchema.safeParse({ ...base, fxSource: 'UNKNOWN' }).success).toBe(false);
  });

  it('returns the upstream failure or out-of-period status without pretending a rate was fetched', async () => {
    const fetch = vi.spyOn(service, 'getCustomsExchangeRate');
    const context = { params: Promise.resolve({ path: ['customs-exchange-rate'] }) };
    const request = () => new NextRequest('http://localhost:3000/api/customs-exchange-rate?date=2026-11-05', { headers: { host: 'localhost:3000' } });
    for (const status of [422, 502]) {
      fetch.mockRejectedValueOnce(new CustomsRateError('匯率尚未公告或無法取得，請改用手動匯率。', status));
      const response = await GET(request(), context);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: '匯率尚未公告或無法取得，請改用手動匯率。' });
    }
  });

  it('restores old and partial Customs drafts but rejects malformed provenance metadata', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    for (const input of [quoteInput(), quoteInput({ fxSource: 'CUSTOMS', customsRateSide: 'EXPORT', customsRate: { ...rate('', 'EXPORT'), rate: '', validFrom: '', validTo: '' } })]) {
      writeQuoteDraft(storage, input); expect(readQuoteDraft(storage, null)).toEqual(input);
    }
    writeQuoteDraft(storage, quoteInput({ customsRate: { ...rate('2026-11-05', 'EXPORT'), sourceUrl: 'x'.repeat(501) } }));
    expect(readQuoteDraft(storage, null)).toBeNull();
  });
});
