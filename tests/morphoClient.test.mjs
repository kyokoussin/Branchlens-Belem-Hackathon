import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VAULT, fetchMorphoVault } from '../api/morphoClient.mjs';

afterEach(() => vi.unstubAllGlobals());

describe('live Morpho source handling', () => {
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
});
