'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Customer, ContractRecord, QuoteRecord, Settings } from '@/lib/types';
import Customers from '@/components/Customers';
import Contracts from '@/components/Contracts';
import SettingsForm from '@/components/SettingsForm';
import History from '@/components/History';
import QuoteEditor from '@/components/QuoteEditor';
import ModuleBoundary from '@/components/ModuleBoundary';
import { useWorkspaceNavigation } from '@/components/useWorkspaceNavigation';
import { api, Badge, Empty, localDate, money } from '@/components/ui';
import { modeName, routeLabel, formatQuantity } from '@/lib/transport';
import { applicableContractVersion, contractHasExpired, quoteContextKey, workspaceHash, type WorkspaceModule } from '@/lib/navigation';

const modules: { id: WorkspaceModule; label: string; en: string; icon: string; description: string }[] = [
  { id: 'dashboard', label: '營運總覽', en: 'Dashboard', icon: '▦', description: '掌握客戶合約與報價作業狀態' },
  { id: 'customers', label: '客戶資料', en: 'Customers', icon: '◉', description: '維護客戶主檔、聯絡資訊與往來紀錄' },
  { id: 'contracts', label: '合約運價', en: 'Contract Rates', icon: '▤', description: '維護客戶海空運國家價、計價單位、級距與附加費' },
  { id: 'quote', label: '新增報價', en: 'New Quotation', icon: '＋', description: '空運 KG、海運 CBM／櫃數與客戶國家價一次確認' },
  { id: 'history', label: '報價紀錄', en: 'Quotation History', icon: '▣', description: '查詢不可覆寫的歷史快照、修訂與正式客戶 PDF' },
  { id: 'settings', label: '系統設定', en: 'Settings', icon: '⚙', description: '設定公司資訊、重量規則、海關匯率與報價條件' },
];

function Dashboard({ customers, contracts, quotes, onNavigate, onQuote }: {
  customers: Customer[]; contracts: ContractRecord[]; quotes: QuoteRecord[];
  onNavigate: (module: WorkspaceModule) => void; onQuote: (id: string) => void;
}) {
  const today = localDate();
  const active = contracts.filter(contract => contract.status === 'ACTIVE' && applicableContractVersion(contract, today));
  const expired = contracts.filter(contract => contract.status === 'ACTIVE' && contractHasExpired(contract, today));
  return <>
    <div className="stat-grid dashboard-stats">
      <div className="stat"><span>啟用客戶 Active Customers</span><strong>{customers.filter(customer => customer.status === 'ACTIVE').length}<em> 家</em></strong><small>全部客戶 {customers.length} 家</small></div>
      <div className="stat"><span>有效合約 Active Contracts</span><strong>{active.length}<em> 份</em></strong><small>依今天適用的合約版本計算</small></div>
      <div className="stat"><span>報價與修訂 Quotations</span><strong>{quotes.length}<em> 筆</em></strong><small>Quoted {quotes.filter(quote => quote.status === 'Quoted').length} · Accepted {quotes.filter(quote => quote.status === 'Accepted').length}</small></div>
      <div className="stat"><span>待更新合約 Expired</span><strong className={expired.length ? 'text-danger' : ''}>{expired.length}<em> 份</em></strong><small>過期合約不會自動套用</small></div>
    </div>
    {(!customers.length || !contracts.length) && <div className="panel onboarding">
      <div className="section-title"><h2>開始第一份報價</h2><Badge>無預填客戶與合約價格</Badge></div>
      <div className="steps">
        <button type="button" onClick={() => onNavigate('settings')}><b>01</b><strong>公司與計算設定</strong><span>確認公司名稱、進位規則與匯率</span></button>
        <button type="button" onClick={() => onNavigate('customers')}><b>02</b><strong>建立客戶主檔</strong><span>輸入實際客戶與聯絡資料</span></button>
        <button type="button" onClick={() => onNavigate('contracts')}><b>03</b><strong>維護合約售價</strong><span>輸入客戶的起訖國家、海空運單價與期間</span></button>
        <button type="button" onClick={() => onNavigate('quote')}><b>04</b><strong>建立報價與 PDF</strong><span>試算計價數量、售價與毛利後儲存</span></button>
      </div>
    </div>}
    <div className="panel">
      <div className="section-title"><h2>最近報價 <span className="muted">Recent Quotations</span></h2><button type="button" className="btn-secondary" onClick={() => onNavigate('history')}>查看全部 →</button></div>
      <div className="table-wrap"><table><thead><tr><th>報價編號</th><th>客戶 / 航線</th><th>運輸 / 計價數量</th><th>Revenue</th><th>狀態</th></tr></thead><tbody>
        {quotes.slice(0, 6).map(quote => <tr key={quote.id}>
          <td><button type="button" className="table-link" onClick={() => onQuote(quote.id)}>{quote.number}</button><small>Rev. {quote.revision}</small></td>
          <td>{quote.snapshot.customer.name}<small>{routeLabel(quote.snapshot.input)}</small></td>
          <td>{modeName(quote.snapshot.input.transportMode)}<small>{quote.snapshot.freight.quantity !== undefined ? `${quote.snapshot.freight.quantity} ${quote.snapshot.freight.unit === 'CONTAINER' ? '櫃' : quote.snapshot.freight.unit}` : quote.snapshot.freight.appliedBreak === 'MANUAL' ? '手動整票' : `${formatQuantity(quote.snapshot.weights.chargeableWeight)} KG`}</small></td>
          <td>{quote.snapshot.input.analysisCurrency} {money(quote.snapshot.finance.revenue)}</td><td><Badge>{quote.status}</Badge></td>
        </tr>)}
      </tbody></table>{!quotes.length && <Empty>尚無報價紀錄。所有儲存的報價皆會保留獨立快照。</Empty>}</div>
    </div>
    <div className="alert">本系統僅供本機或 Codespaces 私人預覽使用。尚未實作應用程式登入與權限，請勿公開連接埠或部署到網際網路。</div>
  </>;
}

export default function Home() {
  const { route, token, navigate, getCurrentRoute, getCurrentToken, ready } = useWorkspaceNavigation();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const refreshGeneration = useRef(0);
  const loadData = useCallback(async () => {
    if (!mounted.current) return false;
    const generation = ++refreshGeneration.current;
    try {
      const [nextCustomers, nextContracts, nextQuotes, nextSettings] = await Promise.all([
        api<Customer[]>('customers'), api<ContractRecord[]>('contracts'), api<QuoteRecord[]>('quotes'), api<Settings>('settings'),
      ]);
      if (!mounted.current || generation !== refreshGeneration.current) return false;
      setCustomers(nextCustomers); setContracts(nextContracts); setQuotes(nextQuotes); setSettings(nextSettings); setError('');
      return true;
    } catch (failure) {
      if (mounted.current && generation === refreshGeneration.current) throw failure;
      return false;
    } finally {
      if (mounted.current && generation === refreshGeneration.current) setLoading(false);
    }
  }, []);
  const refresh = useCallback(async () => { await loadData(); }, [loadData]);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(failure => { if (mounted.current) setError((failure as Error).message); });
    return () => { mounted.current = false; refreshGeneration.current++; };
  }, [refresh]);

  const handleCustomerSaved = useCallback((customer: Customer) => {
    if (!mounted.current) return;
    // Discard reads started before this confirmed write, then show its canonical
    // server response immediately instead of depending on four follow-up reads.
    refreshGeneration.current++;
    setCustomers(current => [customer, ...current.filter(item => item.id !== customer.id)]);
  }, []);

  function goToModule(module: WorkspaceModule) { setNotice(''); navigate({ module }); }
  function openCustomer(id: string, module: 'contracts' | 'history') { setNotice(''); navigate({ module, customerId: id }); }
  function revise(quote: QuoteRecord) { setNotice(''); navigate({ module: 'quote', revisionId: quote.id }); }
  async function handleQuoteSaved(quote: QuoteRecord, originToken: number, originContext: string | null) {
    // The callback belongs to the quote screen that submitted the request, even
    // if that screen was unmounted before the response arrived.
    const stillOnOrigin = () => getCurrentToken() === originToken && quoteContextKey(getCurrentRoute()) === originContext;
    const mayNavigate = stillOnOrigin();
    if (mounted.current) setNotice(`報價 ${quote.number} Rev. ${quote.revision} 已儲存。`);
    try {
      const applied = await loadData();
      if (applied && mounted.current && mayNavigate && stillOnOrigin()) navigate({ module: 'history', quoteId: quote.id });
    } catch (failure) {
      if (mounted.current) setError(`報價已儲存，但重新讀取資料失敗：${(failure as Error).message}`);
    }
  }
  function retryLoad() {
    setLoading(true);
    void refresh().catch(failure => { if (mounted.current) setError((failure as Error).message); });
  }
  const current = modules.find(module => module.id === route.module)!;
  const revision = route.revisionId ? quotes.find(quote => quote.id === route.revisionId) ?? null : null;
  const missingRevision = route.module === 'quote' && route.revisionId !== null && !revision;
  const quoteOriginContext = quoteContextKey(route);

  if (!ready) return <main><div className="panel" role="status">正在恢復工作區…</div></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">AF</div><div><strong>AIR & SEA FREIGHT</strong><span>INTERNAL QUOTATION</span></div></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav>{modules.map(module => <button type="button" key={module.id} className={route.module === module.id ? 'nav-item active' : 'nav-item'} onClick={() => goToModule(module.id)} aria-current={route.module === module.id ? 'page' : undefined}><span className="nav-icon">{module.icon}</span><span>{module.label}<small>{module.en}</small></span>{route.module === module.id && <i />}</button>)}</nav>
      <div className="sidebar-footer"><span className="live-dot" /> 內部工作站 <small>PRIVATE WORKSPACE · SQLite<br />Air Freight Quotation / MVP</small></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><span>{settings?.companyName || '海空運內部報價系統'}</span><div><Badge tone="success">內部使用</Badge><span className="top-date">{localDate()}</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">AIR & SEA FREIGHT OPERATIONS / {current.en.toUpperCase()}</div><h1>{current.label}{revision && route.module === 'quote' && <Badge>修訂 {revision.number} Rev. {revision.revision}</Badge>}</h1><p>{current.description}</p></div>{route.module === 'dashboard' && <button type="button" className="btn" onClick={() => goToModule('quote')}>＋ 建立報價</button>}</div>
        {error && <div role="alert" className="alert danger">{error}<button type="button" className="btn-secondary" onClick={retryLoad}>重試連線</button></div>}
        {notice && <div role="status" className="alert success">{notice}</div>}
        {loading ? <div className="panel empty">正在讀取工作站資料庫…</div> : settings && <ModuleBoundary resetKey={workspaceHash(route)}>
          {route.module === 'dashboard' && <Dashboard customers={customers} contracts={contracts} quotes={quotes} onNavigate={goToModule} onQuote={id => navigate({ module: 'history', quoteId: id })} />}
          {route.module === 'customers' && <Customers customers={customers} onSaved={handleCustomerSaved} onChanged={refresh} onContracts={id => openCustomer(id, 'contracts')} onHistory={id => openCustomer(id, 'history')} />}
          {route.module === 'contracts' && <Contracts customers={customers} contracts={contracts} customerFilter={route.customerId ?? ''} onFilter={id => navigate({ module: 'contracts', customerId: id || null })} onChanged={refresh} />}
          {route.module === 'settings' && <SettingsForm settings={settings} onSaved={refresh} />}
          {route.module === 'quote' && (missingRevision
            ? <section className="panel" role="alert"><h2>找不到要修訂的報價</h2><p>原報價可能尚未載入或已不存在。請回報價紀錄重新選擇，不會建立成另一份新報價。</p><button type="button" className="btn-secondary" onClick={() => goToModule('history')}>前往報價紀錄</button></section>
            : <QuoteEditor key={route.revisionId ?? 'new'} customers={customers} settings={settings} initial={revision} onSaved={quote => { void handleQuoteSaved(quote, token, quoteOriginContext); }} />)}
          {route.module === 'history' && <History quotes={quotes} customers={customers} customerFilter={route.customerId ?? ''} onFilter={id => navigate({ module: 'history', customerId: id || null })} onRevise={revise} selectedId={route.quoteId} onSelect={id => navigate({ ...route, quoteId: id })} />}
        </ModuleBoundary>}
      </main>
      <footer className="main-footer"><span>Air & Sea Freight Internal Quotation System</span><span>售價依據客戶合約 · 歷史快照獨立保存</span></footer>
    </div>
  </div>;
}
