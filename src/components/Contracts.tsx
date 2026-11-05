'use client';

import { useState } from 'react';
import type { ChargeBasis, ChargeInput, ContainerType, ContractInput, ContractRecord, ContractVersion, Currency, Customer, FreightBasis, SeaShipmentType, TransportMode } from '@/lib/types';
import { chargeBasisLabels, freightBasisLabels, modeName, routeLabel } from '@/lib/transport';
import CountrySelect from './CountrySelect';
import { api, Badge, Empty, Field, localDate, money } from './ui';

const chargeNames = ['Fuel Surcharge', 'Security Surcharge', 'Terminal Handling Charge', 'AWB Fee', 'Documentation Fee', 'Customs Clearance', 'Trucking Charge', 'Pickup Charge', 'Other Charges'];
const commonChargeBases: ChargeBasis[] = ['PER_SHIPMENT', 'PER_PIECE', 'MINIMUM', 'MANUAL'];
const freightUnits: Record<FreightBasis, string> = { PER_KG: 'KG', PER_CBM: 'CBM', PER_CONTAINER: '櫃' };
const newest = (contract: ContractRecord) => [...contract.versions].sort((a, b) => b.version - a.version)[0];
const basisOf = (contract: Pick<ContractInput, 'pricingBasis'>): FreightBasis => contract.pricingBasis ?? 'PER_KG';
const carrierLabel = (contract: Pick<ContractInput, 'transportMode' | 'airline'>) => contract.airline || (contract.transportMode === 'SEA' ? '不限船公司' : '不限航空公司');

function blank(customerId: string): ContractInput {
  return {
    customerId, number: '', status: 'ACTIVE', transportMode: 'AIR', routeScope: 'COUNTRY',
    originCountry: 'TW', destinationCountry: '', seaShipmentType: '', containerType: '', pricingBasis: 'PER_KG',
    origin: '', destination: '', airline: '', serviceType: '', commodity: '', effectiveDate: localDate(), expiryDate: '',
    currency: 'USD', rateType: 'BASE_PLUS', minimumCharge: '', normalRate: '',
    breaks: ['45', '100', '300', '500', '1000'].map(weight => ({ weight, rate: '' })), charges: [], remarks: '',
  };
}

function editableVersion(version: ContractVersion): Omit<ContractInput, 'customerId' | 'number' | 'status'> {
  const { id: _id, contractId: _contractId, version: _version, ...fields } = version;
  return {
    ...fields, transportMode: fields.transportMode ?? 'AIR', routeScope: fields.routeScope ?? 'AIRPORT',
    pricingBasis: fields.pricingBasis ?? 'PER_KG', originCountry: fields.originCountry ?? '', destinationCountry: fields.destinationCountry ?? '',
    seaShipmentType: fields.seaShipmentType ?? '', containerType: fields.containerType ?? '',
  };
}

export default function Contracts({ customers, contracts, customerFilter, onFilter, onChanged }: {
  customers: Customer[]; contracts: ContractRecord[]; customerFilter: string;
  onFilter: (id: string) => void; onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<ContractInput | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pricingNotice, setPricingNotice] = useState('');
  const [view, setView] = useState<{ record: ContractRecord; version: ContractVersion } | null>(null);

  function patch<K extends keyof ContractInput>(key: K, value: ContractInput[K]) {
    setForm(current => current ? { ...current, [key]: value } : current);
  }

  function openVersion(contract: ContractRecord, version: ContractVersion, copy = false) {
    const fields = editableVersion(version);
    setEditId(copy ? null : contract.id);
    setForm({
      ...fields, customerId: contract.customerId, number: copy ? '' : contract.number, status: copy ? 'ACTIVE' : contract.status,
      charges: fields.charges.map(({ id, ...charge }) => copy ? charge : { ...charge, id }),
    });
    setView(null); setError(''); setPricingNotice('');
  }

  function changeTransport(transportMode: TransportMode) {
    if (!form || transportMode === form.transportMode) return;
    const pricingBasis: FreightBasis = transportMode === 'AIR' ? 'PER_KG' : 'PER_CBM';
    setForm({
      ...form, transportMode, routeScope: 'COUNTRY', originCountry: form.originCountry || '', destinationCountry: form.destinationCountry || '',
      origin: form.routeScope === 'COUNTRY' ? form.origin : '', destination: form.routeScope === 'COUNTRY' ? form.destination : '',
      airline: '', seaShipmentType: transportMode === 'SEA' ? 'LCL' : '', containerType: '', pricingBasis,
      minimumCharge: '', normalRate: '', breaks: [], charges: form.charges.filter(charge => commonChargeBases.includes(charge.basis)),
    });
    setPricingNotice('已切換運輸模式。請重新填寫此模式的運價與級距；不同單位的附加費已移除，每票、每件及固定費用保留。');
  }

  function changeSeaType(seaShipmentType: SeaShipmentType) {
    if (!form || seaShipmentType === form.seaShipmentType) return;
    setForm({
      ...form, seaShipmentType, containerType: seaShipmentType === 'FCL' ? '20GP' : '',
      pricingBasis: seaShipmentType === 'FCL' ? 'PER_CONTAINER' : 'PER_CBM', minimumCharge: '', normalRate: '', breaks: [],
      charges: form.charges.filter(charge => commonChargeBases.includes(charge.basis)),
    });
    setPricingNotice('已切換海運計價單位。請重新填寫運價與級距；不同單位的附加費已移除，每票、每件及固定費用保留。');
  }

  function chargePatch(index: number, key: keyof ChargeInput, value: string | boolean) {
    if (!form) return;
    patch('charges', form.charges.map((charge, current) => current === index ? { ...charge, [key]: value } : charge));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!form) return;
    setBusy(true); setError('');
    try {
      const body = {
        ...form, breaks: form.breaks.filter(tier => tier.rate.trim() !== ''),
        charges: form.charges.map(charge => ({ ...charge, minimumAmount: charge.minimumAmount || undefined, manualAmount: charge.manualAmount || undefined })),
      };
      await api(`contracts${editId ? `/${editId}` : ''}`, editId ? 'PUT' : 'POST', body);
      await onChanged(); setForm(null);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  async function toggle(contract: ContractRecord) {
    const version = newest(contract); if (!version) return;
    setError('');
    try {
      await api(`contracts/${contract.id}`, 'PUT', {
        ...editableVersion(version), customerId: contract.customerId, number: contract.number,
        status: contract.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      await onChanged();
    } catch (cause) { setError((cause as Error).message); }
  }

  const filtered = contracts.filter(contract => {
    const version = newest(contract);
    const expired = !!version && version.expiryDate < localDate();
    const terms = `${contract.number} ${version ? routeLabel(version) : ''} ${version?.originCountry} ${version?.destinationCountry} ${version?.origin} ${version?.destination} ${version?.airline} ${modeName(version?.transportMode)} ${version?.transportMode ?? 'AIR'} ${version?.effectiveDate} ${version?.expiryDate} ${customers.find(customer => customer.id === contract.customerId)?.name}`;
    return (!customerFilter || contract.customerId === customerFilter) && (!mode || (version?.transportMode ?? 'AIR') === mode)
      && (!status || (status === 'EXPIRED' ? expired : contract.status === status)) && terms.toLowerCase().includes(query.toLowerCase());
  });
  const pricingBasis = form ? basisOf(form) : 'PER_KG';
  const unit = freightUnits[pricingBasis];
  const availableChargeBases: ChargeBasis[] = form?.transportMode === 'SEA'
    ? ['PER_CBM', ...(form.seaShipmentType === 'FCL' ? ['PER_CONTAINER' as const] : []), 'PER_KG', ...commonChargeBases]
    : ['PER_KG', 'PER_CBM', ...commonChargeBases];
  const countryScope = form?.routeScope === 'COUNTRY';

  return <>
    <div className="toolbar">
      <div className="search-group">
        <input aria-label="搜尋合約" placeholder="搜尋合約、國家、航線、承運人或日期" value={query} onChange={event => setQuery(event.target.value)} />
        <select aria-label="合約客戶篩選" value={customerFilter} onChange={event => onFilter(event.target.value)}><option value="">全部客戶</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select>
        <select aria-label="合約運輸模式篩選" value={mode} onChange={event => setMode(event.target.value)}><option value="">全部運輸模式</option><option value="AIR">空運 Air</option><option value="SEA">海運 Sea</option></select>
        <select aria-label="合約狀態" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部狀態</option><option value="ACTIVE">啟用</option><option value="INACTIVE">停用</option><option value="EXPIRED">已過期</option></select>
      </div>
      <button className="btn" disabled={!customers.length} onClick={() => { setEditId(null); setForm(blank(customerFilter || customers.find(customer => customer.status === 'ACTIVE')?.id || '')); setError(''); setPricingNotice(''); setView(null); }}>＋ 新增合約 / 航線</button>
    </div>
    {error && <div role="alert" className="alert danger">{error}</div>}
    {form && <form onSubmit={save} className="panel">
      <div className="section-title"><h2>{editId ? '建立合約新版本' : '新增客戶合約運價'}</h2><span className="muted">每份合約一條航線；編輯後保留歷史版本</span></div>
      <div className="form-grid">
        <Field label="客戶 *"><select required value={form.customerId} disabled={!!editId} onChange={event => patch('customerId', event.target.value)}><option value="">請選擇</option>{customers.filter(customer => customer.status === 'ACTIVE' || customer.id === form.customerId).map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></Field>
        <Field label="Contract Number *"><input required value={form.number} disabled={!!editId} onChange={event => patch('number', event.target.value)} /></Field>
        <Field label="運輸模式"><select value={form.transportMode ?? 'AIR'} onChange={event => changeTransport(event.target.value as TransportMode)}><option value="AIR">空運 Air</option><option value="SEA">海運 Sea</option></select></Field>
        <Field label="運價適用範圍"><select value={form.routeScope ?? 'AIRPORT'} disabled={form.transportMode === 'SEA'} onChange={event => patch('routeScope', event.target.value as ContractInput['routeScope'])}><option value="COUNTRY">國家對國家（全國適用）</option>{form.transportMode !== 'SEA' && <option value="AIRPORT">機場對機場（IATA）</option>}</select></Field>
        {countryScope && <>
          <Field label="起運國家 *"><CountrySelect label="合約起運國家" required value={form.originCountry ?? ''} onChange={value => patch('originCountry', value)} /></Field>
          <Field label="目的國家 *"><CountrySelect label="合約目的國家" required value={form.destinationCountry ?? ''} onChange={value => patch('destinationCountry', value)} /></Field>
        </>}
        <Field label={countryScope ? '起運機場／城市／港口備註（選填）' : '起運機場 Origin *'}><input required={!countryScope} placeholder={countryScope ? '僅供備註，不限制國家運價' : 'IATA，如 TPE'} maxLength={countryScope ? 120 : 3} value={form.origin} onChange={event => patch('origin', countryScope ? event.target.value : event.target.value.toUpperCase())} /></Field>
        <Field label={countryScope ? '目的機場／城市／港口備註（選填）' : '目的機場 Destination *'}><input required={!countryScope} placeholder={countryScope ? '任意地區適用相同國家運價' : 'IATA，如 LAX'} maxLength={countryScope ? 120 : 3} value={form.destination} onChange={event => patch('destination', countryScope ? event.target.value : event.target.value.toUpperCase())} /></Field>
        {form.transportMode === 'SEA' && <>
          <Field label="海運類型"><select value={form.seaShipmentType || 'LCL'} onChange={event => changeSeaType(event.target.value as SeaShipmentType)}><option value="LCL">併櫃 LCL · 每 CBM</option><option value="FCL">整櫃 FCL · 每櫃</option></select></Field>
          {form.seaShipmentType === 'FCL' && <Field label="適用櫃型 *"><select required value={form.containerType || ''} onChange={event => patch('containerType', event.target.value as ContainerType)}><option value="">請選擇</option><option value="20GP">20GP</option><option value="40GP">40GP</option><option value="40HQ">40HQ</option></select></Field>}
        </>}
        <Field label={form.transportMode === 'SEA' ? '船公司（空白為不限）' : '航空公司 Airline（空白為不限）'}><input value={form.airline} onChange={event => patch('airline', event.target.value)} /></Field>
        <Field label="Service Type（空白為不限）"><input value={form.serviceType} onChange={event => patch('serviceType', event.target.value)} /></Field>
        <Field label="Commodity（空白為不限）"><input value={form.commodity} onChange={event => patch('commodity', event.target.value)} /></Field>
        <Field label="有效起日 *"><input required type="date" value={form.effectiveDate} onChange={event => patch('effectiveDate', event.target.value)} /></Field>
        <Field label="有效迄日 *"><input required type="date" value={form.expiryDate} min={form.effectiveDate} onChange={event => patch('expiryDate', event.target.value)} /></Field>
        <Field label="幣別"><select value={form.currency} onChange={event => patch('currency', event.target.value as Currency)}><option>USD</option><option>TWD</option></select></Field>
        <Field label="Rate Type"><select value={form.rateType} onChange={event => patch('rateType', event.target.value as ContractInput['rateType'])}><option value="BASE_PLUS">Base Freight + Surcharges</option><option value="ALL_IN">All-in Rate</option></select></Field>
        <Field label="計價單位"><input readOnly value={freightBasisLabels[pricingBasis]} /></Field>
        <Field label="合約狀態"><select value={form.status} onChange={event => patch('status', event.target.value as ContractInput['status'])}><option value="ACTIVE">啟用</option><option value="INACTIVE">停用</option></select></Field>
      </div>
      {countryScope && <p className="muted">國家運價適用目的國所有地區，機場、城市或港口備註不影響選價。派送、清關等費用是否包含，請逐項設定附加費「已含」。</p>}
      {pricingNotice && <div role="status" className="alert warning">{pricingNotice}</div>}
      <div className="section-title"><h3>{pricingBasis === 'PER_KG' ? '重量級距運價' : '數量級距運價'} · {freightBasisLabels[pricingBasis]}</h3><button type="button" className="btn-secondary" onClick={() => patch('breaks', [...form.breaks, { weight: '', rate: '' }])}>＋ 自訂級距</button></div>
      <p className="muted">選用不超過計費數量的最高級距，單一運價 × 全部計費數量。未達任何級距時使用基本單價；未填價格的級距不儲存。{pricingBasis === 'PER_KG' ? ' 不使用 Weight Break Optimization。' : ''}</p>
      <div className="rate-special">
        <Field label="MIN 最低總收費（固定金額）"><input inputMode="decimal" placeholder="未設定" value={form.minimumCharge} onChange={event => patch('minimumCharge', event.target.value)} /></Field>
        <Field label={`基本單價 Normal Rate · ${form.currency}/${unit}`}><input inputMode="decimal" placeholder="請填實際合約單價" value={form.normalRate} onChange={event => patch('normalRate', event.target.value)} /></Field>
      </div>
      <div className="table-wrap"><table className="input-table"><thead><tr><th>數量下限 {unit}（含）</th><th>單價 {form.currency}/{unit}</th><th>操作</th></tr></thead><tbody>{form.breaks.map((tier, index) => <tr key={index}>
        <td><input aria-label={`級距數量 ${index + 1}`} required={tier.rate.trim() !== ''} inputMode={pricingBasis === 'PER_CONTAINER' ? 'numeric' : 'decimal'} value={tier.weight} onChange={event => patch('breaks', form.breaks.map((current, currentIndex) => currentIndex === index ? { ...current, weight: event.target.value } : current))} /></td>
        <td><input aria-label={`級距價格 ${index + 1}`} inputMode="decimal" value={tier.rate} onChange={event => patch('breaks', form.breaks.map((current, currentIndex) => currentIndex === index ? { ...current, rate: event.target.value } : current))} /></td>
        <td><button type="button" className="text-danger" onClick={() => patch('breaks', form.breaks.filter((_, currentIndex) => currentIndex !== index))}>移除</button></td>
      </tr>)}</tbody></table>{!form.breaks.length && <Empty>未設定數量級距，將使用基本單價。</Empty>}</div>
      <div className="section-title"><h3>合約附加費</h3><button type="button" className="btn-secondary" onClick={() => patch('charges', [...form.charges, { name: '', basis: 'PER_SHIPMENT', rate: '', currency: form.currency, included: false }])}>＋ 新增費用</button></div>
      <p className="muted">每份合約自行標記已包含的費用；勾選「已含」會保留條件且不重複計收。選擇 All-in 不會自動勾選。最低金額為固定金額，可用於每單位附加費。{form.transportMode === 'SEA' && form.seaShipmentType === 'FCL' ? ' 整櫃合約若設定按 KG、CBM 或件數另收的費用，報價時須填寫貨物資料。' : ''}</p>
      <datalist id="charge-names">{chargeNames.map(name => <option key={name} value={name} />)}</datalist>
      <div className="table-wrap"><table className="input-table"><thead><tr><th>費用名稱</th><th>計價方式</th><th>運價 / 金額</th><th>幣別</th><th>最低金額</th><th>手動總額</th><th>已含</th><th></th></tr></thead><tbody>{form.charges.map((charge, index) => <tr key={index}>
        <td><input aria-label={`費用名稱 ${index + 1}`} required list="charge-names" value={charge.name} onChange={event => chargePatch(index, 'name', event.target.value)} /></td>
        <td><select aria-label={`計價方式 ${index + 1}`} value={charge.basis} onChange={event => chargePatch(index, 'basis', event.target.value)}>{[...new Set([...availableChargeBases, charge.basis])].map(basis => <option key={basis} value={basis}>{chargeBasisLabels[basis]}</option>)}</select></td>
        <td><input aria-label={`費用運價 ${index + 1}`} required value={charge.rate} inputMode="decimal" onChange={event => chargePatch(index, 'rate', event.target.value)} /></td>
        <td><select aria-label={`費用幣別 ${index + 1}`} value={charge.currency} onChange={event => chargePatch(index, 'currency', event.target.value)}><option>USD</option><option>TWD</option></select></td>
        <td><input aria-label={`最低金額 ${index + 1}`} value={charge.minimumAmount || ''} inputMode="decimal" onChange={event => chargePatch(index, 'minimumAmount', event.target.value)} /></td>
        <td><input aria-label={`手動總額 ${index + 1}`} disabled={charge.basis !== 'MANUAL'} value={charge.manualAmount || ''} inputMode="decimal" onChange={event => chargePatch(index, 'manualAmount', event.target.value)} /></td>
        <td><input aria-label={`已包含 ${index + 1}`} type="checkbox" checked={charge.included} onChange={event => chargePatch(index, 'included', event.target.checked)} /></td>
        <td><button type="button" className="text-danger" onClick={() => patch('charges', form.charges.filter((_, currentIndex) => currentIndex !== index))}>移除</button></td>
      </tr>)}</tbody></table>{!form.charges.length && <Empty>尚未設定附加費；請依合約明列派送與其他費用。</Empty>}</div>
      <div className="form-grid"><Field label="合約備註" wide><textarea value={form.remarks} onChange={event => patch('remarks', event.target.value)} /></Field></div>
      <div className="actions"><button className="btn" disabled={busy}>{busy ? '儲存中…' : editId ? '儲存為新版本' : '儲存合約'}</button><button type="button" className="btn-secondary" onClick={() => setForm(null)}>取消</button></div>
    </form>}
    {view && <div className="panel">
      <div className="section-title"><h2>合約版本紀錄 · {view.record.number}</h2><button className="btn-secondary" onClick={() => setView(null)}>關閉</button></div>
      <div className="toolbar"><label>版本 <select value={view.version.id} onChange={event => setView({ ...view, version: view.record.versions.find(version => version.id === event.target.value)! })}>{[...view.record.versions].sort((a, b) => b.version - a.version).map(version => <option key={version.id} value={version.id}>v{version.version} · {version.effectiveDate} — {version.expiryDate}</option>)}</select></label><Badge>歷史版本唯讀</Badge><button className="btn-secondary" onClick={() => openVersion(view.record, view.version, true)}>複製此版本為新合約</button></div>
      <p><strong>{modeName(view.version.transportMode)} · {routeLabel(view.version)}</strong> · {carrierLabel(view.version)} · {view.version.currency} · {view.version.rateType}</p>
      {view.version.transportMode === 'SEA' && <p>{view.version.seaShipmentType} {view.version.containerType} · {freightBasisLabels[basisOf(view.version)]}</p>}
      {view.version.routeScope === 'COUNTRY' && (view.version.origin || view.version.destination) && <p className="muted">地點備註：{view.version.origin || '未填'} → {view.version.destination || '未填'}（不限制國家運價）</p>}
      <p>Service: {view.version.serviceType || '不限'} / Commodity: {view.version.commodity || '不限'} / MIN: {view.version.minimumCharge ? `${view.version.currency} ${money(view.version.minimumCharge)}` : '—'} / 基本單價: {view.version.normalRate ? `${view.version.currency} ${money(view.version.normalRate)}/${freightUnits[basisOf(view.version)]}` : '—'}</p>
      <div className="table-wrap"><table><thead><tr><th>數量下限 {freightUnits[basisOf(view.version)]}（含）</th><th>單價 {view.version.currency}/{freightUnits[basisOf(view.version)]}</th></tr></thead><tbody>{view.version.breaks.map(tier => <tr key={tier.weight}><td>+{tier.weight} {freightUnits[basisOf(view.version)]}</td><td>{money(tier.rate)}</td></tr>)}</tbody></table>
        <table><thead><tr><th>附加費</th><th>計價</th><th>運價</th><th>已包含</th></tr></thead><tbody>{view.version.charges.map((charge, index) => <tr key={index}><td>{charge.name}</td><td>{chargeBasisLabels[charge.basis]}</td><td>{charge.currency} {charge.rate}{charge.basis === 'MANUAL' ? ` / 手動 ${charge.manualAmount || '未填'}` : ''}{charge.minimumAmount ? ` / 最低 ${charge.minimumAmount}` : ''}</td><td>{charge.included ? '是' : '否'}</td></tr>)}</tbody></table>
      </div><p className="muted">{view.version.remarks || '無合約備註'}</p>
    </div>}
    <div className="panel table-wrap"><table><thead><tr><th>合約 / 版本</th><th>客戶</th><th>運輸模式 / 航線 / 承運人</th><th>有效期間</th><th>運價 / 計價單位</th><th>狀態</th><th>操作</th></tr></thead><tbody>{filtered.map(contract => {
      const version = newest(contract);
      return <tr key={contract.id}>
        <td><strong>{contract.number}</strong><small>v{version?.version} · {contract.versions.length} 個版本</small></td>
        <td>{customers.find(customer => customer.id === contract.customerId)?.name || contract.customerId}</td>
        <td><Badge>{modeName(version?.transportMode)}</Badge><div>{version ? routeLabel(version) : '尚無版本'}</div><small>{version ? carrierLabel(version) : ''}{version?.transportMode === 'SEA' ? ` · ${version.seaShipmentType} ${version.containerType || ''}` : ''}</small></td>
        <td>{version?.effectiveDate}<small>至 {version?.expiryDate}</small></td>
        <td>{version?.currency} {version?.rateType === 'ALL_IN' ? 'All-in' : 'Base + Surcharges'}<small>{version ? freightBasisLabels[basisOf(version)] : ''}</small></td>
        <td><Badge tone={contract.status === 'ACTIVE' && version?.expiryDate >= localDate() ? 'success' : 'warning'}>{contract.status === 'INACTIVE' ? '停用' : version?.expiryDate < localDate() ? '已過期' : '啟用'}</Badge></td>
        <td><div className="row-actions"><button disabled={!version} onClick={() => openVersion(contract, version)}>編輯</button><button disabled={!version} onClick={() => openVersion(contract, version, true)}>複製 / 新航線</button><button disabled={!version} onClick={() => { setView({ record: contract, version }); setForm(null); }}>版本</button><button disabled={!version} onClick={() => toggle(contract)}>{contract.status === 'ACTIVE' ? '停用' : '啟用'}</button></div></td>
      </tr>;
    })}</tbody></table>{!filtered.length && <Empty>沒有符合條件的合約。請先新增客戶，再建立實際合約運價。</Empty>}</div>
  </>;
}
