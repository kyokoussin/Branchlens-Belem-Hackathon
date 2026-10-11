import { DEMO_POSITIONS } from '../api/_portfolioConfig.mjs';
import { fetchMorphoMarket, fetchMorphoVault } from '../api/_morphoClient.mjs';
import { aggregateLoadedPortfolio, buildPortfolio } from '../api/_portfolioEngine.mjs';
import type { PortfolioData } from './model';

export type ManagedPortfolio = { id: string; name: string };
export type ManagedPosition = { id: string; name: string; address: string; chainId: 1 | 8453; amountUsd: string; portfolioId: string; description: string; positionType?: 'supply' | 'borrow'; borrowDebtUsd?: string };
export type WorkspaceConfig = { version: 1; portfolios: ManagedPortfolio[]; positions: ManagedPosition[] };
export type SourceMode = 'auto' | 'snapshot';
type RawEntry = { id: string; address: string; chainId?: number; raw: unknown; provenance: Record<string, unknown>; capturedAt?: string };
type Snapshot = { kind: 'VERIFIED_HISTORICAL_MORPHO_API_SNAPSHOT'; capturedAt: string; positions: RawEntry[] };
type CacheEntry = { raw: unknown; provenance: Record<string, unknown>; capturedAt: string };
export type MorphoCache = Record<string, CacheEntry>;
const CONFIG_KEY = 'branchlens:managed-portfolios:v1';
const CACHE_KEY = 'branchlens:morpho-cache:v1';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MARKET_ID = /^0x[0-9a-fA-F]{64}$/;

export function defaultWorkspace(): WorkspaceConfig {
  return { version: 1, portfolios: [{ id: 'demo', name: 'Demo Portfolio' }], positions: DEMO_POSITIONS.map((item) => ({ ...item, name: '', chainId: 1, portfolioId: 'demo' })) };
}
export function loadWorkspace(): WorkspaceConfig {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null') as WorkspaceConfig | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.portfolios) || !Array.isArray(parsed.positions) || !parsed.portfolios.length) return defaultWorkspace();
    const ids = new Set(parsed.portfolios.map((item) => item.id));
    if (ids.size !== parsed.portfolios.length || parsed.portfolios.some((item) => !item.id || !item.name?.trim())) return defaultWorkspace();
    if (new Set(parsed.positions.map((item) => item.id)).size !== parsed.positions.length || parsed.positions.some((item) => !item.id || !ids.has(item.portfolioId) || !validIdentifier(item.address) || ![1, 8453].includes(item.chainId) || !validAmount(item.amountUsd) || (item.positionType != null && !['supply', 'borrow'].includes(item.positionType)) || (item.positionType === 'borrow' && (item.address.length !== 66 || !validAmount(item.borrowDebtUsd || ''))))) return defaultWorkspace();
    return parsed;
  } catch { return defaultWorkspace(); }
}
export function saveWorkspace(config: WorkspaceConfig) { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
export function loadMorphoCache(): MorphoCache {
  try { const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}
export function saveMorphoCache(cache: MorphoCache) { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
export const cacheKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;
export function validAddress(value: string) { return ADDRESS.test(value); }
export function validIdentifier(value: string) { return ADDRESS.test(value) || MARKET_ID.test(value); }
export function validAmount(value: string) { return /^\d+(?:\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0; }
export async function loadBaseSnapshot(): Promise<Snapshot> {
  const response = await fetch(`${import.meta.env.BASE_URL}demo-snapshot.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error('The verified Morpho snapshot is unavailable.');
  return response.json();
}
export async function verifySubject(address: string, chainId: 1 | 8453): Promise<CacheEntry> {
  const entry = MARKET_ID.test(address) ? await fetchMorphoMarket(address, chainId) : await fetchMorphoVault(address, chainId);
  return { ...entry, capturedAt: new Date().toISOString() };
}
export function prepareSnapshot(config: WorkspaceConfig, baseline: Snapshot, cache: MorphoCache): Snapshot {
  return { ...baseline, positions: config.positions.flatMap((position) => {
    const found = cache[cacheKey(position.chainId, position.address)] || baseline.positions.find((item) => item.address.toLowerCase() === position.address.toLowerCase() && (item.chainId || 1) === position.chainId);
    return found ? [{ id: position.id, address: position.address, chainId: position.chainId, raw: found.raw, provenance: found.provenance, capturedAt: found.capturedAt || baseline.capturedAt }] : [];
  }) };
}
export async function buildManagedPortfolio(config: WorkspaceConfig, baseline: Snapshot, cache: MorphoCache, source: SourceMode, scenario: boolean): Promise<PortfolioData> {
  const refreshed: MorphoCache = {};
  const result = await buildPortfolio({ source, scenario, snapshot: prepareSnapshot(config, baseline, cache), positions: config.positions,
    fetchVault: async (address, chainId) => { const entry = await verifySubject(address, chainId as 1 | 8453); refreshed[cacheKey(chainId, address)] = entry; return entry; } });
  if (Object.keys(refreshed).length) saveMorphoCache({ ...cache, ...refreshed });
  return result;
}
export function scopePortfolio(data: PortfolioData, portfolioIds: string[]): PortfolioData {
  const selected = new Set(portfolioIds);
  return aggregateLoadedPortfolio(data.positions.filter((position) => selected.has(position.portfolioId)), Boolean(data.portfolioIncident), data.snapshotCapturedAt);
}
