import { z } from 'zod';
import Decimal from 'decimal.js';
import { validCompanyLogo } from './logo';

const text = z.string().trim().max(2000);
const shortText = z.string().trim().max(120);
const identifier = z.string().trim().min(1).max(100);
export const currencySchema = z.enum(['USD', 'TWD']);
export const quoteStatusSchema = z.enum(['Draft', 'Quoted', 'Accepted', 'Rejected', 'Expired']);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD').refine((s) => {
  const parsed = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === s;
}, '日期不存在');
// Accept decimal strings only, with no exponent or binary floating point coercion.
export const decimalSchema = z.string().trim().max(25).regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,8})?$/, '請輸入非負十進位數字（最多 8 位小數）');
const positiveDecimal = decimalSchema.refine((s) => /[1-9]/.test(s), '數值必須大於零');
const optionalDecimal = z.union([decimalSchema, z.literal('')]);
const optionalPositiveDecimal = z.union([positiveDecimal, z.literal('')]);
const airport = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, '請輸入 3 碼 IATA 機場代碼');
const entityStatus = z.enum(['ACTIVE', 'INACTIVE']);

export const customerSchema = z.object({
  name: shortText.min(1, '請輸入客戶名稱'), code: shortText.min(1, '請輸入客戶代碼'), contact: shortText,
  email: z.union([z.email().max(254), z.literal('')]), phone: shortText,
  defaultCurrency: currencySchema, remarks: text, status: entityStatus,
});
export const chargeSchema = z.object({
  id: identifier.optional(), name: shortText.min(1, '請輸入費用名稱'),
  basis: z.enum(['PER_KG', 'PER_SHIPMENT', 'PER_PIECE', 'MINIMUM', 'MANUAL']),
  rate: decimalSchema, currency: currencySchema, included: z.boolean(),
  minimumAmount: optionalDecimal.optional(), manualAmount: optionalDecimal.optional(),
});
export const contractSchema = z.object({
  customerId: identifier, number: shortText.min(1, '請輸入合約編號'), status: entityStatus,
  origin: airport, destination: airport, airline: shortText, serviceType: shortText, commodity: shortText,
  effectiveDate: dateSchema, expiryDate: dateSchema, currency: currencySchema,
  rateType: z.enum(['BASE_PLUS', 'ALL_IN']), minimumCharge: optionalDecimal, normalRate: optionalDecimal,
  breaks: z.array(z.object({ weight: positiveDecimal, rate: decimalSchema })).max(50),
  charges: z.array(chargeSchema).max(100), remarks: text,
}).superRefine((input, ctx) => {
  if (input.effectiveDate > input.expiryDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: '到期日不得早於生效日' });
  if (input.minimumCharge === '' && input.normalRate === '' && input.breaks.length === 0) ctx.addIssue({ code: 'custom', path: ['normalRate'], message: '請至少設定 MIN、Normal 或一個重量級距' });
  const weights = input.breaks.map((b) => decimalSchema.safeParse(b.weight).success ? new Decimal(b.weight).toString() : b.weight);
  if (new Set(weights).size !== weights.length) ctx.addIssue({ code: 'custom', path: ['breaks'], message: '重量級距不得重複' });
  const ids = input.charges.flatMap((c) => c.id ? [c.id] : []);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['charges'], message: '費用識別碼不得重複' });
});
export const settingsSchema = z.object({
  companyName: shortText, companyLogo: z.string().max(1_398_130).refine(validCompanyLogo, 'Logo 須為有效 PNG/JPEG，最大 1MB、4096px 且最多 400 萬像素'),
  volumeDivisor: positiveDecimal, weightIncrement: positiveDecimal, defaultCurrency: currencySchema,
  exchangeRate: optionalPositiveDecimal, exchangeRateDate: z.union([dateSchema, z.literal('')]), terms: z.string().trim().max(10000),
}).superRefine((input, ctx) => {
  if (input.exchangeRate && !input.exchangeRateDate) ctx.addIssue({ code: 'custom', path: ['exchangeRateDate'], message: '設定匯率時須記錄日期' });
});
export const matchSchema = z.object({
  customerId: identifier, origin: airport, destination: airport, airline: shortText,
  serviceType: shortText, commodity: shortText, shipmentDate: dateSchema,
});
export const cargoSchema = z.object({
  pieces: z.number().int().min(1).max(1_000_000), length: positiveDecimal, width: positiveDecimal,
  height: positiveDecimal, grossWeight: decimalSchema, weightMode: z.enum(['PER_PIECE', 'GROUP_TOTAL']),
});
export const quoteSchema = matchSchema.extend({
  cargo: z.array(cargoSchema).min(1, '請至少輸入一組貨物').max(200),
  contractVersionId: identifier.nullable(),
  manualFreight: z.object({ amount: decimalSchema, currency: currencySchema }).nullable(),
  chargeOverrides: z.array(z.object({ chargeId: identifier, rate: decimalSchema, manualAmount: optionalDecimal.optional() })).max(100),
  temporaryCharges: z.array(chargeSchema).max(100),
  costs: z.array(z.object({ name: shortText.min(1), amount: decimalSchema.nullable(), currency: currencySchema, status: z.enum(['ESTIMATED', 'ACTUAL']) })).max(100),
  costsComplete: z.boolean(), analysisCurrency: currencySchema, fxRate: optionalPositiveDecimal,
  fxDate: z.union([dateSchema, z.literal('')]), validity: dateSchema, remarks: text, terms: z.string().trim().max(10000),
  status: quoteStatusSchema, revisionOfId: identifier.nullable(),
}).superRefine((input, ctx) => {
  if (input.fxRate && !input.fxDate) ctx.addIssue({ code: 'custom', path: ['fxDate'], message: '使用匯率時須記錄日期' });
  const ids = input.chargeOverrides.map((c) => c.chargeId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['chargeOverrides'], message: '同一合約費用不得重複調整' });
  if (input.contractVersionId !== null && input.manualFreight !== null) ctx.addIssue({ code: 'custom', path: ['manualFreight'], message: '合約售價與手動售價只能擇一' });
});
