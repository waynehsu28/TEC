import { describe, expect, it } from 'vitest';
import { calculateCharges, calculateWeights } from '../src/lib/engine';
import { chargeSchema, quoteSchema } from '../src/lib/validation';
import type { ChargeInput, Weights } from '../src/lib/types';
import { quoteInput } from './fixtures/quotation';

const settings = { volumeDivisor: '6000', weightIncrement: '0.5' };
const trucking: ChargeInput = {
  id: 'trucking', name: 'Trucking Charge', basis: 'PER_KG_TIERED', rate: '2', currency: 'USD', included: false,
  breaks: [{ weight: '45', rate: '1.5' }, { weight: '100', rate: '1' }, { weight: '300', rate: '0.8' }],
};
function weights(grossWeight: string, mode: 'AIR' | 'SEA' = 'AIR') {
  return calculateWeights([{ pieces: 1, length: '1', width: '1', height: '1', grossWeight, weightMode: 'GROUP_TOTAL' }], settings, mode);
}
const line = (charge = trucking, grossWeight = '45') => calculateCharges([charge], [], [], weights(grossWeight))[0];

describe('Trucking Charge weight tiers', () => {
  it.each([
    ['44.5', '44.5', 'Normal', '2', '89.00'],
    ['45', '45', '+45 KG', '1.5', '67.50'],
    ['44.6', '45', '+45 KG', '1.5', '67.50'],
    ['100', '100', '+100 KG', '1', '100.00'],
    ['420', '420', '+300 KG', '0.8', '336.00'],
  ])('prices gross %s using chargeable %s and one eligible tier', (gross, quantity, appliedBreak, rate, amount) => {
    expect(line(trucking, gross)).toMatchObject({ quantity, appliedBreak, originalRate: rate, appliedRate: rate, amount, minimumApplied: false });
  });

  it('does not use an unachieved higher break to reduce the trucking bill', () => {
    expect(line({ ...trucking, breaks: [{ weight: '45', rate: '1.5' }, { weight: '100', rate: '0.1' }] }, '99.5'))
      .toMatchObject({ appliedBreak: '+45 KG', amount: '149.25' });
  });

  it('applies the fixed per-charge minimum and supports MIN-only fallback below the first tier', () => {
    expect(line({ ...trucking, minimumAmount: '100' }, '44.5')).toMatchObject({ amount: '100.00', appliedRate: '2', minimumApplied: true });
    expect(line({ ...trucking, rate: '', minimumAmount: '25' }, '10')).toMatchObject({ amount: '25.00', appliedRate: '', appliedBreak: 'MIN', minimumApplied: true });
    expect(() => line({ ...trucking, rate: '' }, '10')).toThrow();
  });

  it('keeps explicit free Normal and tier rates distinct from missing prices', () => {
    expect(line({ ...trucking, rate: '0' }, '44.5')).toMatchObject({ appliedRate: '0', amount: '0.00' });
    expect(line({ ...trucking, breaks: [{ weight: '45', rate: '0' }] }, '45')).toMatchObject({ appliedRate: '0', amount: '0.00', appliedBreak: '+45 KG' });
  });

  it('overrides the selected tier unit rate while retaining its original amount and tier', () => {
    const original = structuredClone(trucking);
    expect(calculateCharges([trucking], [{ chargeId: 'trucking', rate: '1.2' }], [], weights('45'))[0])
      .toMatchObject({ originalRate: '1.5', appliedRate: '1.2', originalAmount: '67.50', amount: '54.00', appliedBreak: '+45 KG' });
    expect(trucking).toEqual(original);
  });

  it('uses sea gross KG and permits included FCL trucking without unknown cargo being treated as zero', () => {
    const sea = weights('44.6', 'SEA');
    expect(calculateCharges([trucking], [], [], sea, { transportMode: 'SEA', seaShipmentType: 'LCL' })[0])
      .toMatchObject({ quantity: '44.6', appliedBreak: 'Normal', appliedRate: '2', amount: '89.20' });
    const unknown: Weights = { pieces: 0, grossWeight: '0', cbm: '0', volumeWeight: null, chargeableWeight: null, cargoProvided: false };
    expect(() => calculateCharges([trucking], [], [], unknown, { transportMode: 'SEA', seaShipmentType: 'FCL', containerCount: 1 })).toThrow();
    expect(calculateCharges([{ ...trucking, included: true }], [], [], unknown, { transportMode: 'SEA', seaShipmentType: 'FCL', containerCount: 1 })[0]).toMatchObject({ included: true, amount: '0.00' });
  });

  it('supports independent temporary tiers and prevents a second bill for included trucking', () => {
    expect(calculateCharges([], [], [{ ...trucking, id: undefined }], weights('45'))[0])
      .toMatchObject({ temporary: true, appliedBreak: '+45 KG', amount: '67.50' });
    expect(() => calculateCharges([{ ...trucking, included: true }], [], [{ ...trucking, id: undefined, name: ' trucking charge ' }], weights('45'))).toThrow('不可重複計收');
  });
});

describe('tiered charge API validation', () => {
  it('accepts a tier-only or minimum-only rule, including explicit zero prices', () => {
    for (const candidate of [trucking, { ...trucking, rate: '' }, { ...trucking, rate: '', breaks: [], minimumAmount: '0' }, { ...trucking, breaks: [{ weight: '45', rate: '0' }] }]) {
      expect(chargeSchema.safeParse(candidate).success).toBe(true);
    }
  });

  it('rejects missing prices, nonpositive or duplicate decimal thresholds, invalid rates and tiers on a flat basis', () => {
    for (const candidate of [
      { ...trucking, rate: '', breaks: [] },
      { ...trucking, breaks: [{ weight: '0', rate: '1' }] },
      { ...trucking, breaks: [{ weight: '-45', rate: '1' }] },
      { ...trucking, breaks: [{ weight: '45', rate: '1' }, { weight: '45.0', rate: '2' }] },
      { ...trucking, breaks: [{ weight: '45', rate: '-1' }] },
      { ...trucking, breaks: [{ weight: '45', rate: '' }] },
      { ...trucking, breaks: [{ weight: '45', rate: '1e3' }] },
      { ...trucking, basis: 'PER_KG' },
    ]) expect(chargeSchema.safeParse(candidate).success).toBe(false);
  });

  it('requires optional FCL cargo when a temporary tiered trucking charge is separately payable', () => {
    const fcl = quoteInput({ transportMode: 'SEA', seaShipmentType: 'FCL', containerType: '40HQ', containerCount: 1, cargo: [], temporaryCharges: [trucking] });
    expect(quoteSchema.safeParse(fcl).success).toBe(false);
    expect(quoteSchema.safeParse({ ...fcl, temporaryCharges: [{ ...trucking, included: true }] }).success).toBe(true);
  });
});
