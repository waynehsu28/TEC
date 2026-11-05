import { describe, expect, it } from 'vitest';
import { calculateCharges, calculateFreight, calculateWeights, matchContracts } from '../src/lib/engine';
import { contractSchema, matchSchema, quoteSchema } from '../src/lib/validation';
import type { CargoItem, ChargeInput, ContractCandidate, MatchInput, QuoteInput } from '../src/lib/types';

const settings = { volumeDivisor: '6000', weightIncrement: '0.5' };
const cargo: CargoItem[] = [{ pieces: 10, length: '70', width: '60', height: '60', grossWeight: '35', weightMode: 'PER_PIECE' }];
const air: ContractCandidate = {
  id: 'air-v1', contractId: 'air-c1', customerId: 'customer-a', number: 'AIR-TW-US', version: 1, status: 'ACTIVE',
  transportMode: 'AIR', routeScope: 'COUNTRY', originCountry: 'TW', destinationCountry: 'US',
  origin: 'Taipei', destination: 'Los Angeles', seaShipmentType: '', containerType: '', pricingBasis: 'PER_KG',
  airline: '', serviceType: '', commodity: '', effectiveDate: '2026-01-01', expiryDate: '2026-12-31',
  currency: 'USD', rateType: 'BASE_PLUS', minimumCharge: '50', normalRate: '6', breaks: [{ weight: '300', rate: '4.3' }], charges: [], remarks: '',
};
const lcl: ContractCandidate = { ...air, id: 'lcl-v1', number: 'LCL-TW-US', transportMode: 'SEA', seaShipmentType: 'LCL', pricingBasis: 'PER_CBM', minimumCharge: '', normalRate: '100', breaks: [{ weight: '2', rate: '80' }, { weight: '3', rate: '60' }] };
const fcl: ContractCandidate = { ...lcl, id: 'fcl-v1', number: 'FCL-TW-US', seaShipmentType: 'FCL', containerType: '40HQ', pricingBasis: 'PER_CONTAINER', normalRate: '2500', breaks: [{ weight: '3', rate: '2400' }, { weight: '5', rate: '2000' }] };
const match: MatchInput = {
  customerId: 'customer-a', transportMode: 'AIR', routeScope: 'COUNTRY', originCountry: 'TW', destinationCountry: 'US',
  origin: 'Taichung', destination: 'New York', seaShipmentType: '', containerType: '',
  airline: '', serviceType: '', commodity: '', shipmentDate: '2026-06-01',
};
const quote: QuoteInput = {
  ...match, cargo, containerCount: 0, contractVersionId: 'air-v1', manualFreight: null, chargeOverrides: [], temporaryCharges: [],
  costs: [], costsComplete: false, analysisCurrency: 'USD', fxRate: '', fxDate: '', validity: '2026-06-30', remarks: '', terms: '', status: 'Draft', revisionOfId: null,
};
const charge: ChargeInput = { name: 'Handling', basis: 'PER_CBM', rate: '10', currency: 'USD', included: false };

function seaQuote(subtype: 'LCL' | 'FCL'): QuoteInput {
  return { ...quote, transportMode: 'SEA', seaShipmentType: subtype, containerType: subtype === 'FCL' ? '40HQ' : '', containerCount: subtype === 'FCL' ? 2 : 0, contractVersionId: subtype === 'FCL' ? 'fcl-v1' : 'lcl-v1' };
}

describe('Country customer pricing and transport isolation', () => {
  it('uses the same Taiwan–US rate for Los Angeles, New York and a blank optional location', () => {
    for (const destination of ['LAX', 'New York', 'Chicago', '']) {
      const candidates = matchContracts([air], { ...match, destination });
      expect(candidates).toEqual([air]);
      expect(calculateFreight(candidates[0], calculateWeights(cargo, settings))).toMatchObject({ amount: '1806.00', basis: 'PER_KG', quantity: '420', unit: 'KG' });
    }
  });
  it('does not match other countries, reverse directions or other customers', () => {
    expect(matchContracts([air], { ...match, destinationCountry: 'CA' })).toEqual([]);
    expect(matchContracts([air], { ...match, originCountry: 'US', destinationCountry: 'TW' })).toEqual([]);
    expect(matchContracts([air], { ...match, customerId: 'customer-b' })).toEqual([]);
    expect(matchContracts([air], { ...match, destinationCountry: '' })).toEqual([]);
  });
  it('never mixes AIR with SEA, LCL with FCL, container types or airport/country scopes', () => {
    const candidates = [air, lcl, fcl, { ...fcl, id: '20gp-v1', containerType: '20GP' as const }];
    expect(matchContracts(candidates, match)).toEqual([air]);
    expect(matchContracts(candidates, seaQuote('LCL'))).toEqual([lcl]);
    expect(matchContracts(candidates, seaQuote('FCL'))).toEqual([fcl]);
    expect(matchContracts([air], { ...match, routeScope: 'AIRPORT', origin: 'TPE', destination: 'LAX' })).toEqual([]);
  });
  it('continues applying carrier, service, commodity, status and inclusive dates to country contracts', () => {
    const specific = { ...air, airline: 'BR', serviceType: 'EXPRESS', commodity: 'MEDICINE' };
    const input = { ...match, airline: ' br ', serviceType: 'Express', commodity: 'medicine' };
    expect(matchContracts([air, specific], input)).toEqual([specific]);
    expect(matchContracts([specific], { ...input, airline: 'CI' })).toEqual([]);
    expect(matchContracts([specific], { ...input, serviceType: '' })).toEqual([]);
    expect(matchContracts([specific], { ...input, commodity: '' })).toEqual([]);
    expect(matchContracts([{ ...specific, status: 'INACTIVE' }], input)).toEqual([]);
    expect(matchContracts([specific], { ...input, shipmentDate: '2027-01-01' })).toEqual([]);
    expect(matchContracts([specific], { ...input, shipmentDate: '2026-12-31' })).toEqual([specific]);
  });
});

describe('Sea quantities and freight calculation', () => {
  it('uses exact 2.52 CBM and a single eligible break without air volume weight or air rounding', () => {
    const sea = calculateWeights(cargo, settings, 'SEA');
    expect(sea).toEqual({ pieces: 10, grossWeight: '350', cbm: '2.52', volumeWeight: null, chargeableWeight: null, cargoProvided: true });
    expect(calculateWeights(cargo, { volumeDivisor: '1', weightIncrement: '100' }, 'SEA')).toEqual(sea);
    expect(calculateFreight(lcl, sea)).toEqual({ amount: '201.60', currency: 'USD', rate: '80', appliedBreak: '+2 CBM', minimumApplied: false, basis: 'PER_CBM', quantity: '2.52', unit: 'CBM' });
    expect(calculateFreight({ ...lcl, minimumCharge: '250' }, sea)).toMatchObject({ amount: '250.00', minimumApplied: true });
  });
  it('keeps tiny exact CBM in plain decimal notation throughout freight and surcharge calculations', () => {
    const tiny = calculateWeights([{ ...cargo[0], pieces: 1, length: '0.1', width: '0.1', height: '0.1', grossWeight: '0' }], settings, 'SEA');
    expect(tiny.cbm).toBe('0.000000001');
    expect(calculateFreight({ ...lcl, normalRate: '10000000', breaks: [] }, tiny)).toMatchObject({ quantity: '0.000000001', amount: '0.01' });
    expect(calculateCharges([], [], [{ ...charge, rate: '10000000' }], tiny, { transportMode: 'SEA', seaShipmentType: 'LCL' })[0].amount).toBe('0.01');
  });
  it('prices FCL by container count with a fixed minimum and quantity breaks', () => {
    const empty = calculateWeights([], settings, 'SEA');
    expect(empty).toEqual({ pieces: 0, grossWeight: '0', cbm: '0', volumeWeight: null, chargeableWeight: null, cargoProvided: false });
    expect(calculateFreight(fcl, empty, { containerCount: 4 })).toMatchObject({ amount: '9600.00', rate: '2400', appliedBreak: '+3 CONTAINER', basis: 'PER_CONTAINER', quantity: '4', unit: 'CONTAINER' });
    expect(calculateFreight({ ...fcl, minimumCharge: '6000' }, empty, { containerCount: 2 })).toMatchObject({ amount: '6000.00', minimumApplied: true });
  });
  it('rejects missing/fractional/nonpositive FCL count and incompatible freight units', () => {
    const empty = calculateWeights([], settings, 'SEA');
    for (const count of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => calculateFreight(fcl, empty, { containerCount: count })).toThrow('櫃數');
    expect(() => calculateFreight({ ...lcl, pricingBasis: 'PER_KG' }, calculateWeights(cargo, settings, 'SEA'))).toThrow('CBM');
    expect(() => calculateFreight({ ...air, pricingBasis: 'PER_CBM' }, calculateWeights(cargo, settings))).toThrow('KG');
    expect(() => calculateFreight(lcl, '2.52')).toThrow('海運');
    expect(() => calculateFreight(lcl, empty)).toThrow();
  });
});

describe('Sea surcharges and contract inclusion', () => {
  const sea = calculateWeights(cargo, settings, 'SEA');
  it('uses sea gross KG, exact CBM, pieces and container counts rather than air chargeable weight', () => {
    const lines = calculateCharges([], [], [
      { ...charge, basis: 'PER_KG', rate: '0.25' }, charge,
      { ...charge, basis: 'PER_PIECE', rate: '2' }, { ...charge, basis: 'PER_CONTAINER', rate: '100' },
    ], sea, { transportMode: 'SEA', seaShipmentType: 'FCL', containerCount: 2 });
    expect(lines.map((line) => line.amount)).toEqual(['87.50', '25.20', '20.00', '200.00']);
    expect(calculateCharges([], [], [charge], calculateWeights(cargo, settings))[0].amount).toBe('25.20');
  });
  it('rejects billed quantity surcharges when FCL cargo is unknown and accepts included or fixed charges', () => {
    const empty = calculateWeights([], settings, 'SEA');
    const context = { transportMode: 'SEA' as const, seaShipmentType: 'FCL' as const, containerCount: 2 };
    for (const basis of ['PER_KG', 'PER_CBM', 'PER_PIECE'] as const) {
      expect(() => calculateCharges([], [], [{ ...charge, basis }], empty, context)).toThrow('貨物');
      expect(calculateCharges([{ ...charge, basis, included: true }], [], [], empty, context)[0].amount).toBe('0.00');
    }
    expect(calculateCharges([], [], [{ ...charge, basis: 'PER_CONTAINER', rate: '50' }, { ...charge, basis: 'PER_SHIPMENT', rate: '30' }], empty, context).map((line) => line.amount)).toEqual(['100.00', '30.00']);
  });
  it('enforces container-only fees and does not duplicate a contract-included sea surcharge', () => {
    const containerCharge = { ...charge, basis: 'PER_CONTAINER' as const };
    expect(() => calculateCharges([], [], [containerCharge], sea)).toThrow('FCL');
    expect(() => calculateCharges([], [], [containerCharge], sea, { transportMode: 'SEA', seaShipmentType: 'LCL', containerCount: 1 })).toThrow('FCL');
    expect(() => calculateCharges([], [], [containerCharge], sea, { transportMode: 'SEA', seaShipmentType: 'FCL' })).toThrow('櫃數');
    expect(() => calculateCharges([{ ...charge, included: true }], [], [{ ...charge, name: ' handling ' }], sea, { transportMode: 'SEA', seaShipmentType: 'LCL' })).toThrow('不可重複計收');
  });
});

describe('Routing and quantity validation', () => {
  it('normalizes legacy defaults and IATA codes without requiring new metadata', () => {
    const legacy = { ...quote, origin: ' tpe ', destination: ' lax ' } as Record<string, unknown>;
    for (const key of ['transportMode', 'routeScope', 'originCountry', 'destinationCountry', 'seaShipmentType', 'containerType', 'containerCount']) delete legacy[key];
    expect(quoteSchema.parse(legacy)).toMatchObject({ transportMode: 'AIR', routeScope: 'AIRPORT', origin: 'TPE', destination: 'LAX', originCountry: '', destinationCountry: '', seaShipmentType: '', containerType: '', containerCount: 0 });
  });
  it('validates real ISO countries and allows optional locations only for COUNTRY routes', () => {
    expect(matchSchema.parse({ ...match, originCountry: ' tw ', destinationCountry: 'us', origin: undefined, destination: undefined })).toMatchObject({ originCountry: 'TW', destinationCountry: 'US', origin: '', destination: '' });
    for (const invalid of ['', 'USA', 'ZZ']) expect(matchSchema.safeParse({ ...match, destinationCountry: invalid }).success).toBe(false);
    expect(matchSchema.safeParse({ ...match, routeScope: 'AIRPORT', origin: 'Taipei', destination: 'New York' }).success).toBe(false);
    expect(matchSchema.safeParse({ ...match, routeScope: 'AIRPORT', origin: 'TPE', destination: 'LAX', transportMode: 'SEA', seaShipmentType: 'LCL' }).success).toBe(false);
  });
  it('enforces pricing basis and SEA subtype/container combinations', () => {
    expect(contractSchema.safeParse(air).success).toBe(true);
    expect(contractSchema.safeParse(lcl).success).toBe(true);
    expect(contractSchema.safeParse(fcl).success).toBe(true);
    for (const invalid of [
      { ...air, pricingBasis: 'PER_CBM' }, { ...air, seaShipmentType: 'LCL' },
      { ...lcl, pricingBasis: 'PER_KG' }, { ...lcl, containerType: '20GP' },
      { ...fcl, containerType: '' }, { ...fcl, pricingBasis: 'PER_CBM' },
      { ...fcl, routeScope: 'AIRPORT', origin: 'TPE', destination: 'LAX' },
      { ...lcl, charges: [{ ...charge, basis: 'PER_CONTAINER' }] },
    ]) expect(contractSchema.safeParse(invalid).success).toBe(false);
  });
  it('requires cargo for AIR/LCL and count for FCL, while allowing optional FCL cargo', () => {
    expect(quoteSchema.safeParse({ ...quote, cargo: [] }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...seaQuote('LCL'), cargo: [] }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...seaQuote('FCL'), cargo: [] }).success).toBe(true);
    for (const count of [0, -1, 0.5]) expect(quoteSchema.safeParse({ ...seaQuote('FCL'), containerCount: count }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...seaQuote('LCL'), containerCount: 1 }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...quote, containerCount: 1 }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...seaQuote('FCL'), cargo: [], temporaryCharges: [charge] }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...seaQuote('FCL'), cargo: [], temporaryCharges: [{ ...charge, included: true }] }).success).toBe(true);
    expect(quoteSchema.safeParse({ ...quote, temporaryCharges: [{ ...charge, basis: 'PER_CONTAINER' }] }).success).toBe(false);
  });
});
