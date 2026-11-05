import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../src/lib/db';
import { createService } from '../src/lib/service';

describe('existing air-only database upgrade', () => {
  it('adds routing defaults while preserving legacy rows, linked records, history and exact snapshot bytes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'afq-upgrade-'));
    const filename = path.join(dir, 'legacy.db');
    const datasourceUrl = `file:${filename}`;
    const prisma = path.resolve('node_modules/prisma/build/index.js');
    const run = (args: string[]) => execFileSync(process.execPath, [prisma, ...args], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: datasourceUrl }, stdio: 'pipe',
    });
    const legacySchema = path.join(dir, 'prisma', 'schema.prisma');
    const initialMigration = '20261105000100_initial';
    const initialDir = path.join(dir, 'prisma', 'migrations', initialMigration);
    mkdirSync(initialDir, { recursive: true });
    copyFileSync(path.resolve('prisma/schema.prisma'), legacySchema);
    copyFileSync(path.resolve('prisma/migrations', initialMigration, 'migration.sql'), path.join(initialDir, 'migration.sql'));
    copyFileSync(path.resolve('prisma/migrations/migration_lock.toml'), path.join(dir, 'prisma/migrations/migration_lock.toml'));
    // Deploy only the initial migration, just as an existing installation did before this change.
    run(['migrate', 'deploy', '--schema', legacySchema]);
    const legacyInput = {
      customerId: 'legacy-customer', origin: 'TPE', destination: 'LAX', airline: '', serviceType: '', commodity: '', shipmentDate: '2026-11-05',
      cargo: [{ pieces: 10, length: '70', width: '60', height: '60', grossWeight: '35', weightMode: 'PER_PIECE' }],
      contractVersionId: 'legacy-version', manualFreight: null, chargeOverrides: [], temporaryCharges: [],
      costs: [{ name: 'Freight cost', amount: '1344', currency: 'USD', status: 'ACTUAL' }], costsComplete: true,
      analysisCurrency: 'USD', fxRate: '', fxDate: '', validity: '2026-12-01', remarks: 'Issued before country pricing', terms: '', status: 'Quoted', revisionOfId: null,
    };
    const legacySnapshot = {
      input: legacyInput,
      customer: { id: 'legacy-customer', name: 'Existing Customer', code: 'EXISTING', contact: '', email: '', phone: '', defaultCurrency: 'USD', remarks: '', status: 'ACTIVE' },
      company: { name: 'Original Company', logo: '' },
      contract: { id: 'legacy-version', contractId: 'legacy-contract', version: 1, customerId: 'legacy-customer', number: 'EXISTING-RATE', status: 'ACTIVE',
        origin: 'TPE', destination: 'LAX', airline: '', serviceType: '', commodity: '', effectiveDate: '2026-01-01', expiryDate: '2026-12-31',
        currency: 'USD', rateType: 'BASE_PLUS', minimumCharge: '100', normalRate: '5', breaks: [{ weight: '300', rate: '4.30' }],
        charges: [{ id: 'legacy-charge', name: 'Included fuel', basis: 'PER_KG', rate: '0.5', currency: 'USD', included: true, minimumAmount: '', manualAmount: '' }], remarks: '' },
      weights: { pieces: 10, grossWeight: '350', cbm: '2.52', volumeWeight: '420', chargeableWeight: '420' },
      freight: { amount: '1806.00', currency: 'USD', rate: '4.30', appliedBreak: '+300', minimumApplied: false },
      charges: [{ name: 'Included fuel', basis: 'PER_KG', currency: 'USD', included: true, originalRate: '0.5', appliedRate: '0.5', originalAmount: '0.00', amount: '0.00', temporary: false }],
      finance: { revenue: '1806.00', knownCost: '1344.00', grossProfit: '462.00', margin: '25.58', markup: '34.38', costState: 'COMPLETE',
        provisional: false, negativeProfit: false, missingFx: false, revenueByCurrency: { USD: '1806.00' }, costByCurrency: { USD: '1344.00' } },
      settings: { volumeDivisor: '6000', weightIncrement: '0.5' }, createdAt: '2026-11-05T01:02:03.000Z',
    };
    // Preserve whitespace as well as data: upgrades must never reserialize issued JSON.
    const snapshotJson = JSON.stringify(legacySnapshot, null, 2);
    const legacy = new DatabaseSync(filename);
    legacy.prepare('INSERT INTO "Customers" (id,name,code,defaultCurrency) VALUES (?,?,?,?)').run('legacy-customer', 'Existing Customer', 'EXISTING', 'USD');
    legacy.prepare('INSERT INTO "Contracts" (id,customerId,number,routeKey) VALUES (?,?,?,?)').run('legacy-contract', 'legacy-customer', 'EXISTING-RATE', 'TPE|LAX|||');
    legacy.prepare('INSERT INTO "ContractVersions" (id,contractId,version,origin,destination,effectiveDate,expiryDate,currency,rateType,minimumCharge,normalRate) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run('legacy-version', 'legacy-contract', 1, 'TPE', 'LAX', '2026-01-01', '2026-12-31', 'USD', 'BASE_PLUS', '100', '5');
    legacy.prepare('INSERT INTO "ContractRateBreaks" (id,versionId,weight,rate) VALUES (?,?,?,?)').run('legacy-break', 'legacy-version', '300', '4.30');
    legacy.prepare('INSERT INTO "ContractCharges" (id,versionId,name,basis,rate,currency,included) VALUES (?,?,?,?,?,?,?)').run('legacy-charge', 'legacy-version', 'Included fuel', 'PER_KG', '0.5', 'USD', 1);
    legacy.prepare('INSERT INTO "Quotes" (id,number,customerId,contractVersionId,status,snapshot) VALUES (?,?,?,?,?,?)')
      .run('legacy-quote', 'AFQ-20261105-0001', 'legacy-customer', 'legacy-version', 'Quoted', snapshotJson);
    legacy.prepare('INSERT INTO "QuoteCargoItems" (id,quoteId,pieces,length,width,height,grossWeight,weightMode) VALUES (?,?,?,?,?,?,?,?)')
      .run('legacy-cargo', 'legacy-quote', 10, '70', '60', '60', '35', 'PER_PIECE');
    legacy.prepare('INSERT INTO "QuoteCostItems" (id,quoteId,name,amount,currency,status) VALUES (?,?,?,?,?,?)').run('legacy-cost', 'legacy-quote', 'Freight cost', '1344', 'USD', 'ACTUAL');
    legacy.prepare('INSERT INTO "QuoteCharges" (id,quoteId,name,basis,currency,included,originalRate,appliedRate,originalAmount,amount,temporary) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run('legacy-applied-charge', 'legacy-quote', 'Included fuel', 'PER_KG', 'USD', 1, '0.5', '0.5', '0.00', '0.00', 0);
    legacy.prepare('INSERT INTO "Settings" (id,companyName) VALUES (?,?)').run(1, 'Original Company');
    legacy.prepare('INSERT INTO "QuoteCounter" (date,sequence) VALUES (?,?)').run('20261105', 1);
    legacy.prepare('INSERT INTO "ExchangeRates" (id,quoteId,usdToTwd,rateDate) VALUES (?,?,?,?)').run('legacy-fx', 'legacy-quote', '32.5', '2026-11-05');
    legacy.close();

    const before = new DatabaseSync(filename);
    const initialHistory = before.prepare('SELECT id, checksum, CAST(finished_at AS TEXT) AS finished_at FROM "_prisma_migrations" WHERE migration_name = ?').get('20261105000100_initial');
    before.close();

    const client = createDb(datasourceUrl);
    try {
      run(['migrate', 'deploy']);
      const api = createService(client);
      const row = await client.quote.findUniqueOrThrow({ where: { id: 'legacy-quote' }, include: { cargo: true, costs: true, charges: true, exchangeRates: true } });
      expect(Buffer.from(row.snapshot)).toEqual(Buffer.from(snapshotJson));
      expect(row).toMatchObject({ transportMode: 'AIR', routeScope: 'AIRPORT', pricingBasis: 'PER_KG', originCountry: '', destinationCountry: '', seaShipmentType: '', containerType: '', containerCount: 0 });
      expect(row.cargo[0]).toMatchObject({ id: 'legacy-cargo', pieces: 10, grossWeight: '35' });
      expect(row.costs[0]).toMatchObject({ id: 'legacy-cost', amount: '1344' });
      expect(row.charges[0]).toMatchObject({ id: 'legacy-applied-charge', included: true, amount: '0.00' });
      expect(row.exchangeRates[0]).toMatchObject({ id: 'legacy-fx', usdToTwd: '32.5' });
      expect((await api.getQuote(row.id)).snapshot).toEqual(legacySnapshot);
      expect((await api.getQuote(row.id)).snapshot.input).not.toHaveProperty('transportMode');
      expect((await api.getContracts('legacy-customer'))[0].versions[0]).toMatchObject({ transportMode: 'AIR', routeScope: 'AIRPORT', pricingBasis: 'PER_KG', normalRate: '5' });
      expect((await api.preview(legacyInput)).freight.amount).toBe('1806.00');
      await expect(api.createContract({ ...legacySnapshot.contract, customerId: 'legacy-customer', number: 'EXISTING-RATE', status: 'ACTIVE' })).rejects.toThrow();
      expect(await client.quoteCounter.findUnique({ where: { date: '20261105' } })).toMatchObject({ sequence: 1 });
      expect((await client.settings.findUniqueOrThrow({ where: { id: 1 } })).companyName).toBe('Original Company');
      expect(await client.$queryRawUnsafe('SELECT id, checksum, CAST(finished_at AS TEXT) AS finished_at FROM "_prisma_migrations" WHERE migration_name = ?', '20261105000100_initial')).toEqual([initialHistory]);
      expect(await client.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    } finally {
      await client.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
