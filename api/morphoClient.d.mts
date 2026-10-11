export function fetchMorphoVault(address: string, chainId?: number): Promise<{ raw: unknown; provenance: Record<string, unknown> }>;
export function fetchMorphoMarket(marketId: string, chainId?: number): Promise<{ raw: unknown; provenance: Record<string, unknown> }>;
