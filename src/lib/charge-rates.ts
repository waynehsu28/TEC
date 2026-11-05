import Decimal from 'decimal.js';
import type { ChargeBasis, ChargeInput, RateBreak } from './types';

export const defaultWeightBreaks = (): RateBreak[] => ['45', '100', '300', '500', '1000'].map(weight => ({ weight, rate: '' }));

/** Display the actual Normal range, ignoring unpriced draft rows. */
export function normalWeightRange(breaks: RateBreak[]): string {
  let first: Decimal | null = null;
  for (const tier of breaks) {
    if (!tier.rate.trim() || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(tier.weight.trim())) continue;
    const weight = new Decimal(tier.weight.trim());
    if (weight.gt(0) && (first === null || weight.lt(first))) first = weight;
  }
  return first ? `未滿 ${first.toFixed()} KG` : '全部計費重量';
}

export function chargeBasisPatch(charge: ChargeInput, basis: ChargeBasis): Partial<ChargeInput> {
  if (basis === charge.basis) return {};
  const sameUnit = [charge.basis, basis].every(value => value === 'PER_KG' || value === 'PER_KG_TIERED');
  return {
    basis, breaks: basis === 'PER_KG_TIERED' ? defaultWeightBreaks() : [],
    ...(!sameUnit && (basis === 'PER_KG_TIERED' || charge.basis === 'PER_KG_TIERED') ? { rate: '', manualAmount: '' } : {}),
  };
}

export function pricedCharge(charge: ChargeInput): ChargeInput {
  return { ...charge, ...(charge.basis === 'PER_KG_TIERED' ? { breaks: (charge.breaks ?? []).filter(tier => tier.rate.trim() !== '') } : {}) };
}
