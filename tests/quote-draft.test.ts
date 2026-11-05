import { describe, expect, it } from 'vitest';
import { readQuoteDraft, writeQuoteDraft, clearSavedQuoteDraft, quoteDraftKey } from '../src/lib/quote-draft';
import { quoteInput } from './fixtures/quotation';
function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
describe('quotation draft recovery', () => {
  it('retains incomplete fields, cargo, adjusted charges and internal cost entry', () => {
    const storage = memoryStorage();
    const input = quoteInput({ validity: '', cargo: [{ pieces: 0.5, length: '', width: '60', height: '60', grossWeight: '', weightMode: 'PER_PIECE' }], costs: [{ name: '未確認成本', amount: null, currency: 'TWD', status: 'ESTIMATED' }], remarks: '尚未完成' });
    expect(writeQuoteDraft(storage, input)).toBe(true);
    expect(readQuoteDraft(storage, null)).toEqual(input);
  });
  it('retains incomplete trucking weight tiers and a selected-rate adjustment after reload', () => {
    const storage = memoryStorage();
    const input = quoteInput({
      chargeOverrides: [{ chargeId: 'trucking', rate: '0.8' }],
      temporaryCharges: [{ name: 'Trucking Charge', basis: 'PER_KG_TIERED', rate: '', minimumAmount: '50', currency: 'USD', included: false,
        breaks: [{ weight: '45', rate: '1.25' }, { weight: '100.', rate: '' }, { weight: '', rate: '0' }] }],
    });
    expect(writeQuoteDraft(storage, input)).toBe(true);
    expect(readQuoteDraft(storage, null)).toEqual(input);
  });
  it('rejects malformed or oversized trucking tier storage before restoring the form', () => {
    const storage = memoryStorage();
    const charge = { name: 'Trucking Charge', basis: 'PER_KG_TIERED' as const, rate: '2', currency: 'USD' as const, included: false };
    for (const breaks of [null, [{ weight: 45, rate: '1' }], [{ weight: '45', rate: null }], Array.from({ length: 51 }, () => ({ weight: '45', rate: '1' }))]) {
      const input = quoteInput({ temporaryCharges: [{ ...charge, breaks: breaks as never }] });
      storage.setItem(quoteDraftKey(null), JSON.stringify({ version: 1, input }));
      expect(readQuoteDraft(storage, null)).toBeNull();
    }
  });
  it('separates new quotations from different revision contexts', () => {
    const storage = memoryStorage();
    const first = quoteInput(); const second = quoteInput({ revisionOfId: 'old-quote', remarks: 'revision only' });
    writeQuoteDraft(storage, first); writeQuoteDraft(storage, second);
    expect(readQuoteDraft(storage, null)).toEqual(first);
    expect(readQuoteDraft(storage, 'old-quote')).toEqual(second);
    expect(readQuoteDraft(storage, 'another-quote')).toBeNull();
  });
  it('rejects malformed or mismatched storage before it can crash the form', () => {
    const storage = memoryStorage();
    for (const value of ['{', JSON.stringify({ version: 2, input: quoteInput() }), JSON.stringify({ version: 1, input: quoteInput({ cargo: null as never }) }), JSON.stringify({ version: 1, input: quoteInput({ revisionOfId: 'wrong' }) })]) {
      storage.setItem(quoteDraftKey(null), value);expect(readQuoteDraft(storage, null)).toBeNull();
    }
  });
  it('only clears the saved input, retaining any newer draft after navigation', () => {
    const storage = memoryStorage(); const submitted = quoteInput();
    writeQuoteDraft(storage, submitted);clearSavedQuoteDraft(storage, submitted);expect(readQuoteDraft(storage, null)).toBeNull();
    const newer = quoteInput({ remarks: 'entered while earlier save finished' });
    writeQuoteDraft(storage, newer);clearSavedQuoteDraft(storage, submitted);expect(readQuoteDraft(storage, null)).toEqual(newer);
  });
  it('handles unavailable browser storage without failing the quotation save', () => {
    const unavailable = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
    expect(readQuoteDraft(unavailable, null)).toBeNull();expect(writeQuoteDraft(unavailable, quoteInput())).toBe(false);
    expect(() => clearSavedQuoteDraft(unavailable, quoteInput())).not.toThrow();
  });
});
