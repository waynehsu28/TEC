import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { customerPdfData, generateQuotePdf } from '../src/lib/pdf';
import type { QuoteRecord } from '../src/lib/types';

function quoteFixture(): QuoteRecord {
  return {
    id: 'test-quote', number: 'AFQ-20261105-0001', revision: 1, rootId: null,
    customerId: 'customer-a', status: 'Quoted', createdAt: '2026-11-05T01:30:00.000Z',
    snapshot: {
      customer: { id: 'customer-a', name: '測試客戶甲', code: 'TEST-A', contact: '王小姐', email: 'test@example.com', phone: '02-12345678', defaultCurrency: 'USD', remarks: 'CUSTOMER_INTERNAL_SECRET', status: 'ACTIVE' },
      company: { name: '測試空運公司', logo: '' }, contract: null,
      input: {
        customerId: 'customer-a', origin: 'TPE', destination: 'LAX', airline: 'BR', serviceType: 'GENERAL', commodity: '電子零件', shipmentDate: '2026-11-06',
        cargo: [{ pieces: 10, length: '70', width: '60', height: '60', grossWeight: '35', weightMode: 'PER_PIECE' }],
        contractVersionId: null, manualFreight: { amount: '1806.00', currency: 'USD' }, chargeOverrides: [], temporaryCharges: [],
        costs: [{ name: 'INTERNAL_COST_SECRET', amount: '987654.32', currency: 'USD', status: 'ACTUAL' }], costsComplete: true,
        analysisCurrency: 'USD', fxRate: '32', fxDate: '2026-11-05', validity: '2026-11-20',
        remarks: '請確認收貨時間', terms: '使用者自行輸入之報價條件。', status: 'Quoted', revisionOfId: null,
      },
      weights: { pieces: 10, grossWeight: '350', cbm: '2.52', volumeWeight: '420', chargeableWeight: '420' },
      freight: { amount: '1806.00', currency: 'USD', rate: '4.30', appliedBreak: '+300 KG', minimumApplied: false },
      charges: [
        { name: 'Fuel Surcharge', basis: 'PER_KG', currency: 'USD', included: true, originalRate: '0.50', appliedRate: '0.50', originalAmount: '210.00', amount: '0.00', temporary: false },
        { name: '文件處理費', basis: 'PER_SHIPMENT', currency: 'TWD', included: false, originalRate: '500', appliedRate: '500', originalAmount: '500.00', amount: '500.00', temporary: false },
      ],
      finance: { revenue: '1821.625', knownCost: '987654.32', grossProfit: '-985832.695', margin: '-54118.312', markup: '-99.815', costState: 'COMPLETE', provisional: false, negativeProfit: true, missingFx: false, revenueByCurrency: { USD: '1806.00', TWD: '500.00' }, costByCurrency: { USD: '987654.32' } },
      settings: { volumeDivisor: '6000', weightIncrement: '0.5' }, createdAt: '2026-11-05T01:30:00.000Z',
    },
  };
}

function countryQuoteFixture(shipment: 'AIR' | 'LCL' | 'FCL'): QuoteRecord {
  const quote = quoteFixture();
  const snapshot = quote.snapshot;
  Object.assign(snapshot.input, {
    transportMode: shipment === 'AIR' ? 'AIR' : 'SEA', routeScope: 'COUNTRY',
    originCountry: 'TW', destinationCountry: 'US', origin: '高雄', destination: '紐約',
    airline: shipment === 'AIR' ? 'BR' : 'TEST SHIPPING',
    seaShipmentType: shipment === 'AIR' ? '' : shipment,
  });
  snapshot.charges = [
    { name: '目的地派送費', basis: 'PER_SHIPMENT', currency: 'USD', included: true, originalRate: '999', appliedRate: '999', originalAmount: '999.00', amount: '0.00', temporary: false },
    { name: '目的地文件費', basis: shipment === 'FCL' ? 'PER_CONTAINER' : shipment === 'LCL' ? 'PER_CBM' : 'PER_KG', currency: 'TWD', included: false, originalRate: '100', appliedRate: '100', originalAmount: '100.00', amount: '100.00', temporary: false },
  ];
  if (shipment === 'AIR') {
    Object.assign(snapshot.freight, { basis: 'PER_KG', quantity: '420', unit: 'KG' });
  } else {
    snapshot.weights.volumeWeight = null;
    snapshot.weights.chargeableWeight = null;
    if (shipment === 'LCL') {
      snapshot.freight = { basis: 'PER_CBM', quantity: '2.52', unit: 'CBM', amount: '201.60', currency: 'USD', rate: '80.00', appliedBreak: '+1 CBM', minimumApplied: false };
    } else {
      snapshot.input.containerType = '40HQ';
      snapshot.input.containerCount = 2;
      snapshot.input.cargo = [];
      snapshot.weights = { pieces: 0, grossWeight: '0', cbm: '0', volumeWeight: null, chargeableWeight: null, cargoProvided: false };
      snapshot.freight = { basis: 'PER_CONTAINER', quantity: '2', unit: 'CONTAINER', amount: '2500.00', currency: 'USD', rate: '1250.00', appliedBreak: '+1 CONTAINER', minimumApplied: false };
    }
  }
  return quote;
}
const extractionAvailable = spawnSync('pdftotext', ['-v'], { timeout: 5000 }).status === 0;
function extract(buffer: Buffer) {
  const directory = mkdtempSync(path.join(tmpdir(), 'tec-pdf-'));
  try {
    const filename = path.join(directory, 'quotation.pdf');
    writeFileSync(filename, buffer);
    return spawnSync('pdftotext', ['-layout', filename, '-'], { encoding: 'utf8', timeout: 10000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function quoteText(quote: QuoteRecord) {
  const extracted = extract(await generateQuotePdf(quote));
  expect(extracted.status, extracted.stderr).toBe(0);
  return extracted.stdout.replace(/\s/g, '');
}

function expectNoInternalData(content: string) {
  for (const forbidden of ['INTERNAL_COST_SECRET', '987654.32', '987,654.32', '985832.695', '54118.312', 'GrossProfit', 'InternalCost', 'Markup', 'CUSTOMER_INTERNAL_SECRET']) expect(content).not.toContain(forbidden);
}

describe('正式客戶 PDF 與資訊隔離', () => {
  it('customer projection is allowlisted and keeps selling totals separate by currency', () => {
    const data = customerPdfData(quoteFixture().snapshot);
    const serialized = JSON.stringify(data);
    for (const forbidden of ['costs', 'finance', 'grossProfit', 'markup', 'INTERNAL_COST_SECRET', '987654.32', 'CUSTOMER_INTERNAL_SECRET', 'originalRate', 'originalAmount']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(data.totals).toEqual([{ currency: 'USD', amount: '1806.00' }, { currency: 'TWD', amount: '500.00' }]);
    expect(data.charges[0]).toMatchObject({ included: true, amount: '0.00' });
    expect(data.terms).toBe('使用者自行輸入之報價條件。');
  });

  it('allowlists multimodal billing and routing fields without copying the contract or raw snapshot', () => {
    const quote = countryQuoteFixture('FCL');
    const data = customerPdfData(quote.snapshot);
    expect(data.route).toMatchObject({ transportMode: 'SEA', routeScope: 'COUNTRY', originCountry: 'TW', destinationCountry: 'US', seaShipmentType: 'FCL', containerType: '40HQ', containerCount: 2 });
    expect(data.freight).toMatchObject({ basis: 'PER_CONTAINER', quantity: '2', unit: 'CONTAINER' });
    expect(data.weights.cargoProvided).toBe(false);
    expect(data.totals).toEqual([{ currency: 'USD', amount: '2500.00' }, { currency: 'TWD', amount: '100.00' }]);
    const serialized = JSON.stringify(data);
    for (const forbidden of ['contract', 'costs', 'finance', 'settings', 'originalRate', 'originalAmount', 'INTERNAL_COST_SECRET', 'CUSTOMER_INTERNAL_SECRET']) expect(serialized).not.toContain(forbidden);
  });

  it('projects only the selected selling rate and weight-tier metadata for trucking', () => {
    const quote = quoteFixture();
    quote.snapshot.charges = [{ name: 'Trucking Charge', basis: 'PER_KG_TIERED', currency: 'USD', included: false,
      originalRate: '123456.789', appliedRate: '0', originalAmount: '555555.55', amount: '50.00', temporary: false,
      appliedBreak: 'Normal', quantity: '44.5', minimumApplied: true }];
    const data = customerPdfData(quote.snapshot);
    expect(data.charges).toEqual([{ name: 'Trucking Charge', basis: 'PER_KG_TIERED', currency: 'USD', included: false,
      amount: '50.00', rate: '0', appliedBreak: 'Normal', quantity: '44.5', minimumApplied: true }]);
    expect(data.totals).toEqual([{ currency: 'USD', amount: '1856.00' }]);
    for (const forbidden of ['originalRate', 'originalAmount', '123456.789', '555555.55', 'contract', 'finance', 'INTERNAL_COST_SECRET']) expect(JSON.stringify(data)).not.toContain(forbidden);
  });

  it('renders an actual downloadable PDF without relying on platform fonts or an external API', async () => {
    const buffer = await generateQuotePdf(quoteFixture());
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(3000);
    expect(buffer.toString('latin1')).toContain('%%EOF');
  });

  it('keeps a short quotation on one page including its footer', async () => {
    const quote = quoteFixture();
    quote.snapshot.charges = [];
    quote.snapshot.input.terms = '';
    quote.snapshot.input.remarks = '';
    const buffer = await generateQuotePdf(quote);
    expect(buffer.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  });

  it.skipIf(!extractionAvailable)('extracts Traditional Chinese and selling prices from actual PDF while excluding all internal costs and profit', async () => {
    const quote = quoteFixture();
    const persistedSnapshot = JSON.stringify(quote.snapshot);
    const buffer = await generateQuotePdf(quote);
    expect(JSON.stringify(quote.snapshot)).toBe(persistedSnapshot);
    const extracted = extract(buffer);
    expect(extracted.status, extracted.stderr).toBe(0);
    const content = extracted.stdout.replace(/\s/g, '');
    for (const expected of ['測試空運公司', '航空貨運報價單AirFreightQuotation', '測試客戶甲', 'AFQ-20261105-0001', 'TPE', 'LAX', '+300KG', '420', '1,806.00', '500.00', '文件處理費', '使用者自行輸入之報價條件', '已包含']) expect(content).toContain(expected);
    expectNoInternalData(content);
  });

  it.skipIf(!extractionAvailable)('prints a country-wide AIR price per KG with optional city details and explicit included fees', async () => {
    const content = await quoteText(countryQuoteFixture('AIR'));
    for (const expected of ['航空貨運報價單AirFreightQuotation', '台灣', '美國（全國適用）', '起運地點：高雄', '目的地點：紐約', '420KG', 'USD4.30/KG', '計費重量ChargeableWeight', '目的地派送費', '已包含', '目的地文件費', '每公斤PerKG']) expect(content).toContain(expected);
    expectNoInternalData(content);
  });

  it.skipIf(!extractionAvailable)('prints trucking tier quantities, selected prices and minimums from the saved snapshot', async () => {
    const quote = countryQuoteFixture('AIR');
    quote.snapshot.charges = [
      { name: 'Trucking Charge', basis: 'PER_KG_TIERED', currency: 'USD', included: false, originalRate: '123456.789', appliedRate: '1.25',
        originalAmount: '555555.55', amount: '60.00', temporary: false, appliedBreak: '+45 KG', quantity: '45', minimumApplied: true },
      { name: 'Trucking Normal', basis: 'PER_KG_TIERED', currency: 'TWD', included: false, originalRate: '3.5', appliedRate: '3.5',
        originalAmount: '155.75', amount: '155.75', temporary: true, appliedBreak: 'Normal', quantity: '44.5', minimumApplied: false },
      { name: 'Included Trucking', basis: 'PER_KG_TIERED', currency: 'USD', included: true, originalRate: '', appliedRate: '',
        originalAmount: '0.00', amount: '0.00', temporary: false },
    ];
    const original = JSON.stringify(quote.snapshot);
    const content = await quoteText(quote);
    for (const expected of ['TruckingCharge', '+45KG', '45KG', 'USD1.25/KG', '60.00', '已套用最低收費', 'TruckingNormal', 'Normal', '44.5KG', 'TWD3.5/KG', '155.75', 'IncludedTrucking', '已包含']) expect(content).toContain(expected);
    for (const forbidden of ['123456.789', '555555.55', 'undefined', 'null']) expect(content).not.toContain(forbidden);
    expect(JSON.stringify(quote.snapshot)).toBe(original);
    expectNoInternalData(content);
  });

  it.skipIf(!extractionAvailable)('prints SEA LCL CBM pricing and actual cargo without AIR weight calculations', async () => {
    const content = await quoteText(countryQuoteFixture('LCL'));
    for (const expected of ['海運報價單SeaFreightQuotation', '海運散貨LCL', '台灣', '美國（全國適用）', '船公司／承運人：TESTSHIPPING', '350KG', '2.52CBM', 'USD80.00/CBM', '201.60', '每立方米PerCBM', '目的地派送費', '已包含']) expect(content).toContain(expected);
    for (const forbidden of ['AirFreight', '航空公司', '材積重量', 'ChargeableWeight', '+300KG', 'null', '6000']) expect(content).not.toContain(forbidden);
    expectNoInternalData(content);
  });

  it.skipIf(!extractionAvailable)('prints SEA FCL containers and unit rates without treating missing cargo as zero measurements', async () => {
    const content = await quoteText(countryQuoteFixture('FCL'));
    for (const expected of ['海運報價單SeaFreightQuotation', '海運整櫃FCL', '台灣', '美國（全國適用）', '櫃型：40HQ', '櫃數：2', '2CONTAINER', 'USD1250.00/CONTAINER', '2,500.00', '每櫃PerContainer', '尚未提供貨物尺寸及重量明細', '目的地派送費', '已包含']) expect(content).toContain(expected);
    for (const forbidden of ['AirFreight', '材積重量', 'ChargeableWeight', '總實重', '0CBM', '0KG', 'null', '+300KG']) expect(content).not.toContain(forbidden);
    expectNoInternalData(content);
  });

  it.skipIf(!extractionAvailable)('uses the persisted quotation snapshot and retains user terms across multiple PDF pages', async () => {
    const quote = quoteFixture();
    quote.snapshot.input.terms = Array.from({ length: 90 }, (_, i) => `第 ${i + 1} 行：使用者維護的報價條件。`).join('\n');
    const buffer = await generateQuotePdf(quote);
    const result = extract(buffer);
    expect(result.status).toBe(0);
    expect(result.stdout.replace(/\s/g, '')).toContain('第90行：使用者維護的報價條件。');
    expect(result.stdout.match(/\f/g)!.length).toBeGreaterThan(1);
  });
});
