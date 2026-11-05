export type Currency = 'USD' | 'TWD';
export type EntityStatus = 'ACTIVE' | 'INACTIVE';
export type QuoteStatus = 'Draft' | 'Quoted' | 'Accepted' | 'Rejected' | 'Expired';
export type ChargeBasis = 'PER_KG' | 'PER_SHIPMENT' | 'PER_PIECE' | 'MINIMUM' | 'MANUAL';
export interface CustomerInput { name: string; code: string; contact: string; email: string; phone: string; defaultCurrency: Currency; remarks: string; status: EntityStatus }
export interface Customer extends CustomerInput { id: string }
export interface RateBreak { weight: string; rate: string }
export interface ChargeInput { id?: string; name: string; basis: ChargeBasis; rate: string; currency: Currency; included: boolean; minimumAmount?: string; manualAmount?: string }
export interface ContractInput { customerId: string; number: string; status: EntityStatus; origin: string; destination: string; airline: string; serviceType: string; commodity: string; effectiveDate: string; expiryDate: string; currency: Currency; rateType: 'BASE_PLUS' | 'ALL_IN'; minimumCharge: string; normalRate: string; breaks: RateBreak[]; charges: ChargeInput[]; remarks: string }
export interface ContractVersion extends Omit<ContractInput, 'customerId' | 'number' | 'status'> { id: string; contractId: string; version: number }
export interface ContractRecord { id: string; customerId: string; number: string; status: EntityStatus; versions: ContractVersion[] }
export interface ContractCandidate extends ContractVersion { customerId: string; number: string; status: EntityStatus }
export interface CargoItem { pieces: number; length: string; width: string; height: string; grossWeight: string; weightMode: 'PER_PIECE' | 'GROUP_TOTAL' }
export interface CostInput { name: string; amount: string | null; currency: Currency; status: 'ESTIMATED' | 'ACTUAL' }
export interface Settings { companyName: string; companyLogo: string; volumeDivisor: string; weightIncrement: string; defaultCurrency: Currency; exchangeRate: string; exchangeRateDate: string; terms: string }
export interface MatchInput { customerId: string; origin: string; destination: string; airline: string; serviceType: string; commodity: string; shipmentDate: string }
export interface QuoteInput extends MatchInput { cargo: CargoItem[]; contractVersionId: string | null; manualFreight: { amount: string; currency: Currency } | null; chargeOverrides: { chargeId: string; rate: string; manualAmount?: string }[]; temporaryCharges: ChargeInput[]; costs: CostInput[]; costsComplete: boolean; analysisCurrency: Currency; fxRate: string; fxDate: string; validity: string; remarks: string; terms: string; status: QuoteStatus; revisionOfId: string | null }
export interface Weights { pieces: number; grossWeight: string; cbm: string; volumeWeight: string; chargeableWeight: string }
export interface FreightResult { amount: string; currency: Currency; rate: string; appliedBreak: string; minimumApplied: boolean }
export interface CalculatedCharge { name: string; basis: ChargeBasis; currency: Currency; included: boolean; originalRate: string; appliedRate: string; originalAmount: string; amount: string; temporary: boolean }
export interface FinanceResult { revenue: string | null; knownCost: string | null; grossProfit: string | null; margin: string | null; markup: string | null; costState: 'MISSING' | 'PARTIAL' | 'COMPLETE'; provisional: boolean; negativeProfit: boolean; missingFx: boolean; revenueByCurrency: Partial<Record<Currency, string>>; costByCurrency: Partial<Record<Currency, string>> }
export interface QuoteSnapshot { input: QuoteInput; customer: Customer; company: { name: string; logo: string }; contract: ContractCandidate | null; weights: Weights; freight: FreightResult; charges: CalculatedCharge[]; finance: FinanceResult; settings: { volumeDivisor: string; weightIncrement: string }; createdAt: string }
export interface QuoteRecord { id: string; number: string; revision: number; rootId: string | null; customerId: string; status: QuoteStatus; createdAt: string; snapshot: QuoteSnapshot }
