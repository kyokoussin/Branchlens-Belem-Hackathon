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
