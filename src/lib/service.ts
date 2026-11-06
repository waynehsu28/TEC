import { Prisma, PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { db } from './db';
import { customerSchema, contractSchema, settingsSchema, quoteSchema, matchSchema } from './validation';
import { calculateWeights, matchContracts, calculateFreight, calculateCharges, calculateFinance } from './engine';
import { getCustomsExchangeRate } from './customs-exchange-rate';
import type { Customer, ContractInput, ContractRecord, ContractVersion, ContractCandidate, Settings, MatchInput, QuoteInput, QuoteRecord, QuoteSnapshot, FreightResult, CustomsExchangeRate, CustomsRateSide } from './types';

export class ServiceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const contractInclude = {
  versions: { orderBy: { version: 'desc' as const }, include: { breaks: true, charges: { include: { breaks: true } } } },
} satisfies Prisma.ContractInclude;
type DbContract = Prisma.ContractGetPayload<{ include: typeof contractInclude }>;
function asContract(row: DbContract): ContractRecord {
  return {
    id: row.id, customerId: row.customerId, number: row.number, status: row.status as ContractRecord['status'],
    versions: row.versions.map(v => ({
      id: v.id, contractId: v.contractId, version: v.version, origin: v.origin, destination: v.destination,
      transportMode: v.transportMode as ContractVersion['transportMode'], routeScope: v.routeScope as ContractVersion['routeScope'],
      originCountry: v.originCountry, destinationCountry: v.destinationCountry, pricingBasis: v.pricingBasis as ContractVersion['pricingBasis'],
      seaShipmentType: v.seaShipmentType as ContractVersion['seaShipmentType'], containerType: v.containerType as ContractVersion['containerType'],
      airline: v.airline, serviceType: v.serviceType, commodity: v.commodity, effectiveDate: v.effectiveDate,
      expiryDate: v.expiryDate, currency: v.currency as ContractVersion['currency'], rateType: v.rateType as ContractVersion['rateType'],
      minimumCharge: v.minimumCharge, normalRate: v.normalRate, remarks: v.remarks,
      breaks: v.breaks.map(b => ({ weight: b.weight, rate: b.rate })),
      charges: v.charges.map(c => ({ id: c.id, name: c.name, basis: c.basis as ContractVersion['charges'][number]['basis'],
        rate: c.rate, currency: c.currency as ContractVersion['currency'], included: c.included,
        minimumAmount: c.minimumAmount, manualAmount: c.manualAmount,
        ...(c.basis === 'PER_KG_TIERED' ? { breaks: [...c.breaks].sort((a, b) => new Decimal(a.weight).cmp(b.weight)).map(tier => ({ weight: tier.weight, rate: tier.rate })) } : {}) })),
    })),
  };
}
function asCustomer(row: { id: string; name: string; code: string; contact: string; email: string; phone: string; defaultCurrency: string; remarks: string; status: string }): Customer {
  return { id: row.id, name: row.name, code: row.code, contact: row.contact, email: row.email, phone: row.phone,
    defaultCurrency: row.defaultCurrency as Customer['defaultCurrency'], remarks: row.remarks, status: row.status as Customer['status'] };
}
function asQuote(row: { id: string; number: string; revision: number; rootId: string | null; customerId: string; status: string; createdAt: Date; snapshot: string }): QuoteRecord {
  return { id: row.id, number: row.number, revision: row.revision, rootId: row.rootId, customerId: row.customerId,
    status: row.status as QuoteRecord['status'], createdAt: row.createdAt.toISOString(), snapshot: JSON.parse(row.snapshot) as QuoteSnapshot };
}
function routeKey(input: ContractInput) {
  // Preserve the original key for migrated airport contracts. Country rates deliberately
  // exclude optional city/port descriptions so one country price cannot be duplicated by city.
  if (input.routeScope === 'COUNTRY') {
    return JSON.stringify([input.transportMode ?? 'AIR', 'COUNTRY', input.originCountry ?? '', input.destinationCountry ?? '',
      input.seaShipmentType ?? '', input.containerType ?? '', input.airline, input.serviceType, input.commodity].map(v => v.trim().toUpperCase()));
  }
  return [input.origin, input.destination, input.airline, input.serviceType, input.commodity].map(v => v.trim().toUpperCase()).join('|');
}
function versionData(input: ContractInput, version: number) {
  const { customerId: _customerId, number: _number, status: _status, breaks, charges, ...fields } = input;
  return { ...fields, version,
    breaks: { create: breaks.map(b => ({ weight: b.weight, rate: b.rate })) },
    charges: { create: charges.map(c => ({ name: c.name, basis: c.basis, rate: c.rate, currency: c.currency, included: c.included,
      minimumAmount: c.minimumAmount ?? '', manualAmount: c.manualAmount ?? '',
      breaks: { create: (c.breaks ?? []).map(tier => ({ weight: tier.weight, rate: tier.rate })) } })) },
  };
}
function dateCode(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(t => parts.find(p => p.type === t)?.value).join('');
}

export interface ServiceDependencies { getCustomsExchangeRate?: (date: string, side: CustomsRateSide) => Promise<CustomsExchangeRate> }
export function createService(client: PrismaClient, dependencies: ServiceDependencies = {}) {
  const customsExchangeRate = dependencies.getCustomsExchangeRate ?? getCustomsExchangeRate;
  async function ensureCustomer(customerId: string, active = false) {
    const customer = await client.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new ServiceError('找不到客戶', 404);
    if (active && customer.status !== 'ACTIVE') throw new ServiceError('此客戶已停用，無法建立新的合約或報價');
    return customer;
  }
  async function getSettings(): Promise<Settings> {
    const { id: _id, ...settings } = await client.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    return settings as Settings;
  }
  async function getContracts(customerId?: string): Promise<ContractRecord[]> {
    return (await client.contract.findMany({ where: customerId ? { customerId } : {}, include: contractInclude, orderBy: { createdAt: 'desc' } })).map(asContract);
  }
  async function candidates(input: MatchInput): Promise<ContractCandidate[]> {
    await ensureCustomer(input.customerId, true);
    const records = await getContracts(input.customerId);
    const latest = records.filter(c => c.status === 'ACTIVE').flatMap(c => {
      const applicable = c.versions.find(v => v.effectiveDate <= input.shipmentDate && v.expiryDate >= input.shipmentDate);
      return applicable ? [{ ...applicable, customerId: c.customerId, number: c.number, status: c.status }] : [];
    });
    return matchContracts(latest, input);
  }
  async function buildSnapshot(raw: unknown): Promise<QuoteSnapshot> {
    let input = quoteSchema.parse(raw) as QuoteInput;
    const customer = asCustomer(await ensureCustomer(input.customerId, true));
    if (input.revisionOfId) {
      const previous = await client.quote.findFirst({ where: { id: input.revisionOfId, deletedAt: null }, select: { id: true } });
      if (!previous) throw new ServiceError('找不到原始報價', 404);
    }
    if (input.fxSource === 'CUSTOMS') {
      // The submitted rate/metadata are display hints only. The saved calculation always
      // uses the official rate covering this shipment date, selected again on the server.
      const rate = await customsExchangeRate(input.shipmentDate, input.customsRateSide ?? 'EXPORT');
      input = { ...input, customsRateSide: rate.side, fxRate: rate.rate, fxDate: rate.date, customsRate: rate };
    }
    const settings = await getSettings();
    const weights = calculateWeights(input.cargo, settings, input.transportMode ?? 'AIR');
    const matches = await candidates(input);
    let contract: ContractCandidate | null = null;
    if (input.contractVersionId) {
      contract = matches.find(c => c.id === input.contractVersionId) ?? null;
      if (!contract) throw new ServiceError('指定合約不符合目前客戶、航線、條件或有效期間，或已被新版本取代。請重新匹配合約。');
    } else if (matches.length === 1) {
      contract = matches[0];
    } else if (matches.length > 1) {
      throw new ServiceError('有多份適用合約，請明確選擇合約版本後再計算。');
    }
    let freight: FreightResult;
    if (contract) {
      if (input.manualFreight) throw new ServiceError('已有適用合約，不可同時使用手動非合約售價。');
      freight = calculateFreight(contract, weights, { containerCount: input.containerCount });
    } else {
      if (!input.manualFreight) throw new ServiceError('No Valid Contract Rate：請輸入手動非合約售價。');
      freight = { amount: new Decimal(input.manualFreight.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2), currency: input.manualFreight.currency, rate: '', appliedBreak: 'MANUAL', minimumApplied: false };
    }
    const charges = calculateCharges(contract?.charges ?? [], input.chargeOverrides, input.temporaryCharges, weights, {
      transportMode: input.transportMode ?? 'AIR', seaShipmentType: input.seaShipmentType, containerCount: input.containerCount,
    });
    const finance = calculateFinance(freight, charges, input.costs, input.costsComplete, input.analysisCurrency, input.fxRate);
    return { input: { ...input, contractVersionId: contract?.id ?? null }, customer, company: { name: settings.companyName, logo: settings.companyLogo },
      contract, weights, freight, charges, finance, settings: { volumeDivisor: settings.volumeDivisor, weightIncrement: settings.weightIncrement }, createdAt: new Date().toISOString() };
  }
  return {
    getSettings,
    getCustomsExchangeRate: customsExchangeRate,
    async updateSettings(raw: unknown): Promise<Settings> {
      const parsed = settingsSchema.parse(raw) as Settings;
      const input: Settings = { ...parsed, exchangeRateSource: parsed.exchangeRateSource ?? 'MANUAL', customsRateSide: parsed.customsRateSide ?? 'EXPORT' };
      if (input.exchangeRateSource === 'CUSTOMS') {
        const date = input.exchangeRateDate || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
        const rate = await customsExchangeRate(date, input.customsRateSide ?? 'EXPORT');
        input.exchangeRate = rate.rate;
        input.exchangeRateDate = rate.date;
      }
      return client.$transaction(async tx => {
        const { id: _id, ...settings } = await tx.settings.upsert({ where: { id: 1 }, create: { ...input, id: 1 }, update: input });
        if (input.exchangeRate) await tx.exchangeRate.create({ data: { usdToTwd: input.exchangeRate, rateDate: input.exchangeRateDate } });
        return settings as Settings;
      });
    },
    async getCustomers(): Promise<Customer[]> {
      return (await client.customer.findMany({ orderBy: { name: 'asc' } })).map(asCustomer);
    },
    async createCustomer(raw: unknown): Promise<Customer> {
      return asCustomer(await client.customer.create({ data: customerSchema.parse(raw) }));
    },
    async updateCustomer(id: string, raw: unknown): Promise<Customer> {
      await ensureCustomer(id);
      return asCustomer(await client.customer.update({ where: { id }, data: customerSchema.parse(raw) }));
    },
    getContracts,
    async createContract(raw: unknown): Promise<ContractRecord> {
      const input = contractSchema.parse(raw) as ContractInput;
      await ensureCustomer(input.customerId, true);
      const row = await client.contract.create({ data: { customerId: input.customerId, number: input.number, routeKey: routeKey(input), status: input.status,
        versions: { create: versionData(input, 1) } }, include: contractInclude });
      return asContract(row);
    },
    async updateContract(id: string, raw: unknown): Promise<ContractRecord> {
      const input = contractSchema.parse(raw) as ContractInput;
      return client.$transaction(async tx => {
        const original = await tx.contract.findUnique({ where: { id }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
        if (!original) throw new ServiceError('找不到合約', 404);
        if (original.customerId !== input.customerId) throw new ServiceError('不可變更既有合約所屬客戶，請新增或複製合約。');
        const row = await tx.contract.update({ where: { id }, data: { number: input.number, routeKey: routeKey(input), status: input.status,
          versions: { create: versionData(input, (original.versions[0]?.version ?? 0) + 1) } }, include: contractInclude });
        return asContract(row);
      });
    },
    async match(raw: unknown): Promise<ContractCandidate[]> { return candidates(matchSchema.parse(raw) as MatchInput); },
    preview: buildSnapshot,
    async getQuotes(): Promise<QuoteRecord[]> {
      return (await client.quote.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } })).map(asQuote);
    },
    async getQuote(id: string): Promise<QuoteRecord> {
      const row = await client.quote.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw new ServiceError('找不到報價', 404);
      return asQuote(row);
    },
    async deleteQuote(id: string): Promise<{ id: string; number: string; revision: number }> {
      return client.$transaction(async tx => {
        const updated = await tx.quote.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
        if (updated.count === 0) throw new ServiceError('找不到報價', 404);
        return tx.quote.findUniqueOrThrow({ where: { id }, select: { id: true, number: true, revision: true } });
      });
    },
    async createQuote(raw: unknown): Promise<QuoteRecord> {
      const snapshot = await buildSnapshot(raw);
      const input = snapshot.input;
      return client.$transaction(async tx => {
        // Recheck the selected immutable version in the write transaction so a concurrently
        // published version for the same shipment period cannot turn this into a stale-rate quotation.
        if (snapshot.contract) {
          const current = await tx.contract.findUnique({ where: { id: snapshot.contract.contractId }, include: { versions: { orderBy: { version: 'desc' } } } });
          const applicable = current?.versions.find(v => v.effectiveDate <= input.shipmentDate && v.expiryDate >= input.shipmentDate);
          if (!current || current.status !== 'ACTIVE' || applicable?.id !== snapshot.contract.id) throw new ServiceError('合約已更新，請重新計算報價', 409);
        }
        const currentCustomer = await tx.customer.findUnique({ where: { id: input.customerId } });
        if (currentCustomer?.status !== 'ACTIVE') throw new ServiceError('客戶已停用，請重新確認', 409);
        let revision = 1;
        let rootId: string | null = null;
        let previousQuoteId: string | null = null;
        let number: string;
        if (input.revisionOfId) {
          const previous = await tx.quote.findUnique({ where: { id: input.revisionOfId } });
          if (!previous || previous.deletedAt !== null) throw new ServiceError('找不到原始報價', 404);
          if (previous.customerId !== input.customerId) throw new ServiceError('修訂報價不可變更所屬客戶');
          rootId = previous.rootId ?? previous.id;
          previousQuoteId = previous.id;
          const root = await tx.quote.findUniqueOrThrow({ where: { id: rootId } });
          // Deleted rows still reserve their revision numbers and the original root remains
          // the stable family anchor, even when it is no longer visible in history.
          const latest = await tx.quote.findFirst({ where: { OR: [{ id: rootId }, { rootId }] }, orderBy: { revision: 'desc' } });
          revision = (latest?.revision ?? 1) + 1;
          number = `${root.number}-R${String(revision).padStart(3, '0')}`;
        } else {
          const date = dateCode(new Date());
          const counter = await tx.quoteCounter.upsert({ where: { date }, create: { date, sequence: 1 }, update: { sequence: { increment: 1 } } });
          number = `AFQ-${date}-${String(counter.sequence).padStart(4, '0')}`;
        }
        const row = await tx.quote.create({ data: {
          number, revision, rootId, customerId: input.customerId, contractVersionId: snapshot.contract?.id ?? null,
          transportMode: input.transportMode ?? 'AIR', routeScope: input.routeScope ?? 'AIRPORT',
          originCountry: input.originCountry ?? '', destinationCountry: input.destinationCountry ?? '',
          pricingBasis: snapshot.freight.basis ?? 'MANUAL', seaShipmentType: input.seaShipmentType ?? '',
          containerType: input.containerType ?? '', containerCount: input.containerCount ?? 0,
          status: input.status, snapshot: JSON.stringify(snapshot), cargo: { create: input.cargo },
          charges: { create: snapshot.charges }, costs: { create: input.costs },
          ...(previousQuoteId ? { revisions: { create: { previousQuoteId, revision } } } : {}),
          ...(input.fxRate ? { exchangeRates: { create: { usdToTwd: input.fxRate, rateDate: input.fxDate } } } : {}),
        } });
        return asQuote(row);
      }, { maxWait: 10000, timeout: 20000 });
    },
  };
}
export const service = createService(db);
