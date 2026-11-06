'use client';
import { useRef, useState } from 'react';
import type { Settings, Currency, CustomsExchangeRate, FxSource } from '@/lib/types';
import { api, Field } from './ui';
import CustomsRatePicker from './CustomsRatePicker';

const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Settings>(() => ({ ...settings, exchangeRateSource: settings.exchangeRateSource ?? 'MANUAL', customsRateSide: settings.customsRateSide ?? 'EXPORT', exchangeRateDate: settings.exchangeRateSource === 'CUSTOMS' ? settings.exchangeRateDate || taipeiToday() : settings.exchangeRateDate }));
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
  const [customsRate, setCustomsRate] = useState<CustomsExchangeRate | null>(null);
  const [customsStatus, setCustomsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const manual = useRef({ rate: settings.exchangeRate, date: settings.exchangeRateDate });
  const automatic = form.exchangeRateSource === 'CUSTOMS';
  const rateReady = !automatic || customsStatus === 'ready' && customsRate?.date === form.exchangeRateDate && customsRate.side === form.customsRateSide && customsRate.rate === form.exchangeRate;
  function patch<K extends keyof Settings>(key: K, value: Settings[K]) { setForm(current => ({ ...current, [key]: value })); setSuccess(''); }
  function source(value: FxSource) {
    if (value === form.exchangeRateSource) return;
    if (value === 'CUSTOMS') {
      manual.current = { rate: form.exchangeRate, date: form.exchangeRateDate };
      setCustomsStatus('loading'); setCustomsRate(null);
      setForm(current => ({ ...current, exchangeRateSource: value, exchangeRateDate: current.exchangeRateDate || taipeiToday() }));
    } else setForm(current => ({ ...current, exchangeRateSource: value, exchangeRate: manual.current.rate, exchangeRateDate: manual.current.date }));
    setSuccess(''); setError('');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy || !rateReady) return;
    setBusy(true); setError(''); setSuccess('');
    try { await api('settings', 'PUT', form); await onSaved(); setSuccess('設定已儲存；既有報價快照不受影響。'); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  function logo(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('Logo 僅接受 PNG 或 JPEG。'); return; }
    if (file.size > 1024 * 1024) { setError('Logo 檔案不可超過 1 MB。'); return; }
    const reader = new FileReader(); reader.onload = () => patch('companyLogo', String(reader.result)); reader.onerror = () => setError('Logo 讀取失敗'); reader.readAsDataURL(file);
  }
  return <form onSubmit={save} className="panel settings-panel">
    <div className="section-title"><h2>公司與報價設定</h2><span className="muted">工作站資料 · SQLite</span></div>
    {error && <div role="alert" className="alert danger">{error}</div>}{success && <div role="status" className="alert success">{success}</div>}
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="form-grid">
      <Field label="Company Name 公司名稱 *"><input required value={form.companyName} onChange={event => patch('companyName', event.target.value)} /></Field>
      <Field label="預設幣別"><select value={form.defaultCurrency} onChange={event => patch('defaultCurrency', event.target.value as Currency)}><option>USD</option><option>TWD</option></select></Field>
      <Field label="材積除數 Volume Divisor *"><input required inputMode="decimal" value={form.volumeDivisor} onChange={event => patch('volumeDivisor', event.target.value)} /></Field>
      <Field label="計費重量進位單位 KG *"><input required inputMode="decimal" value={form.weightIncrement} onChange={event => patch('weightIncrement', event.target.value)} /></Field>
      <Field label="匯率來源"><select value={form.exchangeRateSource ?? 'MANUAL'} onChange={event => source(event.target.value as FxSource)}><option value="CUSTOMS">海關三旬匯率</option><option value="MANUAL">手動輸入</option></select></Field>
      <Field label="匯率：1 USD = ? TWD"><input readOnly={automatic} inputMode="decimal" placeholder={automatic ? '依海關三旬公告取得' : '未設定；跨幣別總額將暫停計算'} value={form.exchangeRate} onChange={event => patch('exchangeRate', event.target.value)} /></Field>
      <Field label="匯率使用日期"><input type="date" value={form.exchangeRateDate} onChange={event => { setCustomsStatus('loading'); patch('exchangeRateDate', event.target.value); }} /></Field>
      {automatic && <CustomsRatePicker date={form.exchangeRateDate} side={form.customsRateSide ?? 'EXPORT'} disabled={busy} onSideChange={side => { setCustomsStatus('loading'); patch('customsRateSide', side); }} onStatusChange={setCustomsStatus} onLoaded={rate => { setCustomsRate(rate); setForm(current => ({ ...current, exchangeRate: rate.rate, exchangeRateDate: rate.date, customsRateSide: rate.side })); setSuccess(''); }} />}
      <Field label="Company Logo（PNG / JPEG，最多 1 MB）" wide><input type="file" accept="image/png,image/jpeg" onChange={event => logo(event.target.files?.[0])} /></Field>
      {form.companyLogo && <div className="logo-preview wide"><img src={form.companyLogo} alt="公司 Logo 預覽" /><button type="button" className="btn-secondary" onClick={() => patch('companyLogo', '')}>移除 Logo</button></div>}
      <Field label="預設報價條件 Terms and Conditions（可留空，報價時可調整）" wide><textarea rows={6} placeholder="請自行輸入公司核准的報價條件" value={form.terms} onChange={event => patch('terms', event.target.value)} /></Field>
    </div><div className="alert">重量計算先加總各組實重與材積重，再取較大值並向上進位。匯率與計算設定會保存於每份報價快照。</div>
    <div className="actions"><button disabled={busy || !rateReady} className="btn">{busy ? '儲存中…' : '儲存設定'}</button></div></fieldset>
  </form>;
}
