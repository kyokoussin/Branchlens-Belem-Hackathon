const API = 'https://api.morpho.org/graphql';
const REST_BASE = 'https://api.morpho.org/v0/vaults-v1';
export const DEFAULT_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MARKET_ID = /^0x[0-9a-fA-F]{64}$/;

export const VAULT_QUERY = `query VaultRiskSnapshot($address: String!, $chainId: Int!) {
  vaultByAddress(address: $address, chainId: $chainId) {
    address name chain { id }
    asset { address symbol decimals }
    state {
      totalAssetsUsd
      allocation {
        supplyAssetsUsd
        market {
          marketId lltv irmAddress
          oracle {
            address type
            data {
              ... on MorphoChainlinkOracleData {
                baseFeedOne { address } baseFeedTwo { address }
                quoteFeedOne { address } quoteFeedTwo { address }
                baseOracleVault { address }
              }
              ... on MorphoChainlinkOracleV2Data {
                baseFeedOne { address } baseFeedTwo { address }
                quoteFeedOne { address } quoteFeedTwo { address }
                baseOracleVault { address } quoteOracleVault { address }
              }
            }
          }
          loanAsset { address symbol decimals }
          collateralAsset { address symbol decimals }
          state { supplyAssetsUsd borrowAssetsUsd liquidityAssetsUsd utilization }
        }
      }
    }
    liquidity { usd underlying }
  }
}`;

export const MARKET_QUERY = `query MarketRiskSnapshot($marketId: String!, $chainId: Int!) {
  marketById(marketId: $marketId, chainId: $chainId) {
    marketId chain { id } lltv irmAddress
    oracle {
      address type
      data {
        ... on MorphoChainlinkOracleData {
          baseFeedOne { address } baseFeedTwo { address }
          quoteFeedOne { address } quoteFeedTwo { address }
          baseOracleVault { address }
        }
        ... on MorphoChainlinkOracleV2Data {
          baseFeedOne { address } baseFeedTwo { address }
          quoteFeedOne { address } quoteFeedTwo { address }
          baseOracleVault { address } quoteOracleVault { address }
        }
      }
    }
    loanAsset { address symbol decimals }
    collateralAsset { address symbol decimals }
    state { supplyAssetsUsd borrowAssetsUsd liquidityAssetsUsd utilization }
  }
}`;

export class SourceError extends Error {
  constructor(message, code = 'SOURCE_UNAVAILABLE') {
    super(message);
    this.code = code;
  }
}

export async function fetchMorphoVault(address = DEFAULT_VAULT, chainId = 1) {
  if (!ADDRESS.test(address)) throw new SourceError('Enter a valid 42-character EVM vault address.', 'INVALID_ADDRESS');
  if (![1, 8453].includes(chainId)) throw new SourceError('Only Ethereum and Base Morpho V1 vaults are supported.', 'UNSUPPORTED_CHAIN');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const restEndpoint = `${REST_BASE}/${chainId}:${address}/state`;
  let result;
  let restState = null;
  let restStateNote = 'REST vault state unavailable; no indexed block or withdrawable token amount was substituted.';
  try {
    const graphRequest = fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: VAULT_QUERY, variables: { address, chainId } }),
      signal: controller.signal,
    });
    const restRequest = fetch(restEndpoint, { headers: { accept: 'application/json' }, signal: controller.signal });
    const [response, restResponse] = await Promise.all([graphRequest, restRequest.catch(() => null)]);
    if (!response.ok) throw new SourceError(`Morpho API returned HTTP ${response.status}.`, response.status === 429 ? 'RATE_LIMITED' : 'SOURCE_UNAVAILABLE');
    result = await response.json();
    if (restResponse?.ok) {
      let candidate = null;
      try { candidate = (await restResponse.json()).data; } catch { /* Optional REST source remains UNKNOWN. */ }
      if (candidate?.chain_id === chainId && typeof candidate.address === 'string' && candidate.address.toLowerCase() === address.toLowerCase()
        && /^\d+$/.test(candidate.last_indexed_block || '') && /^\d+$/.test(candidate.withdrawable_assets || '')) {
        restState = {
          endpoint: restEndpoint,
          retrievedAt: new Date().toISOString(),
          indexedBlock: candidate.last_indexed_block,
          withdrawableAssetsRaw: candidate.withdrawable_assets,
          totalAssetsRaw: /^\d+$/.test(candidate.total_assets || '') ? candidate.total_assets : null,
        };
        restStateNote = 'REST vault state is independently indexed; its block does not timestamp the GraphQL USD allocations.';
      } else restStateNote = 'REST vault state failed identity or field validation; no values were substituted.';
    } else if (restResponse) restStateNote = `REST vault state returned HTTP ${restResponse.status}; block and withdrawal units are UNKNOWN.`;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(error.name === 'AbortError' ? 'Morpho API timed out.' : 'Morpho API could not be reached.');
  } finally {
    clearTimeout(timeout);
  }
  if (result.errors?.length) throw new SourceError(`Morpho API rejected the query: ${result.errors[0].message}`);
  if (!result.data?.vaultByAddress) throw new SourceError('No Morpho V1 vault was found at this address on the selected chain.', 'NOT_FOUND');
  return {
    raw: result.data.vaultByAddress,
    provenance: {
      endpoint: API,
      queryName: 'VaultRiskSnapshot',
      retrievedAt: new Date().toISOString(),
      indexedBlock: null,
      sourceTimestamp: null,
      restState,
      restStateNote,
      note: 'The selected GraphQL response does not expose an indexed block or market update timestamp. Retrieval time is not blockchain time.',
    },
  };
}

export async function fetchMorphoMarket(marketId, chainId = 1) {
  if (!MARKET_ID.test(marketId)) throw new SourceError('Enter a valid 32-byte Morpho market ID.', 'INVALID_MARKET_ID');
  if (![1, 8453].includes(chainId)) throw new SourceError('Only Ethereum and Base Morpho markets are supported.', 'UNSUPPORTED_CHAIN');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let result;
  try {
    const response = await fetch(API, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: MARKET_QUERY, variables: { marketId, chainId } }), signal: controller.signal,
    });
    if (!response.ok) throw new SourceError(`Morpho API returned HTTP ${response.status}.`, response.status === 429 ? 'RATE_LIMITED' : 'SOURCE_UNAVAILABLE');
    result = await response.json();
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(error.name === 'AbortError' ? 'Morpho API timed out.' : 'Morpho API could not be reached.');
  } finally { clearTimeout(timeout); }
  if (result.errors?.length) throw new SourceError(`Morpho API rejected the market query: ${result.errors[0].message}`);
  const raw = result.data?.marketById;
  if (!raw) throw new SourceError('No Morpho market was found with this ID on the selected chain.', 'NOT_FOUND');
  if (raw.marketId?.toLowerCase() !== marketId.toLowerCase() || raw.chain?.id !== chainId) throw new SourceError('Morpho returned a different market identity.', 'INVALID_SOURCE_DATA');
  return { raw, provenance: {
    endpoint: API, queryName: 'MarketRiskSnapshot', retrievedAt: new Date().toISOString(),
    indexedBlock: null, sourceTimestamp: null, restState: null,
    note: 'GraphQL market state is reported by Morpho. Retrieval time is not blockchain index time.',
  } };
}

async function publicRest(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`https://api.morpho.org${path}`, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, Math.min(1500, 300 * (2 ** attempt)))); continue; }
        }
        throw new SourceError(`Morpho REST API returned HTTP ${response.status}.`, response.status === 429 ? 'RATE_LIMITED' : 'SOURCE_UNAVAILABLE');
      }
      return await response.json();
    } catch (error) {
      if (error instanceof SourceError || attempt === 2) throw error instanceof SourceError ? error : new SourceError(error.name === 'AbortError' ? 'Morpho REST API timed out.' : 'Morpho REST API could not be reached.');
      await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
    } finally { clearTimeout(timeout); }
  }
}

export async function fetchMorphoAssetPrice(address, chainId = 1) {
  if (!ADDRESS.test(address) || ![1, 8453].includes(chainId)) throw new SourceError('Invalid token address or chain.', 'INVALID_ADDRESS');
  const endpoint = `/v0/tokens/${chainId}:${address}/price`;
  const body = await publicRest(endpoint);
  const row = body?.data;
  const timestamp = Number(row?.timestamp);
  if (row?.chain_id !== chainId || row?.address?.toLowerCase() !== address.toLowerCase() || !Number.isFinite(row?.price) || row.price <= 0 || !Number.isInteger(timestamp) || timestamp <= 0) throw new SourceError('Morpho token-price identity, value or timestamp is invalid.', 'INVALID_SOURCE_DATA');
  return { address: address.toLowerCase(), chainId, usd: String(row.price), timestamp: new Date(timestamp * 1000).toISOString(), provider: row.provider || 'UNKNOWN', endpoint: `https://api.morpho.org${endpoint}`, retrievedAt: new Date().toISOString() };
}

export async function fetchMorphoOracleState(address, chainId = 1) {
  if (!ADDRESS.test(address) || ![1, 8453].includes(chainId)) throw new SourceError('Invalid oracle address or chain.', 'INVALID_ADDRESS');
  const endpoint = `/v0/oracles/${chainId}:${address}/state`;
  const body = await publicRest(endpoint);
  const row = body?.data;
  if (row?.chain_id !== chainId || row?.address?.toLowerCase() !== address.toLowerCase()) throw new SourceError('Morpho oracle-state identity is invalid.', 'INVALID_SOURCE_DATA');
  return { address: address.toLowerCase(), chainId, rawQuote: row.price == null ? null : String(row.price), lastUpdatedAt: row.last_updated_at || null, indexedBlock: row.last_indexed_block || null, endpoint: `https://api.morpho.org${endpoint}`, retrievedAt: new Date().toISOString(), note: 'The raw Morpho oracle quote is not a USD token price and is not used in borrower-dollar calculations.' };
}

export async function listMorphoMarkets({ chainId = 1, cursor = null, limit = 25 } = {}) {
  if (![1, 8453].includes(chainId) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new SourceError('Invalid market-list chain or page size.', 'INVALID_REQUEST');
  const params = new URLSearchParams({ chain_id: String(chainId), listed: 'true', limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const body = await publicRest(`/v1/blue/markets?${params}`);
  if (!Array.isArray(body?.data)) throw new SourceError('Morpho market-list response is malformed.', 'INVALID_SOURCE_DATA');
  return { items: body.data.filter((item) => MARKET_ID.test(item.market_id || item.marketId || '')).map((item) => ({ marketId: (item.market_id || item.marketId).toLowerCase(), chainId })), cursor: body.cursor || null, endpoint: `https://api.morpho.org/v1/blue/markets?${params}`, retrievedAt: new Date().toISOString() };
}
