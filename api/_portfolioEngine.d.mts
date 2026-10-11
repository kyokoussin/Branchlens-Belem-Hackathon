import type { PortfolioData, Position } from '../src/model';
export function buildPortfolio(input: { source: 'auto' | 'snapshot'; scenario: boolean; snapshot: unknown; positions: unknown[]; fetchVault?: (address: string, chainId: number) => Promise<{ raw: unknown; provenance: Record<string, unknown> }> }): Promise<PortfolioData>;
export function aggregateLoadedPortfolio(positions: Position[], scenario?: boolean, snapshotCapturedAt?: string | null): PortfolioData;
