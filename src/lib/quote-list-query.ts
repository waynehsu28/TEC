import { z } from 'zod';
import type { QuoteListQuery } from './types';

const positiveInteger = (fallback: number, maximum: number) => z.union([
  z.number(), z.string().regex(/^[1-9]\d*$/, '請輸入正整數').transform(Number),
]).pipe(z.number().int().min(1).max(maximum)).default(fallback);

export const quoteListQuerySchema = z.object({
  page: positiveInteger(1, 1_000_000),
  pageSize: positiveInteger(20, 100).refine(value => [20, 50, 100].includes(value), '每頁筆數須為 20、50 或 100'),
  q: z.string().trim().max(120, '搜尋文字最多 120 字').default(''),
  customerId: z.string().regex(/^[A-Za-z0-9_-]{0,100}$/, '客戶識別碼格式不正確').default(''),
  status: z.enum(['', 'Draft', 'Quoted', 'Accepted', 'Rejected', 'Expired']).default(''),
  transportMode: z.enum(['', 'AIR', 'SEA']).default(''),
}).strict();

export function parseQuoteListQuery(raw: unknown = {}): QuoteListQuery { return quoteListQuerySchema.parse(raw); }
