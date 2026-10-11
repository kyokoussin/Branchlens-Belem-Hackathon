import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildPortfolio } from '../api/_portfolioEngine.mjs';
import { evaluateImpactScenario } from '../api/_impactModel.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/demo-snapshot.json', import.meta.url), 'utf8'));

describe('calculated demo stress', () => {
  it('uses Morpho allocations once across shared cbBTC paths and feeds the incident', async () => {
    const portfolio = await buildPortfolio({ source: 'snapshot', snapshot, scenario: true });
    const impact = portfolio.impactIndex['token:1:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'];
    const estimate = evaluateImpactScenario(impact, portfolio.positions, { type: 'DEMO_STRESS' });
    expect(estimate.affectedCapitalUsd).toBe('773729.78');
    expect(estimate.estimatedFinancialLossUsd).toBe('16219.18');
    expect(estimate.temporarilyInaccessibleCapitalUsd).toBe('697424.89');
    expect(estimate.affectedPositions.length).toBe(5);
    expect(estimate.affectedPositions.every((row) => Number(row.estimatedFinancialLossUsd) <= Number(row.exposedPrincipalUsd))).toBe(true);
    expect(portfolio.portfolioIncident.estimatedFinancialLossUsd).toBe(estimate.estimatedFinancialLossUsd);
    expect(portfolio.portfolioIncident.temporarilyInaccessibleCapitalUsd).toBe(estimate.temporarilyInaccessibleCapitalUsd);
  });

  it('separates a 24-hour chain halt from principal impairment', async () => {
    const portfolio = await buildPortfolio({ source: 'snapshot', snapshot });
    const estimate = evaluateImpactScenario(portfolio.impactIndex['chain:1'], portfolio.positions, { type: 'DEMO_STRESS' });
    expect(estimate.affectedCapitalUsd).toBe('2650000.00');
    expect(estimate.temporarilyInaccessibleCapitalUsd).toBe('2650000.00');
    expect(estimate.estimatedFinancialLossUsd).toBe('363.02');
  });

  it('uses borrower collateral and debt instead of applying the supplier bad-debt formula', async () => {
    const vault = snapshot.positions.find((item) => item.id === 'steakhouse-usdc');
    const market = vault.raw.state.allocation.find((row) => row.market.collateralAsset?.symbol === 'cbBTC' && Number(row.supplyAssetsUsd) > 0).market;
    const marketId = market.marketId.toLowerCase();
    const borrow = { id: 'test-borrow', name: 'Test borrow', address: marketId, chainId: 1, portfolioId: 'demo', amountUsd: '15000', borrowDebtUsd: '9000', positionType: 'borrow' };
    const supplier = { ...borrow, id: 'test-supply', name: 'Test supply', amountUsd: '2000', positionType: 'supply', borrowDebtUsd: undefined };
    const testSnapshot = { ...snapshot, positions: [borrow, supplier].map((item) => ({ id: item.id, address: marketId, chainId: 1, raw: { ...market, chain: { id: 1 } }, provenance: vault.provenance, capturedAt: snapshot.capturedAt })) };
    const portfolio = await buildPortfolio({ source: 'snapshot', snapshot: testSnapshot, positions: [borrow, supplier] });
    const impact = portfolio.impactIndex['token:1:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'];
    const estimate = evaluateImpactScenario(impact, portfolio.positions, { type: 'DEMO_STRESS' });
    const borrower = estimate.affectedPositions.find((row) => row.id === borrow.id);
    const lender = estimate.affectedPositions.find((row) => row.id === supplier.id);
    expect(estimate.affectedCapitalUsd).toBe('17000.00');
    expect(borrower.estimatedFinancialLossUsd).toBe('4500.00');
    expect(Number(borrower.temporarilyInaccessibleCapitalUsd)).toBeGreaterThan(0);
    expect(Number(borrower.temporarilyInaccessibleCapitalUsd)).toBeLessThanOrEqual(15000);
    expect(Number(lender.estimatedFinancialLossUsd)).toBeLessThan(2000);
    expect(Number(estimate.estimatedFinancialLossUsd)).toBeCloseTo(4500 + Number(lender.estimatedFinancialLossUsd), 2);
  });
});
