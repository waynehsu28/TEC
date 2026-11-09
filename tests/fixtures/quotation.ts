import type { Customer, Settings, QuoteInput, QuoteSnapshot, QuoteRecord, QuotePage, QuoteOverview } from '../../src/lib/types';
import { quoteListItemFromRecord } from '../../src/lib/quote-list';
export const uiCustomer: Customer = { id: 'test-customer', name: '測試客戶', code: 'TEST', contact: '', email: '', phone: '', defaultCurrency: 'USD', remarks: '', status: 'ACTIVE' };
export const uiSettings: Settings = { companyName: '測試公司', companyLogo: '', volumeDivisor: '6000', weightIncrement: '0.5', defaultCurrency: 'USD', exchangeRate: '', exchangeRateDate: '', terms: '' };
export function quoteInput(patch: Partial<QuoteInput> = {}): QuoteInput {
  return { customerId: uiCustomer.id, transportMode: 'AIR', routeScope: 'COUNTRY', originCountry: 'TW', destinationCountry: 'US', seaShipmentType: '', containerType: '', containerCount: 0,
    origin: '台北', destination: 'New York', airline: '', serviceType: '', commodity: '', shipmentDate: '2026-11-05',
    cargo: [{ pieces: 10, length: '70', width: '60', height: '60', grossWeight: '35', weightMode: 'PER_PIECE' }],
    contractVersionId: null, manualFreight: { amount: '1806', currency: 'USD' }, chargeOverrides: [], temporaryCharges: [],
    costs: [{ name: 'Carrier Cost', amount: '1344', currency: 'USD', status: 'ACTUAL' }], costsComplete: true, analysisCurrency: 'USD', fxRate: '', fxDate: '', validity: '2026-11-30', remarks: '', terms: '', status: 'Draft', revisionOfId: null, ...patch };
}
export function quoteSnapshot(input = quoteInput()): QuoteSnapshot {
  return { input, customer: uiCustomer, company: { name: uiSettings.companyName, logo: '' }, contract: null,
    weights: { pieces: 10, grossWeight: '350', cbm: '2.52', volumeWeight: '420', chargeableWeight: '420' },
    freight: { amount: '1806.00', currency: 'USD', rate: '', appliedBreak: 'MANUAL', minimumApplied: false }, charges: [],
    finance: { revenue: '1806.00', knownCost: '1344.00', grossProfit: '462.00', margin: '25.58', markup: '34.38', costState: 'COMPLETE', provisional: false, negativeProfit: false, missingFx: false, revenueByCurrency: { USD: '1806.00' }, costByCurrency: { USD: '1344.00' } },
    settings: { volumeDivisor: '6000', weightIncrement: '0.5' }, createdAt: '2026-11-05T00:00:00.000Z' };
}
export function quoteRecord(input = quoteInput()): QuoteRecord {
  return { id: 'test-quote', number: 'AFQ-20261105-0001', revision: 1, rootId: null, customerId: input.customerId, status: input.status, createdAt: '2026-11-05T00:00:00.000Z', snapshot: quoteSnapshot(input) };
}
export function quotePage(records: QuoteRecord[] = [], page = 1, pageSize = 20): QuotePage {
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const current = Math.min(page, totalPages);
  return { items: records.slice((current - 1) * pageSize, current * pageSize).map(quoteListItemFromRecord), page: current, pageSize, total: records.length, totalPages };
}
export function quoteOverview(records: QuoteRecord[] = []): QuoteOverview {
  return { total: records.length, quoted: records.filter(quote => quote.status === 'Quoted').length,
    accepted: records.filter(quote => quote.status === 'Accepted').length, recent: records.slice(0, 6).map(quoteListItemFromRecord) };
}
