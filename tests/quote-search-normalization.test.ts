import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb } from '../src/lib/db';
import { createService } from '../src/lib/service';
import { quoteListItemFromRecord } from '../src/lib/quote-list';
import { quoteInput, quoteSnapshot, uiCustomer } from './fixtures/quotation';
import type { QuoteRecord } from '../src/lib/types';

const dir = mkdtempSync(path.join(tmpdir(), 'tec-search-normalize-'));
const databaseUrl = `file:${path.join(dir, 'search.db')}`;
const client = createDb(databaseUrl);
const createdAt = new Date('2026-11-09T00:00:00.000Z');

beforeAll(async () => {
  execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  await client.$executeRawUnsafe('CREATE TABLE SearchWriteAudit (quoteId TEXT NOT NULL)');
  await client.$executeRawUnsafe('CREATE TRIGGER audit_search_updates AFTER UPDATE OF searchText, searchVersion ON Quotes BEGIN INSERT INTO SearchWriteAudit(quoteId) VALUES (NEW.id); END');
}, 60_000);
beforeEach(async () => {
  await client.quote.deleteMany();
  await client.customer.deleteMany();
  await client.$executeRawUnsafe('DELETE FROM SearchWriteAudit');
  await client.customer.create({ data: { ...uiCustomer, name: 'Current customer name' } });
});
afterAll(async () => { await client.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

function oldRow(index: number, options: { deleted?: boolean; invalidSnapshot?: boolean } = {}) {
  const input = quoteInput({ customerId: uiCustomer.id, destination: 'ＳＥＡＴＴＬＥ', status: index % 2 ? 'Quoted' : 'Accepted' });
  const snapshot = quoteSnapshot(input);
  snapshot.customer = { ...uiCustomer, name: 'ＡＣＭＥ MÜNCHEN 臺北', code: 'ＦＵＬＬ＿ＣＯＤＥ' };
  snapshot.company = { ...snapshot.company, logo: 'archive-only-large-payload-' + 'A'.repeat(50_000) };
  if (options.deleted) { snapshot.finance.revenue = null; snapshot.finance.grossProfit = null; }
  const record: QuoteRecord = {
    id: `unicode-${String(index).padStart(4, '0')}`, number: `UNICODE-${String(index).padStart(4, '0')}`,
    revision: 1, rootId: null, customerId: uiCustomer.id, status: input.status,
    createdAt: createdAt.toISOString(), snapshot,
  };
  const item = quoteListItemFromRecord(record);
  // SQLite's built-in lower() folds ASCII only. This models the SQL migration's
  // initial projection, before the application applies its Unicode normalization.
  const legacySearch = [item.number, item.customerName, item.customerCode, item.origin, item.destination,
    item.originCountry, item.destinationCountry].join(' ').replace(/[A-Z]/g, value => value.toLowerCase());
  return {
    ...item, unit: item.unit ?? '', createdAt,
    deletedAt: options.deleted ? createdAt : null,
    snapshot: options.invalidSnapshot ? 'not-json-on-purpose' : JSON.stringify(snapshot, null, 2),
    searchText: legacySearch, searchVersion: 0,
  };
}

async function writes(): Promise<number> {
  const rows = await client.$queryRaw<{ n: bigint | number }[]>`SELECT COUNT(*) AS n FROM SearchWriteAudit`;
  return Number(rows[0].n);
}

describe('legacy Unicode quote search preparation', () => {
  it('finds old full-width and Unicode customer/city text without rewriting snapshots or historical display values', async () => {
    await client.quote.createMany({ data: [oldRow(0), oldRow(1, { deleted: true })] });
    const preserved = { id: true, snapshot: true, customerName: true, customerCode: true, origin: true, destination: true,
      validity: true, revenue: true, grossProfit: true, deletedAt: true } as const;
    const before = await client.quote.findMany({ select: preserved, orderBy: { id: 'asc' } });
    const api = createService(client);
    for (const q of ['ＡＣＭＥ', 'acme', 'MÜNCHEN', 'münchen', '臺北', '台北', 'seattle', 'ＳＥＡＴＴＬＥ', 'FULL_CODE']) {
      const page = await api.listQuotes({ q });
      expect(page.total, q).toBe(1);
      expect(page.items.map(item => item.id), q).toEqual(['unicode-0000']);
      expect(page.items[0]).toMatchObject({ customerName: 'ＡＣＭＥ MÜNCHEN 臺北', destination: 'ＳＥＡＴＴＬＥ', revenue: '1806.00', grossProfit: '462.00' });
    }
    expect(await client.quote.findMany({ select: preserved, orderBy: { id: 'asc' } })).toEqual(before);
    expect(await client.quote.count({ where: { searchVersion: 0 } })).toBe(0);
    expect(await writes()).toBe(2);
    await api.listQuotes({ q: 'acme' });
    expect(await writes()).toBe(2);
  });

  it('prepares more than one batch from small summary fields, including rows whose snapshot cannot be parsed', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => oldRow(index, { invalidSnapshot: index % 2 === 1, deleted: index === 204 }));
    await client.quote.createMany({ data: rows });
    const api = createService(client);
    const page = await api.listQuotes({ q: 'acme', pageSize: 100, page: 3 });
    expect(page).toMatchObject({ total: 204, totalPages: 3, page: 3 });
    expect(page.items).toHaveLength(4);
    expect(await client.quote.count({ where: { searchVersion: 1 } })).toBe(205);
    expect(await writes()).toBe(205);
    expect((await api.listQuotes({ q: 'münchen', pageSize: 100 })).total).toBe(204);
    expect((await api.getQuoteOverview()).total).toBe(204);
    expect(await writes()).toBe(205);
    expect((await client.quote.findUniqueOrThrow({ where: { id: 'unicode-0001' } })).snapshot).toBe('not-json-on-purpose');
    for (const item of page.items) expect(item).not.toHaveProperty('snapshot');
  });

  it('shares preparation across concurrent page and search requests without missing or repeatedly rewriting rows', async () => {
    await client.quote.createMany({ data: Array.from({ length: 45 }, (_, index) => oldRow(index, { invalidSnapshot: true })) });
    const api = createService(client);
    const results = await Promise.all([
      api.listQuotes({ q: 'acme', page: 1 }),
      api.listQuotes({ q: 'münchen', page: 2 }),
      api.listQuotes({ q: '台北', page: 3 }),
    ]);
    expect(results.map(page => page.total)).toEqual([45, 45, 45]);
    expect(results.map(page => page.items.length)).toEqual([20, 20, 5]);
    expect(new Set(results.flatMap(page => page.items.map(item => item.id))).size).toBe(45);
    expect(await writes()).toBe(45);
    expect(await client.quote.count({ where: { searchVersion: 0 } })).toBe(0);
  });
});
