// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Contracts from '../src/components/Contracts';
import QuoteEditor from '../src/components/QuoteEditor';
import type { ChargeInput, ContractCandidate, ContractInput, ContractRecord, QuoteInput } from '../src/lib/types';
import { contractSchema, quoteSchema } from '../src/lib/validation';
import { readQuoteDraft, writeQuoteDraft } from '../src/lib/quote-draft';
import { quoteInput, quoteRecord, quoteSnapshot, uiCustomer, uiSettings } from './fixtures/quotation';

function truckingCharge(patch: Partial<ChargeInput> = {}): ChargeInput {
  return {
    id: 'trucking-charge', name: 'Trucking Charge', basis: 'PER_KG_TIERED', rate: '2.5', currency: 'USD',
    included: false, minimumAmount: '20', breaks: [{ weight: '45', rate: '2' }, { weight: '100', rate: '1.5' }],
    ...patch,
  };
}

function contract(charge = truckingCharge()): ContractRecord {
  return {
    id: 'trucking-contract', customerId: uiCustomer.id, number: 'AIR-TRUCKING', status: 'ACTIVE',
    versions: [{
      id: 'trucking-version', contractId: 'trucking-contract', version: 1,
      transportMode: 'AIR', routeScope: 'COUNTRY', originCountry: 'TW', destinationCountry: 'US', pricingBasis: 'PER_KG',
      origin: '', destination: '', airline: '', serviceType: '', commodity: '',
      effectiveDate: '2026-01-01', expiryDate: '2099-12-31', currency: 'USD', rateType: 'BASE_PLUS',
      minimumCharge: '50', normalRate: '6', breaks: [{ weight: '45', rate: '5.5' }], charges: [charge], remarks: '',
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

function fillNewContract() {
  fireEvent.click(screen.getByRole('button', { name: /新增合約 \/ 航線/ }));
  fireEvent.change(screen.getByLabelText('Contract Number *'), { target: { value: 'AIR-NEW-TRUCKING' } });
  fireEvent.change(screen.getByLabelText('合約目的國家'), { target: { value: 'US' } });
  fireEvent.change(screen.getByLabelText('有效迄日 *'), { target: { value: '2099-12-31' } });
  fireEvent.change(screen.getByLabelText('空運 Normal 單價'), { target: { value: '6' } });
  fireEvent.change(screen.getByLabelText('級距價格 1'), { target: { value: '5.5' } });
  fireEvent.click(screen.getByRole('button', { name: '＋ 新增費用' }));
  fireEvent.change(screen.getByLabelText('費用名稱 1'), { target: { value: 'Trucking Charge' } });
}

function submitted(fetch: ReturnType<typeof harness>['fetch']): ContractInput {
  return JSON.parse(fetch.mock.calls[0][1]!.body as string) as ContractInput;
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Trucking Charge contract weight tiers', () => {
  it.each(['', '3'])('saves independent trucking tiers with Normal %j and preserves an explicit zero tier price', async normalRate => {
    const { fetch, onChanged } = harness();
    fillNewContract();
    fireEvent.change(screen.getByLabelText('計價方式 1'), { target: { value: 'PER_KG_TIERED' } });
    fireEvent.change(screen.getByLabelText('費用 1 Normal 單價'), { target: { value: normalRate } });
    fireEvent.change(screen.getByLabelText('費用 1 級距單價 1'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('費用 1 級距單價 2'), { target: { value: '1.5' } });
    expect(within(screen.getByRole('table', { name: '費用 1 重量級距' })).getByText('未滿 45 KG')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '儲存合約' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const body = submitted(fetch);
    expect(body).toMatchObject({ normalRate: '6', breaks: [{ weight: '45', rate: '5.5' }] });
    expect(body.charges).toEqual([{
      name: 'Trucking Charge', basis: 'PER_KG_TIERED', currency: 'USD', included: false, rate: normalRate,
      breaks: [{ weight: '45', rate: '0' }, { weight: '100', rate: '1.5' }],
    }]);
    expect(contractSchema.safeParse(body).success).toBe(true);
  });

  it('edits existing trucking tiers into the version update while preserving the previous version', async () => {
    const record = contract();
    const previous = structuredClone(record.versions[0]);
    const { fetch, onChanged } = harness([record]);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect((screen.getByLabelText('費用 1 Normal 單價') as HTMLInputElement).value).toBe('2.5');
    expect((screen.getByLabelText('費用 1 級距單價 1') as HTMLInputElement).value).toBe('2');
    fireEvent.change(screen.getByLabelText('費用 1 級距單價 1'), { target: { value: '1.9' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存為新版本' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toBe('/api/contracts/trucking-contract');
    expect(fetch.mock.calls[0][1]?.method).toBe('PUT');
    expect(submitted(fetch).charges[0]).toMatchObject({
      id: 'trucking-charge', rate: '2.5', minimumAmount: '20', breaks: [{ weight: '45', rate: '1.9' }, { weight: '100', rate: '1.5' }],
    });
    expect(record.versions).toEqual([previous]);
  });

  it('shows historical tier prices read-only and retains their values when copying a version', async () => {
    const record = contract();
    const { fetch, onChanged } = harness([record]);
    fireEvent.click(screen.getByRole('button', { name: '版本' }));
    const historical = within(screen.getByRole('table', { name: 'Trucking Charge 重量級距' }));
    expect(historical.getByRole('row', { name: /未滿 45 KG\s*Normal.*2\.5/ })).toBeTruthy();
    expect(historical.getByRole('row', { name: '+45 KG 2' })).toBeTruthy();
    expect(historical.getByRole('row', { name: '+100 KG 1.5' })).toBeTruthy();
    expect(historical.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '複製此版本為新合約' }));
    fireEvent.change(screen.getByLabelText('Contract Number *'), { target: { value: 'AIR-TRUCKING-COPY' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存合約' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][1]?.method).toBe('POST');
    const copied = submitted(fetch).charges[0];
    expect(copied.id).toBeUndefined();
    const { id: _id, ...expected } = record.versions[0].charges[0];
    expect(copied).toEqual(expected);
    expect(contractSchema.safeParse(submitted(fetch)).success).toBe(true);
  });

  it('clears trucking tiers when switching to flat per-KG pricing and retains the compatible unit rate', async () => {
    const { fetch, onChanged } = harness([contract()]);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    fireEvent.change(screen.getByLabelText('計價方式 1'), { target: { value: 'PER_KG' } });
    expect(screen.queryByRole('table', { name: '費用 1 重量級距' })).toBeNull();
    expect((screen.getByLabelText('費用運價 1') as HTMLInputElement).value).toBe('2.5');
    fireEvent.click(screen.getByRole('button', { name: '儲存為新版本' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(submitted(fetch).charges[0]).toMatchObject({ basis: 'PER_KG', rate: '2.5', breaks: [] });
    expect(contractSchema.safeParse(submitted(fetch)).success).toBe(true);
  });

  it('does not reuse a fixed per-shipment price as a per-KG Normal price', async () => {
    const { fetch, onChanged } = harness([contract(truckingCharge({ basis: 'PER_SHIPMENT', rate: '100', breaks: [] }))]);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    fireEvent.change(screen.getByLabelText('計價方式 1'), { target: { value: 'PER_KG_TIERED' } });
    expect((screen.getByLabelText('費用 1 Normal 單價') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('費用 1 Normal 單價'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('費用 1 級距單價 1'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存為新版本' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(submitted(fetch).charges[0]).toMatchObject({ basis: 'PER_KG_TIERED', rate: '3', breaks: [{ weight: '45', rate: '2' }] });
    expect(contractSchema.safeParse(submitted(fetch)).success).toBe(true);
  });
});

function quoteHarness(input: QuoteInput, candidates: ContractCandidate[]) {
  writeQuoteDraft(window.sessionStorage, input);
  const fetch = vi.fn(async (resource: string | URL | Request, init?: RequestInit) => {
    const path = String(resource);
    const body = JSON.parse(init!.body as string) as QuoteInput;
    const data = path === '/api/match' ? candidates
      : path === '/api/preview' ? quoteSnapshot(body)
        : path === '/api/quotes' ? quoteRecord(body) : null;
    if (!data) throw new Error(`Unexpected test request: ${path}`);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  const onSaved = vi.fn();
  const view = render(<QuoteEditor customers={[uiCustomer]} settings={uiSettings} initial={null} onSaved={onSaved} />);
  return { ...view, fetch, onSaved };
}

async function previewQuote() {
  const button = screen.getByRole('button', { name: '試算報價' });
  await waitFor(() => expect(button.matches(':disabled')).toBe(false));
  fireEvent.click(button);
  await screen.findByText('報價試算結果', { exact: true });
}

function quoteBody(fetch: ReturnType<typeof quoteHarness>['fetch'], path: string): QuoteInput {
  const call = fetch.mock.calls.filter(([resource]) => String(resource) === path).at(-1);
  return JSON.parse(call![1]!.body as string) as QuoteInput;
}

describe('Trucking Charge quotation adjustments and drafts', () => {
  it('shows the selected tier rate across 44.5 and 45 KG and retains an override until explicitly restored', async () => {
    const record = contract();
    const candidate: ContractCandidate = { ...record.versions[0], customerId: record.customerId, number: record.number, status: record.status };
    const { fetch } = quoteHarness(quoteInput({
      contractVersionId: candidate.id, manualFreight: null,
      cargo: [{ pieces: 1, length: '1', width: '1', height: '1', grossWeight: '44.5', weightMode: 'GROUP_TOTAL' }],
    }), [candidate]);

    const rate = await screen.findByLabelText('調整 Trucking Charge 單價') as HTMLInputElement;
    expect(rate.value).toBe('2.5');
    fireEvent.change(screen.getByLabelText('貨物 1 實際重量'), { target: { value: '45' } });
    expect(rate.value).toBe('2');
    fireEvent.change(rate, { target: { value: '1.7' } });
    await previewQuote();
    expect(quoteBody(fetch, '/api/preview').chargeOverrides).toEqual([{ chargeId: 'trucking-charge', rate: '1.7' }]);

    fireEvent.change(screen.getByLabelText('貨物 1 實際重量'), { target: { value: '100' } });
    expect(rate.value).toBe('1.7');
    fireEvent.click(screen.getByRole('button', { name: '還原合約級距價' }));
    expect(rate.value).toBe('1.5');
    await previewQuote();
    expect(quoteBody(fetch, '/api/preview').chargeOverrides).toEqual([]);
  });

  it('restores unfinished temporary tiers but sends only priced rows and clears the successfully saved draft', async () => {
    const input = quoteInput();
    const first = quoteHarness(input, []);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增臨時應收費用' }));
    fireEvent.change(screen.getByLabelText('臨時費用名稱'), { target: { value: 'Trucking Charge' } });
    fireEvent.change(screen.getByLabelText('臨時費用 1 計價方式'), { target: { value: 'PER_KG_TIERED' } });
    fireEvent.change(screen.getByLabelText('臨時費用 1 級距單價 1'), { target: { value: '0' } });

    await waitFor(() => expect(readQuoteDraft(window.sessionStorage, null)?.temporaryCharges[0].breaks).toHaveLength(5));
    const unfinished = readQuoteDraft(window.sessionStorage, null)!;
    first.unmount();
    const { fetch, onSaved } = quoteHarness(unfinished, []);
    expect((await screen.findByLabelText('臨時費用 1 級距單價 1') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('臨時費用 1 Normal 單價') as HTMLInputElement).value).toBe('');
    await previewQuote();
    const expected = { name: 'Trucking Charge', basis: 'PER_KG_TIERED', rate: '', breaks: [{ weight: '45', rate: '0' }] };
    expect(quoteBody(fetch, '/api/preview').temporaryCharges[0]).toMatchObject(expected);
    expect(quoteSchema.safeParse(quoteBody(fetch, '/api/preview')).success).toBe(true);
    expect(readQuoteDraft(window.sessionStorage, null)?.temporaryCharges[0].breaks).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: '儲存報價快照' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(quoteBody(fetch, '/api/quotes').temporaryCharges[0]).toMatchObject(expected);
    expect(quoteSchema.safeParse(quoteBody(fetch, '/api/quotes')).success).toBe(true);
    expect(readQuoteDraft(window.sessionStorage, null)).toBeNull();
  });
});
