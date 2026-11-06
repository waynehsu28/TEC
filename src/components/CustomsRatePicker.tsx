'use client';

import { useEffect, useRef, useState } from 'react';
import type { CustomsExchangeRate, CustomsRateSide } from '@/lib/types';

type RateStatus = 'loading' | 'ready' | 'error';
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export default function CustomsRatePicker({ date, side, onSideChange, onLoaded, onStatusChange, disabled = false }: {
  date: string; side: CustomsRateSide; onSideChange: (side: CustomsRateSide) => void;
  onLoaded: (rate: CustomsExchangeRate) => void; onStatusChange?: (status: RateStatus) => void; disabled?: boolean;
}) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; status: RateStatus; rate?: CustomsExchangeRate; error?: string }>({ key: '', status: 'loading' });
  const callbacks = useRef({ onLoaded, onStatusChange });
  const completed = useRef<{ key: string; retry: number } | null>(null);
  callbacks.current = { onLoaded, onStatusChange };
  const key = `${date}:${side}`;

  useEffect(() => {
    if (disabled) return;
    // A save can temporarily disable the controls; resuming must not fetch or apply the same rate again.
    if (completed.current?.key === key && completed.current.retry === retry && state.key === key && state.status === 'ready') return;
    const controller = new AbortController();
    if (!validDate(date)) {
      setState({ key, status: 'error', error: '請先選擇有效的匯率使用日期。' });
      callbacks.current.onStatusChange?.('error');
      return () => controller.abort();
    }
    setState({ key, status: 'loading' });
    callbacks.current.onStatusChange?.('loading');
    (async () => {
      try {
        const response = await fetch(`/api/customs-exchange-rate?date=${encodeURIComponent(date)}&side=${side}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(data.error || '海關匯率取得失敗，請重試或改用手動匯率。');
        if (data.currency !== 'USD' || data.date !== date || data.side !== side || typeof data.rate !== 'string'
          || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(data.rate) || !/[1-9]/.test(data.rate)
          || !validDate(data.validFrom) || !validDate(data.validTo) || data.validFrom > date || data.validTo < date
          || typeof data.sourceUrl !== 'string' || !data.sourceUrl.startsWith('https://portal.sw.nat.gov.tw/')) {
          throw new Error('海關匯率資料與所選日期或類別不符，請重試。');
        }
        completed.current = { key, retry };
        setState({ key, status: 'ready', rate: data as CustomsExchangeRate });
        callbacks.current.onLoaded(data as CustomsExchangeRate);
        callbacks.current.onStatusChange?.('ready');
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ key, status: 'error', error: error instanceof Error ? error.message : '海關匯率取得失敗，請重試或改用手動匯率。' });
        callbacks.current.onStatusChange?.('error');
      }
    })();
    return () => controller.abort();
  }, [date, side, key, retry, disabled]);

  const current = state.key === key ? state : { status: 'loading' as const };
  return <div className="wide">
    <div className="toolbar">
      <label className="field">海關匯率類別<select value={side} disabled={disabled} onChange={event => onSideChange(event.target.value as CustomsRateSide)}><option value="EXPORT">出口（買進）</option><option value="IMPORT">進口（賣出）</option></select></label>
      <button type="button" className="btn-secondary" disabled={disabled || current.status === 'loading'} onClick={() => setRetry(value => value + 1)}>重新取得海關匯率</button>
    </div>
    {current.status === 'loading' && <div role="status" className="alert">正在取得海關三旬匯率…</div>}
    {current.status === 'error' && <div role="alert" className="alert warning">{current.error} 可重新取得，或將匯率來源改為手動輸入。</div>}
    {current.status === 'ready' && current.rate && <div role="status" className="alert">海關三旬匯率：1 USD = {current.rate.rate} TWD · 適用期間 {current.rate.validFrom} 至 {current.rate.validTo} · <a href={current.rate.sourceUrl} target="_blank" rel="noreferrer">官方來源</a></div>}
  </div>;
}
