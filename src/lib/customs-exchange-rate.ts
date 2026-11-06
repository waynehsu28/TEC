import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici';
import type { CustomsExchangeRate, CustomsRateSide } from './types';

export const CUSTOMS_EXCHANGE_RATE_URL = 'https://portal.sw.nat.gov.tw/APGQ/GC331!downLoad?formBean.downLoadFile=CURRENT_JSON';
const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 256 * 1024;

export class CustomsRateError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

interface CustomsResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): {
    read(): Promise<{ done?: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  } } | null;
}
export type CustomsRateFetcher = (url: string, options: {
  method: 'GET'; redirect: 'error'; signal: AbortSignal; headers: Record<string, string>;
}) => Promise<CustomsResponse>;
interface Dataset { validFrom: string; validTo: string; buy: string; sell: string; fetchedAt: string }

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function isoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function officialDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) throw new CustomsRateError('海關匯率資料的適用日期格式不正確。');
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (!isoDate(date)) throw new CustomsRateError('海關匯率資料的適用日期不存在。');
  return date;
}
function positiveRate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 25 && /^(?:0|[1-9]\d{0,14})(?:\.\d{1,8})?$/.test(value) && /[1-9]/.test(value);
}
function parseDataset(raw: unknown, fetchedAt: string): Dataset {
  if (!record(raw) || !Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > 500) throw new CustomsRateError('海關匯率資料格式不正確。');
  const validFrom = officialDate(raw.start);
  const validTo = officialDate(raw.end);
  if (validFrom > validTo || validFrom.slice(0, 7) !== validTo.slice(0, 7)) throw new CustomsRateError('海關匯率的適用期間不正確。');
  const startDay = Number(validFrom.slice(8));
  const lastDay = new Date(Date.UTC(Number(validTo.slice(0, 4)), Number(validTo.slice(5, 7)), 0)).getUTCDate();
  const expectedEnd = startDay === 1 ? 10 : startDay === 11 ? 20 : startDay === 21 ? lastDay : null;
  if (Number(validTo.slice(8)) !== expectedEnd) throw new CustomsRateError('海關匯率資料不是完整的上旬、中旬或下旬。');
  const codes = new Set<string>();
  let usd: { buy: string; sell: string } | null = null;
  for (const item of raw.items) {
    if (!record(item) || typeof item.code !== 'string' || !/^[A-Z]{3}$/.test(item.code) || !positiveRate(item.buyValue) || !positiveRate(item.sellValue)) throw new CustomsRateError('海關匯率資料含有無效的幣別或單價。');
    if (codes.has(item.code)) throw new CustomsRateError('海關匯率資料含有重複幣別。');
    codes.add(item.code);
    if (item.code === 'USD') usd = { buy: item.buyValue, sell: item.sellValue };
  }
  if (!usd) throw new CustomsRateError('海關匯率資料沒有美元 USD 匯率。');
  return { validFrom, validTo, ...usd, fetchedAt };
}

async function discardBody(response: CustomsResponse): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  try { await reader.cancel(); } finally { reader.releaseLock(); }
}

async function limitedJson(response: CustomsResponse): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) {
    await discardBody(response);
    throw new CustomsRateError('海關匯率回應超過大小限制。');
  }
  if (!response.body) throw new CustomsRateError('海關匯率回應沒有資料。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new CustomsRateError('海關匯率回應超過大小限制。');
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    try { return JSON.parse(body); }
    catch { throw new CustomsRateError('海關匯率回應不是有效的 JSON，請稍後重試或改用手動匯率。'); }
  } finally { reader.releaseLock(); }
}

let dispatcher: EnvHttpProxyAgent | undefined;
const defaultFetcher: CustomsRateFetcher = (url, options) => {
  dispatcher ??= new EnvHttpProxyAgent();
  return proxyFetch(url, { ...options, dispatcher });
};

/** The source remains the official fixed endpoint, including when a test injects its transport. */
export function createCustomsExchangeRateClient(options: { fetcher?: CustomsRateFetcher; now?: () => number } = {}) {
  const fetcher = options.fetcher ?? defaultFetcher;
  const now = options.now ?? Date.now;
  let cached: { dataset: Dataset; at: number } | null = null;
  let pending: Promise<Dataset> | null = null;

  function load(): Promise<Dataset> {
    if (cached && now() - cached.at >= 0 && now() - cached.at < CACHE_MS) return Promise.resolve(cached.dataset);
    if (pending) return pending;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new CustomsRateError('海關匯率連線逾時，請稍後重試或改用手動匯率。'));
      }, TIMEOUT_MS);
    });
    const operation = (async () => {
      const response = await fetcher(CUSTOMS_EXCHANGE_RATE_URL, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        await discardBody(response);
        throw new CustomsRateError(`海關匯率服務暫時無法使用（HTTP ${response.status}），請稍後重試或改用手動匯率。`);
      }
      return parseDataset(await limitedJson(response), new Date(now()).toISOString());
    })();
    pending = Promise.race([operation, timeout]).then(dataset => {
      cached = { dataset, at: now() };
      return dataset;
    }).catch(error => {
      if (error instanceof CustomsRateError) throw error;
      throw new CustomsRateError('無法連線海關匯率服務，請稍後重試或改用手動匯率。');
    }).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
      pending = null;
    });
    return pending;
  }

  return async function getRate(date: string, side: CustomsRateSide): Promise<CustomsExchangeRate> {
    if (!isoDate(date)) throw new CustomsRateError('請提供有效的匯率適用日期（YYYY-MM-DD）。', 400);
    if (side !== 'EXPORT' && side !== 'IMPORT') throw new CustomsRateError('請選擇進口或出口匯率。', 400);
    const dataset = await load();
    if (date < dataset.validFrom || date > dataset.validTo) throw new CustomsRateError(`海關目前公告匯率僅適用 ${dataset.validFrom} 至 ${dataset.validTo}，不包含 ${date}；請改用手動匯率。`, 422);
    return { currency: 'USD', date, side, rate: side === 'EXPORT' ? dataset.buy : dataset.sell,
      validFrom: dataset.validFrom, validTo: dataset.validTo, sourceUrl: CUSTOMS_EXCHANGE_RATE_URL, fetchedAt: dataset.fetchedAt };
  };
}

export const getCustomsExchangeRate = createCustomsExchangeRateClient();
