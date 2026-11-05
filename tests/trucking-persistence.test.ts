import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../src/lib/db';
import { createService } from '../src/lib/service';
import type { ContractInput, CustomerInput, QuoteInput } from '../src/lib/types';

const dir = mkdtempSync(path.join(tmpdir(), 'tec-trucking-'));
const url = `file:${path.join(dir, 'trucking.db')}`;
const client = createDb(url);
const api = createService(client);
function migrate(databaseUrl: string, schema?: string) {
  execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', ...(schema ? ['--schema', schema] : [])], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
}
const customer: CustomerInput = { name: 'Demo Trucking Test', code: 'DEMO-TRUCKING', contact: '', email: '', phone: '', defaultCurrency: 'USD', remarks: '', status: 'ACTIVE' };
function contractInput(customerId: string): ContractInput {
  return { customerId, number: 'DEMO-TRUCKING-RATE', status: 'ACTIVE', origin: 'TPE', destination: 'LAX', airline: '', serviceType: '', commodity: '',
    effectiveDate: '2026-01-01', expiryDate: '2026-12-31', currency: 'USD', rateType: 'BASE_PLUS', minimumCharge: '', normalRate: '5', breaks: [], remarks: '',
    charges: [{ name: 'Trucking Charge', basis: 'PER_KG_TIERED', rate: '2', currency: 'USD', included: false, minimumAmount: '50', breaks: [{ weight: '45', rate: '1.5' }, { weight: '100', rate: '1' }] }],
  };
}
function quoteInput(customerId: string): QuoteInput {
  return { customerId, origin: 'TPE', destination: 'LAX', airline: '', serviceType: '', commodity: '', shipmentDate: '2026-11-05',
    cargo: [{ pieces: 1, length: '1', width: '1', height: '1', grossWeight: '45', weightMode: 'GROUP_TOTAL' }], contractVersionId: null, manualFreight: null,
    chargeOverrides: [], temporaryCharges: [], costs: [], costsComplete: false, analysisCurrency: 'USD', fxRate: '', fxDate: '', validity: '2026-11-30', remarks: '', terms: '', status: 'Draft', revisionOfId: null };
}
beforeAll(() => migrate(url), 60_000);
afterAll(async () => { await client.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

describe('tiered trucking SQLite persistence', () => {
  it('reloads normalized tier rules and selected quote metadata, preserving historical versions and exact snapshot bytes', async () => {
    const savedCustomer = await api.createCustomer(customer);
    const input = contractInput(savedCustomer.id);
    const contract = await api.createContract(input);
    const charge = contract.versions[0].charges[0];
    const { breaks, ...chargeFields } = input.charges[0];
    expect(charge).toMatchObject(chargeFields);
    expect(charge.breaks?.slice().sort((a, b) => Number(a.weight) - Number(b.weight))).toEqual(breaks);
    const chargeRow = await client.contractCharge.findUniqueOrThrow({ where: { id: charge.id! }, include: { breaks: true } });
    expect(chargeRow.breaks.map(b => ({ weight: b.weight, rate: b.rate })).sort((a, b) => Number(a.weight) - Number(b.weight)))
      .toEqual(input.charges[0].breaks);

    const quote = await api.createQuote({ ...quoteInput(savedCustomer.id), chargeOverrides: [{ chargeId: charge.id!, rate: '1.2' }] });
    expect(quote.snapshot.charges[0]).toMatchObject({ originalRate: '1.5', appliedRate: '1.2', originalAmount: '67.50', amount: '54.00', appliedBreak: '+45 KG', quantity: '45', minimumApplied: false });
    const rowBefore = await client.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { charges: true } });
    expect(rowBefore.charges[0]).toMatchObject(quote.snapshot.charges[0]);

    const changed = await api.updateContract(contract.id, { ...input, charges: [{ ...input.charges[0], breaks: [{ weight: '45', rate: '3' }] }] });
    expect(changed.versions).toHaveLength(2);
    expect(changed.versions[1].charges[0].breaks?.slice().sort((a, b) => Number(a.weight) - Number(b.weight))).toEqual(input.charges[0].breaks);
    expect((await api.preview(quoteInput(savedCustomer.id))).charges[0]).toMatchObject({ appliedRate: '3', amount: '135.00' });
    expect((await client.quote.findUniqueOrThrow({ where: { id: quote.id } })).snapshot).toBe(rowBefore.snapshot);

    const second = createDb(url);
    try {
      const reloaded = createService(second);
      expect((await reloaded.getContracts(savedCustomer.id))[0].versions[0].charges[0].breaks).toEqual([{ weight: '45', rate: '3' }]);
      expect((await reloaded.getQuote(quote.id)).snapshot).toEqual(quote.snapshot);
    } finally { await second.$disconnect(); }
  });

  it('upgrades an existing multimodal database without changing old flat charges or snapshot bytes', async () => {
    const legacyPath = path.join(dir, 'pre-trucking.db');
    const legacyUrl = `file:${legacyPath}`;
    const legacySchema = path.join(dir, 'legacy', 'schema.prisma');
    const previous = ['20261105000100_initial', '20261105000200_multimodal_country_rates'];
    mkdirSync(path.dirname(legacySchema), { recursive: true });
    copyFileSync(path.resolve('prisma/schema.prisma'), legacySchema);
    for (const migration of previous) {
      const target = path.join(path.dirname(legacySchema), 'migrations', migration);
      mkdirSync(target, { recursive: true });
      copyFileSync(path.resolve('prisma/migrations', migration, 'migration.sql'), path.join(target, 'migration.sql'));
    }
    copyFileSync(path.resolve('prisma/migrations/migration_lock.toml'), path.join(path.dirname(legacySchema), 'migrations/migration_lock.toml'));
    migrate(legacyUrl, legacySchema);
    const db = new DatabaseSync(legacyPath);
    const snapshot = '{\n  "issued": "before tiered trucking", "charges": [{"basis":"PER_KG","amount":"22.50"}]\n}';
    db.prepare('INSERT INTO Customers(id,name,code,defaultCurrency) VALUES(?,?,?,?)').run('old-customer', 'Existing', 'OLD', 'USD');
    db.prepare('INSERT INTO Contracts(id,customerId,number,routeKey) VALUES(?,?,?,?)').run('old-contract', 'old-customer', 'OLD-RATE', 'TPE|LAX|||');
    db.prepare('INSERT INTO ContractVersions(id,contractId,version,origin,destination,effectiveDate,expiryDate,currency,rateType,normalRate) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run('old-version', 'old-contract', 1, 'TPE', 'LAX', '2026-01-01', '2026-12-31', 'USD', 'BASE_PLUS', '5');
    db.prepare('INSERT INTO ContractCharges(id,versionId,name,basis,rate,currency,included) VALUES(?,?,?,?,?,?,?)')
      .run('old-charge', 'old-version', 'Trucking Charge', 'PER_KG', '0.5', 'USD', 0);
    db.prepare('INSERT INTO Quotes(id,number,customerId,contractVersionId,status,snapshot) VALUES(?,?,?,?,?,?)')
      .run('old-quote', 'OLD-QUOTE', 'old-customer', 'old-version', 'Quoted', snapshot);
    db.prepare('INSERT INTO QuoteCharges(id,quoteId,name,basis,currency,included,originalRate,appliedRate,originalAmount,amount,temporary) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('old-quote-charge', 'old-quote', 'Trucking Charge', 'PER_KG', 'USD', 0, '0.5', '0.5', '22.50', '22.50', 0);
    db.close();
    migrate(legacyUrl);
    const upgraded = createDb(legacyUrl);
    try {
      const saved = await upgraded.quote.findUniqueOrThrow({ where: { id: 'old-quote' }, include: { charges: true } });
      expect(Buffer.from(saved.snapshot)).toEqual(Buffer.from(snapshot));
      expect(saved.charges[0]).toMatchObject({ basis: 'PER_KG', originalRate: '0.5', amount: '22.50' });
      expect((await createService(upgraded).getContracts('old-customer'))[0].versions[0].charges[0]).toMatchObject({ basis: 'PER_KG', rate: '0.5' });
      expect(await upgraded.contractChargeRateBreak.count()).toBe(0);
      expect(await upgraded.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    } finally { await upgraded.$disconnect(); }
  }, 60_000);
});
