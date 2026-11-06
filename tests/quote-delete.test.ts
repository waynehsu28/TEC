import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../src/lib/db';
import { createService } from '../src/lib/service';
import { quoteInput, quoteSnapshot, uiCustomer } from './fixtures/quotation';
import type { CustomsExchangeRate, QuoteInput } from '../src/lib/types';

const dir = mkdtempSync(path.join(tmpdir(), 'tec-quote-delete-'));
const databaseUrl = `file:${path.join(dir, 'delete.db')}`;
const client = createDb(databaseUrl);
const api = createService(client);
let sequence = 0;
function migrate(url: string, schema?: string) {
  execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', ...(schema ? ['--schema', schema] : [])], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
}
async function input(): Promise<QuoteInput> {
  const { id: _id, ...fields } = uiCustomer;
  const customer = await api.createCustomer({ ...fields, code: `DELETE-${++sequence}` });
  return quoteInput({
    customerId: customer.id, fxSource: 'MANUAL', fxRate: '32.5', fxDate: '2026-11-06', analysisCurrency: 'TWD',
    temporaryCharges: [{ name: 'Demo Documentation', basis: 'PER_SHIPMENT', rate: '5', currency: 'USD', included: false }],
  });
}
beforeAll(() => migrate(databaseUrl), 60_000);
afterAll(async () => { await client.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

describe('quotation soft deletion with real SQLite', () => {
  it('hides one quote while preserving its exact snapshot, normalized children and daily counter', async () => {
    const data = await input();
    const quote = await api.createQuote(data);
    const include = { cargo: true, charges: true, costs: true, exchangeRates: true, revisions: true, revisedBy: true } as const;
    const before = await client.quote.findUniqueOrThrow({ where: { id: quote.id }, include });
    expect(before.cargo).toHaveLength(1); expect(before.charges).toHaveLength(1);
    expect(before.costs).toHaveLength(1); expect(before.exchangeRates).toHaveLength(1);
    const counters = await client.quoteCounter.findMany();
    expect(await api.deleteQuote(quote.id)).toEqual({ id: quote.id, number: quote.number, revision: 1 });
    expect((await api.getQuotes()).some(row => row.id === quote.id)).toBe(false);
    await expect(api.getQuote(quote.id)).rejects.toMatchObject({ status: 404 });
    const after = await client.quote.findUniqueOrThrow({ where: { id: quote.id }, include });
    expect(after.deletedAt).toBeInstanceOf(Date);
    expect({ ...after, deletedAt: null }).toEqual(before);
    expect(await client.quoteCounter.findMany()).toEqual(counters);
    await expect(api.deleteQuote(quote.id)).rejects.toMatchObject({ status: 404 });
    expect((await client.quote.findUniqueOrThrow({ where: { id: quote.id } })).deletedAt).toEqual(after.deletedAt);
    await expect(api.deleteQuote('not-a-saved-quote')).rejects.toMatchObject({ status: 404 });
    expect(await client.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('keeps surviving revisions readable and extensible after their root is deleted', async () => {
    const data = await input();
    const root = await api.createQuote(data);
    const second = await api.createQuote({ ...data, revisionOfId: root.id });
    const third = await api.createQuote({ ...data, revisionOfId: second.id });
    await api.deleteQuote(root.id);
    const visible = (await api.getQuotes()).filter(q => q.customerId === data.customerId);
    expect(visible.map(q => q.revision).sort()).toEqual([2, 3]);
    expect((await api.getQuote(second.id)).snapshot).toEqual(second.snapshot);
    expect((await api.getQuote(third.id)).snapshot).toEqual(third.snapshot);
    const fourth = await api.createQuote({ ...data, revisionOfId: third.id });
    expect(fourth).toMatchObject({ rootId: root.id, revision: 4, number: `${root.number}-R004` });
    expect((await client.quoteRevision.findFirstOrThrow({ where: { quoteId: second.id } })).previousQuoteId).toBe(root.id);
    await expect(api.preview({ ...data, revisionOfId: root.id })).rejects.toMatchObject({ status: 404 });
    await expect(api.createQuote({ ...data, revisionOfId: root.id })).rejects.toMatchObject({ status: 404 });
  });

  it('reserves deleted revision numbers and never rolls back the daily quotation counter', async () => {
    const data = await input();
    const root = await api.createQuote(data);
    const second = await api.createQuote({ ...data, revisionOfId: root.id });
    const counters = await client.quoteCounter.findMany();
    await api.deleteQuote(second.id);
    const third = await api.createQuote({ ...data, revisionOfId: root.id });
    expect(third).toMatchObject({ revision: 3, number: `${root.number}-R003`, rootId: root.id });
    expect(await client.quoteCounter.findMany()).toEqual(counters);
    expect((await client.quote.findUniqueOrThrow({ where: { id: second.id } })).number).toBe(`${root.number}-R002`);
    await api.deleteQuote(root.id);
    const separate = await api.createQuote(data);
    expect(separate.number).not.toBe(root.number);
    expect(separate.revision).toBe(1);
  });

  it('preserves revision links and untouched snapshots when an intermediate revision is deleted', async () => {
    const data = await input();
    const root = await api.createQuote(data);
    const second = await api.createQuote({ ...data, revisionOfId: root.id });
    const third = await api.createQuote({ ...data, revisionOfId: second.id });
    const before = await client.quote.findUniqueOrThrow({ where: { id: third.id }, include: { revisions: true } });
    await api.deleteQuote(second.id);
    expect(await client.quote.findUniqueOrThrow({ where: { id: third.id }, include: { revisions: true } })).toEqual(before);
    expect(before.revisions[0].previousQuoteId).toBe(second.id);
    expect((await api.getQuote(root.id)).snapshot).toEqual(root.snapshot);
    expect((await api.getQuote(third.id)).snapshot).toEqual(third.snapshot);
    expect((await api.createQuote({ ...data, revisionOfId: third.id })).revision).toBe(4);
  });

  it('rechecks deletion in the save transaction after a preview-stage request was already in flight', async () => {
    const data = await input();
    const root = await api.createQuote(data);
    let started!: () => void;
    let finish!: (value: CustomsExchangeRate) => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const result = new Promise<CustomsExchangeRate>(resolve => { finish = resolve; });
    const getRate = vi.fn(async () => { started(); return result; });
    const slowApi = createService(client, { getCustomsExchangeRate: getRate });
    const attempt = slowApi.createQuote({ ...data, fxSource: 'CUSTOMS', revisionOfId: root.id });
    const rejected = expect(attempt).rejects.toMatchObject({ status: 404 });
    await began;
    await api.deleteQuote(root.id);
    finish({ currency: 'USD', date: data.shipmentDate, side: 'EXPORT', rate: '32.455', validFrom: '2026-11-01', validTo: '2026-11-10', sourceUrl: 'https://portal.sw.nat.gov.tw/APGQ/GC331!downLoad?formBean.downLoadFile=CURRENT_JSON', fetchedAt: '2026-11-06T00:00:00Z' });
    await rejected;
    expect(await client.quote.count({ where: { customerId: data.customerId } })).toBe(1);
    getRate.mockClear();
    await expect(slowApi.preview({ ...data, fxSource: 'CUSTOMS', revisionOfId: root.id })).rejects.toMatchObject({ status: 404 });
    expect(getRate).not.toHaveBeenCalled();
  });

  it('adds deletion support to an existing database without rewriting historical snapshots', async () => {
    const legacyFile = path.join(dir, 'legacy.db');
    const legacyUrl = `file:${legacyFile}`;
    const schema = path.join(dir, 'legacy', 'schema.prisma');
    mkdirSync(path.dirname(schema), { recursive: true });
    copyFileSync(path.resolve('prisma/schema.prisma'), schema);
    for (const migration of ['20261105000100_initial', '20261105000200_multimodal_country_rates', '20261105000300_tiered_charge_rates', '20261105000400_customs_exchange_rates']) {
      const target = path.join(path.dirname(schema), 'migrations', migration);
      mkdirSync(target, { recursive: true });
      copyFileSync(path.resolve('prisma/migrations', migration, 'migration.sql'), path.join(target, 'migration.sql'));
    }
    copyFileSync(path.resolve('prisma/migrations/migration_lock.toml'), path.join(path.dirname(schema), 'migrations/migration_lock.toml'));
    migrate(legacyUrl, schema);
    const snapshot = JSON.stringify(quoteSnapshot(), null, 2);
    const old = new DatabaseSync(legacyFile);
    old.prepare('INSERT INTO Customers(id,name,code,defaultCurrency) VALUES(?,?,?,?)').run('legacy-customer', 'Existing', 'EXISTING-DELETE', 'USD');
    old.prepare('INSERT INTO Quotes(id,number,customerId,status,snapshot) VALUES(?,?,?,?,?)').run('legacy-quote', 'EXISTING-QUOTE', 'legacy-customer', 'Draft', snapshot);
    old.close();
    migrate(legacyUrl);
    const upgraded = createDb(legacyUrl);
    try {
      const reloaded = createService(upgraded);
      expect((await reloaded.getQuotes()).map(q => q.id)).toEqual(['legacy-quote']);
      expect((await upgraded.quote.findUniqueOrThrow({ where: { id: 'legacy-quote' } })).deletedAt).toBeNull();
      await reloaded.deleteQuote('legacy-quote');
      expect((await upgraded.quote.findUniqueOrThrow({ where: { id: 'legacy-quote' } })).snapshot).toBe(snapshot);
      expect(await reloaded.getQuotes()).toEqual([]);
      expect(await upgraded.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    } finally { await upgraded.$disconnect(); }
  }, 60_000);
});
