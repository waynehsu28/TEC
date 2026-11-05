import Decimal from 'decimal.js';
import type { CargoItem, Settings, Weights, ContractCandidate, MatchInput, FreightResult, ChargeInput, QuoteInput, CalculatedCharge, CostInput, Currency, FinanceResult, TransportMode, SeaShipmentType, FreightBasis } from './types';

const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const zero = () => new D(0);
const amount = (value: Decimal.Value) => new D(value).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
function nonnegative(value: string, name: string): Decimal {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`${name} 必須是非負十進位數值`);
  const result = new D(value);
  if (!result.isFinite() || result.isNegative()) throw new Error(`${name} 必須是有限非負數值`);
  return result;
}
function positive(value: string, name: string): Decimal {
  const result = nonnegative(value, name);
  if (!result.gt(0)) throw new Error(`${name} 必須大於零`);
  return result;
}

/** Air weight rounds once after aggregation. Sea quotes retain exact CBM and never use air volume weight. */
export function calculateWeights(cargo: CargoItem[], settings: Pick<Settings, 'volumeDivisor' | 'weightIncrement'>, transportMode: TransportMode = 'AIR'): Weights {
  if (transportMode !== 'AIR' && transportMode !== 'SEA') throw new Error('未知運輸模式');
  if (!cargo.length && transportMode === 'AIR') throw new Error('至少需要一組貨物');
  let gross = zero(), cubicCm = zero(), pieces = 0;
  for (const item of cargo) {
    if (!Number.isSafeInteger(item.pieces) || item.pieces <= 0) throw new Error('件數須為正整數');
    const volume = positive(item.length, '長度').mul(positive(item.width, '寬度')).mul(positive(item.height, '高度')).mul(item.pieces);
    const weight = nonnegative(item.grossWeight, '實際重量');
    if (!['PER_PIECE', 'GROUP_TOTAL'].includes(item.weightMode)) throw new Error('未知實際重量模式');
    gross = gross.plus(item.weightMode === 'PER_PIECE' ? weight.mul(item.pieces) : weight);
    cubicCm = cubicCm.plus(volume);
    pieces += item.pieces;
    if (!Number.isSafeInteger(pieces)) throw new Error('總件數超出可用範圍');
  }
  const totals = { pieces, grossWeight: gross.toFixed(), cbm: cubicCm.div(1_000_000).toFixed() };
  if (transportMode === 'SEA') return { ...totals, volumeWeight: null, chargeableWeight: null, cargoProvided: cargo.length > 0 };
  const divisor = positive(settings.volumeDivisor, '材積除數');
  const increment = positive(settings.weightIncrement, '計費重量進位單位');
  const volumeWeight = cubicCm.div(divisor);
  const chargeable = D.max(gross, volumeWeight).div(increment).ceil().mul(increment);
  return { ...totals, volumeWeight: volumeWeight.toFixed(), chargeableWeight: chargeable.toFixed() };
}
const norm = (value: string) => value.trim().toUpperCase();
function routeMatches(contract: ContractCandidate, input: MatchInput): boolean {
  const mode = contract.transportMode ?? 'AIR';
  const scope = contract.routeScope ?? 'AIRPORT';
  if (mode !== (input.transportMode ?? 'AIR') || scope !== (input.routeScope ?? 'AIRPORT')) return false;
  if (mode === 'SEA') {
    if (scope !== 'COUNTRY' || !contract.seaShipmentType || contract.seaShipmentType !== input.seaShipmentType) return false;
    if (contract.seaShipmentType === 'FCL' && (!contract.containerType || contract.containerType !== input.containerType)) return false;
  }
  if (scope === 'COUNTRY') {
    return !!contract.originCountry && !!contract.destinationCountry
      && norm(contract.originCountry) === norm(input.originCountry ?? '')
      && norm(contract.destinationCountry) === norm(input.destinationCountry ?? '');
  }
  return norm(contract.origin) === norm(input.origin) && norm(contract.destination) === norm(input.destination);
}
export function matchContracts(candidates: ContractCandidate[], input: MatchInput): ContractCandidate[] {
  const matches = candidates.filter((c) => c.status === 'ACTIVE' && c.customerId === input.customerId && routeMatches(c, input)
    && c.effectiveDate <= input.shipmentDate && c.expiryDate >= input.shipmentDate
    && (!c.airline || norm(c.airline) === norm(input.airline))
    && (!c.serviceType || norm(c.serviceType) === norm(input.serviceType))
    && (!c.commodity || norm(c.commodity) === norm(input.commodity)));
  const airlineSpecific = matches.filter((c) => c.airline.trim() !== '');
  return airlineSpecific.length ? airlineSpecific : matches;
}
function containerQuantity(containerCount: number | undefined): Decimal {
  if (!Number.isSafeInteger(containerCount) || containerCount! <= 0) throw new Error('每櫃計價須提供正整數櫃數');
  return new D(containerCount!);
}
function freightBasis(contract: ContractCandidate): FreightBasis {
  const basis = contract.pricingBasis ?? 'PER_KG';
  if ((contract.transportMode ?? 'AIR') === 'AIR') {
    if (basis !== 'PER_KG' || contract.seaShipmentType || contract.containerType) throw new Error('空運須按 KG 計價且不可設定海運櫃型');
  } else if (contract.seaShipmentType === 'LCL') {
    if (basis !== 'PER_CBM' || contract.containerType) throw new Error('海運散貨須按 CBM 計價且不可設定櫃型');
  } else if (contract.seaShipmentType === 'FCL') {
    if (basis !== 'PER_CONTAINER' || !contract.containerType) throw new Error('海運整櫃須按櫃計價並設定櫃型');
  } else throw new Error('海運須指定散貨 LCL 或整櫃 FCL');
  return basis;
}
/** A single eligible quantity break applies to the entire shipment, followed by a fixed minimum floor. */
export function calculateFreight(contract: ContractCandidate, weightOrWeights: string | Weights, context: { containerCount?: number } = {}): FreightResult {
  const basis = freightBasis(contract);
  const unit: NonNullable<FreightResult['unit']> = basis === 'PER_KG' ? 'KG' : basis === 'PER_CBM' ? 'CBM' : 'CONTAINER';
  if (typeof weightOrWeights === 'string' && basis !== 'PER_KG') throw new Error('海運計價須提供貨物彙總與櫃數');
  const sourceQuantity = typeof weightOrWeights === 'string' ? weightOrWeights
    : basis === 'PER_KG' ? weightOrWeights.chargeableWeight
    : basis === 'PER_CBM' ? weightOrWeights.cbm : null;
  let quantity: Decimal;
  if (basis === 'PER_CONTAINER') quantity = containerQuantity(context.containerCount);
  else {
    if (sourceQuantity === null) throw new Error('缺少計費重量');
    quantity = positive(sourceQuantity, basis === 'PER_CBM' ? '貨物 CBM' : '計費重量');
  }
  if (typeof weightOrWeights !== 'string' && basis !== 'PER_CONTAINER' && weightOrWeights.cargoProvided === false) throw new Error('此運費計價需要貨物數量');
  const metadata = typeof weightOrWeights === 'string' ? {} : { basis, quantity: quantity.toFixed(), unit };
  const eligible = contract.breaks.filter((b) => nonnegative(b.weight, '數量級距').lte(quantity)).sort((a, b) => new D(b.weight).cmp(a.weight));
  let rate = contract.normalRate, appliedBreak = 'Normal';
  if (eligible.length) { rate = eligible[0].rate; appliedBreak = `+${new D(eligible[0].weight).toString()} ${unit}`; }
  const minimum = contract.minimumCharge === '' ? null : nonnegative(contract.minimumCharge, '最低收費');
  if (rate === '') {
    if (minimum === null) throw new Error('此計費數量沒有適用級距、Normal 或最低收費');
    return { ...metadata, amount: amount(minimum), currency: contract.currency, rate: '', appliedBreak: 'MIN', minimumApplied: true };
  }
  const raw = quantity.mul(nonnegative(rate, `每 ${unit} 運價`));
  const minimumApplied = minimum !== null && raw.lt(minimum);
  return { ...metadata, amount: amount(minimumApplied ? minimum! : raw), currency: contract.currency, rate: new D(rate).toString(), appliedBreak, minimumApplied };
}
export interface ChargeContext { transportMode?: TransportMode; seaShipmentType?: SeaShipmentType | ''; containerCount?: number }
function chargeAmount(charge: ChargeInput, weights: Weights, rate: string, manualAmount: string | undefined, context: ChargeContext): string {
  const numericRate = nonnegative(rate, '附加費運價');
  // A container charge is only meaningful on a sea FCL shipment, even if marked included.
  let containers: Decimal | undefined;
  if (charge.basis === 'PER_CONTAINER') {
    if (context.transportMode !== 'SEA' || (context.seaShipmentType !== undefined && context.seaShipmentType !== 'FCL')) throw new Error('每櫃附加費僅適用海運整櫃 FCL');
    containers = containerQuantity(context.containerCount);
  }
  // Included charges describe the contract coverage; unknown optional FCL cargo must not prevent them.
  if (charge.included) return '0.00';
  if (weights.cargoProvided === false && ['PER_KG', 'PER_CBM', 'PER_PIECE'].includes(charge.basis)) throw new Error('此附加費需要貨物重量、材積或件數，請先輸入貨物資料');
  let raw: Decimal;
  switch (charge.basis) {
    case 'PER_KG': {
      const weight = (context.transportMode ?? 'AIR') === 'SEA' ? weights.grossWeight : weights.chargeableWeight;
      if (weight === null) throw new Error('缺少附加費計費重量');
      raw = numericRate.mul(nonnegative(weight, (context.transportMode ?? 'AIR') === 'SEA' ? '實際重量' : '計費重量'));
      break;
    }
    case 'PER_CBM': raw = numericRate.mul(nonnegative(weights.cbm, '貨物 CBM')); break;
    case 'PER_CONTAINER': raw = numericRate.mul(containers!); break;
    case 'PER_PIECE': {
      if (!Number.isSafeInteger(weights.pieces) || weights.pieces < 0) throw new Error('件數須為非負整數');
      raw = numericRate.mul(weights.pieces); break;
    }
    case 'MANUAL': raw = nonnegative(manualAmount === undefined || manualAmount === '' ? rate : manualAmount, '手動費用'); break;
    case 'PER_SHIPMENT': case 'MINIMUM': raw = numericRate; break;
    default: throw new Error('未知的費用計價方式');
  }
  if (charge.minimumAmount) raw = D.max(raw, nonnegative(charge.minimumAmount, '附加費最低收費'));
  return amount(raw);
}
export function calculateCharges(contractCharges: ChargeInput[], overrides: QuoteInput['chargeOverrides'], temporaryCharges: ChargeInput[], weights: Weights, context: ChargeContext = {}): CalculatedCharge[] {
  const knownIds = new Set(contractCharges.flatMap((c) => c.id ? [c.id] : []));
  const seen = new Set<string>();
  for (const override of overrides) {
    if (!knownIds.has(override.chargeId)) throw new Error('無法調整不存在的合約費用');
    if (seen.has(override.chargeId)) throw new Error('同一合約費用不得重複調整');
    seen.add(override.chargeId);
  }
  const includedNames = new Set(contractCharges.filter((c) => c.included).map((c) => norm(c.name)));
  if (temporaryCharges.some((c) => !c.included && includedNames.has(norm(c.name)))) throw new Error('臨時費用與已包含的合約費用重複，不可重複計收');
  return [...contractCharges.map((c) => ({ c, temporary: false })), ...temporaryCharges.map((c) => ({ c, temporary: true }))].map(({ c, temporary }) => {
    const override = temporary ? undefined : overrides.find((o) => o.chargeId === c.id);
    const rate = override?.rate ?? c.rate;
    return { name: c.name, basis: c.basis, currency: c.currency, included: c.included, originalRate: c.rate, appliedRate: rate,
      originalAmount: chargeAmount(c, weights, c.rate, c.manualAmount, context), amount: chargeAmount(c, weights, rate, override?.manualAmount ?? c.manualAmount, context), temporary };
  });
}
function subtotals(lines: { amount: string; currency: Currency }[]): Partial<Record<Currency, string>> {
  const sums: Partial<Record<Currency, Decimal>> = {};
  for (const line of lines) sums[line.currency] = (sums[line.currency] ?? zero()).plus(nonnegative(line.amount, '金額').toDecimalPlaces(2, D.ROUND_HALF_UP));
  return Object.fromEntries(Object.entries(sums).map(([currency, value]) => [currency, amount(value!)]));
}
function convertTotals(totals: Partial<Record<Currency, string>>, target: Currency, fx: Decimal | null): string | null {
  let sum = zero();
  for (const [currency, value] of Object.entries(totals)) {
    const number = new D(value!);
    if (currency === target || number.isZero()) sum = sum.plus(number);
    else if (fx === null) return null;
    else sum = sum.plus(currency === 'USD' ? number.mul(fx) : number.div(fx));
  }
  return amount(sum);
}
export function calculateFinance(freight: FreightResult, charges: CalculatedCharge[], costs: CostInput[], costsComplete: boolean, analysisCurrency: Currency, fxRate: string): FinanceResult {
  const fx = fxRate === '' ? null : positive(fxRate, '匯率');
  const revenueByCurrency = subtotals([{ amount: freight.amount, currency: freight.currency }, ...charges.filter((c) => !c.included)]);
  const knownCosts = costs.filter((c): c is CostInput & { amount: string } => c.amount !== null && c.amount !== '');
  const costByCurrency = subtotals(knownCosts);
  const costState = knownCosts.length === 0 ? 'MISSING' : !costsComplete || knownCosts.length !== costs.length ? 'PARTIAL' : 'COMPLETE';
  const revenue = convertTotals(revenueByCurrency, analysisCurrency, fx);
  const knownCost = costState === 'MISSING' ? null : convertTotals(costByCurrency, analysisCurrency, fx);
  const grossProfit = revenue !== null && knownCost !== null ? amount(new D(revenue).minus(knownCost)) : null;
  const margin = costState === 'COMPLETE' && grossProfit !== null && new D(revenue!).gt(0) ? amount(new D(grossProfit).div(revenue!).mul(100)) : null;
  const markup = costState === 'COMPLETE' && grossProfit !== null && new D(knownCost!).gt(0) ? amount(new D(grossProfit).div(knownCost!).mul(100)) : null;
  return { revenue, knownCost, grossProfit, margin, markup, costState,
    provisional: costState !== 'COMPLETE' || costs.some((c) => c.status === 'ESTIMATED'),
    negativeProfit: grossProfit !== null && new D(grossProfit).lt(0),
    missingFx: revenue === null || (costState !== 'MISSING' && knownCost === null), revenueByCurrency, costByCurrency };
}
