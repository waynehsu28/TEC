import { describe, it, expect } from 'vitest';
import { calculateWeights, matchContracts, calculateFreight, calculateCharges, calculateFinance } from '../src/lib/engine';
import { contractSchema, quoteSchema, customerSchema, settingsSchema, dateSchema } from '../src/lib/validation';
import type { ContractCandidate, CargoItem, FreightResult, ChargeInput, CostInput, QuoteInput } from '../src/lib/types';

const cargo: CargoItem[] = [{ pieces: 10, length: '70', width: '60', height: '60', grossWeight: '35', weightMode: 'PER_PIECE' }];
const settings = { volumeDivisor: '6000', weightIncrement: '0.5' };
const weights = calculateWeights(cargo, settings);
const base: ContractCandidate = { id: 'v1', contractId: 'c1', customerId: 'customerA', number: 'A-2026', version: 1, status: 'ACTIVE', origin: 'TPE', destination: 'LAX', airline: '', serviceType: '', commodity: '', effectiveDate: '2026-01-01', expiryDate: '2026-12-31', currency: 'USD', rateType: 'BASE_PLUS', minimumCharge: '50', normalRate: '6', breaks: [{weight:'45',rate:'5.8'},{weight:'100',rate:'5'},{weight:'300',rate:'4.30'},{weight:'500',rate:'3'}], charges: [], remarks: '' };
const match = { customerId: 'customerA', origin: 'TPE', destination: 'LAX', airline: 'BR', serviceType: 'GENERAL', commodity: 'Electronics', shipmentDate: '2026-06-01' };
const freight: FreightResult = { amount: '1806.00', currency: 'USD', rate: '4.3', appliedBreak: '+300 KG', minimumApplied: false };
const cost: CostInput = { name: 'Airline Freight Cost', amount: '1344', currency: 'USD', status: 'ACTUAL' };
const charge: ChargeInput = { id: 'fuel', name: 'Fuel Surcharge', basis: 'PER_KG', rate: '0.25', currency: 'USD', included: false };
const quote: QuoteInput = { ...match, cargo, contractVersionId: 'v1', manualFreight: null, chargeOverrides: [], temporaryCharges: [], costs: [cost], costsComplete: true, analysisCurrency: 'USD', fxRate: '', fxDate: '', validity: '2026-06-30', remarks: '', terms: '', status: 'Draft', revisionOfId: null };

describe('Chargeable weight — aggregate before rounding', () => {
  it('Test 1: 10×70×60×60cm, 35KG each => gross350, volume420, CW420', () => {
    expect(weights).toEqual({ pieces: 10, grossWeight: '350', cbm: '2.52', volumeWeight: '420', chargeableWeight: '420' });
  });
  it('does not multiply group total weight by pieces', () => {
    expect(calculateWeights([{...cargo[0], grossWeight:'350', weightMode:'GROUP_TOTAL'}], settings)).toEqual(weights);
  });
  it('sums multiple groups before a single 0.5KG ceiling', () => {
    const tiny = { pieces: 1, length:'1',width:'1',height:'1',grossWeight:'0.1',weightMode:'GROUP_TOTAL' as const };
    expect(calculateWeights([tiny,tiny], settings).chargeableWeight).toBe('0.5');
  });
  it('supports configured divisor and increment without IEEE754 boundary drift', () => {
    expect(calculateWeights([{...cargo[0],pieces:1,length:'60',width:'60',height:'60',grossWeight:'36.01'}], {volumeDivisor:'5000',weightIncrement:'1'}).chargeableWeight).toBe('44');
    expect(calculateWeights([{...cargo[0],pieces:1,length:'1',width:'1',height:'1',grossWeight:'0.3'}], {volumeDivisor:'6000',weightIncrement:'0.1'}).chargeableWeight).toBe('0.3');
  });
  it('rejects invalid counts and divisors', () => {
    expect(() => calculateWeights([{...cargo[0],pieces:0}],settings)).toThrow();
    expect(() => calculateWeights(cargo,{...settings,volumeDivisor:'0'})).toThrow();
  });
});
describe('Freight — single break pricing and fixed MIN', () => {
  it('Test 2: +300 4.30 ×420 =1806, never progressive or optimized to500', () => {
    expect(calculateFreight(base,'420')).toEqual(freight);
  });
  it('uses normal rate below first threshold then enforces fixed MIN', () => {
    expect(calculateFreight(base,'10').amount).toBe('60.00');
    expect(calculateFreight(base,'1')).toMatchObject({ amount:'50.00',rate:'6',appliedBreak:'Normal',minimumApplied:true });
  });
  it('includes exact threshold boundaries', () => {
    expect(calculateFreight(base,'300')).toMatchObject({ rate:'4.3',amount:'1290.00' });
  });
  it('uses MIN-only fallback without treating it as a perKG rate', () => {
    expect(calculateFreight({...base,normalRate:''},'10')).toMatchObject({ amount:'50.00',rate:'',appliedBreak:'MIN' });
  });
  it('rejects a weight with no applicable rate or minimum', () => {
    expect(() => calculateFreight({...base,normalRate:'',minimumCharge:''},'10')).toThrow('沒有適用');
  });
  it('keeps explicit free rates distinct from empty fields', () => {
    expect(calculateFreight({...base,normalRate:'0',minimumCharge:'',breaks:[]},'10').amount).toBe('0.00');
  });
});
describe('Contract matching — customer, route, terms, inclusive dates', () => {
  it('Test 4: rejects expired contract and includes start/end dates', () => {
    expect(matchContracts([base],{...match,shipmentDate:'2027-01-01'})).toEqual([]);
    expect(matchContracts([base],{...match,shipmentDate:'2026-01-01'})).toHaveLength(1);
    expect(matchContracts([base],{...match,shipmentDate:'2026-12-31'})).toHaveLength(1);
  });
  it('Test 5: does not leak customer A rates to customer B', () => {
    expect(matchContracts([base],{...match,customerId:'customerB'})).toEqual([]);
  });
  it('matches route direction and active status', () => {
    expect(matchContracts([base],{...match,origin:'LAX',destination:'TPE'})).toEqual([]);
    expect(matchContracts([{...base,status:'INACTIVE'}],match)).toEqual([]);
  });
  it('checks airline/service/commodity and normalizes comparison', () => {
    expect(matchContracts([{...base,airline:'CI'}],match)).toEqual([]);
    expect(matchContracts([{...base,serviceType:'EXPRESS'}],match)).toEqual([]);
    expect(matchContracts([{...base,commodity:'Live Animals'}],match)).toEqual([]);
    expect(matchContracts([{...base,airline:' br ',serviceType:' general ',commodity:'electronics'}],match)).toHaveLength(1);
  });
  it('prefers airline-specific matches and retains equal candidates for explicit choice', () => {
    const specific = {...base,id:'v2',airline:'BR'};
    expect(matchContracts([base,specific,{...specific,id:'v3'}],match).map((c)=>c.id)).toEqual(['v2','v3']);
  });
});
describe('Surcharges and per-quote overrides', () => {
  it('Test 6: included All-in charges never billed twice, even after override', () => {
    const lines = calculateCharges([{...charge,included:true}],[{chargeId:'fuel',rate:'9'}],[],weights);
    expect(lines[0]).toMatchObject({ included:true,originalRate:'0.25',appliedRate:'9',amount:'0.00' });
    expect(calculateFinance(freight,lines,[cost],true,'USD','').revenue).toBe('1806.00');
  });
  it('retains original price while applying override and temporary fees', () => {
    const original = structuredClone(charge);
    const lines = calculateCharges([charge],[{chargeId:'fuel',rate:'0.3'}],[{...charge,id:undefined,name:'AWB',basis:'PER_SHIPMENT',rate:'25'}],weights);
    expect(lines[0]).toMatchObject({ originalAmount:'105.00',amount:'126.00',originalRate:'0.25',appliedRate:'0.3',temporary:false });
    expect(lines[1]).toMatchObject({ amount:'25.00',temporary:true });
    expect(charge).toEqual(original);
  });
  it('supports per piece, fixed MIN, manual amount, and per-line minimum floor', () => {
    expect(calculateCharges([],[],[{...charge,basis:'PER_PIECE',rate:'2.5'},{...charge,basis:'MINIMUM',rate:'35'},{...charge,basis:'MANUAL',manualAmount:'8.125'},{...charge,minimumAmount:'120'}],weights).map(c=>c.amount)).toEqual(['25.00','35.00','8.13','120.00']);
  });
  it('rejects duplicate billing of an included contract surcharge through temporary lines', () => {
    expect(()=>calculateCharges([{...charge,included:true}],[],[{...charge,name:' fuel surcharge ',included:false}],weights)).toThrow('不可重複計收');
  });
  it('rejects stale or duplicate override references', () => {
    expect(()=>calculateCharges([charge],[{chargeId:'missing',rate:'1'}],[],weights)).toThrow();
    expect(()=>calculateCharges([charge],[{chargeId:'fuel',rate:'1'},{chargeId:'fuel',rate:'2'}],[],weights)).toThrow();
  });
});
describe('Revenue, cost, profit, and currency precision', () => {
  it('Test 3: 1806 revenue -1344 cost =462, margin25.58%', () => {
    expect(calculateFinance(freight,[],[cost],true,'USD','')).toMatchObject({ revenue:'1806.00',knownCost:'1344.00',grossProfit:'462.00',margin:'25.58',markup:'34.38',costState:'COMPLETE',provisional:false,negativeProfit:false });
  });
  it('Test 8: no costs means Cost Not Available, never zero cost or fabricated profit', () => {
    expect(calculateFinance(freight,[],[],true,'USD','')).toMatchObject({ costState:'MISSING',knownCost:null,grossProfit:null,margin:null,markup:null });
    expect(calculateFinance(freight,[],[{...cost,amount:null}],false,'USD','').grossProfit).toBeNull();
  });
  it('partial costs yield subtotal/provisional profit without complete profit margin', () => {
    expect(calculateFinance(freight,[],[cost,{...cost,name:'Other',amount:null}],true,'USD','')).toMatchObject({ costState:'PARTIAL',knownCost:'1344.00',grossProfit:'462.00',margin:null,markup:null,provisional:true });
    expect(calculateFinance(freight,[],[cost],false,'USD','').costState).toBe('PARTIAL');
  });
  it('explicit zero cost is valid, but markup remains undefined', () => {
    expect(calculateFinance(freight,[],[{...cost,amount:'0'}],true,'USD','')).toMatchObject({ grossProfit:'1806.00',margin:'100.00',markup:null });
  });
  it('flags estimates and negative profit without changing contract price', () => {
    expect(calculateFinance(freight,[],[{...cost,amount:'2000',status:'ESTIMATED'}],true,'USD','')).toMatchObject({ negativeProfit:true,provisional:true,grossProfit:'-194.00' });
    expect(freight.amount).toBe('1806.00');
  });
  it('does not divide by zero revenue', () => {
    expect(calculateFinance({...freight,amount:'0'},[],[cost],true,'USD','').margin).toBeNull();
  });
  it('requires FX for foreign totals and still exposes original currency subtotals', () => {
    expect(calculateFinance(freight,[],[{...cost,currency:'TWD'}],true,'USD','')).toMatchObject({ revenue:'1806.00',knownCost:null,grossProfit:null,margin:null,missingFx:true,costByCurrency:{TWD:'1344.00'} });
    expect(calculateFinance(freight,[],[cost],true,'TWD','').revenue).toBeNull();
  });
  it('Test 10: exact decimal arithmetic and HALF_UP cents', () => {
    expect(calculateFreight({...base,normalRate:'0.1',minimumCharge:'',breaks:[]},'0.2').amount).toBe('0.02');
    expect(calculateFreight({...base,normalRate:'0.335',minimumCharge:'',breaks:[]},'3').amount).toBe('1.01');
    expect(calculateFinance({...freight,amount:'0.10'},[{...calculateCharges([],[],[{...charge,basis:'PER_SHIPMENT',rate:'0.20'}],weights)[0]}],[{...cost,amount:'0.20'}],true,'USD','')).toMatchObject({ revenue:'0.30',grossProfit:'0.10',margin:'33.33' });
  });
  it('Test 10: converts USD↔TWD using manually specified TWD per USD rate', () => {
    expect(calculateFinance({...freight,amount:'10.01'},[],[{...cost,amount:'200',currency:'TWD'}],true,'TWD','32.1234')).toMatchObject({ revenue:'321.56',knownCost:'200.00',grossProfit:'121.56',margin:'37.80' });
    expect(calculateFinance({...freight,amount:'321.56',currency:'TWD'},[],[{...cost,amount:'1'}],true,'USD','32.1234')).toMatchObject({ revenue:'10.01',knownCost:'1.00',grossProfit:'9.01' });
  });
});
describe('Server input validation', () => {
  const contractInput = { ...base, customerId:'customerA', number:'A-2026',status:'ACTIVE' };
  it('validates happy-path quote and rejects impossible calendar dates', () => {
    expect(quoteSchema.safeParse(quote).success).toBe(true);
    expect(quoteSchema.safeParse({...quote,validity:'2026-05-15'}).success).toBe(true);
    expect(dateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(dateSchema.safeParse('2028-02-29').success).toBe(true);
  });
  it('rejects invalid contract dates and duplicate break weights', () => {
    expect(contractSchema.safeParse({...contractInput,expiryDate:'2025-01-01'}).success).toBe(false);
    expect(contractSchema.safeParse({...contractInput,breaks:[{weight:'45',rate:'1'},{weight:'45.0',rate:'2'}]}).success).toBe(false);
  });
  it('rejects floating numbers, exponent notation, negative rates and zero increments', () => {
    expect(contractSchema.safeParse({...contractInput,normalRate:4.3}).success).toBe(false);
    expect(contractSchema.safeParse({...contractInput,normalRate:'1e3'}).success).toBe(false);
    expect(contractSchema.safeParse({...contractInput,normalRate:'-1'}).success).toBe(false);
    expect(contractSchema.safeParse({...contractInput,breaks:[{weight:'not-a-number',rate:'1'}]}).success).toBe(false);
    expect(settingsSchema.safeParse({companyName:'',companyLogo:'',volumeDivisor:'6000',weightIncrement:'0',defaultCurrency:'USD',exchangeRate:'',exchangeRateDate:'',terms:''}).success).toBe(false);
  });
  it('requires FX date, mutually exclusive pricing, and valid customer email', () => {
    expect(quoteSchema.safeParse({...quote,fxRate:'32'}).success).toBe(false);
    expect(quoteSchema.safeParse({...quote,manualFreight:{amount:'1',currency:'USD'}}).success).toBe(false);
    expect(customerSchema.safeParse({name:'A',code:'A',contact:'',email:'invalid',phone:'',defaultCurrency:'USD',remarks:'',status:'ACTIVE'}).success).toBe(false);
  });
});
