import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../src/lib/db';
import { createService } from '../src/lib/service';
import { quoteListItemFromRecord, quoteSearchText } from '../src/lib/quote-list';
import { parseQuoteListQuery } from '../src/lib/quote-list-query';
import { quoteInput, quoteSnapshot, uiCustomer } from './fixtures/quotation';
import type { Customer, QuoteListItem, QuoteRecord } from '../src/lib/types';

const dir = mkdtempSync(path.join(tmpdir(), 'tec-paging-'));
const databaseUrl = `file:${path.join(dir, 'paging.db')}`;
const client = createDb(databaseUrl), api = createService(client);
const createdAt = new Date('2026-11-06T00:00:00.000Z');
let customers: Customer[];
let active: QuoteListItem[];
function migrate(url: string, schema?: string) {
  execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', ...(schema ? ['--schema', schema] : [])], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
}
beforeAll(() => migrate(databaseUrl), 60_000);
beforeEach(async () => {
  await client.quoteRevision.deleteMany(); await client.exchangeRate.deleteMany(); await client.quoteCargoItem.deleteMany();
  await client.quoteCharge.deleteMany(); await client.quoteCostItem.deleteMany(); await client.quote.deleteMany();
  await client.customer.deleteMany(); await client.quoteCounter.deleteMany();
  const { id: _id, ...fields } = uiCustomer;
  customers = await Promise.all([
    api.createCustomer({ ...fields, name: 'Archive Customer', code: 'ARCHIVE' }),
    api.createCustomer({ ...fields, name: "Unique %_ ' Freight", code: 'SPECIAL_%_' }),
  ]);
  const records = Array.from({ length: 55 }, (_, index) => {
    const customer = customers[index === 50 ? 1 : 0];
    const sea = index % 2 === 1, japan = index % 5 === 0;
    const input = quoteInput({ customerId: customer.id, transportMode: sea ? 'SEA' : 'AIR', seaShipmentType: sea ? 'LCL' : '',
      destinationCountry: japan ? 'JP' : 'US', destination: japan ? 'Tokyo' : 'Seattle',
      status: (['Draft', 'Quoted', 'Accepted'] as const)[index % 3] });
    const snapshot = quoteSnapshot(input); snapshot.customer = customer;
    snapshot.company.logo = 'data:image/png;base64,' + 'A'.repeat(100_000);
    if (index === 49) { snapshot.finance.revenue = null; snapshot.finance.grossProfit = null; }
    const record: QuoteRecord = { id: `paging-${String(index).padStart(4, '0')}`, number: `PAGING-${String(index).padStart(4, '0')}`, revision: 1,
      rootId: null, customerId: customer.id, status: input.status, createdAt: createdAt.toISOString(), snapshot };
    const item = quoteListItemFromRecord(record);
    return { record, item, deletedAt: index >= 51 ? createdAt : null };
  });
  active = records.filter(row => row.deletedAt === null).map(row => row.item).reverse();
  await client.quote.createMany({ data: records.map(({ record, item, deletedAt }) => ({
    ...item, unit: item.unit ?? '', createdAt, deletedAt, snapshot: JSON.stringify(record.snapshot), searchText: quoteSearchText(item),
  })) });
});
afterAll(async () => { await client.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

describe('bounded quote summaries and server-side search', () => {
  it('returns three deterministic non-overlapping pages and clamps a deleted last page', async () => {
    const pages = await Promise.all([api.listQuotes(), api.listQuotes({ page: 2 }), api.listQuotes({ page: 3 })]);
    expect(pages.map(page => page.items.length)).toEqual([20, 20, 11]);
    for (const [index, page] of pages.entries()) expect(page).toMatchObject({ page: index + 1, pageSize: 20, total: 51, totalPages: 3 });
    expect(pages.flatMap(page => page.items.map(item => item.id))).toEqual(active.map(item => item.id));
    expect((await api.listQuotes({ page: 999_999 })).page).toBe(3);
    await client.quote.updateMany({ where: { id: { in: active.slice(40).map(item => item.id) } }, data: { deletedAt: new Date() } });
    expect(await api.listQuotes({ page: 3 })).toMatchObject({ page: 2, totalPages: 2, total: 40 });
    const empty = await api.listQuotes({ q: 'no such stored customer' });
    expect(empty).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
  });

  it('intersects customer, mode, status and literal text filters, including country names and city case', async () => {
    const expected = active.filter(item => item.customerId === customers[0].id && item.transportMode === 'SEA' && item.status === 'Quoted' && item.destinationCountry === 'US');
    const result = await api.listQuotes({ customerId: customers[0].id, transportMode: 'SEA', status: 'Quoted', q: '  台灣 美國  ' });
    expect(result.items.map(item => item.id)).toEqual(expected.map(item => item.id));
    expect(result.total).toBe(expected.length);
    expect((await api.listQuotes({ q: 'sEaTtLe', pageSize: 100 })).items.map(item => item.id)).toEqual(active.filter(item => item.destination === 'Seattle').map(item => item.id));
    expect((await api.listQuotes({ q: 'PAGING-0050' })).items[0].id).toBe('paging-0050');
    for (const q of ['%', '_', '%_', "Unique %_ '", 'SPECIAL_%_']) expect((await api.listQuotes({ q })).items.map(item => item.id)).toEqual(['paging-0050']);
    expect((await api.listQuotes({ q: "' OR 1=1--" })).total).toBe(0);
    expect((await api.listQuotes({ customerId: customers[1].id, q: '美國' })).total).toBe(0);
  });

  it('keeps list snapshots immutable, nullable finance intact and large snapshot data off list/overview responses', async () => {
    await client.customer.update({ where: { id: customers[0].id }, data: { name: 'Renamed Current Customer' } });
    // List/overview must not deserialize the old large document at read time.
    await client.quote.update({ where: { id: 'paging-0049' }, data: { snapshot: 'not-json-on-purpose' } });
    const page = await api.listQuotes();
    expect(page.items.find(item => item.id === 'paging-0049')).toMatchObject({ customerName: 'Archive Customer', revenue: null, grossProfit: null });
    expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThan(25_000);
    for (const item of page.items) {
      expect(item).not.toHaveProperty('snapshot'); expect(item).not.toHaveProperty('searchText');
      expect(item).not.toHaveProperty('company'); expect(item).not.toHaveProperty('costs');
    }
    const overview = await api.getQuoteOverview();
    expect(overview).toMatchObject({ total: 51, quoted: 17, accepted: 17 });
    expect(overview.recent.map(item => item.id)).toEqual(active.slice(0, 6).map(item => item.id));
    expect(Buffer.byteLength(JSON.stringify(overview), 'utf8')).toBeLessThan(8_000);
  });

  it('writes new authoritative list projections together with the quote transaction', async () => {
    const quote = await api.createQuote(quoteInput({ customerId: customers[0].id, fxSource: 'MANUAL' }));
    const expected = quoteListItemFromRecord(quote);
    expect((await api.listQuotes({ q: quote.number })).items).toEqual([expected]);
    const saved = await client.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(saved).toMatchObject({ customerName: expected.customerName, customerCode: expected.customerCode, validity: quote.snapshot.input.validity, revenue: expected.revenue, analysisCurrency: expected.analysisCurrency });
    await api.deleteQuote(quote.id);
    expect((await api.listQuotes({ q: quote.number })).items).toEqual([]);
    expect((await api.getQuoteOverview()).total).toBe(51);
  });

  it('validates page/filter bounds before querying and preserves accepted page sizes', async () => {
    for (const raw of [{ page: 0 }, { page: -1 }, { page: 1.2 }, { page: 1_000_001 }, { page: '1e2' }, { page: true }, { pageSize: 10 }, { pageSize: 101 },
      { q: 'x'.repeat(121) }, { status: 'Unknown' }, { transportMode: 'TRUCK' }, { customerId: '../customer' }, { unknown: 'value' }]) {
      expect(() => parseQuoteListQuery(raw)).toThrow(); await expect(api.listQuotes(raw)).rejects.toThrow();
    }
    for (const pageSize of [20, 50, 100]) expect((await api.listQuotes({ pageSize })).items.length).toBe(Math.min(pageSize, 51));
  });
});

describe('existing quote-list projection upgrade', () => {
  it('backfills legacy air and country summaries without changing original JSON bytes, null finance or deletion state', async () => {
    const filename = path.join(dir, 'legacy.db'), url = `file:${filename}`, schema = path.join(dir, 'legacy', 'schema.prisma');
    const prior = ['20261105000100_initial', '20261105000200_multimodal_country_rates', '20261105000300_tiered_charge_rates', '20261105000400_customs_exchange_rates', '20261106000500_quote_soft_delete'];
    mkdirSync(path.dirname(schema), { recursive: true }); copyFileSync(path.resolve('prisma/schema.prisma'), schema);
    for (const migration of prior) { const folder = path.join(path.dirname(schema), 'migrations', migration); mkdirSync(folder, { recursive: true }); copyFileSync(path.resolve('prisma/migrations', migration, 'migration.sql'), path.join(folder, 'migration.sql')); }
    copyFileSync(path.resolve('prisma/migrations/migration_lock.toml'), path.join(path.dirname(schema), 'migrations/migration_lock.toml'));
    migrate(url, schema);
    const db = new DatabaseSync(filename);
    db.prepare('INSERT INTO Customers(id,name,code,defaultCurrency) VALUES(?,?,?,?)').run('legacy-customer', 'Current Name', 'CURRENT', 'USD');
    const legacyAir = quoteSnapshot(quoteInput({ routeScope: 'AIRPORT', origin: 'TPE', destination: 'LAX', originCountry: '', destinationCountry: '' }));
    delete legacyAir.input.transportMode; delete legacyAir.input.routeScope;
    legacyAir.customer = { ...legacyAir.customer, name: '臺北物流 Original Name', code: 'ORIGINAL' };
    legacyAir.freight = { amount: '1806.00', currency: 'USD', rate: '4.30', appliedBreak: '+300 KG', minimumApplied: false };
    legacyAir.finance.grossProfit = null; legacyAir.finance.revenue = null;
    const airJson = JSON.stringify(legacyAir, null, 2);
    const country = quoteSnapshot(quoteInput({ origin: '高雄' })); country.customer = { ...uiCustomer, name: 'Historical Country Customer' };
    const countryJson = JSON.stringify(country, null, 4);
    db.prepare('INSERT INTO Quotes(id,number,customerId,status,snapshot) VALUES(?,?,?,?,?)').run('legacy-air', 'LEGACY-AIR', 'legacy-customer', 'Quoted', airJson);
    db.prepare('INSERT INTO Quotes(id,number,customerId,status,snapshot,transportMode,routeScope,originCountry,destinationCountry,deletedAt) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run('legacy-country', 'LEGACY-COUNTRY', 'legacy-customer', 'Accepted', countryJson, 'AIR', 'COUNTRY', 'TW', 'US', null);
    db.prepare('INSERT INTO Quotes(id,number,customerId,status,snapshot,deletedAt) VALUES(?,?,?,?,?,?)').run('already-deleted', 'OLD-DELETED', 'legacy-customer', 'Draft', countryJson, 1);
    db.close(); migrate(url);
    const upgraded = createDb(url);
    try {
      const upgradedApi = createService(upgraded);
      expect((await upgraded.quote.findUniqueOrThrow({ where: { id: 'legacy-air' } })).snapshot).toBe(airJson);
      expect((await upgraded.quote.findUniqueOrThrow({ where: { id: 'legacy-country' } })).snapshot).toBe(countryJson);
      const air = (await upgradedApi.listQuotes({ q: 'ORIGINAL LAX' })).items[0];
      expect(air).toMatchObject({ id: 'legacy-air', customerName: '臺北物流 Original Name', customerCode: 'ORIGINAL', validity: legacyAir.input.validity, quantity: '420', unit: 'KG', revenue: null, grossProfit: null });
      for (const q of ['臺北', '台北']) expect((await upgradedApi.listQuotes({ q })).items.map(item => item.id)).toEqual(['legacy-air']);
      expect((await upgradedApi.listQuotes({ q: '台灣 美國' })).items.map(item => item.id)).toEqual(['legacy-country']);
      expect((await upgradedApi.listQuotes({ pageSize: 100 })).total).toBe(2);
      expect((await upgradedApi.getQuoteOverview()).total).toBe(2);
      expect(await upgraded.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    } finally { await upgraded.$disconnect(); }
  }, 60_000);
});
