import { countryName } from './countries';
import { routeLabel } from './transport';
import type { QuoteListItem, QuoteRecord } from './types';

export function quoteListItemFromRecord(quote: QuoteRecord): QuoteListItem {
  const { input, customer, weights, freight, finance } = quote.snapshot;
  const manual = freight.appliedBreak === 'MANUAL';
  return {
    id: quote.id, number: quote.number, revision: quote.revision, rootId: quote.rootId,
    customerId: quote.customerId, status: quote.status, createdAt: quote.createdAt, validity: input.validity,
    customerName: customer.name, customerCode: customer.code,
    transportMode: input.transportMode ?? 'AIR', routeScope: input.routeScope ?? 'AIRPORT',
    originCountry: input.originCountry ?? '', destinationCountry: input.destinationCountry ?? '',
    seaShipmentType: input.seaShipmentType ?? '', containerType: input.containerType ?? '',
    origin: input.origin, destination: input.destination,
    analysisCurrency: input.analysisCurrency, revenue: finance.revenue, grossProfit: finance.grossProfit,
    provisional: finance.provisional, quantity: freight.quantity ?? (manual ? null : weights.chargeableWeight),
    unit: freight.unit ?? (!manual && weights.chargeableWeight !== null ? 'KG' : null),
    appliedBreak: freight.appliedBreak, chargeableWeight: weights.chargeableWeight,
  };
}

export function normalizeQuoteSearch(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/臺/g, '台'); }

export function quoteSearchText(item: QuoteListItem): string {
  return normalizeQuoteSearch([item.number, item.customerName, item.customerCode, item.origin, item.destination,
    item.originCountry, item.destinationCountry, countryName(item.originCountry), countryName(item.destinationCountry), routeLabel(item)].join(' '));
}
