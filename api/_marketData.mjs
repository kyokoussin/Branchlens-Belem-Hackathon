import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMorphoAssetPrice, fetchMorphoMarket, fetchMorphoOracleState } from './_morphoClient.mjs';
import { normalizeMarket } from './_riskEngine.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inFlight = new Map();
const cache = new Map();
const LIVE_TTL_MS = 60_000;
const PRICE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function validatePrice(price, address, chainId, historical = false) {
  if (!price || price.address?.toLowerCase() !== address?.toLowerCase() || price.chainId !== chainId || !Number.isFinite(Number(price.usd)) || Number(price.usd) <= 0 || !Number.isFinite(Date.parse(price.timestamp))) throw new Error('Morpho token-price evidence is missing or does not match this market.');
  const ageMs = Date.now() - Date.parse(price.timestamp);
  if (!historical && (ageMs < -300_000 || ageMs > PRICE_MAX_AGE_MS)) throw new Error(`Morpho token price is stale (${Math.round(ageMs / 60000)} minutes old).`);
  return { ...price, ageSeconds: Math.max(0, Math.round(ageMs / 1000)), stale: ageMs > PRICE_MAX_AGE_MS };
}

async function live(chainId, marketId) {
  const { raw, provenance } = await fetchMorphoMarket(marketId, chainId);
  const market = normalizeMarket(raw, provenance);
  const row = market.allocations[0];
  if (!row.collateral.address || !row.loan.address) throw new Error('This Morpho market has no verified collateral or loan token address.');
  const [collateralPrice, loanPrice, oracleResult] = await Promise.all([
    fetchMorphoAssetPrice(row.collateral.address, chainId),
    fetchMorphoAssetPrice(row.loan.address, chainId),
    row.oracleAddress ? fetchMorphoOracleState(row.oracleAddress, chainId).catch((error) => ({ status: 'UNAVAILABLE', reason: error.message })) : Promise.resolve({ status: 'UNAVAILABLE', reason: 'No verified oracle address.' }),
  ]);
  const capturedAt = new Date().toISOString();
  return {
    id: `market-snapshot:${chainId}:${marketId.toLowerCase()}:${capturedAt}`,
    chainId, marketId: marketId.toLowerCase(), mode: 'LIVE_MORPHO_API', capturedAt,
    raw, market,
    prices: { collateral: validatePrice(collateralPrice, row.collateral.address, chainId), loan: validatePrice(loanPrice, row.loan.address, chainId) },
    oracle: oracleResult,
    freshness: { marketRetrievedAt: provenance.retrievedAt, oracleUpdatedAt: oracleResult.lastUpdatedAt || null, sourceIndexedBlock: oracleResult.indexedBlock || null, note: 'API retrieval time is not chain finality or a guarantee of execution freshness.' },
  };
}

async function historical(chainId, marketId) {
  const path = join(root, 'data', 'borrower-demo-snapshot.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  if (saved.kind !== 'VERIFIED_HISTORICAL_MORPHO_BORROWER_SNAPSHOT' || saved.chainId !== chainId || saved.marketId?.toLowerCase() !== marketId.toLowerCase()) throw new Error('No matching verified historical borrower snapshot is available.');
  const market = normalizeMarket(saved.raw, saved.provenance);
  const row = market.allocations[0];
  return {
    ...saved, id: `market-snapshot:${chainId}:${marketId.toLowerCase()}:${saved.capturedAt}`,
    mode: 'SAVED_HISTORICAL_SNAPSHOT', market,
    prices: { collateral: validatePrice(saved.prices.collateral, row.collateral.address, chainId, true), loan: validatePrice(saved.prices.loan, row.loan.address, chainId, true) },
    freshness: { ...saved.freshness, note: 'This is a historical Morpho response, not a current market observation or executable quote.' },
  };
}

export async function getBorrowMarketSnapshot({ chainId, marketId, source = 'auto' }) {
  if (![1, 8453].includes(chainId) || !/^0x[0-9a-fA-F]{64}$/.test(marketId || '')) throw new Error('Select a valid Ethereum or Base Morpho market ID.');
  if (source === 'snapshot') return historical(chainId, marketId);
  if (source !== 'auto') throw new Error('Unknown Morpho data mode.');
  const key = `${chainId}:${marketId.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < LIVE_TTL_MS) return cached.value;
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = live(chainId, marketId).then((value) => { cache.set(key, { at: Date.now(), value }); return value; }).catch(async (error) => {
    try { const fallback = await historical(chainId, marketId); return { ...fallback, liveFailure: error.message }; }
    catch { throw error; }
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}
