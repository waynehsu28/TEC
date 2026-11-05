import type { ContractRecord, ContractVersion } from './types';

export const WORKSPACE_MODULES = ['dashboard', 'customers', 'contracts', 'quote', 'history', 'settings'] as const;
export type WorkspaceModule = typeof WORKSPACE_MODULES[number];
export interface WorkspaceRoute {
  module: WorkspaceModule;
  revisionId: string | null;
  quoteId: string | null;
  customerId: string | null;
}
export type WorkspaceRouteInput = Pick<WorkspaceRoute, 'module'> & Partial<Omit<WorkspaceRoute, 'module'>>;
export const DEFAULT_WORKSPACE_ROUTE: WorkspaceRoute = { module: 'dashboard', revisionId: null, quoteId: null, customerId: null };
const safeId = (value: string | null | undefined) => value == null || /^[A-Za-z0-9_-]{1,100}$/.test(value);

/** URL state contains opaque record IDs only, never form data, names, or amounts. */
export function parseWorkspaceHash(hash: string): WorkspaceRoute {
  if (!hash || hash === '#') return { ...DEFAULT_WORKSPACE_ROUTE };
  if (hash.length > 2048) return { ...DEFAULT_WORKSPACE_ROUTE };
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const separator = raw.indexOf('?');
  const module = separator === -1 ? raw : raw.slice(0, separator);
  if (!(WORKSPACE_MODULES as readonly string[]).includes(module)) return { ...DEFAULT_WORKSPACE_ROUTE };
  const query = new URLSearchParams(separator === -1 ? '' : raw.slice(separator + 1));
  const route: WorkspaceRoute = { ...DEFAULT_WORKSPACE_ROUTE, module: module as WorkspaceModule };
  const read = (key: string) => {
    if (query.getAll(key).length > 1) throw new Error('Duplicate navigation identifier');
    const value = query.get(key);
    if (!safeId(value)) throw new Error('Invalid navigation identifier');
    return value;
  };
  try {
    if (module === 'quote') route.revisionId = read('revision');
    if (module === 'history') { route.quoteId = read('quote'); route.customerId = read('customer'); }
    if (module === 'contracts') route.customerId = read('customer');
  } catch { return { ...DEFAULT_WORKSPACE_ROUTE }; }
  return route;
}

export function workspaceHash(input: WorkspaceRouteInput): string {
  if (!(WORKSPACE_MODULES as readonly string[]).includes(input.module)) return '#dashboard';
  const query = new URLSearchParams();
  const add = (key: string, value: string | null | undefined) => {
    if (!safeId(value)) throw new Error('Invalid navigation identifier');
    if (value) query.set(key, value);
  };
  try {
    if (input.module === 'quote') add('revision', input.revisionId);
    if (input.module === 'history') { add('quote', input.quoteId); add('customer', input.customerId); }
    if (input.module === 'contracts') add('customer', input.customerId);
  } catch { return '#dashboard'; }
  return `#${input.module}${query.size ? `?${query}` : ''}`;
}

export function quoteContextKey(route: WorkspaceRoute): string | null {
  return route.module === 'quote' ? route.revisionId ? `revision:${route.revisionId}` : 'new' : null;
}

/** Match the backend's date selection rather than letting a future version hide the current one. */
export function applicableContractVersion(contract: ContractRecord, date: string): ContractVersion | undefined {
  return [...contract.versions].sort((a, b) => b.version - a.version)
    .find(version => version.effectiveDate <= date && version.expiryDate >= date);
}
export function contractHasExpired(contract: ContractRecord, date: string): boolean {
  return contract.versions.length > 0 && contract.versions.every(version => version.expiryDate < date);
}
