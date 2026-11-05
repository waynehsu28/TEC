'use client';

import type { ChargeInput, Currency, RateBreak } from '@/lib/types';
import { normalWeightRange } from '@/lib/charge-rates';

export default function ChargeWeightRates({ label, currency, rate, breaks, onChange }: {
  label: string; currency: Currency; rate: string; breaks: RateBreak[];
  onChange?: (patch: Partial<ChargeInput>) => void;
}) {
  return <div className="panel" style={{ margin: '8px 0' }}>
    <div className="section-title"><strong>{label} · 重量級距</strong>{onChange && <button type="button" className="btn-secondary" onClick={() => onChange({ breaks: [...breaks, { weight: '', rate: '' }] })}>＋ {label} 自訂級距</button>}</div>
    <p className="muted">按已達門檻的最高級距單價 × 全部重量；未達任何已填級距使用 Normal。+45 包含 45 KG；未填單價的級距不儲存。</p>
    <div className="table-wrap"><table className={onChange ? 'input-table' : undefined} aria-label={`${label} 重量級距`}>
      <thead><tr><th>重量區間 / 數量下限 KG（含）</th><th>單價 {currency}/KG</th>{onChange && <th>操作</th>}</tr></thead>
      <tbody>
        <tr><td><strong>{normalWeightRange(breaks)}</strong><small>Normal · 一般單價</small></td>
          <td>{onChange ? <input aria-label={`${label} Normal 單價`} inputMode="decimal" placeholder="未滿 45 KG 單價" value={rate} onChange={event => onChange({ rate: event.target.value })} /> : rate || '未設定'}</td>{onChange && <td />}</tr>
        {breaks.map((tier, index) => <tr key={index}>
          <td>{onChange ? <input aria-label={`${label} 級距數量 ${index + 1}`} inputMode="decimal" required={tier.rate.trim() !== ''} value={tier.weight} onChange={event => onChange({ breaks: breaks.map((row, i) => i === index ? { ...row, weight: event.target.value } : row) })} /> : `+${tier.weight} KG`}</td>
          <td>{onChange ? <input aria-label={`${label} 級距單價 ${index + 1}`} inputMode="decimal" value={tier.rate} onChange={event => onChange({ breaks: breaks.map((row, i) => i === index ? { ...row, rate: event.target.value } : row) })} /> : tier.rate}</td>
          {onChange && <td><button type="button" className="text-danger" onClick={() => onChange({ breaks: breaks.filter((_, i) => i !== index) })}>移除</button></td>}
        </tr>)}
      </tbody>
    </table></div>
  </div>;
}
