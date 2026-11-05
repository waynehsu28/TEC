import type { QuoteInput } from './types';

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const prefix = 'tec:quote-draft:v1:';
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max;
const oneOf = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value);
const currency = (value: unknown) => oneOf(value, ['USD', 'TWD']);
const money = (value: unknown) => text(value, 64); // A draft may be incomplete; final validation remains server-side.
const list = (value: unknown, max: number, valid: (item: unknown) => boolean) => Array.isArray(value) && value.length <= max && value.every(valid);
function charge(value: unknown): boolean {
  return record(value) && text(value.name, 120) && oneOf(value.basis, ['PER_KG', 'PER_CBM', 'PER_CONTAINER', 'PER_SHIPMENT', 'PER_PIECE', 'MINIMUM', 'MANUAL'])
    && money(value.rate) && currency(value.currency) && typeof value.included === 'boolean'
    && (value.id === undefined || text(value.id, 100)) && (value.minimumAmount === undefined || money(value.minimumAmount)) && (value.manualAmount === undefined || money(value.manualAmount));
}
/** Check shape, not business validity: partially entered numbers/dates must survive a reload. */
export function isQuoteDraftInput(value: unknown): value is QuoteInput {
  if (!record(value)) return false;
  for (const field of ['customerId', 'origin', 'destination', 'airline', 'serviceType', 'commodity', 'shipmentDate', 'fxRate', 'fxDate', 'validity', 'remarks']) if (!text(value[field])) return false;
  if (!text(value.terms, 10000) || !currency(value.analysisCurrency) || typeof value.costsComplete !== 'boolean'
    || !oneOf(value.status, ['Draft', 'Quoted', 'Accepted', 'Rejected', 'Expired'])
    || !(value.revisionOfId === null || text(value.revisionOfId, 100)) || !(value.contractVersionId === null || text(value.contractVersionId, 100))) return false;
  if (value.transportMode !== undefined && !oneOf(value.transportMode, ['AIR', 'SEA'])) return false;
  if (value.routeScope !== undefined && !oneOf(value.routeScope, ['AIRPORT', 'COUNTRY'])) return false;
  if (value.seaShipmentType !== undefined && !oneOf(value.seaShipmentType, ['', 'LCL', 'FCL'])) return false;
  if (value.containerType !== undefined && !oneOf(value.containerType, ['', '20GP', '40GP', '40HQ'])) return false;
  for (const field of ['originCountry', 'destinationCountry']) if (value[field] !== undefined && !text(value[field], 2)) return false;
  if (value.containerCount !== undefined && (typeof value.containerCount !== 'number' || !Number.isFinite(value.containerCount) || Math.abs(value.containerCount) > 1_000_000)) return false;
  if (!list(value.cargo, 200, item => record(item) && typeof item.pieces === 'number' && Number.isFinite(item.pieces) && Math.abs(item.pieces) <= 1_000_000
    && money(item.length) && money(item.width) && money(item.height) && money(item.grossWeight) && oneOf(item.weightMode, ['PER_PIECE', 'GROUP_TOTAL']))) return false;
  if (!list(value.chargeOverrides, 100, item => record(item) && text(item.chargeId, 100) && money(item.rate) && (item.manualAmount === undefined || money(item.manualAmount)))) return false;
  if (!list(value.temporaryCharges, 100, charge)) return false;
  if (!list(value.costs, 100, item => record(item) && text(item.name, 120) && (item.amount === null || money(item.amount)) && currency(item.currency) && oneOf(item.status, ['ESTIMATED', 'ACTUAL']))) return false;
  return value.manualFreight === null || record(value.manualFreight) && money(value.manualFreight.amount) && currency(value.manualFreight.currency);
}
export function quoteDraftKey(revisionId: string | null): string { return prefix + (revisionId === null ? 'new' : `revision:${encodeURIComponent(revisionId)}`); }
export function quoteDraftStorage(): DraftStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
export function readQuoteDraft(storage: DraftStorage | null, revisionId: string | null): QuoteInput | null {
  try {
    const raw = storage?.getItem(quoteDraftKey(revisionId));
    if (!raw || raw.length > 1_000_000) return null;
    const envelope: unknown = JSON.parse(raw);
    if (!record(envelope) || envelope.version !== 1 || !isQuoteDraftInput(envelope.input) || envelope.input.revisionOfId !== revisionId) return null;
    return envelope.input;
  } catch { return null; }
}
export function writeQuoteDraft(storage: DraftStorage | null, input: QuoteInput): boolean {
  try {
    if (!storage) return false;
    storage.setItem(quoteDraftKey(input.revisionOfId), JSON.stringify({ version: 1, input }));
    return true;
  } catch { return false; }
}
/** A late save must never remove a newer draft entered after navigation. */
export function clearSavedQuoteDraft(storage: DraftStorage | null, submitted: QuoteInput): void {
  try {
    const current = readQuoteDraft(storage, submitted.revisionOfId);
    if (current !== null && JSON.stringify(current) === JSON.stringify(submitted)) storage?.removeItem(quoteDraftKey(submitted.revisionOfId));
  } catch { /* Storage availability must not turn a successful database save into an error. */ }
}
