'use client';
import { useEffect, useRef, useState } from 'react';
import type { Customer, CustomerInput } from '@/lib/types';
import { api, Badge, Empty, Field } from './ui';

const blank: CustomerInput = { name: '', code: '', contact: '', email: '', phone: '', defaultCurrency: 'USD', remarks: '', status: 'ACTIVE' };
export default function Customers({ customers, onSaved, onChanged, onContracts, onHistory }: {
  customers: Customer[]; onSaved: (customer: Customer) => void; onChanged: () => Promise<void>;
  onContracts: (id: string) => void; onHistory: (id: string) => void;
}) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState('');
  const [form, setForm] = useState<CustomerInput | null>(null), [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(''), [warning, setWarning] = useState('');
  const [refreshing, setRefreshing] = useState(false), [savedId, setSavedId] = useState<string | null>(null);
  const mounted = useRef(true), pending = useRef(false), operation = useRef(0);
  const savedRow = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { savedRow.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [customers, savedId]);
  function patch<K extends keyof CustomerInput>(key: K, value: CustomerInput[K]) { setForm(current => current ? { ...current, [key]: value } : current); }
  async function refreshSaved(id: number) {
    if (mounted.current && operation.current === id) setRefreshing(true);
    try {
      await onChanged();
      if (mounted.current && operation.current === id) setWarning('');
    } catch (failure) {
      if (mounted.current && operation.current === id) setWarning(`客戶已儲存，但重新讀取資料失敗：${(failure as Error).message}。清單已保留已儲存資料，請勿重複新增。`);
    } finally { if (mounted.current && operation.current === id) setRefreshing(false); }
  }
  async function persist(input: CustomerInput, customerId: string | null, closeForm: boolean) {
    if (pending.current) return;
    pending.current = true;
    const id = ++operation.current;
    setBusy(true); setError(''); setSuccess(''); setWarning('');
    let saved: Customer;
    try { saved = await api<Customer>(`customers${customerId ? `/${customerId}` : ''}`, customerId ? 'PUT' : 'POST', input); }
    catch (failure) {
      if (mounted.current) setError((failure as Error).message);
      return;
    } finally { pending.current = false; if (mounted.current) setBusy(false); }

    // The mutation response is committed database data. Display it before any
    // unrelated refresh, and never present a later read failure as a failed save.
    try { onSaved(saved); }
    catch { if (mounted.current) setWarning('客戶已儲存，但畫面更新失敗。請重新整理資料，請勿重複新增。'); }
    if (mounted.current) {
      setQuery(''); setStatus(''); setSavedId(saved.id);
      setSuccess(`客戶已儲存：${saved.name}（${saved.code}）。`);
      if (closeForm) { setForm(null); setEditId(null); }
    }
    void refreshSaved(id);
  }
  function save(event: React.FormEvent) { event.preventDefault(); if (form) void persist(form, editId, true); }
  function deactivate(customer: Customer) { void persist({ ...customer, status: customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, customer.id, false); }
  function open(customer?: Customer) { setEditId(customer?.id ?? null); setForm(customer ? { ...customer } : { ...blank }); setError(''); }
  const filtered = customers.filter(customer => (!status || customer.status === status) && `${customer.code} ${customer.name} ${customer.contact} ${customer.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className="toolbar"><div className="search-group">
      <input aria-label="搜尋客戶" placeholder="搜尋客戶名稱、代碼或聯絡人" value={query} onChange={event => { setQuery(event.target.value); setSavedId(null); }} />
      <select aria-label="客戶狀態" value={status} onChange={event => { setStatus(event.target.value); setSavedId(null); }}><option value="">全部狀態</option><option value="ACTIVE">啟用中</option><option value="INACTIVE">已停用</option></select>
    </div><button type="button" className="btn" disabled={busy} onClick={() => open()}>＋ 新增客戶</button></div>
    {error && <div role="alert" className="alert danger">{error}</div>}
    {success && <div role="status" className="alert success">{success}</div>}
    {warning && <div role="alert" className="alert warning">{warning} <button type="button" className="btn-secondary" disabled={refreshing} onClick={() => { void refreshSaved(operation.current); }}>{refreshing ? '同步中…' : '重新整理資料'}</button></div>}
    {form && <form className="panel" onSubmit={save}>
      <div className="section-title"><h2>{editId ? '編輯客戶' : '新增客戶'}</h2><span className="muted">Customer master</span></div>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="form-grid">
        <Field label="Customer Name 客戶名稱 *"><input required maxLength={120} value={form.name} onChange={event => patch('name', event.target.value)} /></Field>
        <Field label="Customer Code 客戶代碼 *"><input required maxLength={120} value={form.code} onChange={event => patch('code', event.target.value)} /></Field>
        <Field label="聯絡人"><input maxLength={120} value={form.contact} onChange={event => patch('contact', event.target.value)} /></Field>
        <Field label="Email"><input type="email" maxLength={254} value={form.email} onChange={event => patch('email', event.target.value)} /></Field>
        <Field label="電話"><input maxLength={120} value={form.phone} onChange={event => patch('phone', event.target.value)} /></Field>
        <Field label="預設幣別"><select value={form.defaultCurrency} onChange={event => patch('defaultCurrency', event.target.value as 'USD' | 'TWD')}><option>USD</option><option>TWD</option></select></Field>
        <Field label="狀態"><select value={form.status} onChange={event => patch('status', event.target.value as 'ACTIVE' | 'INACTIVE')}><option value="ACTIVE">啟用</option><option value="INACTIVE">停用</option></select></Field>
        <Field label="備註" wide><textarea maxLength={2000} value={form.remarks} onChange={event => patch('remarks', event.target.value)} /></Field>
      </div><div className="actions"><button type="submit" disabled={busy} className="btn">{busy ? '儲存中…' : '儲存客戶'}</button><button type="button" className="btn-secondary" onClick={() => setForm(null)}>取消</button></div></fieldset>
    </form>}
    <div className="panel table-wrap"><table><thead><tr><th>代碼 / Customer ID</th><th>客戶名稱</th><th>聯絡資料</th><th>幣別</th><th>狀態</th><th>操作</th></tr></thead><tbody>
      {filtered.map(customer => <tr key={customer.id} data-customer-id={customer.id} ref={customer.id === savedId ? savedRow : undefined} style={customer.id === savedId ? { backgroundColor: '#ecfdf5' } : undefined}>
        <td><strong>{customer.code}</strong><small className="mono">{customer.id}</small></td><td>{customer.name}</td><td>{customer.contact || '—'}<small>{customer.email} {customer.phone}</small></td><td>{customer.defaultCurrency}</td><td><Badge tone={customer.status === 'ACTIVE' ? 'success' : ''}>{customer.status === 'ACTIVE' ? '啟用' : '停用'}</Badge></td>
        <td><div className="row-actions"><button type="button" disabled={busy} onClick={() => open(customer)}>編輯</button><button type="button" onClick={() => onContracts(customer.id)}>合約</button><button type="button" onClick={() => onHistory(customer.id)}>歷史報價</button><button type="button" disabled={busy} onClick={() => deactivate(customer)}>{customer.status === 'ACTIVE' ? '停用' : '啟用'}</button></div></td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty>沒有符合條件的客戶。新增客戶後，即可維護合約與建立報價。</Empty>}</div>
  </>;
}
