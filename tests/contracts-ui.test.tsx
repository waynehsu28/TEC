// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Contracts from '../src/components/Contracts';
import type { ContractInput, ContractRecord, ContractVersion } from '../src/lib/types';
import { contractSchema } from '../src/lib/validation';
import { uiCustomer } from './fixtures/quotation';

function legacyContract(patch: Partial<ContractVersion> = {}): ContractRecord {
  return {
    id: 'legacy-contract', customerId: uiCustomer.id, number: 'AIR-LEGACY', status: 'ACTIVE',
    versions: [{
      id: 'legacy-version', contractId: 'legacy-contract', version: 1,
      origin: 'TPE', destination: 'LAX', airline: '', serviceType: '', commodity: '',
      effectiveDate: '2026-01-01', expiryDate: '2099-12-31', currency: 'USD', rateType: 'BASE_PLUS',
      minimumCharge: '50', normalRate: '6.75', breaks: [{ weight: '45', rate: '5.8' }], charges: [], remarks: '',
      ...patch,
    }],
  };
}

function harness(contracts: ContractRecord[] = []) {
  const fetch = vi.fn(async (_resource: string | URL | Request, _init?: RequestInit) => new Response('{}', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetch);
  const onChanged = vi.fn(async () => {});
  render(<Contracts customers={[uiCustomer]} contracts={contracts} customerFilter="" onFilter={vi.fn()} onChanged={onChanged} />);
  return { fetch, onChanged };
}

function openNew() {
  fireEvent.click(screen.getByRole('button', { name: /新增合約 \/ 航線/ }));
  fireEvent.change(screen.getByLabelText('Contract Number *'), { target: { value: 'AIR-UNDER45' } });
  fireEvent.change(screen.getByLabelText('合約目的國家'), { target: { value: 'US' } });
  fireEvent.change(screen.getByLabelText('有效迄日 *'), { target: { value: '2099-12-31' } });
}

function normalRow() { return screen.getByLabelText('空運 Normal 單價').closest('tr')!; }
function submitted(fetch: ReturnType<typeof harness>['fetch']): ContractInput {
  return JSON.parse(fetch.mock.calls[0][1]!.body as string) as ContractInput;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('air freight below-45 rate entry', () => {
  it.each(['6.25', '0'])('saves the small-shipment unit rate %s as Normal with a separate +45 tier', async normalRate => {
    const { fetch, onChanged } = harness();
    openNew();
    fireEvent.change(within(normalRow()).getByRole('textbox'), { target: { value: normalRate } });
    fireEvent.change(screen.getByLabelText('級距價格 1'), { target: { value: '5.5' } });
    expect(within(normalRow()).getByText('未滿 45 KG')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '儲存合約' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toBe('/api/contracts');
    expect(fetch.mock.calls[0][1]?.method).toBe('POST');
    const body = submitted(fetch);
    expect(body.normalRate).toBe(normalRate);
    expect(body.breaks).toEqual([{ weight: '45', rate: '5.5' }]);
    expect(contractSchema.safeParse(body).success).toBe(true);
    expect(screen.queryByLabelText('空運 Normal 單價')).toBeNull();
  });

  it('edits a legacy Normal rate through the existing version update without changing its old version', async () => {
    const record = legacyContract();
    const originalVersion = structuredClone(record.versions[0]);
    const { fetch, onChanged } = harness([record]);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    const input = screen.getByLabelText('空運 Normal 單價') as HTMLInputElement;
    expect(input.value).toBe('6.75');
    expect(within(normalRow()).getByText('未滿 45 KG')).toBeTruthy();
    fireEvent.change(input, { target: { value: '7.25' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存為新版本' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toBe('/api/contracts/legacy-contract');
    expect(fetch.mock.calls[0][1]?.method).toBe('PUT');
    expect(submitted(fetch)).toMatchObject({ normalRate: '7.25', breaks: originalVersion.breaks, number: record.number });
    expect(contractSchema.safeParse(submitted(fetch)).success).toBe(true);
    expect(record.versions).toEqual([originalVersion]);
  });

  it('labels Normal by the first priced tier and counts a zero rate while ignoring an unpriced threshold', async () => {
    const { fetch, onChanged } = harness();
    openNew();
    fireEvent.change(screen.getByLabelText('空運 Normal 單價'), { target: { value: '6' } });
    // The unpriced +45 row must not hide the fallback from 45 through 99.5 KG.
    fireEvent.change(screen.getByLabelText('級距價格 2'), { target: { value: '4' } });
    expect(within(normalRow()).getByText('未滿 100 KG')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /自訂級距/ }));
    fireEvent.change(screen.getByLabelText('級距數量 6'), { target: { value: '30' } });
    expect(within(normalRow()).getByText('未滿 100 KG')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('級距價格 6'), { target: { value: '0' } });
    expect(within(normalRow()).getByText('未滿 30 KG')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '儲存合約' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(submitted(fetch).breaks).toEqual([{ weight: '100', rate: '4' }, { weight: '30', rate: '0' }]);
  });

  it('shows the unrestricted Normal range for an older contract with no tiers in both history and editing', () => {
    harness([legacyContract({ breaks: [] })]);
    fireEvent.click(screen.getByRole('button', { name: '版本' }));
    expect(screen.getByRole('row', { name: '全部計費重量 · Normal 6.75' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(within(normalRow()).getByText('全部計費重量')).toBeTruthy();
    expect((screen.getByLabelText('空運 Normal 單價') as HTMLInputElement).value).toBe('6.75');
  });
});

describe('sea freight Normal rate entry', () => {
  it.each([
    { type: 'LCL', unit: 'CBM', rate: '80', basis: 'PER_CBM' },
    { type: 'FCL', unit: '櫃', rate: '2500', basis: 'PER_CONTAINER' },
  ] as const)('keeps $type pricing in its own $unit Normal field', async ({ type, unit, rate, basis }) => {
    const { fetch, onChanged } = harness();
    openNew();
    fireEvent.change(screen.getByLabelText('運輸模式'), { target: { value: 'SEA' } });
    if (type === 'FCL') fireEvent.change(screen.getByLabelText('海運類型'), { target: { value: 'FCL' } });
    expect(screen.queryByLabelText('空運 Normal 單價')).toBeNull();
    fireEvent.change(screen.getByLabelText(`基本單價 Normal Rate · USD/${unit}`), { target: { value: rate } });
    fireEvent.click(screen.getByRole('button', { name: '儲存合約' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(submitted(fetch)).toMatchObject({ transportMode: 'SEA', seaShipmentType: type, pricingBasis: basis, normalRate: rate, breaks: [] });
    expect(contractSchema.safeParse(submitted(fetch)).success).toBe(true);
  });
});
