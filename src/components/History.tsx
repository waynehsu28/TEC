'use client';
import { useEffect, useRef, useState } from 'react';
import type { Customer, QuoteRecord, QuoteStatus, QuoteSnapshot } from '@/lib/types';
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
export default function History({ quotes, customers, customerFilter, onFilter, onRevise, selectedId, onSelect, onDeleted, onChanged }: {
  quotes: QuoteRecord[]; customers: Customer[]; customerFilter: string; onFilter: (id: string) => void;
  onRevise: (quote: QuoteRecord) => void; selectedId: string | null; onSelect: (id: string | null) => void;
  onDeleted: (id: string) => void; onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [mode, setMode] = useState('');
  const [confirmation, setConfirmation] = useState<QuoteRecord | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [displayWarning, setDisplayWarning] = useState(''), [refreshWarning, setRefreshWarning] = useState(''), [refreshing, setRefreshing] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const mounted = useRef(true), pending = useRef(false), operation = useRef(0);
  const opener = useRef<HTMLButtonElement | null>(null), cancelButton = useRef<HTMLButtonElement | null>(null), search = useRef<HTMLInputElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (confirmation) cancelButton.current?.focus();
    else if (opener.current) {
      if (opener.current.isConnected) opener.current.focus();
      else search.current?.focus();
      opener.current = null;
    }
  }, [confirmation?.id]);

  function askDelete(quote: QuoteRecord, button: HTMLButtonElement) {
    if (pending.current) return;
    operation.current++;
    opener.current = button;
    setConfirmation(quote); setError(''); setSuccess(''); setDisplayWarning(''); setRefreshWarning(''); setRefreshing(false);
  }
  async function refreshDeleted(id: number) {
    if (mounted.current && operation.current === id) setRefreshing(true);
    try {
      await onChanged();
      if (mounted.current && operation.current === id) setRefreshWarning('');
    } catch (failure) {
      if (mounted.current && operation.current === id) setRefreshWarning(`報價已刪除，但重新讀取資料失敗：${(failure as Error).message}。請重新整理資料。`);
    } finally { if (mounted.current && operation.current === id) setRefreshing(false); }
  }
  async function removeConfirmed() {
    if (!confirmation || pending.current) return;
    const target = confirmation, id = operation.current;
    pending.current = true; setBusy(true); setError('');
    let deleted: { id: string; number: string; revision: number };
    try { deleted = await api(`quotes/${target.id}`, 'DELETE'); }
    catch (failure) { if (mounted.current && operation.current === id) setError((failure as Error).message); return; }
    finally { pending.current = false; if (mounted.current) setBusy(false); }

    // A successful DELETE is committed even if a later display callback or refresh fails.
    try { onDeleted(deleted.id); }
    catch { if (mounted.current && operation.current === id) setDisplayWarning('報價已刪除，但畫面更新失敗。請重新整理資料。'); }
    if (mounted.current && operation.current === id) {
      setDeletedIds(current => new Set([...current, deleted.id]));
      setConfirmation(null);
      setSuccess(`報價 ${deleted.number} Rev. ${deleted.revision} 已刪除。`);
    }
    void refreshDeleted(id);
  }
  const filtered = quotes.filter(q => !deletedIds.has(q.id) && (!customerFilter || q.customerId === customerFilter) && (!status || q.status === status) && (!mode || (q.snapshot.input.transportMode || 'AIR') === mode) && `${q.number} ${q.snapshot.customer.name} ${routeLabel(q.snapshot.input)} ${q.snapshot.input.originCountry || ''} ${q.snapshot.input.destinationCountry || ''} ${q.snapshot.input.origin} ${q.snapshot.input.destination}`.toLowerCase().includes(query.toLowerCase()));
  const selected = quotes.find(q => q.id === selectedId && !deletedIds.has(q.id));
  function deleteButton(quote: QuoteRecord) {
    return <button type="button" className="text-danger" style={{ color: 'var(--red)' }} disabled={busy} aria-label={`刪除 ${quote.number} Rev. ${quote.revision}`} onClick={event => askDelete(quote, event.currentTarget)}>刪除</button>;
  }
  return <>
    <div className="toolbar"><div className="search-group"><input ref={search} aria-label="搜尋歷史報價" placeholder="搜尋報價編號、客戶、國家或航線" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="歷史客戶篩選" value={customerFilter} onChange={e => onFilter(e.target.value)}><option value="">全部客戶</option>{customers.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select><select aria-label="歷史運輸方式" value={mode} onChange={e => setMode(e.target.value)}><option value="">海空運全部</option><option value="AIR">空運 Air</option><option value="SEA">海運 Sea</option></select><select aria-label="報價狀態篩選" value={status} onChange={e => setStatus(e.target.value)}><option value="">全部狀態</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></div><span className="muted">{filtered.length} 筆報價 / 修訂</span></div>
    {success && <div role="status" className="alert success">{success}</div>}
    {displayWarning && <div role="alert" className="alert warning">{displayWarning}</div>}
    {refreshWarning && <div role="alert" className="alert warning">{refreshWarning} <button type="button" className="btn-secondary" disabled={refreshing} onClick={() => { void refreshDeleted(operation.current); }}>{refreshing ? '同步中…' : '重新整理資料'}</button></div>}
    {confirmation && <section className="panel" role="dialog" aria-labelledby="quote-delete-title" aria-describedby="quote-delete-description" aria-busy={busy} onKeyDown={event => { if (event.key === 'Escape' && !busy) setConfirmation(null); }}>
      <h2 id="quote-delete-title">確認刪除報價</h2>
      <p><strong>{confirmation.number} · Rev. {confirmation.revision}</strong></p><p>客戶：{confirmation.snapshot.customer.name}（{confirmation.snapshot.customer.code}）</p>
      <p id="quote-delete-description">只刪除所選的這筆報價，其他修訂版本保留。刪除後，此畫面無法復原。</p>
      {error && <div role="alert" className="alert danger">{error}</div>}
      <div className="actions"><button type="button" ref={cancelButton} className="btn-secondary" disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button type="button" className="btn" style={{ backgroundColor: 'var(--red)' }} disabled={busy} onClick={() => { void removeConfirmed(); }}>{busy ? '刪除中…' : '確認刪除'}</button></div>
    </section>}
    {selected && <article className="panel"><div className="section-title"><div><h2>{selected.number} <Badge>Rev. {selected.revision}</Badge></h2><p className="muted">{modeName(selected.snapshot.input.transportMode)} · {new Date(selected.createdAt).toLocaleString('zh-TW')} · {selected.status} · 已儲存快照</p></div><div className="row-actions"><a className="btn" href={`/api/quotes/${selected.id}/pdf`} download>下載客戶 PDF</a><button type="button" className="btn-secondary" onClick={() => onRevise(selected)}>建立修訂版本</button>{deleteButton(selected)}<button type="button" className="btn-secondary" onClick={() => onSelect(null)}>關閉</button></div></div><SnapshotDetails snapshot={selected.snapshot} /></article>}
    <div className="panel table-wrap"><table><thead><tr><th>報價編號 / 修訂</th><th>運輸方式 / 客戶 / 國家</th><th>日期</th><th>Revenue</th><th>Gross Profit</th><th>狀態</th><th>操作</th></tr></thead><tbody>{filtered.map(q => <tr key={q.id}><td><strong>{q.number}</strong><small>Rev. {q.revision}</small></td><td><Badge>{modeName(q.snapshot.input.transportMode)}{q.snapshot.input.seaShipmentType ? ` ${q.snapshot.input.seaShipmentType}` : ''}</Badge><small>{q.snapshot.customer.name} · {routeLabel(q.snapshot.input)}</small></td><td>{new Date(q.createdAt).toLocaleDateString('zh-TW')}<small>有效至 {q.snapshot.input.validity}</small></td><td>{q.snapshot.input.analysisCurrency} {money(q.snapshot.finance.revenue)}</td><td className={q.snapshot.finance.negativeProfit ? 'text-danger' : ''}>{q.snapshot.finance.grossProfit === null ? 'Cost Not Available' : `${q.snapshot.input.analysisCurrency} ${money(q.snapshot.finance.grossProfit)}`}<small>{q.snapshot.finance.provisional ? '暫估 / 不完整' : ''}</small></td><td><Badge tone={q.status === 'Accepted' ? 'success' : ''}>{q.status}</Badge></td><td><div className="row-actions"><button type="button" onClick={() => onSelect(q.id)}>明細</button><a href={`/api/quotes/${q.id}/pdf`} download>PDF</a><button type="button" onClick={() => onRevise(q)}>修訂 / 變更狀態</button>{deleteButton(q)}</div></td></tr>)}</tbody></table>{!filtered.length && <Empty>尚無符合條件的報價。報價儲存後會在此保留完整歷史快照。</Empty>}</div>
  </>;
}
