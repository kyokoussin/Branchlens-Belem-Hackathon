import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { aggregateLoadedPortfolio, buildPortfolio } from '../api/_portfolioEngine.mjs';
import { evaluateImpactScenario } from '../api/_impactModel.mjs';

const fixture = JSON.parse(await readFile(new URL('../data/demo-snapshot.json', import.meta.url), 'utf8'));
const sharedMarket = '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64';
const vaultIds = ['gauntlet-usdc-core', 'gauntlet-usdc-prime'];

async function sample() {
  const snapshot = structuredClone(fixture);
  for (const entry of snapshot.positions) if (vaultIds.includes(entry.id)) entry.provenance.vaultAccountingVersion = '1.0';
  const full = await buildPortfolio({ source: 'snapshot', snapshot });
  return { snapshot, portfolio: aggregateLoadedPortfolio(full.positions.filter((item) => vaultIds.includes(item.id))) };
}

describe('incident-specific Impact View accounting', () => {
  it('keeps a shared chain dependency as affected capital, without declaring it lost', async () => {
    const { portfolio } = await sample();
    const impact = portfolio.impactIndex['chain:1'];
    const baseline = evaluateImpactScenario(impact, portfolio.positions);
    expect(baseline.affectedCapitalUsd).toBe(portfolio.portfolio.totalAssumedCapitalUsd);
    expect(baseline.estimatedFinancialLossUsd).toBeNull();
    expect(baseline.temporarilyInaccessibleCapitalUsd).toBeNull();
    const outage = evaluateImpactScenario(impact, portfolio.positions, { type: 'CHAIN_OUTAGE' });
    expect(outage.temporarilyInaccessibleCapitalUsd).toBe(outage.affectedCapitalUsd);
    expect(outage.estimatedFinancialLossUsd).toBeNull();
  });

  it('uses real recorded Core and Prime market allocations once for a conditional lender-loss scenario', async () => {
    const { snapshot, portfolio } = await sample();
    const impact = portfolio.impactIndex[`market:1:${sharedMarket}`];
    const modeled = evaluateImpactScenario(impact, portfolio.positions, { type: 'MARKET_BAD_DEBT', marketLossPercent: '10' });
    const entries = snapshot.positions.filter((entry) => vaultIds.includes(entry.id));
    const expected = entries.reduce((sum, entry) => {
      const position = portfolio.positions.find((item) => item.id === entry.id);
      const allocation = entry.raw.state.allocation.find((row) => row.market.marketId.toLowerCase() === sharedMarket);
      return sum + Number(position.amountUsd) * Number(allocation.supplyAssetsUsd) / Number(entry.raw.state.totalAssetsUsd) * 0.1;
    }, 0);
    expect(impact.affectedPositions.map((item) => item.id)).toEqual(vaultIds);
    expect(Number(modeled.estimatedFinancialLossUsd)).toBeCloseTo(expected, 1);
    expect(Number(modeled.estimatedFinancialLossUsd)).toBeLessThan(Number(impact.uniqueCapitalExposedUsd));
    expect(modeled.temporarilyInaccessibleCapitalUsd).toBeNull();
    expect(modeled.affectedPositions.every((item) => item.estimatedFinancialLossUsd !== null)).toBe(true);
  });

  it('does not infer loss from oracle, liquidity, or collateral incidents', async () => {
    const { portfolio } = await sample();
    const impact = portfolio.impactIndex[`market:1:${sharedMarket}`];
    for (const type of ['ORACLE_FAILURE', 'LIQUIDITY_STRESS', 'COLLATERAL_SHOCK']) {
      const result = evaluateImpactScenario(impact, portfolio.positions, { type });
      expect(result.estimatedFinancialLossUsd).toBeNull();
      expect(result.temporarilyInaccessibleCapitalUsd).toBeNull();
    }
  });

  it('withholds a depositor-loss total for V1.1 or unverified vault accounting', async () => {
    const { portfolio } = await sample();
    const impact = portfolio.impactIndex[`market:1:${sharedMarket}`];
    const positions = structuredClone(portfolio.positions);
    positions.find((item) => item.id === 'gauntlet-usdc-prime').analysis.vault.accountingVersion = '1.1';
    const v11 = evaluateImpactScenario(impact, positions, { type: 'MARKET_BAD_DEBT', marketLossPercent: '10' });
    expect(v11.estimatedFinancialLossUsd).toBeNull();
    expect(v11.affectedPositions.find((item) => item.id === 'gauntlet-usdc-prime').estimatedFinancialLossUsd).toBeNull();
    positions.find((item) => item.id === 'gauntlet-usdc-prime').analysis.vault.accountingVersion = null;
    expect(evaluateImpactScenario(impact, positions, { type: 'MARKET_BAD_DEBT', marketLossPercent: '10' }).estimatedFinancialLossUsd).toBeNull();
    expect(evaluateImpactScenario(impact, portfolio.positions, { type: 'MARKET_BAD_DEBT' }).estimatedFinancialLossUsd).toBeNull();
  });
});
