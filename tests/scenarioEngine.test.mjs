import { describe, expect, it } from 'vitest';
import { analyze } from '../api/riskEngine.mjs';
import { addDocumentedCbbtcDependencies, CBBTC_ETHEREUM, evaluatePriceDeviation, simulateCbbtcDepeg } from '../api/scenarioEngine.mjs';

const vaultAddress = `0x${'d'.repeat(40)}`;
const usdc = `0x${'a'.repeat(40)}`;
const wbtc = `0x${'b'.repeat(40)}`;
const oracle = `0x${'c'.repeat(40)}`;
const provenance = { endpoint: 'https://api.morpho.org/graphql', queryName: 'VaultRiskSnapshot', retrievedAt: '2026-10-10T10:00:00.000Z', indexedBlock: null };
function market(index, collateral, allocationUsd) {
  return { supplyAssetsUsd: allocationUsd, market: {
    marketId: `0x${String(index).repeat(64)}`, lltv: '860000000000000000', oracle: { address: oracle },
    loanAsset: { address: usdc, symbol: 'USDC', decimals: 6 },
    collateralAsset: { address: collateral, symbol: collateral === CBBTC_ETHEREUM ? 'cbBTC' : 'WBTC', decimals: 8 },
    state: { utilization: 0.8 },
  } };
}
function snapshot(rows) {
  return { address: vaultAddress, name: 'Synthetic vault', chain: { id: 1 },
    asset: { address: usdc, symbol: 'USDC', decimals: 6 },
    state: { totalAssetsUsd: 10000000, allocation: rows }, liquidity: { usd: 1000000 } };
}

describe('cbBTC hypothetical replay', () => {
  it('selects current cbBTC markets by contract and calculates unique exposed principal', () => {
    const raw = snapshot([market(1, CBBTC_ETHEREUM, 2000000), market(2, wbtc, 5000000), market(3, CBBTC_ETHEREUM, 3000000)]);
    const result = addDocumentedCbbtcDependencies(analyze(raw, provenance, '1000000'));
    const scenario = simulateCbbtcDepeg(result, '2026-10-10T10:01:00.000Z');
    expect(scenario.marketIds).toEqual([`0x${'3'.repeat(64)}`, `0x${'1'.repeat(64)}`]);
    expect(scenario.capitalExposedUsd).toBe('500000.00');
    expect(scenario.maxPrincipalAtRiskUsd).toBe('500000.00');
    expect(scenario.dependencyPaths).toHaveLength(2);
    expect(scenario.actualLossUsd).toBeNull();
    expect(scenario.shock.observedPriceChangePercent).toBeNull();
    expect(scenario.executionEnabled).toBe(false);
    expect(scenario.exit.walletSpecificWithdrawableUsd).toBeNull();
    expect(scenario.liveSnapshotRetrievedAt).toBe(provenance.retrievedAt);
    expect(result.graph.edges.filter((edge) => edge.status === 'DOCUMENTED')).toHaveLength(3);
  });
  it('does not offer the scenario when no cbBTC-funded market exists', () => {
    const result = analyze(snapshot([market(1, wbtc, 10000000)]), provenance, '1000000');
    expect(simulateCbbtcDepeg(result).available).toBe(false);
    expect(addDocumentedCbbtcDependencies(result).graph.edges.some((edge) => edge.status === 'DOCUMENTED')).toBe(false);
  });
});

describe('relative price deviation rule', () => {
  it('distinguishes a hypothetical breach from a normal observation', () => {
    const breach = evaluatePriceDeviation({ baseline: '1', observed: '0.70', threshold: '0.10', provenance: 'SIMULATED_INPUT' });
    expect(breach.status).toBe('TRIGGERED');
    expect(breach.deviationPercent).toBe('-30.00');
    expect(evaluatePriceDeviation({ baseline: '1', observed: '0.96', threshold: '0.10', provenance: 'SAMPLE' }).status).toBe('NOT_TRIGGERED');
  });
  it('does not manufacture a live signal when price evidence is absent or invalid', () => {
    expect(evaluatePriceDeviation({ baseline: null, observed: null, provenance: null }).status).toBe('UNKNOWN');
    expect(evaluatePriceDeviation({ baseline: 'bad', observed: '0.70', provenance: 'SAMPLE' }).status).toBe('UNKNOWN');
  });
});
