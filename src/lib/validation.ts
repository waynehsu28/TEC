import { z } from 'zod';
import Decimal from 'decimal.js';
import { validCompanyLogo } from './logo';
import { COUNTRY_CODES } from './countries';

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
const entityStatus = z.enum(['ACTIVE', 'INACTIVE']);
const countries = new Set(COUNTRY_CODES);
const country = z.string().trim().toUpperCase().refine((value) => value === '' || countries.has(value), '請選擇有效的 ISO 國家代碼').default('');
const routingShape = {
  transportMode: z.enum(['AIR', 'SEA']).default('AIR'), routeScope: z.enum(['AIRPORT', 'COUNTRY']).default('AIRPORT'),
  originCountry: country, destinationCountry: country,
  origin: shortText.default(''), destination: shortText.default(''),
  seaShipmentType: z.enum(['', 'LCL', 'FCL']).default(''), containerType: z.enum(['', '20GP', '40GP', '40HQ']).default(''),
};
type ParsedRouting = {
  transportMode: 'AIR' | 'SEA'; routeScope: 'AIRPORT' | 'COUNTRY'; originCountry: string; destinationCountry: string;
  origin: string; destination: string; seaShipmentType: '' | 'LCL' | 'FCL'; containerType: '' | '20GP' | '40GP' | '40HQ';
};
function validateRouting(input: ParsedRouting, ctx: z.RefinementCtx) {
  if (input.routeScope === 'COUNTRY') {
    if (!input.originCountry) ctx.addIssue({ code: 'custom', path: ['originCountry'], message: '請選擇起運國家' });
    if (!input.destinationCountry) ctx.addIssue({ code: 'custom', path: ['destinationCountry'], message: '請選擇目的國家' });
  } else {
    for (const field of ['origin', 'destination'] as const) {
      if (!/^[A-Za-z]{3}$/.test(input[field])) ctx.addIssue({ code: 'custom', path: [field], message: '請輸入 3 碼 IATA 機場代碼' });
    }
  }
  if (input.transportMode === 'AIR') {
    if (input.seaShipmentType || input.containerType) ctx.addIssue({ code: 'custom', path: ['seaShipmentType'], message: '空運不可設定海運模式或櫃型' });
  } else {
    if (input.routeScope !== 'COUNTRY') ctx.addIssue({ code: 'custom', path: ['routeScope'], message: '海運合約須按起運國家與目的國家定價' });
    if (!input.seaShipmentType) ctx.addIssue({ code: 'custom', path: ['seaShipmentType'], message: '請選擇散貨 LCL 或整櫃 FCL' });
    if (input.seaShipmentType === 'FCL' && !input.containerType) ctx.addIssue({ code: 'custom', path: ['containerType'], message: '整櫃 FCL 須選擇櫃型' });
    if (input.seaShipmentType === 'LCL' && input.containerType) ctx.addIssue({ code: 'custom', path: ['containerType'], message: '散貨 LCL 不可設定櫃型' });
  }
}
function canonicalRouting<T extends ParsedRouting>(input: T): T {
  return input.routeScope === 'AIRPORT' ? { ...input, origin: input.origin.toUpperCase(), destination: input.destination.toUpperCase() } : input;
}

export const customerSchema = z.object({
  name: shortText.min(1, '請輸入客戶名稱'), code: shortText.min(1, '請輸入客戶代碼'), contact: shortText,
  email: z.union([z.email().max(254), z.literal('')]), phone: shortText,
  defaultCurrency: currencySchema, remarks: text, status: entityStatus,
});
export const chargeSchema = z.object({
  id: identifier.optional(), name: shortText.min(1, '請輸入費用名稱'),
  basis: z.enum(['PER_KG', 'PER_SHIPMENT', 'PER_PIECE', 'PER_CBM', 'PER_CONTAINER', 'MINIMUM', 'MANUAL']),
  rate: decimalSchema, currency: currencySchema, included: z.boolean(),
  minimumAmount: optionalDecimal.optional(), manualAmount: optionalDecimal.optional(),
});
export const contractSchema = z.object({
  customerId: identifier, number: shortText.min(1, '請輸入合約編號'), status: entityStatus,
  ...routingShape, pricingBasis: z.enum(['PER_KG', 'PER_CBM', 'PER_CONTAINER']).default('PER_KG'),
  airline: shortText, serviceType: shortText, commodity: shortText,
  effectiveDate: dateSchema, expiryDate: dateSchema, currency: currencySchema,
  rateType: z.enum(['BASE_PLUS', 'ALL_IN']), minimumCharge: optionalDecimal, normalRate: optionalDecimal,
  breaks: z.array(z.object({ weight: positiveDecimal, rate: decimalSchema })).max(50),
  charges: z.array(chargeSchema).max(100), remarks: text,
}).superRefine((input, ctx) => {
  validateRouting(input, ctx);
  const expectedBasis = input.transportMode === 'AIR' ? 'PER_KG' : input.seaShipmentType === 'FCL' ? 'PER_CONTAINER' : 'PER_CBM';
  if (input.pricingBasis !== expectedBasis) ctx.addIssue({ code: 'custom', path: ['pricingBasis'], message: '空運使用每 KG，海運散貨使用每 CBM，海運整櫃使用每櫃計價' });
  if ((input.transportMode !== 'SEA' || input.seaShipmentType !== 'FCL') && input.charges.some((charge) => charge.basis === 'PER_CONTAINER')) ctx.addIssue({ code: 'custom', path: ['charges'], message: '每櫃附加費僅適用海運整櫃 FCL' });
  if (input.effectiveDate > input.expiryDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: '到期日不得早於生效日' });
  if (input.minimumCharge === '' && input.normalRate === '' && input.breaks.length === 0) ctx.addIssue({ code: 'custom', path: ['normalRate'], message: '請至少設定 MIN、Normal 或一個數量級距' });
  const weights = input.breaks.map((b) => decimalSchema.safeParse(b.weight).success ? new Decimal(b.weight).toString() : b.weight);
  if (new Set(weights).size !== weights.length) ctx.addIssue({ code: 'custom', path: ['breaks'], message: '數量級距不得重複' });
  const ids = input.charges.flatMap((c) => c.id ? [c.id] : []);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['charges'], message: '費用識別碼不得重複' });
}).transform(canonicalRouting);
export const settingsSchema = z.object({
  companyName: shortText, companyLogo: z.string().max(1_398_130).refine(validCompanyLogo, 'Logo 須為有效 PNG/JPEG，最大 1MB、4096px 且最多 400 萬像素'),
  volumeDivisor: positiveDecimal, weightIncrement: positiveDecimal, defaultCurrency: currencySchema,
  exchangeRate: optionalPositiveDecimal, exchangeRateDate: z.union([dateSchema, z.literal('')]), terms: z.string().trim().max(10000),
}).superRefine((input, ctx) => {
  if (input.exchangeRate && !input.exchangeRateDate) ctx.addIssue({ code: 'custom', path: ['exchangeRateDate'], message: '設定匯率時須記錄日期' });
});
const matchBase = z.object({
  customerId: identifier, ...routingShape, airline: shortText,
  serviceType: shortText, commodity: shortText, shipmentDate: dateSchema,
});
export const matchSchema = matchBase.superRefine(validateRouting).transform(canonicalRouting);
export const cargoSchema = z.object({
  pieces: z.number().int().min(1).max(1_000_000), length: positiveDecimal, width: positiveDecimal,
  height: positiveDecimal, grossWeight: decimalSchema, weightMode: z.enum(['PER_PIECE', 'GROUP_TOTAL']),
});
export const quoteSchema = matchBase.extend({
  cargo: z.array(cargoSchema).max(200), containerCount: z.number().int().min(0).max(1_000_000).default(0),
  contractVersionId: identifier.nullable(),
  manualFreight: z.object({ amount: decimalSchema, currency: currencySchema }).nullable(),
  chargeOverrides: z.array(z.object({ chargeId: identifier, rate: decimalSchema, manualAmount: optionalDecimal.optional() })).max(100),
  temporaryCharges: z.array(chargeSchema).max(100),
  costs: z.array(z.object({ name: shortText.min(1), amount: decimalSchema.nullable(), currency: currencySchema, status: z.enum(['ESTIMATED', 'ACTUAL']) })).max(100),
  costsComplete: z.boolean(), analysisCurrency: currencySchema, fxRate: optionalPositiveDecimal,
  fxDate: z.union([dateSchema, z.literal('')]), validity: dateSchema, remarks: text, terms: z.string().trim().max(10000),
  status: quoteStatusSchema, revisionOfId: identifier.nullable(),
}).superRefine((input, ctx) => {
  validateRouting(input, ctx);
  const isFcl = input.transportMode === 'SEA' && input.seaShipmentType === 'FCL';
  if (isFcl && input.containerCount < 1) ctx.addIssue({ code: 'custom', path: ['containerCount'], message: '整櫃 FCL 須提供正整數櫃數' });
  if (!isFcl && input.containerCount !== 0) ctx.addIssue({ code: 'custom', path: ['containerCount'], message: '僅海運整櫃 FCL 可設定櫃數' });
  if (!isFcl && input.cargo.length === 0) ctx.addIssue({ code: 'custom', path: ['cargo'], message: '空運與海運散貨請至少輸入一組貨物' });
  if (!isFcl && input.temporaryCharges.some((charge) => charge.basis === 'PER_CONTAINER')) ctx.addIssue({ code: 'custom', path: ['temporaryCharges'], message: '每櫃附加費僅適用海運整櫃 FCL' });
  if (isFcl && input.cargo.length === 0 && input.temporaryCharges.some((charge) => !charge.included && ['PER_KG', 'PER_CBM', 'PER_PIECE'].includes(charge.basis))) ctx.addIssue({ code: 'custom', path: ['cargo'], message: '按重量、材積或件數計算附加費時須輸入貨物資料' });
  if (input.fxRate && !input.fxDate) ctx.addIssue({ code: 'custom', path: ['fxDate'], message: '使用匯率時須記錄日期' });
  const ids = input.chargeOverrides.map((c) => c.chargeId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['chargeOverrides'], message: '同一合約費用不得重複調整' });
  if (input.contractVersionId !== null && input.manualFreight !== null) ctx.addIssue({ code: 'custom', path: ['manualFreight'], message: '合約售價與手動售價只能擇一' });
}).transform(canonicalRouting);
