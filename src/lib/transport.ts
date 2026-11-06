import Decimal from 'decimal.js';
import { countryName } from './countries';
import type { RoutingTerms, FreightBasis, ChargeBasis } from './types';
export const modeName = (mode: RoutingTerms['transportMode']) => mode === 'SEA' ? '海運 Sea' : '空運 Air';
export const freightBasisLabels: Record<FreightBasis,string> = { PER_KG: '每公斤 KG', PER_CBM: '每立方米 CBM', PER_CONTAINER: '每櫃 Container' };
export const chargeBasisLabels: Record<ChargeBasis,string> = { PER_KG: '每公斤 Per KG', PER_KG_TIERED: '重量級距 Per KG', PER_CBM: '每立方米 Per CBM', PER_CONTAINER: '每櫃 Per Container', PER_SHIPMENT: '每票 Per Shipment', PER_PIECE: '每件 Per Piece', MINIMUM: '最低收費（固定）', MANUAL: '手動金額' };
export function routeLabel(route: RoutingTerms & { origin: string; destination: string }): string {
  return route.routeScope === 'COUNTRY' ? `${countryName(route.originCountry)} → ${countryName(route.destinationCountry)}（全國適用）` : `${route.origin} → ${route.destination}`;
}
/** General quantities retain their measured precision. */
export function formatQuantity(value: string | null | undefined): string {
  if (value == null) return '—';
  const [whole, fraction] = value.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
}

/** Display only: never feed rounded volume weight back into freight calculations. */
export function formatVolumeWeight(value: string | null | undefined): string {
  if (value == null) return '—';
  const [whole, fraction] = new Decimal(value).toFixed(2, Decimal.ROUND_HALF_UP).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
