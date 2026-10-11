import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildPortfolio } from '../api/portfolioEngine.mjs';
import { buildImpactIndex } from '../api/portfolioImpact.mjs';
import { CBBTC_ETHEREUM } from '../api/scenarioEngine.mjs';
import { layoutGraph } from '../src/graphLayout.ts';

const snapshot = JSON.parse(await readFile(new URL('../data/demo-snapshot.json', import.meta.url), 'utf8'));
const cbBtcId = `token:1:${CBBTC_ETHEREUM}`;

describe('reverse portfolio impact', () => {
  it('finds all affected positions, counts distinct markets, and reconciles with the incident', async () => {
    const portfolio = await buildPortfolio({ source: 'snapshot', scenario: true, snapshot });
    const impact = portfolio.impactIndex[cbBtcId];
    expect(impact.affectedPositions.map((item) => item.id)).toEqual(['steakhouse-usdc', 'gauntlet-usdc-core', 'gauntlet-usdc-prime', 'smokehouse-usdc', 'yearn-usdc']);
    expect(impact.affectedPositionCount).toBe(5);
    expect(impact.affectedMarketCount).toBe(3);
    expect(impact.affectedAllocationCount).toBe(7);
    expect(Number(impact.uniqueCapitalExposedUsd)).toBeCloseTo(impact.affectedPositions.reduce((sum, item) => sum + Number(item.exposedPrincipalUsd), 0), 2);
    const positionsByMarket = new Map();
    for (const item of impact.affectedPositions) for (const marketId of item.marketIds) positionsByMarket.set(marketId, new Set([...(positionsByMarket.get(marketId) || []), item.id]));
    expect([...positionsByMarket.values()].some((positionIds) => positionIds.size >= 3)).toBe(true);
    expect(portfolio.portfolioGraph.nodes.filter((node) => node.id === cbBtcId)).toHaveLength(1);
    expect(impact.maximumConditionalPrincipalLossUsd).toBe(impact.uniqueCapitalExposedUsd);
    expect(portfolio.portfolioIncident.uniqueCapitalExposedUsd).toBe(impact.uniqueCapitalExposedUsd);
    for (const item of impact.affectedPositions) for (const path of item.paths) {
      expect(path.nodeIds[0]).toBe(`position:tracked:${item.id}`);
      expect(path.nodeIds.at(-1)).toBe(cbBtcId);
      expect(path.edgeIds).toHaveLength(path.nodeIds.length - 1);
      expect(path.edgeIds.every((id) => portfolio.portfolioGraph.edges.some((edge) => edge.id === id))).toBe(true);
    }
  });

  it('does not count the same funded market twice when independent routes reach a shared issuer', async () => {
    const portfolio = await buildPortfolio({ source: 'snapshot', snapshot });
    const cbBtc = portfolio.impactIndex[cbBtcId];
    const issuer = portfolio.impactIndex['organization:coinbase'];
    expect(issuer.affectedPositions[0].paths.length).toBeGreaterThan(cbBtc.affectedPositions[0].paths.length);
    expect(issuer.uniqueCapitalExposedUsd).toBe(cbBtc.uniqueCapitalExposedUsd);
    expect(issuer.affectedMarketCount).toBe(cbBtc.affectedMarketCount);
  });

  it('keeps every position and vault visible when their paths share a market', async () => {
    const portfolio = await buildPortfolio({ source: 'snapshot', snapshot });
    const paths = portfolio.impactIndex[cbBtcId].affectedPositions.flatMap((item) => item.paths);
    const nodeIds = new Set(paths.flatMap((path) => path.nodeIds));
    const edgeIds = new Set(paths.flatMap((path) => path.edgeIds));
    const layout = layoutGraph({
      nodes: portfolio.portfolioGraph.nodes.filter((node) => nodeIds.has(node.id)),
      edges: portfolio.portfolioGraph.edges.filter((edge) => edgeIds.has(edge.id)),
    });
    for (const type of ['Position', 'Vault']) {
      const lane = layout.nodes.filter((node) => node.type === type).sort((a, b) => a.y - b.y);
      expect(lane).toHaveLength(5);
      for (let index = 1; index < lane.length; index++) expect(lane[index].y).toBeGreaterThanOrEqual(lane[index - 1].y + lane[index - 1].height);
    }
  });

  it('traverses newly verified intermediate layers without a fixed depth or hardcoded positions', async () => {
    const portfolio = await buildPortfolio({ source: 'snapshot', snapshot });
    const positions = structuredClone(portfolio.positions);
    for (const position of positions) {
      if (!position.analysis.graph.nodes.some((node) => node.id === cbBtcId)) continue;
      position.analysis.graph.nodes.push({ id: 'protocol:bridge', type: 'Protocol', label: 'Bridge', address: null });
      position.analysis.graph.nodes.push({ id: 'service:deep', type: 'Service', label: 'Deep dependency', address: null });
      position.analysis.graph.edges.push({ id: `${cbBtcId}|USES|protocol:bridge`, from: cbBtcId, to: 'protocol:bridge', type: 'USES', status: 'DOCUMENTED', evidence: { source: 'https://example.org/evidence', field: 'bridge' } });
      position.analysis.graph.edges.push({ id: 'protocol:bridge|USES|service:deep', from: 'protocol:bridge', to: 'service:deep', type: 'USES', status: 'DOCUMENTED', evidence: { source: 'https://example.org/evidence', field: 'service' } });
    }
    const { impacts } = buildImpactIndex(positions);
    const deep = impacts['service:deep'];
    expect(deep.affectedPositionCount).toBe(5);
    expect(deep.uniqueCapitalExposedUsd).toBe(portfolio.impactIndex[cbBtcId].uniqueCapitalExposedUsd);
    expect(deep.affectedPositions.every((item) => item.paths.every((path) => path.nodeIds.length === 6))).toBe(true);
  });

  it('treats a vault-wide chain dependency as the full assumed portfolio principal', async () => {
    const portfolio = await buildPortfolio({ source: 'snapshot', snapshot });
    const chain = portfolio.impactIndex['chain:1'];
    expect(chain.affectedPositionCount).toBe(6);
    expect(chain.uniqueCapitalExposedUsd).toBe(portfolio.portfolio.totalAssumedCapitalUsd);
  });
});
