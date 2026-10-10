import Decimal from 'decimal.js';
import { DEMO_POSITIONS } from './portfolioConfig.mjs';
import { fetchMorphoVault } from './morphoClient.mjs';
import { analyze, DataError, unionExposure } from './riskEngine.mjs';
import { formatIncidents } from './incidentFormatter.mjs';
import { addDocumentedCbbtcDependencies, evaluatePriceDeviation, simulateCbbtcDepeg } from './scenarioEngine.mjs';
import { CBBTC_ETHEREUM } from './scenarioEngine.mjs';
import { buildImpactIndex } from './portfolioImpact.mjs';

const money = (number) => new Decimal(number).toDecimalPlaces(2).toFixed(2);
const monitoringBaseline = new Map();

export function addGraphImpact(analysis) {
  const { graph, vault, exposure } = analysis;
  const incoming = new Map();
  for (const edge of graph.edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge.from);
  }
  const allMarketIds = vault.allocations.map((row) => row.marketId);
  const nodes = graph.nodes.map((node) => {
    let marketIds;
    const vaultWide = node.type === 'Position' || node.type === 'Vault' || graph.edges.some((edge) => edge.from.startsWith('vault:') && edge.to === node.id && edge.type !== 'ALLOCATES_TO');
    if (vaultWide) marketIds = allMarketIds;
    else {
      const found = new Set();
      const visited = new Set();
      const queue = [node.id];
      while (queue.length) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        if (current.startsWith('market:')) found.add(current.split(':').pop());
        for (const parent of incoming.get(current) || []) queue.push(parent);
      }
      marketIds = [...found];
    }
    return { ...node, affectedMarketIds: marketIds, capitalExposedUsd: vaultWide ? exposure.assumedPrincipalUsd : unionExposure(exposure, marketIds) };
  });
  return { ...analysis, graph: { ...graph, nodes } };
}

export async function buildPortfolio({ source = 'auto', scenario = false, snapshot, fetchVault = fetchMorphoVault, positions = DEMO_POSITIONS }) {
  if (!['auto', 'snapshot'].includes(source)) throw new DataError('Unknown data source mode.');
  if (snapshot?.kind !== 'VERIFIED_HISTORICAL_MORPHO_API_SNAPSHOT' || !snapshot.capturedAt || !Array.isArray(snapshot.positions)) throw new DataError('Verified demo snapshot is missing or invalid.');
  const loaded = await Promise.all(positions.map(async (position) => {
    let entry;
    let mode = 'LIVE_API';
    let warning = null;
    if (source === 'auto') {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            entry = await fetchVault(position.address);
            analyze(entry.raw, entry.provenance, position.amountUsd);
            if (attempt) warning = 'An initially inconsistent API response was replaced by a fresh, validated response.';
            break;
          } catch (error) {
            if (attempt || !(error instanceof DataError && error.message.includes('allocation USD sum exceeds'))) throw error;
          }
        }
      } catch (error) {
        mode = 'SAVED_HISTORICAL_SNAPSHOT';
        warning = `Live API unavailable or invalid: ${error.message}. Showing a saved historical response, not live state.`;
      }
    } else mode = 'SAVED_HISTORICAL_SNAPSHOT';
    if (mode === 'SAVED_HISTORICAL_SNAPSHOT') {
      const stored = snapshot.positions.find((item) => item.id === position.id && item.address.toLowerCase() === position.address.toLowerCase());
      if (!stored) throw new DataError(`No verified historical snapshot for ${position.id}.`);
      entry = { raw: stored.raw, provenance: { ...stored.provenance, retrievedAt: stored.provenance.retrievedAt, snapshotCapturedAt: snapshot.capturedAt } };
    }
    const analysis = addGraphImpact(addDocumentedCbbtcDependencies(formatIncidents(analyze(entry.raw, entry.provenance, position.amountUsd))));
    if (warning) analysis.vault.warnings.push(warning);
    const previous = monitoringBaseline.get(position.id);
    const current = {
      markets: analysis.vault.allocations.map((row) => `${row.marketId}:${row.allocationUsd}`).join('|'),
      totalUsd: analysis.vault.totalUsd,
      findingKeys: analysis.findings.filter((item) => item.status === 'TRIGGERED').map((item) => item.id).join('|'),
    };
    const changes = mode === 'LIVE_API' && previous ? [
      previous.markets !== current.markets ? 'Funded market allocations changed' : null,
      previous.totalUsd !== current.totalUsd ? 'Vault total assets changed' : null,
      previous.findingKeys !== current.findingKeys ? 'Structural rule outcomes changed' : null,
    ].filter(Boolean) : [];
    if (mode === 'LIVE_API') monitoringBaseline.set(position.id, current);
    const simulation = scenario ? simulateCbbtcDepeg(analysis) : null;
    return { id: position.id, address: position.address, description: position.description, amountUsd: money(position.amountUsd), dataMode: mode, snapshotCapturedAt: mode === 'SAVED_HISTORICAL_SNAPSHOT' ? snapshot.capturedAt : null, changes, analysis, simulation, livePriceSignal: evaluatePriceDeviation({ baseline: null, observed: null, provenance: null }) };
  }));
  const { graph: portfolioGraph, impacts: impactIndex } = buildImpactIndex(loaded);
  const cbBtcNodeId = `token:1:${CBBTC_ETHEREUM}`;
  const cbBtcImpact = impactIndex[cbBtcNodeId];
  const simulations = loaded.filter((item) => item.simulation?.available);
  const portfolioIncident = scenario && simulations.length ? {
    kind: 'SIMULATED_PORTFOLIO_INCIDENT', status: 'SIMULATED_NOT_OBSERVED', id: 'sim_portfolio_cbbtc_depeg_30', severity: 'REVIEW_REQUIRED',
    title: 'Hypothetical cbBTC 30% depeg relative to BTC',
    whatHappened: 'Analyst replay of a 30% relative cbBTC/BTC price decline. No live depeg was detected.',
    whyItMatters: 'cbBTC is collateral in funded Morpho markets beneath the selected portfolio positions; lender bad debt is not modeled.',
    dependency: 'Ethereum cbBTC collateral',
    dependencyNodeId: cbBtcNodeId,
    detectionRule: simulations[0].simulation.detectionRule,
    affectedPositions: cbBtcImpact.affectedPositions.map((item) => ({ id: item.id, name: item.name, assumedPrincipalUsd: item.assumedPrincipalUsd, exposedPrincipalUsd: item.exposedPrincipalUsd, markets: item.marketIds, dataMode: item.dataMode })),
    uniqueCapitalExposedUsd: cbBtcImpact.uniqueCapitalExposedUsd,
    maximumConditionalPrincipalLossUsd: cbBtcImpact.maximumConditionalPrincipalLossUsd,
    maxRiskMeaning: 'Conditional bound if all affected principal is lost; it is not a loss estimate from the 30% price deviation.',
    actualLossUsd: null,
    exit: { walletSpecificWithdrawal: 'NOT_VERIFIED', vaultWideLiquidityIsNotWalletCapacity: true, executionQuote: 'NOT_QUOTED', swapSlippage: 'NOT_APPLICABLE_FOR_PLAIN_VAULT_REDEMPTION', gasCost: 'NOT_QUOTED', executionEnabled: false },
    analystMustVerify: ['Whether cbBTC actually deviated from BTC', 'Borrower health and recoverable bad debt', 'Wallet-specific redeemability and gates', 'Current execution quote and gas cost'],
    sources: [...new Set(simulations.flatMap((item) => item.simulation.sourceLinks))],
    sourceTimestamps: simulations.map((item) => ({ positionId: item.id, retrievedAt: item.simulation.liveSnapshotRetrievedAt, dataMode: item.dataMode, snapshotCapturedAt: item.snapshotCapturedAt })),
    simulatedAt: new Date().toISOString(), executionEnabled: false,
  } : null;
  const dependencyIds = new Set(loaded.flatMap((item) => item.analysis.graph.nodes.filter((node) => node.type !== 'Position').map((node) => node.id)));
  return {
    mode: loaded.every((item) => item.dataMode === 'LIVE_API') ? 'LIVE_API' : loaded.every((item) => item.dataMode === 'SAVED_HISTORICAL_SNAPSHOT') ? 'SAVED_HISTORICAL_SNAPSHOT' : 'MIXED_LIVE_AND_SNAPSHOT',
    portfolio: { totalAssumedCapitalUsd: money(loaded.reduce((sum, item) => sum.plus(item.amountUsd), new Decimal(0))), trackedPositions: loaded.length, trackedDependencyRelationships: portfolioGraph.edges.length, distinctDependencies: dependencyIds.size, activeAlerts: portfolioIncident ? 1 : 0 },
    positions: loaded,
    portfolioGraph,
    impactIndex,
    portfolioIncident,
    snapshotCapturedAt: snapshot.capturedAt,
  };
}
