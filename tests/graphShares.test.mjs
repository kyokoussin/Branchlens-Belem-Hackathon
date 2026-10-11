import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { mergePortfolioGraph } from '../api/_portfolioImpact.mjs';
import { buildPortfolio } from '../api/_portfolioEngine.mjs';
import { calculateGraphShares } from '../src/graphShares.ts';

const snapshot = JSON.parse(await readFile(new URL('../data/demo-snapshot.json', import.meta.url), 'utf8'));

const node = (id, type, capitalExposedUsd, affectedMarketIds) => ({ id, type, label: id, address: null, capitalExposedUsd, affectedMarketIds });
const edge = (from, to, type) => ({ id: `${from}|${type}|${to}`, from, to, type, status: 'OBSERVED', evidence: { source: 'test', field: type } });

function position(id, amount, firstMarket, secondMarket) {
  const positionId = 'position:assumed:vault';
  const nodes = [
    node(positionId, 'Position', amount, ['one', 'two']),
    node('vault:shared', 'Vault', amount, ['one', 'two']),
    node('market:one', 'LendingMarket', firstMarket, ['one']),
    node('market:two', 'LendingMarket', secondMarket, ['two']),
    node('token:shared', 'CollateralToken', String(Number(firstMarket) + Number(secondMarket)), ['one', 'two']),
    node('chain:one', 'Blockchain', amount, ['one', 'two']),
  ];
  const edges = [edge(positionId, 'vault:shared', 'HOLDS'), edge('vault:shared', 'market:one', 'ALLOCATES_TO'), edge('vault:shared', 'market:two', 'ALLOCATES_TO'), edge('market:one', 'token:shared', 'SECURED_BY'), edge('vault:shared', 'chain:one', 'DEPLOYED_ON')];
  return { id, name: id, amountUsd: amount, analysis: { graph: { nodes, edges, coverage: '' }, exposure: { marketExposures: [{ marketId: 'one', capitalExposedUsd: firstMarket }, { marketId: 'two', capitalExposedUsd: secondMarket }] } } };
}

describe('percent of previous dependency node', () => {
  it('uses funded allocation for markets and full branch share for structural links', () => {
    const item = position('first', '100', '30', '50');
    const shares = calculateGraphShares(item.analysis.graph, [item], false);
    expect(shares['position:assumed:vault|HOLDS|vault:shared'].label).toBe('100%');
    expect(shares['vault:shared|ALLOCATES_TO|market:one'].label).toBe('30.0%');
    expect(shares['vault:shared|ALLOCATES_TO|market:two'].label).toBe('50.0%');
    expect(shares['market:one|SECURED_BY|token:shared'].label).toBe('100%');
    expect(shares['vault:shared|DEPLOYED_ON|chain:one'].label).toBe('100%');
  });

  it('weights a shared vault across positions without counting a shared child twice', () => {
    const positions = [position('first', '100', '30', '50'), position('second', '200', '60', '100')];
    const graph = mergePortfolioGraph(positions).graph;
    const shares = calculateGraphShares(graph, positions, true);
    expect(shares['vault:shared|ALLOCATES_TO|market:one']).toMatchObject({ label: '30.0%', linkedUsd: '90.00', parentUsd: '300.00' });
    expect(shares['market:one|SECURED_BY|token:shared'].label).toBe('100%');
    expect(shares['position:tracked:first|HOLDS|vault:shared'].label).toBe('100%');
  });

  it('calculates a share for every dependency edge in the verified demo graphs', async () => {
    const portfolio = await buildPortfolio({ source: 'snapshot', snapshot });
    for (const position of portfolio.positions) {
      const shares = calculateGraphShares(position.analysis.graph, [position], false);
      expect(Object.keys(shares)).toHaveLength(position.analysis.graph.edges.length);
      expect(Object.entries(shares).filter(([, share]) => share.label === 'Unknown').map(([id]) => id)).toEqual([]);
    }
    const globalShares = calculateGraphShares(portfolio.portfolioGraph, portfolio.positions, true);
    expect(Object.keys(globalShares)).toHaveLength(portfolio.portfolioGraph.edges.length);
    expect(Object.entries(globalShares).filter(([, share]) => share.label === 'Unknown').map(([id]) => id)).toEqual([]);
  });
});
