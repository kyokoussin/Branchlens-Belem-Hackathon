import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { analyzeMarket } from '../api/_riskEngine.mjs';
import { buildPortfolio } from '../api/_portfolioEngine.mjs';

const baseline = JSON.parse(await readFile(new URL('../data/demo-snapshot.json', import.meta.url), 'utf8'));
const vaultEntry = baseline.positions.find((position) => position.id === 'steakhouse-usdc');
const rawMarket = { ...vaultEntry.raw.state.allocation.find((row) => row.market.collateralAsset?.symbol === 'cbBTC' && Number(row.supplyAssetsUsd) > 0).market, chain: { id: 1 } };
const marketId = rawMarket.marketId.toLowerCase();
const marketEntry = { id: 'direct-market', address: marketId, chainId: 1, raw: rawMarket, provenance: vaultEntry.provenance, capturedAt: baseline.capturedAt };

describe('direct Morpho market holdings', () => {
  it('uses only observed market relationships and exposes the assumed lender amount once', () => {
    const result = analyzeMarket(rawMarket, vaultEntry.provenance, '1000');
    expect(result.vault.version).toBe('MORPHO_MARKET');
    expect(result.graph.nodes.some((node) => node.type === 'Vault')).toBe(false);
    expect(result.graph.edges.some((edge) => edge.from.startsWith('position:') && edge.to === `market:1:${marketId}` && edge.status === 'ASSUMED')).toBe(true);
    expect(result.exposure.marketExposures[0].capitalExposedUsd).toBe('1000.00');
  });

  it('merges a directly held market with the same market inside a verified vault', async () => {
    const positions = [
      { id: 'vault-holding', name: 'Vault holding', portfolioId: 'one', address: vaultEntry.address, chainId: 1, amountUsd: '1000', description: '' },
      { id: 'direct-market', name: 'Direct market', portfolioId: 'two', address: marketId, chainId: 1, amountUsd: '1000', description: '' },
    ];
    const snapshot = { ...baseline, positions: [{ ...vaultEntry, id: 'vault-holding', chainId: 1 }, marketEntry] };
    const result = await buildPortfolio({ source: 'snapshot', scenario: true, snapshot, positions });
    const marketNodeId = `market:1:${marketId}`;
    expect(result.portfolioGraph.nodes.filter((node) => node.id === marketNodeId)).toHaveLength(1);
    const impact = result.impactIndex[marketNodeId];
    expect(impact.affectedPositionCount).toBe(2);
    expect(impact.affectedPositions.find((position) => position.id === 'direct-market').exposedPrincipalUsd).toBe('1000.00');
    expect(Number(impact.uniqueCapitalExposedUsd)).toBeCloseTo(impact.affectedPositions.reduce((sum, position) => sum + Number(position.exposedPrincipalUsd), 0), 2);
    expect(result.portfolio.totalAssumedCapitalUsd).toBe('2000.00');
    expect(result.positions.find((position) => position.id === 'direct-market').simulation.dependencyPaths[0]).toEqual([
      `position:assumed:market:1:${marketId}`, marketNodeId, `token:1:${rawMarket.collateralAsset.address.toLowerCase()}`,
    ]);
  });

  it('connects simulated supply and borrow positions to one real market without applying supplier liquidity risk to the borrower', async () => {
    const positions = [
      { id: 'supply', name: 'My supply', portfolioId: 'demo', address: marketId, chainId: 1, amountUsd: '1000', positionType: 'supply', description: '' },
      { id: 'borrow', name: 'My borrow', portfolioId: 'demo', address: marketId, chainId: 1, amountUsd: '2000', borrowDebtUsd: '1000', positionType: 'borrow', description: '' },
    ];
    const snapshot = { ...baseline, positions: positions.map((item) => ({ ...marketEntry, id: item.id })) };
    const result = await buildPortfolio({ source: 'snapshot', scenario: false, snapshot, positions });
    expect(result.portfolioGraph.nodes.filter((node) => node.id === `market:1:${marketId}`)).toHaveLength(1);
    expect(result.portfolioGraph.edges.some((edge) => edge.type === 'BORROWS_FROM')).toBe(true);
    expect(result.portfolioGraph.edges.some((edge) => edge.type === 'SUPPLIES_TO' && edge.from.startsWith('position:'))).toBe(true);
    expect(result.impactIndex[`market:1:${marketId}`].affectedPositionCount).toBe(2);
    expect(result.impactIndex[`market:1:${marketId}`].uniqueCapitalExposedUsd).toBe('3000.00');
    expect(result.positions.find((item) => item.id === 'borrow').analysis.findings.some((item) => item.detector === 'WITHDRAWAL_LIQUIDITY_CONSTRAINT')).toBe(false);
  });
});
