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
const extractionAvailable = spawnSync('pdftotext', ['-v'], { timeout: 5000 }).status === 0;
function extract(buffer: Buffer) {
  const directory = mkdtempSync(path.join(tmpdir(), 'tec-pdf-'));
  try {
    const filename = path.join(directory, 'quotation.pdf');
    writeFileSync(filename, buffer);
    return spawnSync('pdftotext', ['-layout', filename, '-'], { encoding: 'utf8', timeout: 10000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
    const buffer = await generateQuotePdf(quote);
    const extracted = extract(buffer);
    expect(extracted.status, extracted.stderr).toBe(0);
    const content = extracted.stdout.replace(/\s/g, '');
    for (const expected of ['測試空運公司', '測試客戶甲', 'AFQ-20261105-0001', 'TPE', 'LAX', '420', '1,806.00', '500.00', '文件處理費', '使用者自行輸入之報價條件', '已包含']) expect(content).toContain(expected);
    for (const forbidden of ['INTERNAL_COST_SECRET', '987654.32', '987,654.32', '985832.695', '54118.312', 'GrossProfit', 'InternalCost', 'Markup', 'CUSTOMER_INTERNAL_SECRET']) expect(content).not.toContain(forbidden);
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
