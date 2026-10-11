import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildPortfolio } from '../api/portfolioEngine.mjs';
import { CBBTC_ETHEREUM } from '../api/scenarioEngine.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/demo-snapshot.json', import.meta.url), 'utf8'));

describe('portfolio scenario from the verified Morpho snapshot', () => {
  it('deduplicates affected markets within each position and leaves unrelated capital unaffected', async () => {
    const result = await buildPortfolio({ source: 'snapshot', scenario: true, snapshot });
    expect(result.mode).toBe('SAVED_HISTORICAL_SNAPSHOT');
    expect(result.portfolio.trackedPositions).toBe(6);
    expect(result.portfolio.trackedDependencyRelationships).toBe(result.portfolioGraph.edges.length);
    expect(result.portfolio.distinctDependencies).toBe(result.portfolioGraph.nodes.filter((node) => node.type !== 'Position').length);
    expect(result.portfolio.totalAssumedCapitalUsd).toBe('2650000.00');
    expect(result.portfolio.activeAlerts).toBe(1);
    expect(result.portfolioIncident.status).toBe('SIMULATED_NOT_OBSERVED');
    expect(result.portfolioIncident.affectedPositions).toHaveLength(5);
    expect(result.portfolioIncident.actualLossUsd).toBeNull();
    const summed = result.portfolioIncident.affectedPositions.reduce((total, position) => total + Number(position.exposedPrincipalUsd), 0);
    expect(Number(result.portfolioIncident.uniqueCapitalExposedUsd)).toBeCloseTo(summed, 2);
    expect(result.positions.find((position) => position.id === 'gauntlet-weth-prime').simulation.available).toBe(false);
    const steakhouse = result.positions.find((position) => position.id === 'steakhouse-usdc');
    const cbBtc = steakhouse.analysis.graph.nodes.find((node) => node.type === 'CollateralToken' && node.address === CBBTC_ETHEREUM);
    expect(cbBtc.affectedMarketIds).toHaveLength(1);
    expect(cbBtc.capitalExposedUsd).toBe(steakhouse.simulation.capitalExposedUsd);
    expect(steakhouse.livePriceSignal.status).toBe('UNKNOWN');
  });
  it('falls back to a clearly labeled historical response when the API fails', async () => {
    const result = await buildPortfolio({ source: 'auto', scenario: false, snapshot, fetchVault: async () => { throw new Error('offline'); } });
    expect(result.mode).toBe('SAVED_HISTORICAL_SNAPSHOT');
    expect(result.portfolio.activeAlerts).toBe(0);
    expect(result.portfolioIncident).toBeNull();
    expect(result.positions.every((position) => position.analysis.vault.warnings.some((warning) => warning.includes('not live state')))).toBe(true);
  });
});
