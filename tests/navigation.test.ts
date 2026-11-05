import { describe, expect, it } from 'vitest';
import { applicableContractVersion, contractHasExpired, parseWorkspaceHash, quoteContextKey, workspaceHash } from '../src/lib/navigation';
import type { ContractRecord, ContractVersion } from '../src/lib/types';

describe('workspace URL navigation', () => {
  it('restores quotation and revision screens from a document URL', () => {
    expect(parseWorkspaceHash('#quote')).toEqual({ module: 'quote', revisionId: null, quoteId: null, customerId: null });
    const revision = parseWorkspaceHash('#quote?revision=quote-abc');
    expect(revision.revisionId).toBe('quote-abc');
    expect(quoteContextKey(revision)).toBe('revision:quote-abc');
    expect(quoteContextKey(parseWorkspaceHash('#quote'))).toBe('new');
  });
  it('round trips record selection and customer filters without form data', () => {
    const route = { module: 'history' as const, quoteId: 'quote-1', customerId: 'customer-2', revisionId: null };
    expect(parseWorkspaceHash(workspaceHash(route))).toEqual(route);
    expect(workspaceHash({ module: 'contracts', customerId: 'customer-2' })).toBe('#contracts?customer=customer-2');
    expect(workspaceHash({ ...route, revisionId: 'unused-id' })).not.toContain('revision');
    expect(parseWorkspaceHash('#history?quote=quote-1&customer=customer-2&amount=100')).toEqual(route);
  });
  it('falls back safely for unknown modules and malformed identifiers', () => {
    for (const hash of ['', '#', '#unknown', '#quote?revision=../../data', '#quote?revision=abc&revision=def', '#history?quote=', `#contracts?customer=${'x'.repeat(101)}`]) {
      expect(parseWorkspaceHash(hash).module).toBe('dashboard');
    }
    expect(workspaceHash({ module: 'quote', revisionId: '../unsafe' })).toBe('#dashboard');
    expect(quoteContextKey(parseWorkspaceHash('#history?quote=quote-1'))).toBeNull();
  });
});

function version(version: number, effectiveDate: string, expiryDate: string): ContractVersion {
  return { id: `version-${version}`, contractId: 'contract-1', version, origin: 'TPE', destination: 'LAX', airline: '', serviceType: '', commodity: '', effectiveDate, expiryDate, currency: 'USD', rateType: 'BASE_PLUS', minimumCharge: '', normalRate: '4', breaks: [], charges: [], remarks: '' };
}
function contract(versions: ContractVersion[]): ContractRecord { return { id: 'contract-1', customerId: 'customer-1', number: 'TEST', status: 'ACTIVE', versions }; }

describe('dashboard version counts follow quotation matching dates', () => {
  it('keeps the valid current version active when a newer future version exists', () => {
    const row = contract([version(1, '2026-01-01', '2026-12-31'), version(2, '2027-01-01', '2027-12-31')]);
    expect(applicableContractVersion(row, '2026-11-05')?.version).toBe(1);
    expect(applicableContractVersion(row, '2027-01-01')?.version).toBe(2);
    expect(row.versions[0].version).toBe(1);
    expect(contractHasExpired(row, '2026-11-05')).toBe(false);
  });
  it('uses the highest applicable version and never calls a still-valid older period expired', () => {
    const row = contract([version(1, '2026-01-01', '2026-12-31'), version(3, '2026-01-01', '2026-06-30'), version(2, '2026-01-01', '2026-10-31')]);
    expect(applicableContractVersion(row, '2026-06-01')?.version).toBe(3);
    expect(applicableContractVersion(row, '2026-11-05')?.version).toBe(1);
    expect(contractHasExpired(row, '2026-11-05')).toBe(false);
    expect(contractHasExpired(row, '2027-01-01')).toBe(true);
    expect(applicableContractVersion(row, '2027-01-01')).toBeUndefined();
  });
});
