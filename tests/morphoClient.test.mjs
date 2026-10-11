import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VAULT, fetchMorphoMarketCatalog, fetchMorphoVault } from '../api/_morphoClient.mjs';

afterEach(() => vi.unstubAllGlobals());

describe('live Morpho source handling', () => {
  it('reads vault accounting version from the verified REST identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => new Response(JSON.stringify(url.endsWith('/graphql')
      ? { data: { vaultByAddress: { address: DEFAULT_VAULT } } }
      : url.endsWith('/state')
        ? { data: { chain_id: 1, address: DEFAULT_VAULT, last_indexed_block: '26163970', withdrawable_assets: '100' } }
        : { data: { chain_id: 1, address: DEFAULT_VAULT, version: '1.1' } }), { status: 200 })));
    const { provenance } = await fetchMorphoVault();
    expect(provenance.vaultAccountingVersion).toBe('1.1');
    expect(provenance.vaultVersionEndpoint).toMatch(/\/v0\/vaults-v1\/1:/);
  });
  it('keeps the independently indexed REST block separate from GraphQL allocation provenance', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => new Response(JSON.stringify(url.endsWith('/graphql')
      ? { data: { vaultByAddress: { address: DEFAULT_VAULT } } }
      : { data: { chain_id: 1, address: DEFAULT_VAULT, last_indexed_block: '26163970', withdrawable_assets: '48228636085117', total_assets: '65077498868171' } }), { status: 200 })));
    const { provenance } = await fetchMorphoVault();
    expect(provenance.restState.indexedBlock).toBe('26163970');
    expect(provenance.restState.withdrawableAssetsRaw).toBe('48228636085117');
    expect(provenance.indexedBlock).toBeNull();
  });

  it('does not invent REST values if its response fails validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => new Response(JSON.stringify(url.endsWith('/graphql')
      ? { data: { vaultByAddress: { address: DEFAULT_VAULT } } }
      : { data: { chain_id: 8453, address: DEFAULT_VAULT, last_indexed_block: '26163970', withdrawable_assets: '1' } }), { status: 200 })));
    const { provenance } = await fetchMorphoVault();
    expect(provenance.restState).toBeNull();
    expect(provenance.restStateNote).toContain('validation');
  });

  it('lists verified real market identities with token filters and rejects mismatched rows', async () => {
    const marketId = '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64';
    const token = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';
    const loan = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { markets: { items: [
      { marketId, chain: { id: 1 }, collateralAsset: { address: token, symbol: 'cbBTC', decimals: 8 }, loanAsset: { address: loan, symbol: 'USDC', decimals: 6 }, lltv: '860000000000000000', state: { supplyAssetsUsd: 1000 } },
      { marketId, chain: { id: 8453 }, collateralAsset: { address: token, symbol: 'cbBTC', decimals: 8 }, loanAsset: { address: loan, symbol: 'USDC', decimals: 6 } },
    ] } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const result = await fetchMorphoMarketCatalog({ chainId: 1, skip: 50, limit: 2 });
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.variables).toEqual({ first: 2, skip: 50, where: { chainId_in: [1], listed: true } });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].marketId).toBe(marketId);
    expect(result.items[0].collateral.symbol).toBe('cbBTC');
    expect(result.nextSkip).toBe(52);
  });
});
