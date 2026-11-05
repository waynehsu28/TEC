import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/lib/db';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createService } from '../src/lib/service';
import type { CustomerInput, ContractInput, QuoteInput } from '../src/lib/types';
const dir = mkdtempSync(path.join(tmpdir(), 'afq-test-'));
const datasourceUrl = `file:${path.join(dir, 'test.db')}`;
const client = createDb(datasourceUrl);
const api = createService(client);
const customerInput: CustomerInput = { name: 'Demo Test Customer', code: 'TEST-A', contact: '', email: '', phone: '', defaultCurrency: 'USD', remarks: 'Only automated test data', status: 'ACTIVE' };
function contractInput(customerId: string): ContractInput {
  return { customerId, number: 'TEST-CONTRACT', status: 'ACTIVE', origin: 'TPE', destination: 'LAX', airline: '', serviceType: '', commodity: '', effectiveDate: '2026-01-01', expiryDate: '2026-12-31', currency: 'USD', rateType: 'BASE_PLUS', minimumCharge: '100', normalRate: '5', breaks: [{ weight: '300', rate: '4.30' }], charges: [], remarks: '' };
}
function quoteInput(customerId: string): QuoteInput {
  return { customerId, origin: 'TPE', destination: 'LAX', airline: '', serviceType: '', commodity: '', shipmentDate: '2026-11-05',
    cargo: [{ pieces: 10, length: '70', width: '60', height: '60', grossWeight: '35', weightMode: 'PER_PIECE' }], contractVersionId: null, manualFreight: null, chargeOverrides: [], temporaryCharges: [],
    costs: [{ name: 'Airline Freight Cost', amount: '1344', currency: 'USD', status: 'ACTUAL' }], costsComplete: true, analysisCurrency: 'USD', fxRate: '', fxDate: '', validity: '2026-12-01', remarks: '', terms: '', status: 'Quoted', revisionOfId: null };
}
beforeAll(() => {
  execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: datasourceUrl }, stdio: 'pipe' });
}, 60_000);
beforeEach(async () => {
  await client.quoteRevision.deleteMany();
  await client.exchangeRate.deleteMany();
  await client.quoteCargoItem.deleteMany(); await client.quoteCharge.deleteMany(); await client.quoteCostItem.deleteMany();
  await client.quote.deleteMany({ where: { rootId: { not: null } } }); await client.quote.deleteMany();
  await client.contractRateBreak.deleteMany(); await client.contractCharge.deleteMany(); await client.contractVersion.deleteMany();
  await client.contract.deleteMany(); await client.customer.deleteMany(); await client.quoteCounter.deleteMany(); await client.settings.deleteMany();
});
afterAll(async () => { await client.$disconnect(); rmSync(dir, { recursive: true, force: true }); });
describe('real SQLite persistence and authoritative quotation workflow', () => {
  it('stores linked cargo, costs, applied rates, and immutable snapshot; reloads from a separate client', async () => {
    const customer = await api.createCustomer(customerInput);
    const contract = await api.createContract(contractInput(customer.id));
    const quote = await api.createQuote(quoteInput(customer.id));
    expect(quote.snapshot.weights.chargeableWeight).toBe('420');
    expect(quote.snapshot.freight.amount).toBe('1806.00');
    expect(quote.snapshot.finance.grossProfit).toBe('462.00');
    expect(quote.snapshot.finance.margin).toBe('25.58');
    expect(quote.snapshot.contract?.id).toBe(contract.versions[0].id);
    const linked = await client.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { cargo: true, costs: true } });
    expect(linked.cargo).toHaveLength(1); expect(linked.costs).toHaveLength(1);
    const second = createDb(datasourceUrl);
    try { expect(JSON.parse((await second.quote.findUniqueOrThrow({ where: { id: quote.id } })).snapshot).freight.amount).toBe('1806.00'); }
    finally { await second.$disconnect(); }
  });
  it('keeps every old contract version and quotation unchanged after editing rates', async () => {
    const customer = await api.createCustomer(customerInput);
    const contract = await api.createContract(contractInput(customer.id));
    const old = await api.createQuote(quoteInput(customer.id));
    const changed = await api.updateContract(contract.id, { ...contractInput(customer.id), breaks: [{ weight: '300', rate: '6' }] });
    expect(changed.versions).toHaveLength(2);
    expect(changed.versions[1].breaks[0].rate).toBe('4.30');
    expect((await api.getQuote(old.id)).snapshot).toEqual(old.snapshot);
    expect((await api.preview(quoteInput(customer.id))).freight.amount).toBe('2520.00');
    await expect(api.preview({ ...quoteInput(customer.id), contractVersionId: contract.versions[0].id })).rejects.toThrow('指定合約不符合');
  });
  it('uses the newest version covering the shipment date, preserving valid earlier periods', async () => {
    const a = await api.createCustomer(customerInput);
    const c = await api.createContract(contractInput(a.id));
    const v2 = await api.updateContract(c.id, { ...contractInput(a.id), effectiveDate: '2027-01-01', expiryDate: '2027-12-31', breaks: [{ weight: '300', rate: '6' }] });
    expect((await api.preview(quoteInput(a.id))).contract?.id).toBe(c.versions[0].id);
    expect((await api.preview({ ...quoteInput(a.id), shipmentDate: '2027-02-01', validity: '2027-03-01' })).contract?.id).toBe(v2.versions[0].id);
    const v3 = await api.updateContract(c.id, { ...contractInput(a.id), effectiveDate: '2026-01-01', expiryDate: '2026-06-30', breaks: [{ weight: '300', rate: '7' }] });
    expect(v3.versions).toHaveLength(3);
    expect((await api.preview(quoteInput(a.id))).contract?.id).toBe(c.versions[0].id);
    expect((await api.createQuote(quoteInput(a.id))).snapshot.freight.amount).toBe('1806.00');
  });
  it('rejects a cross-customer or expired explicit contract; never substitutes buying cost for selling', async () => {
    const a = await api.createCustomer(customerInput);
    const b = await api.createCustomer({ ...customerInput, code: 'TEST-B' });
    const contract = await api.createContract(contractInput(a.id));
    await expect(api.preview({ ...quoteInput(b.id), contractVersionId: contract.versions[0].id })).rejects.toThrow('指定合約不符合');
    await expect(api.preview({ ...quoteInput(a.id), shipmentDate: '2027-01-01', validity: '2027-02-01' })).rejects.toThrow('No Valid Contract Rate');
    const manual = await api.preview({ ...quoteInput(b.id), manualFreight: { amount: '2000', currency: 'USD' } });
    expect(manual.contract).toBeNull(); expect(manual.finance.revenue).toBe('2000.00');
  });
  it('requires explicit selection among equal matches, prioritizes airline specific, and rejects manual overrides of valid rates', async () => {
    const a = await api.createCustomer(customerInput);
    const first = await api.createContract(contractInput(a.id));
    await api.createContract({ ...contractInput(a.id), number: 'TEST-SECOND' });
    await expect(api.preview(quoteInput(a.id))).rejects.toThrow('多份');
    const selected = await api.preview({ ...quoteInput(a.id), contractVersionId: first.versions[0].id });
    expect(selected.contract?.number).toBe('TEST-CONTRACT');
    await expect(api.preview({ ...quoteInput(a.id), contractVersionId: first.versions[0].id, manualFreight: { amount: '999', currency: 'USD' } })).rejects.toThrow();
    const specific = await api.createContract({ ...contractInput(a.id), number: 'TEST-EVA', airline: 'BR' });
    expect((await api.preview({ ...quoteInput(a.id), airline: 'BR' })).contract?.id).toBe(specific.versions[0].id);
  });
  it('persists original and adjusted surcharge prices while excluding included All-in charges', async () => {
    const a = await api.createCustomer(customerInput);
    const c = await api.createContract({ ...contractInput(a.id), rateType: 'ALL_IN', charges: [
      { name: 'Fuel Surcharge', basis: 'PER_KG', rate: '0.5', currency: 'USD', included: true },
      { name: 'AWB Fee', basis: 'PER_SHIPMENT', rate: '20', currency: 'USD', included: false },
    ] });
    const awb = c.versions[0].charges.find(x => x.name === 'AWB Fee')!;
    const q = await api.createQuote({ ...quoteInput(a.id), chargeOverrides: [{ chargeId: awb.id!, rate: '25' }] });
    expect(q.snapshot.finance.revenue).toBe('1831.00');
    const rows = await client.quoteCharge.findMany({ where: { quoteId: q.id } });
    expect(rows.find(x => x.name === 'Fuel Surcharge')?.amount).toBe('0.00');
    expect(rows.find(x => x.name === 'AWB Fee')).toMatchObject({ originalRate: '20', appliedRate: '25', originalAmount: '20.00', amount: '25.00' });
  });
  it('creates new quote revisions without modifying an already-issued quote', async () => {
    const a = await api.createCustomer(customerInput); await api.createContract(contractInput(a.id));
    const original = await api.createQuote(quoteInput(a.id));
    const next = await api.createQuote({ ...quoteInput(a.id), revisionOfId: original.id, status: 'Accepted', remarks: 'Accepted in revision' });
    expect(next.rootId).toBe(original.id); expect(next.revision).toBe(2); expect(next.number).toBe(`${original.number}-R002`);
    expect((await api.getQuote(original.id)).status).toBe('Quoted');
    expect(await client.quoteRevision.count()).toBe(1);
    const third = await api.createQuote({ ...quoteInput(a.id), revisionOfId: original.id });
    expect(third.revision).toBe(3);
  });
  it('does not partially persist invalid requests and generates distinct sequential quotation numbers', async () => {
    const a = await api.createCustomer(customerInput); await api.createContract(contractInput(a.id));
    await expect(api.createQuote({ ...quoteInput(a.id), revisionOfId: 'missing' })).rejects.toThrow('找不到原始報價');
    expect(await client.quote.count()).toBe(0); expect(await client.quoteCargoItem.count()).toBe(0);
    const one = await api.createQuote(quoteInput(a.id)); const two = await api.createQuote(quoteInput(a.id));
    expect(one.number).toMatch(/^AFQ-\d{8}-0001$/); expect(two.number).toMatch(/^AFQ-\d{8}-0002$/);
  });
  it('preserves missing and partial costs and blocks inactive customers from new quotations', async () => {
    const a = await api.createCustomer(customerInput); await api.createContract(contractInput(a.id));
    const quote = await api.createQuote({ ...quoteInput(a.id), costs: [], costsComplete: false });
    expect(quote.snapshot.finance.costState).toBe('MISSING'); expect(quote.snapshot.finance.grossProfit).toBeNull();
    await api.updateCustomer(a.id, { ...customerInput, status: 'INACTIVE' });
    await expect(api.createQuote(quoteInput(a.id))).rejects.toThrow('停用');
    expect((await api.getQuote(quote.id)).snapshot.customer.status).toBe('ACTIVE');
  });
  it('allows one contract number to contain separate route records while rejecting duplicate route identity', async () => {
    const a = await api.createCustomer(customerInput);
    await api.createContract(contractInput(a.id));
    const secondRoute = await api.createContract({ ...contractInput(a.id), destination: 'SFO' });
    expect(secondRoute.number).toBe('TEST-CONTRACT');
    expect((await api.getContracts(a.id))).toHaveLength(2);
    await expect(api.createContract(contractInput(a.id))).rejects.toThrow();
  });
  it('saves exchange rate history and settings without altering earlier quote company snapshots', async () => {
    const a = await api.createCustomer(customerInput); await api.createContract(contractInput(a.id));
    const settings = await api.getSettings();
    await api.updateSettings({ ...settings, companyName: 'Original Co', exchangeRate: '32.5', exchangeRateDate: '2026-11-05' });
    const quote = await api.createQuote({ ...quoteInput(a.id), analysisCurrency: 'TWD', fxRate: '32.5', fxDate: '2026-11-05' });
    expect(quote.snapshot.finance.revenue).toBe('58695.00');
    await api.updateSettings({ ...settings, companyName: 'New Co' });
    expect((await api.getQuote(quote.id)).snapshot.company.name).toBe('Original Co');
    expect(await client.exchangeRate.count()).toBe(2);
  });
});
