'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CargoItem, ChargeBasis, ChargeInput, ContractCandidate, CostInput, Currency, Customer, QuoteInput, QuoteRecord, QuoteSnapshot, RouteScope, SeaShipmentType, Settings, TransportMode } from '@/lib/types';
import { calculateWeights } from '@/lib/engine';
import { COUNTRIES } from '@/lib/countries';
import { chargeBasisLabels, freightBasisLabels, modeName, routeLabel } from '@/lib/transport';
import { readQuoteDraft, writeQuoteDraft, clearSavedQuoteDraft, quoteDraftStorage } from '@/lib/quote-draft';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const emptyCargo = (): CargoItem => ({ pieces: 1, length: '', width: '', height: '', grossWeight: '', weightMode: 'GROUP_TOTAL' });
const basisLabels = chargeBasisLabels;
const curr = (value: string | null | undefined) => { if (value == null) return '—'; const [whole, fraction] = value.split('.'); return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction !== undefined ? `.${fraction}` : ''); };
async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '操作失敗，請重試');
  return data as T;
}
function initialInput(settings: Settings, initial: QuoteRecord | null): QuoteInput {
  if (initial) {
    const input = structuredClone(initial.snapshot.input);
    return { ...input, transportMode: input.transportMode ?? 'AIR', routeScope: input.routeScope ?? 'AIRPORT', originCountry: input.originCountry ?? '', destinationCountry: input.destinationCountry ?? '', seaShipmentType: input.seaShipmentType ?? '', containerType: input.containerType ?? '', containerCount: input.containerCount ?? 0, revisionOfId: initial.id, status: 'Draft' };
  }
  return { customerId: '', transportMode: 'AIR', routeScope: 'COUNTRY', originCountry: 'TW', destinationCountry: '', seaShipmentType: '', containerType: '', containerCount: 0, origin: '', destination: '', airline: '', serviceType: '', commodity: '', shipmentDate: today(), cargo: [emptyCargo()], contractVersionId: null, manualFreight: null, chargeOverrides: [], temporaryCharges: [], costs: [], costsComplete: false, analysisCurrency: settings.defaultCurrency, fxRate: settings.exchangeRate, fxDate: settings.exchangeRateDate, validity: '', remarks: '', terms: settings.terms, status: 'Draft', revisionOfId: null };
}

export default function QuoteEditor({ customers, settings, initial, onSaved }: { customers: Customer[]; settings: Settings; initial: QuoteRecord | null; onSaved: (record: QuoteRecord) => void }) {
  const [draft] = useState(() => {
    const base = initialInput(settings, initial);
    const restored = readQuoteDraft(quoteDraftStorage(), base.revisionOfId);
    return { input: restored ? { ...base, ...restored } : base, restored: restored !== null };
  });
  const [form, setForm] = useState<QuoteInput>(draft.input);
  const [draftAvailable, setDraftAvailable] = useState(true);
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [candidates, setCandidates] = useState<ContractCandidate[]>([]);
  const [matchState, setMatchState] = useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [snapshot, setSnapshot] = useState<QuoteSnapshot | null>(null);
  const [busy, setBusy] = useState<'preview'|'save'|null>(null);
  const [error, setError] = useState('');
  const [matchError, setMatchError] = useState('');
  const [retry, setRetry] = useState(0);
  const [savedNumber, setSavedNumber] = useState('');
  useEffect(() => { if (!savedNumber) setDraftAvailable(writeQuoteDraft(quoteDraftStorage(), form)); }, [form, savedNumber]);
  const revision = useRef(0);
  const isSea = form.transportMode === 'SEA';
  const isFcl = isSea && form.seaShipmentType === 'FCL';
  const isCountry = form.routeScope === 'COUNTRY';
  const routingKeys: (keyof QuoteInput)[] = ['customerId', 'transportMode', 'routeScope', 'originCountry', 'destinationCountry', 'seaShipmentType', 'containerType', 'origin', 'destination', 'airline', 'serviceType', 'commodity', 'shipmentDate'];
  function update(patch: Partial<QuoteInput>, resetMatch = false) {
    revision.current++;
    setForm(prev => ({ ...prev, ...patch, ...(resetMatch ? { contractVersionId: null, chargeOverrides: [], manualFreight: null } : {}) }));
    if (resetMatch) { setCandidates([]); setMatchState('idle'); }
    setSnapshot(null); setSavedNumber(''); setError('');
  }
  function change<K extends keyof QuoteInput>(key: K, value: QuoteInput[K]) { update({ [key]: value }, routingKeys.includes(key)); }
  function switchMode(mode: TransportMode) {
    if (mode === form.transportMode) return;
    update({ transportMode: mode, airline: '', routeScope: mode === 'SEA' ? 'COUNTRY' : form.routeScope, seaShipmentType: mode === 'SEA' ? 'LCL' : '', containerType: '', containerCount: 0, cargo: form.cargo.length ? form.cargo : [emptyCargo()], temporaryCharges: form.temporaryCharges.filter(charge => charge.basis !== 'PER_CONTAINER') }, true);
  }
  function switchScope(scope: RouteScope) {
    update({ routeScope: scope, origin: '', destination: '', originCountry: scope === 'COUNTRY' ? form.originCountry || 'TW' : '', destinationCountry: scope === 'COUNTRY' ? form.destinationCountry : '' }, true);
  }
  function switchSeaType(type: SeaShipmentType) {
    const cargoIsPlaceholder = form.cargo.length === 1 && !form.cargo[0].length && !form.cargo[0].width && !form.cargo[0].height && !form.cargo[0].grossWeight;
    update({ seaShipmentType: type, containerType: type === 'FCL' ? '20GP' : '', containerCount: type === 'FCL' ? 1 : 0, cargo: type === 'FCL' && cargoIsPlaceholder ? [] : form.cargo.length ? form.cargo : [emptyCargo()], temporaryCharges: type === 'FCL' ? form.temporaryCharges : form.temporaryCharges.filter(charge => charge.basis !== 'PER_CONTAINER') }, true);
  }
  const matchKey = JSON.stringify([form.customerId, form.transportMode, form.routeScope, form.originCountry, form.destinationCountry, form.seaShipmentType, form.containerType, form.origin, form.destination, form.airline, form.serviceType, form.commodity, form.shipmentDate]);
  useEffect(() => {
    const routeReady = form.routeScope === 'COUNTRY' ? Boolean(form.originCountry && form.destinationCountry) : Boolean(form.origin && form.destination);
    const containerReady = form.transportMode !== 'SEA' || form.seaShipmentType !== 'FCL' || Boolean(form.containerType);
    if (!form.customerId || !routeReady || !form.shipmentDate || !containerReady) { setCandidates([]); setMatchState('idle'); return; }
    const controller = new AbortController();
    setMatchState('loading'); setMatchError(''); setSnapshot(null);
    const timer = setTimeout(() => {
      post<ContractCandidate[]>('/api/match', { customerId: form.customerId, transportMode: form.transportMode, routeScope: form.routeScope, originCountry: form.originCountry, destinationCountry: form.destinationCountry, seaShipmentType: form.seaShipmentType, containerType: form.containerType, origin: form.origin, destination: form.destination, airline: form.airline, serviceType: form.serviceType, commodity: form.commodity, shipmentDate: form.shipmentDate }, controller.signal)
        .then(rows => {
          if (controller.signal.aborted) return;
          setCandidates(rows); setMatchState('ready');
          setForm(prev => {
            const stillValid = rows.some(row => row.id === prev.contractVersionId);
            const selected = stillValid ? prev.contractVersionId : rows.length === 1 && !initial ? rows[0].id : null;
            return { ...prev, contractVersionId: selected, chargeOverrides: stillValid ? prev.chargeOverrides : [], manualFreight: rows.length ? null : prev.manualFreight };
          });
        }).catch(err => { if (!controller.signal.aborted) { setMatchState('error'); setMatchError(err instanceof Error ? err.message : '合約匹配失敗'); } });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  // Match only on shipment conditions; changing financial inputs must not erase the selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, retry]);
  const selected = candidates.find(c => c.id === form.contractVersionId);
  const weights = useMemo(() => { try { return calculateWeights(form.cargo, settings, form.transportMode ?? 'AIR'); } catch { return null; } }, [form.cargo, settings, form.transportMode]);
  function cargoChange(index: number, patch: Partial<CargoItem>) { change('cargo', form.cargo.map((row,i) => i === index ? { ...row, ...patch } : row)); }
  function costChange(index: number, patch: Partial<CostInput>) { change('costs', form.costs.map((row,i) => i === index ? { ...row, ...patch } : row)); }
  function chargeChange(index: number, patch: Partial<ChargeInput>) { change('temporaryCharges', form.temporaryCharges.map((row,i) => i === index ? { ...row, ...patch } : row)); }
  function override(id: string, patch: {rate?:string; manualAmount?:string}) {
    const original = selected?.charges.find(c => c.id === id);
    const old = form.chargeOverrides.find(c => c.chargeId === id);
    change('chargeOverrides', [...form.chargeOverrides.filter(c => c.chargeId !== id), { chargeId: id, rate: old?.rate ?? original?.rate ?? '', manualAmount: old?.manualAmount ?? original?.manualAmount, ...patch }]);
  }
  const cargoReady = weights !== null && (isFcl || form.cargo.length > 0);
  const containerReady = !isFcl || Number.isInteger(form.containerCount) && (form.containerCount ?? 0) > 0;
  const canCalculate = matchState === 'ready' && cargoReady && containerReady && (candidates.length === 0 ? Boolean(form.manualFreight && form.manualFreight.amount !== '') : Boolean(selected));
  async function preview() {
    setBusy('preview'); setError(''); const current = revision.current;
    try {
      const data = await post<QuoteSnapshot>('/api/preview', form);
      if (mounted.current && revision.current === current) setSnapshot(data);
    } catch (err) {
      if (mounted.current && revision.current === current) setError(err instanceof Error ? err.message : '試算失敗');
    } finally { if (mounted.current) setBusy(null); }
  }
  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    const submitted = form;
    setBusy('save'); setError('');
    try {
      const record = await post<QuoteRecord>('/api/quotes', submitted);
      clearSavedQuoteDraft(quoteDraftStorage(), submitted);
      if (mounted.current) { setSavedNumber(`${record.number} · R${record.revision}`); setSnapshot(record.snapshot); }
      try { onSaved(record); }
      catch { if (mounted.current) setError('報價已儲存，但畫面更新失敗。請到報價紀錄查看，避免重複儲存。'); }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : '儲存失敗');
    } finally { submitting.current = false; if (mounted.current) setBusy(null); }
  }
  return <div className="quote-editor">
    {draft.restored && !savedNumber && <div role="status" className="alert">已恢復此分頁的未儲存報價草稿。儲存前請重新試算並確認合約。</div>}
    {!draftAvailable && <div role="status" className="alert warning">此瀏覽器目前無法暫存草稿，重整或離開前請先儲存報價。</div>}
    {initial && <div className="alert">修訂 {initial.number} · R{initial.revision}：儲存時建立新修訂版本，原始報價保留。請重新確認目前適用合約及價格。</div>}
    {error && <div role="alert" className="alert error">{error}</div>}
    {savedNumber && <div className="alert success">已儲存 {savedNumber}，可在報價紀錄下載 PDF。</div>}
    <fieldset disabled={busy === 'save'} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
    <section className="panel">
      <h3 className="section-title">1. 客戶與運輸條件</h3>
      <div className="form-grid">
        <label className="field">客戶 Customer<select value={form.customerId} onChange={e => { const customer = customers.find(c=>c.id===e.target.value); update({ customerId: e.target.value, ...(customer ? { analysisCurrency: customer.defaultCurrency } : {}) }, true); }}><option value="">選擇啟用中的客戶</option>{customers.filter(c=>c.status==='ACTIVE').map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
        <label className="field">運輸模式 Transport Mode<select value={form.transportMode ?? 'AIR'} onChange={e=>switchMode(e.target.value as TransportMode)}><option value="AIR">空運 Air</option><option value="SEA">海運 Sea</option></select></label>
        <label className="field">航線定價範圍<select value={form.routeScope ?? 'AIRPORT'} onChange={e=>switchScope(e.target.value as RouteScope)}><option value="COUNTRY">國家到國家（全國適用）</option>{!isSea && <option value="AIRPORT">機場到機場</option>}</select></label>
        {isCountry ? <>
          <label className="field">起運國家 Origin Country<select required value={form.originCountry ?? ''} onChange={e=>change('originCountry',e.target.value)}><option value="">選擇起運國家</option>{COUNTRIES.map(country=><option key={country.code} value={country.code}>{country.code} · {country.name}</option>)}</select></label>
          <label className="field">目的國家 Destination Country<select required value={form.destinationCountry ?? ''} onChange={e=>change('destinationCountry',e.target.value)}><option value="">選擇目的國家</option>{COUNTRIES.map(country=><option key={country.code} value={country.code}>{country.code} · {country.name}</option>)}</select></label>
          <label className="field">起運地／港口（選填）<input maxLength={120} placeholder="如台北、基隆港" value={form.origin} onChange={e=>change('origin',e.target.value)}/></label>
          <label className="field">目的地／港口（選填）<input maxLength={120} placeholder="如洛杉磯、紐約或其他地區" value={form.destination} onChange={e=>change('destination',e.target.value)}/></label>
        </> : <>
          <label className="field">起運機場 Origin<input maxLength={3} placeholder="TPE" value={form.origin} onChange={e=>change('origin',e.target.value.toUpperCase())}/></label>
          <label className="field">目的機場 Destination<input maxLength={3} placeholder="LAX" value={form.destination} onChange={e=>change('destination',e.target.value.toUpperCase())}/></label>
        </>}
        {isSea && <label className="field">海運型態<select value={form.seaShipmentType || 'LCL'} onChange={e=>switchSeaType(e.target.value as SeaShipmentType)}><option value="LCL">併櫃 LCL · 每 CBM</option><option value="FCL">整櫃 FCL · 每櫃</option></select></label>}
        {isFcl && <>
          <label className="field">櫃型 Container Type<select value={form.containerType || '20GP'} onChange={e=>change('containerType',e.target.value as QuoteInput['containerType'])}><option value="20GP">20GP</option><option value="40GP">40GP</option><option value="40HQ">40HQ</option></select></label>
          <label className="field">貨櫃數量 Container Count<input required type="number" min="1" max="1000000" step="1" value={form.containerCount ?? 1} onChange={e=>change('containerCount',Number(e.target.value))}/></label>
        </>}
        <label className="field">出貨日期<input type="date" value={form.shipmentDate} onChange={e=>change('shipmentDate',e.target.value)}/></label>
        <label className="field">承運人 Carrier<input placeholder="航空公司／船公司，依合約填寫" value={form.airline} onChange={e=>change('airline',e.target.value.toUpperCase())}/></label>
        <label className="field">服務類型 Service Type<input placeholder="依合約條件填寫" value={form.serviceType} onChange={e=>change('serviceType',e.target.value)}/></label>
        <label className="field">貨物種類 Commodity<input value={form.commodity} onChange={e=>change('commodity',e.target.value)}/></label>
        <label className="field">報價有效日期<input type="date" value={form.validity} onChange={e=>change('validity',e.target.value)}/></label>
        <label className="field">報價狀態<select value={form.status} onChange={e=>change('status',e.target.value as QuoteInput['status'])}>{['Draft','Quoted','Accepted','Rejected','Expired'].map(s=><option key={s}>{s}</option>)}</select></label>
      </div>
      {isCountry && <p className="muted">國家價適用目的國內任意地區，選填城市或港口不影響合約匹配。派送費與其他附加費是否包含，依所選合約明細。</p>}
    </section>
    <section className="panel">
      <h3 className="section-title">2. 貨物資料 Cargo Details</h3>
      <p className="muted">{isSea ? '尺寸單位 cm，重量單位 kg。海運依實際體積 CBM 或貨櫃數量計價；每公斤附加費依實際總重計算。' : `尺寸單位 cm，重量單位 kg。重量欄位可選「每件」或「該組總重」；系統加總後才依 ${settings.weightIncrement} kg 進位，材積除數 ${settings.volumeDivisor}。`}</p>
      {isFcl && <p className="muted">整櫃運費依 {form.containerType} × {form.containerCount ?? 1} 櫃計算。貨物件數、尺寸與重量可暫不提供；需要依貨物數量計費的另計附加費時，請新增完整貨物資料。</p>}
      {form.cargo.length === 0 && <div className="alert">貨物資料未提供；整櫃基本運費仍可依櫃型與數量試算。</div>}
      {form.cargo.length > 0 && <div className="table-wrap"><table><thead><tr><th>件數</th><th>長 cm</th><th>寬 cm</th><th>高 cm</th><th>重量輸入模式</th><th>實際重量 kg</th><th></th></tr></thead><tbody>{form.cargo.map((row,i)=><tr key={i}>
        <td><input aria-label={`貨物 ${i+1} 件數`} required type="number" min="1" max="1000000" step="1" value={row.pieces} onChange={e=>cargoChange(i,{pieces:Number(e.target.value)})}/></td>
        {(['length','width','height'] as const).map(key=><td key={key}><input aria-label={`貨物 ${i+1} ${key}`} required type="number" min="0.00000001" step="any" value={row[key]} onChange={e=>cargoChange(i,{[key]:e.target.value})}/></td>)}
        <td><select aria-label={`貨物 ${i+1} 重量模式`} value={row.weightMode} onChange={e=>cargoChange(i,{weightMode:e.target.value as CargoItem['weightMode']})}><option value="GROUP_TOTAL">該組總重</option><option value="PER_PIECE">每件重量</option></select></td>
        <td><input aria-label={`貨物 ${i+1} 實際重量`} required type="number" min="0" step="any" value={row.grossWeight} onChange={e=>cargoChange(i,{grossWeight:e.target.value})}/></td>
        <td><button type="button" className="btn btn-secondary" disabled={!isFcl && form.cargo.length===1} onClick={()=>change('cargo',form.cargo.filter((_,n)=>n!==i))}>移除</button></td>
      </tr>)}</tbody></table></div>}
      <button type="button" className="btn btn-secondary" onClick={()=>change('cargo',[...form.cargo,emptyCargo()])}>＋ 新增貨物列</button>
      <div className="stat-grid" style={{marginTop:16}}><div className="stat"><span>總件數</span><strong>{form.cargo.length === 0 ? '未提供' : weights?.pieces ?? '—'}</strong></div><div className="stat"><span>實際總重 Gross</span><strong>{form.cargo.length === 0 ? '未提供' : `${curr(weights?.grossWeight)} kg`}</strong></div><div className="stat"><span>體積 CBM</span><strong>{form.cargo.length === 0 ? '未提供' : curr(weights?.cbm)}</strong></div>{!isSea && <><div className="stat"><span>材積重量 Volume</span><strong>{curr(weights?.volumeWeight)} kg</strong></div><div className="stat"><span>計費重量 Chargeable</span><strong>{curr(weights?.chargeableWeight)} kg</strong></div></>}</div>
    </section>
    <section className="panel">
      <h3 className="section-title">3. 客戶合約與應收費用</h3>
      {matchState==='idle' && <p className="muted">填寫客戶、{isCountry ? '起運國家、目的國家' : '起運機場、目的機場'}及出貨日期後，自動查詢有效合約。</p>}
      {matchState==='loading' && <p role="status">正在匹配有效合約…</p>}
      {matchState==='error' && <div className="alert error">{matchError} <button type="button" className="btn btn-secondary" onClick={()=>setRetry(n=>n+1)}>重新查詢</button></div>}
      {matchState==='ready' && candidates.length===0 && <><div className="alert">No Valid Contract Rate — 沒有符合條件的有效合約。請手動輸入本次非合約售價；系統不會以成本代替售價。</div><div className="form-grid">
        <label className="field">非合約基本運費（整票金額）<input type="number" min="0" step="any" value={form.manualFreight?.amount ?? ''} onChange={e=>change('manualFreight',{amount:e.target.value,currency:form.manualFreight?.currency??form.analysisCurrency})}/></label>
        <label className="field">基本運費幣別<select value={form.manualFreight?.currency??form.analysisCurrency} onChange={e=>change('manualFreight',{amount:form.manualFreight?.amount??'',currency:e.target.value as Currency})}><option>USD</option><option>TWD</option></select></label>
      </div></>}
      {matchState==='ready' && candidates.length>0 && <><p className="muted">找到 {candidates.length} 份有效合約。承運人專屬合約優先；多份候選須由使用者確認。</p><div className="table-wrap"><table><thead><tr><th>選用</th><th>合約 / 版本</th><th>運輸 / 航線</th><th>承運人 / 服務 / 貨物</th><th>有效期間</th><th>費率類型 / 單位</th></tr></thead><tbody>{candidates.map(c=><tr key={c.id}><td><input aria-label={`選用 ${c.number} v${c.version}`} type="radio" name="contract" checked={form.contractVersionId===c.id} onChange={()=>update({contractVersionId:c.id,chargeOverrides:[],manualFreight:null})}/></td><td>{c.number} · v{c.version}</td><td>{modeName(c.transportMode)}{c.transportMode==='SEA' && ` · ${c.seaShipmentType}${c.containerType ? ` · ${c.containerType}` : ''}`}<br/>{routeLabel(c)}</td><td>{c.airline||'不限'} / {c.serviceType||'不限'} / {c.commodity||'不限'}</td><td>{c.effectiveDate} ～ {c.expiryDate}</td><td>{c.rateType==='ALL_IN'?'All-in':'Base + Surcharges'} · {c.currency}<br/>{freightBasisLabels[c.pricingBasis ?? (c.transportMode==='SEA' ? c.seaShipmentType==='FCL' ? 'PER_CONTAINER' : 'PER_CBM' : 'PER_KG')]}</td></tr>)}</tbody></table></div></>}
      {selected && <><p>計價單位：{freightBasisLabels[selected.pricingBasis ?? (isSea ? isFcl ? 'PER_CONTAINER' : 'PER_CBM' : 'PER_KG')]} · 最低運費 {selected.minimumCharge||'未設定'} {selected.currency} · 一般單價 {selected.normalRate||'未設定'} {selected.currency} · 數量級距 {selected.breaks.map(b=>`+${b.weight}: ${b.rate}`).join(' / ')||'未設定'}</p>
      {selected.charges.length>0 && <div className="table-wrap"><table><thead><tr><th>合約費用</th><th>計價方式</th><th>幣別</th><th>原合約價格</th><th>本次套用價格</th><th>原手動金額 / 本次金額</th><th>包含於運價</th></tr></thead><tbody>{selected.charges.map((charge,i)=>{const adjustment=form.chargeOverrides.find(o=>o.chargeId===charge.id);return <tr key={charge.id??i}><td>{charge.name}</td><td>{basisLabels[charge.basis]}</td><td>{charge.currency}</td><td>{charge.rate}</td><td><input aria-label={`調整 ${charge.name} 單價`} disabled={charge.included||!charge.id} type="number" min="0" step="any" value={adjustment?.rate??charge.rate} onChange={e=>charge.id&&override(charge.id,{rate:e.target.value})}/></td><td>{charge.basis==='MANUAL'?<><small>原：{charge.manualAmount||'未設定'}</small><input aria-label={`${charge.name} 本次手動金額`} disabled={charge.included||!charge.id} type="number" min="0" step="any" value={adjustment?.manualAmount??charge.manualAmount??''} onChange={e=>charge.id&&override(charge.id,{manualAmount:e.target.value})}/></>:'—'}</td><td>{charge.included?'已包含，不重複計收':'另計'}</td></tr>;})}</tbody></table></div>}</>}
      <h4>臨時應收費用</h4>
      {isSea && <p className="muted">海運每公斤附加費使用實際總重；每 CBM 使用實際體積；每櫃僅適用整櫃 FCL。合約標記「已包含」的費用不會重複計收。</p>}
      {form.temporaryCharges.length>0 && <div className="table-wrap"><table><thead><tr><th>費用名稱</th><th>方式</th><th>單價 / 固定額</th><th>手動金額</th><th>最低收費</th><th>幣別</th><th></th></tr></thead><tbody>{form.temporaryCharges.map((charge,i)=><tr key={i}><td><input aria-label="臨時費用名稱" value={charge.name} onChange={e=>chargeChange(i,{name:e.target.value})}/></td><td><select aria-label={`臨時費用 ${i+1} 計價方式`} value={charge.basis} onChange={e=>chargeChange(i,{basis:e.target.value as ChargeBasis})}>{Object.entries(basisLabels).filter(([value])=>value!=='PER_CONTAINER'||isFcl).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></td><td><input aria-label="臨時費用單價" type="number" min="0" step="any" value={charge.rate} onChange={e=>chargeChange(i,{rate:e.target.value})}/></td><td><input aria-label="臨時費用手動金額" disabled={charge.basis!=='MANUAL'} type="number" min="0" step="any" value={charge.manualAmount??''} onChange={e=>chargeChange(i,{manualAmount:e.target.value})}/></td><td><input aria-label="臨時費用最低收費" type="number" min="0" step="any" value={charge.minimumAmount??''} onChange={e=>chargeChange(i,{minimumAmount:e.target.value})}/></td><td><select value={charge.currency} onChange={e=>chargeChange(i,{currency:e.target.value as Currency})}><option>USD</option><option>TWD</option></select></td><td><button type="button" className="btn btn-secondary" onClick={()=>change('temporaryCharges',form.temporaryCharges.filter((_,n)=>n!==i))}>移除</button></td></tr>)}</tbody></table></div>}
      <button type="button" className="btn btn-secondary" onClick={()=>change('temporaryCharges',[...form.temporaryCharges,{name:'',basis:'PER_SHIPMENT',rate:'',currency:form.analysisCurrency,included:false}])}>＋ 新增臨時應收費用</button>
    </section>
    <section className="panel">
      <h3 className="section-title">4. 內部成本與分析幣別</h3>
      <p className="muted">內部資料不會出現在客戶 PDF。金額留白表示成本尚未提供，並非零；預估成本將標記暫估毛利。</p>
      <div className="table-wrap"><table><thead><tr><th>成本項目</th><th>金額</th><th>幣別</th><th>成本狀態</th><th></th></tr></thead><tbody>{form.costs.map((cost,i)=><tr key={i}><td><input aria-label={`成本 ${i+1} 名稱`} list="cost-names" value={cost.name} onChange={e=>costChange(i,{name:e.target.value})}/></td><td><input aria-label={`成本 ${i+1} 金額`} type="number" min="0" step="any" placeholder="未提供" value={cost.amount??''} onChange={e=>costChange(i,{amount:e.target.value===''?null:e.target.value})}/></td><td><select value={cost.currency} onChange={e=>costChange(i,{currency:e.target.value as Currency})}><option>USD</option><option>TWD</option></select></td><td><select value={cost.status} onChange={e=>costChange(i,{status:e.target.value as CostInput['status']})}><option value="ESTIMATED">Estimated 預估</option><option value="ACTUAL">Actual 實際</option></select></td><td><button type="button" className="btn btn-secondary" onClick={()=>change('costs',form.costs.filter((_,n)=>n!==i))}>移除</button></td></tr>)}</tbody></table></div>
      <datalist id="cost-names">{['Carrier Freight Cost','Fuel Cost','Security Cost','Terminal Cost','AWB / B/L Cost','Documentation Cost','Trucking Cost','Container Cost','Other Costs'].map(name=><option key={name} value={name}/>)}</datalist>
      <button type="button" className="btn btn-secondary" onClick={()=>change('costs',[...form.costs,{name:'',amount:null,currency:form.analysisCurrency,status:'ESTIMATED'}])}>＋ 新增成本項目</button>
      <label style={{display:'flex',gap:8,margin:'16px 0',alignItems:'center'}}><input type="checkbox" checked={form.costsComplete} onChange={e=>change('costsComplete',e.target.checked)}/>我已確認本次所有成本項目完整（仍有空白金額時將維持不完整）</label>
      <div className="form-grid"><label className="field">分析幣別<select value={form.analysisCurrency} onChange={e=>change('analysisCurrency',e.target.value as Currency)}><option>USD</option><option>TWD</option></select></label><label className="field">匯率：1 USD = ? TWD<input type="number" min="0" step="any" placeholder="跨幣別分析時必填" value={form.fxRate} onChange={e=>change('fxRate',e.target.value)}/></label><label className="field">匯率使用日期<input type="date" value={form.fxDate} onChange={e=>change('fxDate',e.target.value)}/></label></div>
    </section>
    <section className="panel"><h3 className="section-title">5. 報價條件</h3><div className="form-grid"><label className="field">本次報價條件 Terms and Conditions<textarea rows={4} value={form.terms} onChange={e=>change('terms',e.target.value)}/></label><label className="field">備註 Remarks<textarea rows={4} value={form.remarks} onChange={e=>change('remarks',e.target.value)}/></label></div><p className="muted">報價條件由使用者自行確認。儲存時保留本次輸入、合約版本、原價及調整價的完整快照。</p></section>
    <div style={{display:'flex',gap:12,alignItems:'center',margin:'20px 0'}}><button type="button" className="btn" disabled={!canCalculate||busy!==null} onClick={preview}>{busy==='preview'?'正在試算…':'試算報價'}</button><button type="button" className="btn" disabled={!snapshot||busy!==null||Boolean(savedNumber)} onClick={save}>{busy==='save'?'正在儲存…':'儲存報價快照'}</button>{!canCalculate&&<span className="muted">請完成運輸條件、{isFcl?'正整數貨櫃數量':'完整貨物資料'}及合約選擇或非合約售價。</span>}</div>
    {snapshot && <section className="panel"><h3 className="section-title">報價試算結果</h3><p>{modeName(snapshot.input.transportMode)} · {routeLabel(snapshot.input)}{snapshot.input.transportMode==='SEA' && ` · ${snapshot.input.seaShipmentType}${snapshot.input.containerType ? ` · ${snapshot.input.containerType}` : ''}`}</p><p>基本運費：<strong>{snapshot.freight.currency} {curr(snapshot.freight.amount)}</strong>{snapshot.freight.basis && ` · ${freightBasisLabels[snapshot.freight.basis]}`}{snapshot.freight.quantity !== undefined && ` · 計價數量 ${curr(snapshot.freight.quantity)} ${snapshot.freight.unit==='CONTAINER'?'櫃':snapshot.freight.unit ?? ''}`} · 適用級距 {snapshot.freight.appliedBreak}{snapshot.freight.minimumApplied?' · 已套用最低收費':''}</p>
      {snapshot.charges.length>0&&<div className="table-wrap"><table><thead><tr><th>應收費用</th><th>原合約單價</th><th>本次單價</th><th>原始金額</th><th>本次金額</th><th>說明</th></tr></thead><tbody>{snapshot.charges.map((charge,i)=><tr key={i}><td>{charge.name}</td><td>{charge.currency} {curr(charge.originalRate)}</td><td>{charge.currency} {curr(charge.appliedRate)}</td><td>{charge.currency} {curr(charge.originalAmount)}</td><td>{charge.currency} {curr(charge.amount)}</td><td>{charge.included?'已包含':charge.temporary?'臨時費用':'合約附加費'}</td></tr>)}</tbody></table></div>}
      {snapshot.finance.costState==='MISSING'&&<div className="alert">Cost Not Available — 尚無成本資料，不計算毛利及毛利率。</div>}
      {snapshot.finance.costState==='PARTIAL'&&<div className="alert">成本資料不完整；僅顯示已知成本小計及暫估利潤。</div>}
      {snapshot.finance.provisional&&snapshot.finance.costState!=='MISSING'&&<p className="muted">此結果包含預估成本或未確認項目，屬暫估分析。</p>}
      {snapshot.finance.missingFx&&<div className="alert">缺少必要匯率，無法合併不同幣別的總額。請填寫匯率與使用日期後重新試算。</div>}
      {snapshot.finance.negativeProfit&&<div className="alert error">Negative Profit Warning — 成本超過售價，客戶合約價維持原值。</div>}
      <div className="stat-grid"><div className="stat"><span>Revenue 應收總額 · {form.analysisCurrency}</span><strong>{curr(snapshot.finance.revenue)}</strong></div><div className="stat"><span>{snapshot.finance.costState==='PARTIAL'?'已知成本小計':'Cost 成本'} · {form.analysisCurrency}</span><strong>{curr(snapshot.finance.knownCost)}</strong></div><div className="stat"><span>{snapshot.finance.provisional?'暫估 ':''}Gross Profit · {form.analysisCurrency}</span><strong>{curr(snapshot.finance.grossProfit)}</strong></div><div className="stat"><span>Gross Profit Margin</span><strong>{snapshot.finance.margin===null?'—':`${snapshot.finance.margin}%`}</strong></div><div className="stat"><span>Markup</span><strong>{snapshot.finance.markup===null?'—':`${snapshot.finance.markup}%`}</strong></div></div>
      {snapshot.finance.missingFx&&<p>應收各幣別小計：{Object.entries(snapshot.finance.revenueByCurrency).map(([currency,amount])=>`${currency} ${curr(amount)}`).join(' / ')}；已知成本各幣別小計：{Object.entries(snapshot.finance.costByCurrency).map(([currency,amount])=>`${currency} ${curr(amount)}`).join(' / ')||'未提供'}</p>}
    </section>}
    </fieldset>
  </div>;
}
