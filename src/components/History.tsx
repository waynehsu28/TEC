'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Customer, QuoteListItem, QuotePage, QuoteRecord, QuoteStatus, QuoteSnapshot } from '@/lib/types';
import { quoteListItemFromRecord } from '@/lib/quote-list';
import { api, Badge, Empty, money } from './ui';
import { modeName, routeLabel, chargeBasisLabels, formatQuantity, formatVolumeWeight } from '@/lib/transport';
const statuses: QuoteStatus[] = ['Draft', 'Quoted', 'Accepted', 'Rejected', 'Expired'];
export function SnapshotDetails({ snapshot: s }: { snapshot: QuoteSnapshot }) {
  const sea = s.input.transportMode === 'SEA';
  const cargoProvided = s.input.cargo.length > 0;
  return <>
    <div className="detail-grid">
      <div><span>客戶</span><strong>{s.customer.code} · {s.customer.name}</strong></div>
      <div><span>運輸方式 / 定價範圍</span><strong>{modeName(s.input.transportMode)} · {s.input.routeScope === 'COUNTRY' ? '國家價' : '機場航線價'}{sea ? ` · ${s.input.seaShipmentType}` : ''}</strong></div>
      <div><span>適用國家 / 航線</span><strong>{routeLabel(s.input)}</strong></div>
      {s.input.routeScope === 'COUNTRY' && <div><span>城市／機場／港口（不影響國家價）</span><strong>{s.input.origin || '未指定'} → {s.input.destination || '未指定'}</strong></div>}
      <div><span>承運人 / 服務</span><strong>{s.input.airline || '不限'} / {s.input.serviceType || '不限'}</strong></div>
      <div><span>出貨日期 / 貨物種類</span><strong>{s.input.shipmentDate} / {s.input.commodity || '—'}</strong></div>
      <div><span>合約 / 適用級距</span><strong>{s.contract ? `${s.contract.number} v${s.contract.version}` : '非合約手動售價'} · {s.freight.appliedBreak}</strong></div>
      <div><span>匯率快照</span><strong>{s.input.fxRate ? `1 USD = ${s.input.fxRate} TWD (${s.input.fxDate})` : '未設定'}</strong>{s.input.fxSource === 'CUSTOMS' && s.input.customsRate && <small>海關三旬 · {s.input.customsRate.side === 'EXPORT' ? '出口／買進' : '進口／賣出'} · {s.input.customsRate.validFrom} — {s.input.customsRate.validTo}</small>}</div>
      {sea && s.input.seaShipmentType === 'FCL' && <div><span>整櫃 FCL</span><strong>{s.input.containerType} × {s.input.containerCount} 櫃</strong></div>}
    </div>
    <div className="stat-grid">
      <div className="stat"><span>總實重 Gross Weight</span><strong>{cargoProvided ? formatQuantity(s.weights.grossWeight) : '未提供'} <em>{cargoProvided ? 'KG' : ''}</em></strong></div>
      {!sea && <><div className="stat"><span>材積重 Volume Weight</span><strong>{formatVolumeWeight(s.weights.volumeWeight)} <em>KG</em></strong></div><div className="stat"><span>計費重 Chargeable Weight</span><strong>{formatQuantity(s.weights.chargeableWeight)} <em>KG</em></strong></div></>}
      <div className="stat"><span>體積 Volume</span><strong>{cargoProvided ? formatQuantity(s.weights.cbm) : '未提供'} <em>{cargoProvided ? 'CBM' : ''}</em></strong></div>
      <div className="stat"><span>計價數量</span><strong>{s.freight.quantity !== undefined ? `${s.freight.quantity} ${s.freight.unit === 'CONTAINER' ? '櫃' : s.freight.unit}` : s.freight.appliedBreak === 'MANUAL' ? '手動整票金額' : `${formatQuantity(s.weights.chargeableWeight)} KG`}</strong></div>
    </div>
    <h3>貨物資料 Cargo Details</h3>
    <div className="table-wrap"><table><thead><tr><th>件數</th><th>尺寸 cm</th><th>重量輸入 KG</th><th>重量模式</th></tr></thead><tbody>{s.input.cargo.map((c, i) => <tr key={i}><td>{c.pieces}</td><td>{c.length} × {c.width} × {c.height}</td><td>{c.grossWeight}</td><td>{c.weightMode === 'PER_PIECE' ? '單件實重' : '該組總實重'}</td></tr>)}</tbody></table>{!cargoProvided && <Empty>本次整櫃報價未提供貨物尺寸與重量，依櫃型及櫃數計費。</Empty>}</div>
    <h3>售價明細 Revenue</h3>
    <div className="table-wrap"><table><thead><tr><th>項目</th><th>計價方式</th><th>原始單價</th><th>套用單價</th><th>金額</th></tr></thead><tbody>
      <tr><td>{sea ? 'Ocean Freight' : 'Air Freight'} {s.freight.minimumApplied && <Badge>適用 MIN</Badge>}</td><td>{s.freight.appliedBreak}</td><td>{s.freight.currency} {s.freight.rate || '—'}{s.freight.unit ? ` / ${s.freight.unit === 'CONTAINER' ? '櫃' : s.freight.unit}` : ''}</td><td>{s.freight.currency} {s.freight.rate || '—'}</td><td>{s.freight.currency} {money(s.freight.amount)}</td></tr>
      {s.charges.map((c, i) => <tr key={i}><td>{c.name} {c.included && <Badge>已包含</Badge>}{c.temporary && <Badge>臨時費用</Badge>}{c.minimumApplied && <Badge>適用 MIN</Badge>}</td><td>{chargeBasisLabels[c.basis]}{c.basis === 'PER_KG_TIERED' && <small>{[c.appliedBreak, c.quantity ? `${formatQuantity(c.quantity)} KG` : ''].filter(Boolean).join(' · ')}</small>}</td><td>{c.currency} {c.originalRate || '—'}{c.basis === 'PER_KG_TIERED' && c.originalRate !== '' ? ' / KG' : ''}</td><td>{c.currency} {c.appliedRate || '—'}{c.basis === 'PER_KG_TIERED' && c.appliedRate !== '' ? ' / KG' : ''}</td><td>{c.currency} {money(c.amount)}</td></tr>)}
    </tbody></table></div>
    <h3>內部成本 Internal Costs</h3>
    <div className="table-wrap"><table><thead><tr><th>成本項目</th><th>類型</th><th>金額</th></tr></thead><tbody>{s.input.costs.map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.status}</td><td>{c.amount === null ? '尚未確認' : `${c.currency} ${money(c.amount)}`}</td></tr>)}</tbody></table>{!s.input.costs.length && <Empty>Cost Not Available · 尚未輸入成本</Empty>}</div>
    <div className="stat-grid finance-grid">
      <div className="stat"><span>Revenue 總售價 · {s.input.analysisCurrency}</span><strong>{money(s.finance.revenue)}</strong>{Object.entries(s.finance.revenueByCurrency).map(([c, a]) => <small key={c}>{c} {money(a)}</small>)}</div>
      <div className="stat"><span>{s.finance.costState === 'COMPLETE' ? 'Total Cost' : 'Known Cost 已知成本'} · {s.input.analysisCurrency}</span><strong>{money(s.finance.knownCost)}</strong>{Object.entries(s.finance.costByCurrency).map(([c, a]) => <small key={c}>{c} {money(a)}</small>)}</div>
      <div className={`stat ${s.finance.negativeProfit ? 'negative' : ''}`}><span>{s.finance.provisional ? '暫估毛利' : 'Gross Profit'} · {s.input.analysisCurrency}</span><strong>{money(s.finance.grossProfit)}</strong></div>
      <div className="stat"><span>Gross Profit Margin</span><strong>{s.finance.margin === null ? '—' : `${money(s.finance.margin)}%`}</strong><small>Markup {s.finance.markup === null ? '—' : `${money(s.finance.markup)}%`}</small></div>
    </div>
    {s.finance.costState === 'MISSING' && <div className="alert warning">Cost Not Available · 未提供成本，無法計算完整毛利。</div>}
    {s.finance.provisional && s.finance.costState !== 'MISSING' && <div className="alert warning">成本尚未完整確認或包含 Estimated 成本；毛利僅為暫估。</div>}
    {s.finance.missingFx && <div className="alert warning">缺少必要匯率，未顯示跨幣別合併總額。</div>}
    {s.finance.negativeProfit && <div className="alert danger">Negative Profit Warning · 成本超過售價；合約售價未被自動修改。</div>}
    <div className="detail-grid"><div><span>報價有效期限</span><strong>{s.input.validity}</strong></div><div><span>計算設定快照</span><strong>{sea ? '海運依 CBM 或櫃數計價，不使用空運材積重量' : `除數 ${s.settings.volumeDivisor} / 進位 ${s.settings.weightIncrement} KG`}</strong></div></div>
    <h3>報價條件 Terms and Conditions</h3><p className="pre-wrap">{s.input.terms || '未設定'}</p><h3>備註 Remarks</h3><p className="pre-wrap">{s.input.remarks || '無'}</p>
  </>;
}

interface Criteria { query: string; status: string; mode: string; page: number; pageSize: number; customerId: string }
const criteriaKey = (criteria: Criteria) => JSON.stringify(criteria);
type ListState = { key: string; status: 'loading' | 'ready' | 'error'; data?: QuotePage; error?: string };
type DetailState = { id: string | null; status: 'loading' | 'ready' | 'error'; quote?: QuoteRecord; error?: string };
async function readJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, { cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '讀取報價失敗，請重試。');
  return data as T;
}

export default function History({ customers, customerFilter, onFilter, onRevise, selectedId, onSelect, onDeleted, onChanged }: {
  customers: Customer[]; customerFilter: string; onFilter: (id: string) => void;
  onRevise: (id: string) => void; selectedId: string | null; onSelect: (id: string | null) => void;
  onDeleted: (quote: QuoteListItem) => void; onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [criteria, setCriteria] = useState<Criteria>({ query: '', status: '', mode: '', page: 1, pageSize: 20, customerId: customerFilter });
  const effective = criteria.customerId === customerFilter ? criteria : { ...criteria, customerId: customerFilter, page: 1 };
  const requestKey = criteriaKey(effective);
  const currentCriteria = useRef(effective), currentKey = useRef(requestKey);
  currentCriteria.current = effective; currentKey.current = requestKey;
  const [list, setList] = useState<ListState>({ key: '', status: 'loading' });
  const [detail, setDetail] = useState<DetailState>({ id: null, status: 'loading' });
  const [detailRetry, setDetailRetry] = useState(0);
  const [confirmation, setConfirmation] = useState<QuoteListItem | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [displayWarning, setDisplayWarning] = useState(''), [refreshWarning, setRefreshWarning] = useState(''), [refreshing, setRefreshing] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const deleted = useRef(new Set<string>()), mounted = useRef(true), pending = useRef(false), operation = useRef(0);
  const listGeneration = useRef(0), listController = useRef<AbortController | null>(null), skipEffectKey = useRef<string | null>(null);
  const detailGeneration = useRef(0), detailController = useRef<AbortController | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null), cancelButton = useRef<HTMLButtonElement | null>(null), search = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; listGeneration.current++; detailGeneration.current++; listController.current?.abort(); detailController.current?.abort(); };
  }, []);
  useEffect(() => { setCriteria(current => current.customerId === customerFilter ? current : { ...current, customerId: customerFilter, page: 1 }); }, [customerFilter]);
  useEffect(() => {
    const timer = setTimeout(() => setCriteria(current => current.query === query.trim() ? current : { ...current, query: query.trim(), page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const loadPage = useCallback(async (): Promise<void> => {
    if (!mounted.current) return;
    const requested = currentCriteria.current, key = criteriaKey(requested), generation = ++listGeneration.current;
    listController.current?.abort();
    const controller = new AbortController(); listController.current = controller;
    setList(current => ({ key, status: 'loading', data: current.key === key ? current.data : undefined }));
    const params = new URLSearchParams({ page: String(requested.page), pageSize: String(requested.pageSize) });
    if (requested.query) params.set('q', requested.query);
    if (requested.status) params.set('status', requested.status);
    if (requested.mode) params.set('transportMode', requested.mode);
    if (requested.customerId) params.set('customerId', requested.customerId);
    try {
      const result = await readJson<QuotePage>(`quotes?${params}`, controller.signal);
      if (!mounted.current || controller.signal.aborted || generation !== listGeneration.current || key !== currentKey.current) return;
      if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || !Number.isSafeInteger(result.page) || !Number.isSafeInteger(result.totalPages) || ![20, 50, 100].includes(result.pageSize) || result.items.length > result.pageSize || result.page < 1 || result.total < 0 || result.totalPages < 1 || result.page > result.totalPages) throw new Error('報價清單資料格式不正確，請重新讀取。');
      const removed = result.items.filter(item => deleted.current.has(item.id)).length;
      const total = Math.max(0, result.total - removed);
      const data = { ...result, items: result.items.filter(item => !deleted.current.has(item.id)), total, totalPages: Math.max(1, Math.ceil(total / result.pageSize)) };
      const canonical = { ...requested, page: result.page }, canonicalKey = criteriaKey(canonical);
      if (canonicalKey !== key) {
        skipEffectKey.current = canonicalKey;
        setCriteria(current => criteriaKey(currentCriteria.current) === key ? { ...current, page: result.page, customerId: requested.customerId } : current);
      }
      setList({ key: canonicalKey, status: 'ready', data });
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted || generation !== listGeneration.current || key !== currentKey.current) return;
      const message = failure instanceof Error ? failure.message : '讀取報價失敗，請重試。';
      setList(current => ({ key, status: 'error', data: current.key === key ? current.data : undefined, error: message }));
      throw new Error(message);
    }
  }, []);
  useEffect(() => {
    if (skipEffectKey.current === requestKey) { skipEffectKey.current = null; return; }
    void loadPage().catch(() => {});
    return () => { listGeneration.current++; listController.current?.abort(); };
  }, [requestKey, loadPage]);

  useEffect(() => {
    const generation = ++detailGeneration.current;
    detailController.current?.abort();
    if (!selectedId || deleted.current.has(selectedId)) { setDetail({ id: selectedId, status: 'ready' }); return; }
    const controller = new AbortController(); detailController.current = controller;
    setDetail({ id: selectedId, status: 'loading' });
    void readJson<QuoteRecord>(`quotes/${selectedId}`, controller.signal).then(quote => {
      if (!mounted.current || controller.signal.aborted || generation !== detailGeneration.current || deleted.current.has(selectedId)) return;
      if (quote.id !== selectedId || !quote.snapshot) throw new Error('報價明細資料不完整，請重新讀取。');
      setDetail({ id: selectedId, status: 'ready', quote });
    }).catch(failure => {
      if (mounted.current && !controller.signal.aborted && generation === detailGeneration.current) setDetail({ id: selectedId, status: 'error', error: failure instanceof Error ? failure.message : '讀取報價明細失敗。' });
    });
    return () => { controller.abort(); detailGeneration.current++; };
  }, [selectedId, detailRetry]);
  useEffect(() => {
    if (confirmation) cancelButton.current?.focus();
    else if (opener.current) { if (opener.current.isConnected) opener.current.focus(); else search.current?.focus(); opener.current = null; }
  }, [confirmation?.id]);

  function askDelete(quote: QuoteListItem, button: HTMLButtonElement) {
    if (pending.current) return;
    operation.current++; opener.current = button;
    setConfirmation(quote); setError(''); setSuccess(''); setDisplayWarning(''); setRefreshWarning(''); setRefreshing(false);
  }
  async function refreshDeleted(id: number) {
    if (mounted.current && operation.current === id) setRefreshing(true);
    const results = await Promise.allSettled([mounted.current ? loadPage() : Promise.resolve(), Promise.resolve().then(onChanged)]);
    if (mounted.current && operation.current === id) {
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      setRefreshWarning(failures.length ? `報價已刪除，但重新讀取資料失敗：${failures.map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)).join('；')}。請重新整理資料。` : '');
      setRefreshing(false);
    }
  }
  async function removeConfirmed() {
    if (!confirmation || pending.current) return;
    const target = confirmation, id = operation.current;
    pending.current = true; setBusy(true); setError('');
    let receipt: { id: string; number: string; revision: number };
    try { receipt = await api(`quotes/${target.id}`, 'DELETE'); }
    catch (failure) { if (mounted.current && operation.current === id) setError((failure as Error).message); return; }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
    deleted.current.add(receipt.id); listGeneration.current++; listController.current?.abort();
    try { onDeleted({ ...target, id: receipt.id }); }
    catch { if (mounted.current && operation.current === id) setDisplayWarning('報價已刪除，但畫面更新失敗。請重新整理資料。'); }
    if (mounted.current && operation.current === id) {
      setDeletedIds(new Set(deleted.current));
      setList(current => {
        if (!current.data) return current;
        const found = current.data.items.some(item => item.id === receipt.id);
        const total = Math.max(0, current.data.total - (found ? 1 : 0));
        const totalPages = Math.max(1, Math.ceil(total / current.data.pageSize));
        // The server must select the preceding page; an emptied last page is
        // not a valid representation of that page while refresh is pending.
        if (current.data.page > totalPages) return { ...current, data: undefined };
        return { ...current, data: { ...current.data, items: current.data.items.filter(item => item.id !== receipt.id), total, totalPages } };
      });
      setConfirmation(null); setSuccess(`報價 ${receipt.number} Rev. ${receipt.revision} 已刪除。`);
    }
    void refreshDeleted(id);
  }

  const searchPending = query.trim() !== effective.query;
  const currentPage = list.key === requestKey && !searchPending ? list.data : undefined;
  const listPending = searchPending || list.key !== requestKey || list.status === 'loading';
  const rows = currentPage?.items.filter(item => !deletedIds.has(item.id)) ?? [];
  const selected = selectedId && detail.id === selectedId && !deletedIds.has(selectedId) ? detail.quote : undefined;
  const detailPending = selectedId && !deletedIds.has(selectedId) && (detail.id !== selectedId || detail.status === 'loading');
  function changeFilter(patch: Partial<Criteria>) { setCriteria(current => ({ ...current, ...patch, customerId: customerFilter, page: 1 })); }
  function deleteButton(quote: QuoteListItem, disabled = false) {
    return <button type="button" className="text-danger" style={{ color: 'var(--red)' }} disabled={busy || disabled} aria-label={`刪除 ${quote.number} Rev. ${quote.revision}`} onClick={event => askDelete(quote, event.currentTarget)}>刪除</button>;
  }
  return <>
    <div className="toolbar"><div className="search-group">
      <input ref={search} aria-label="搜尋歷史報價" maxLength={120} placeholder="搜尋報價編號、客戶、國家或航線" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="歷史客戶篩選" value={customerFilter} onChange={event => { changeFilter({ customerId: event.target.value }); onFilter(event.target.value); }}><option value="">全部客戶</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select>
      <select aria-label="歷史運輸方式" value={effective.mode} onChange={event => changeFilter({ mode: event.target.value })}><option value="">海空運全部</option><option value="AIR">空運 Air</option><option value="SEA">海運 Sea</option></select>
      <select aria-label="報價狀態篩選" value={effective.status} onChange={event => changeFilter({ status: event.target.value })}><option value="">全部狀態</option>{statuses.map(status => <option key={status}>{status}</option>)}</select>
      <label>每頁 <select aria-label="每頁筆數" value={effective.pageSize} onChange={event => changeFilter({ pageSize: Number(event.target.value) })}>{[20, 50, 100].map(size => <option key={size} value={size}>{size} 筆</option>)}</select></label>
    </div><span className="muted">{currentPage ? `共 ${currentPage.total} 筆報價 / 修訂` : listPending ? '正在查詢報價' : '尚未取得報價數量'}</span></div>
    {success && <div role="status" className="alert success">{success}</div>}
    {displayWarning && <div role="alert" className="alert warning">{displayWarning}</div>}
    {refreshWarning && <div role="alert" className="alert warning">{refreshWarning} <button type="button" className="btn-secondary" disabled={refreshing} onClick={() => { void refreshDeleted(operation.current); }}>{refreshing ? '同步中…' : '重新整理資料'}</button></div>}
    {confirmation && <section className="panel" role="dialog" aria-labelledby="quote-delete-title" aria-describedby="quote-delete-description" aria-busy={busy} onKeyDown={event => { if (event.key === 'Escape' && !busy) setConfirmation(null); }}>
      <h2 id="quote-delete-title">確認刪除報價</h2><p><strong>{confirmation.number} · Rev. {confirmation.revision}</strong></p><p>客戶：{confirmation.customerName}（{confirmation.customerCode}）</p>
      <p id="quote-delete-description">只刪除所選的這筆報價，其他修訂版本保留。刪除後，此畫面無法復原。</p>{error && <div role="alert" className="alert danger">{error}</div>}
      <div className="actions"><button type="button" ref={cancelButton} className="btn-secondary" disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button type="button" className="btn" style={{ backgroundColor: 'var(--red)' }} disabled={busy} onClick={() => { void removeConfirmed(); }}>{busy ? '刪除中…' : '確認刪除'}</button></div>
    </section>}
    {detailPending && <div role="status" className="panel">正在讀取報價明細…</div>}
    {selectedId && !deletedIds.has(selectedId) && detail.id === selectedId && detail.status === 'error' && <div role="alert" className="panel alert danger">{detail.error} <button type="button" className="btn-secondary" onClick={() => setDetailRetry(value => value + 1)}>重新讀取明細</button><button type="button" className="btn-secondary" onClick={() => onSelect(null)}>關閉明細</button></div>}
    {selected && <article className="panel"><div className="section-title"><div><h2>{selected.number} <Badge>Rev. {selected.revision}</Badge></h2><p className="muted">{modeName(selected.snapshot.input.transportMode)} · {new Date(selected.createdAt).toLocaleString('zh-TW')} · {selected.status} · 已儲存快照</p></div><div className="row-actions"><a className="btn" href={`/api/quotes/${selected.id}/pdf`} download>下載客戶 PDF</a><button type="button" className="btn-secondary" onClick={() => onRevise(selected.id)}>建立修訂版本</button>{deleteButton(quoteListItemFromRecord(selected))}<button type="button" className="btn-secondary" onClick={() => onSelect(null)}>關閉</button></div></div><SnapshotDetails snapshot={selected.snapshot} /></article>}
    {listPending && <div role="status" className="alert">正在讀取報價清單…</div>}
    {list.key === requestKey && list.status === 'error' && !refreshWarning && <div role="alert" className="alert danger">報價清單讀取失敗：{list.error} {currentPage && '目前顯示已載入的當頁資料。'}<button type="button" className="btn-secondary" onClick={() => { void loadPage().catch(() => {}); }}>重新讀取報價</button></div>}
    <div className="panel table-wrap" aria-busy={listPending}><table><thead><tr><th>報價編號 / 修訂</th><th>運輸方式 / 客戶 / 國家</th><th>日期</th><th>Revenue</th><th>Gross Profit</th><th>狀態</th><th>操作</th></tr></thead><tbody>{rows.map(quote => <tr key={quote.id}>
      <td><strong>{quote.number}</strong><small>Rev. {quote.revision}</small></td><td><Badge>{modeName(quote.transportMode)}{quote.seaShipmentType ? ` ${quote.seaShipmentType}` : ''}</Badge><small>{quote.customerName} · {routeLabel(quote)}</small></td><td>{new Date(quote.createdAt).toLocaleDateString('zh-TW')}{quote.validity && <small>有效至 {quote.validity}</small>}</td><td>{quote.analysisCurrency} {money(quote.revenue)}</td>
      <td className={quote.grossProfit !== null && quote.grossProfit.startsWith('-') ? 'text-danger' : ''}>{quote.grossProfit === null ? 'Cost Not Available' : `${quote.analysisCurrency} ${money(quote.grossProfit)}`}<small>{quote.provisional ? '暫估 / 不完整' : ''}</small></td><td><Badge tone={quote.status === 'Accepted' ? 'success' : ''}>{quote.status}</Badge></td>
      <td><div className="row-actions"><button type="button" disabled={listPending} onClick={() => onSelect(quote.id)}>明細</button><a href={`/api/quotes/${quote.id}/pdf`} download>PDF</a><button type="button" disabled={listPending} onClick={() => onRevise(quote.id)}>修訂 / 變更狀態</button>{deleteButton(quote, listPending)}</div></td>
    </tr>)}</tbody></table>{!listPending && list.status === 'ready' && currentPage?.total === 0 && <Empty>尚無符合條件的報價。請調整搜尋或篩選條件。</Empty>}</div>
    <div className="toolbar" aria-label="報價分頁"><span>{currentPage ? `第 ${currentPage.page} / ${currentPage.totalPages} 頁 · 共 ${currentPage.total} 筆` : '尚未取得頁面資料'}</span><div className="row-actions"><button type="button" className="btn-secondary" disabled={!currentPage || listPending || currentPage.page <= 1} onClick={() => setCriteria(current => ({ ...current, customerId: customerFilter, page: (currentPage?.page ?? 1) - 1 }))}>上一頁</button><button type="button" className="btn-secondary" disabled={!currentPage || listPending || currentPage.page >= currentPage.totalPages} onClick={() => setCriteria(current => ({ ...current, customerId: customerFilter, page: (currentPage?.page ?? 1) + 1 }))}>下一頁</button></div></div>
  </>;
}
