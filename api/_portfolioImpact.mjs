import Decimal from 'decimal.js';
import { unionExposure } from './_riskEngine.mjs';

const money = (value) => new Decimal(value).toDecimalPlaces(2).toFixed(2);

function whyAffected(selected, position, marketCount) {
  const subject = position.analysis.vault.version === 'MORPHO_MARKET' ? 'The tracked Morpho market' : 'The tracked Morpho vault';
  if (selected.type === 'Blockchain') return `${subject} settles on ${selected.label}. A chain outage can interrupt access without implying a permanent loss.`;
  if (selected.type === 'LendingMarket') return position.positionType === 'borrow'
    ? 'The simulated borrower uses this verified market; tracked collateral and debt are not lender principal or a lender-loss estimate.'
    : `${subject} supplies this verified market. Only its allocated share of the assumed position is counted.`;
  if (selected.type === 'Oracle' || selected.type === 'OracleFeed' || selected.type === 'OracleVault') return `${marketCount} funded market${marketCount === 1 ? '' : 's'} depend on this pricing component. A bad price alone does not establish lender loss.`;
  if (selected.type === 'CollateralToken') return `${marketCount} funded market${marketCount === 1 ? '' : 's'} accept ${selected.label} as collateral. Collateral stress does not itself establish bad debt.`;
  if (selected.type === 'Vault') return 'The simulated position holds this vault; its underlying allocations determine market-specific exposure.';
  if (selected.type === 'Position') return 'This is the analyst-entered simulated holding, not an observed wallet balance.';
  if (selected.type === 'IssuerCustodian' || selected.type === 'BackingAsset') return `The path continues through a documented backing or custody claim for collateral in ${marketCount} funded market${marketCount === 1 ? '' : 's'}; economic loss is not verified.`;
  return `${subject} has a graph path to this dependency through ${marketCount} funded market${marketCount === 1 ? '' : 's'}.`;
}

// Keep one graph: these are the verified per-position graph nodes and edges,
// with only the assumed holding node made unique for each tracked position.
export function mergePortfolioGraph(positions) {
  const nodes = new Map();
  const edges = new Map();
  const positionNodeIds = new Map();
  for (const position of positions) {
    const graph = position.analysis.graph;
    const original = graph.nodes.find((node) => node.type === 'Position');
    if (!original) throw new Error(`No position node for ${position.id}`);
    const trackedId = `position:tracked:${position.id}`;
    positionNodeIds.set(trackedId, position);
    const translate = (id) => id === original.id ? trackedId : id;
    for (const node of graph.nodes) {
      const id = translate(node.id);
      if (!nodes.has(id)) nodes.set(id, { ...node, id, label: node.type === 'Position' ? (position.name || position.analysis.vault.name) : node.label });
    }
    for (const edge of graph.edges) {
      const from = translate(edge.from);
      const to = translate(edge.to);
      const id = `${from}|${edge.type}|${to}`;
      if (!edges.has(id)) edges.set(id, { ...edge, id, from, to });
    }
  }
  return { graph: { nodes: [...nodes.values()], edges: [...edges.values()], coverage: 'Union of the same observed, documented, and assumed position graphs used by Dependency View.' }, positionNodeIds };
}

// Enumerate every simple incoming path. No depth limit: graph provenance,
// rather than a hardcoded asset or market list, determines the affected set.
export function buildImpactIndex(positions) {
  const { graph, positionNodeIds } = mergePortfolioGraph(positions);
  const incoming = new Map();
  for (const edge of graph.edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
  }
  const impacts = {};
  for (const selected of graph.nodes) {
    const pathsByPosition = new Map();
    const walk = (nodeId, nodesFromDependency, edgesFromDependency, visited) => {
      if (positionNodeIds.has(nodeId)) {
        const position = positionNodeIds.get(nodeId);
        const list = pathsByPosition.get(position.id) || [];
        list.push({ nodeIds: [...nodesFromDependency].reverse(), edgeIds: [...edgesFromDependency].reverse() });
        pathsByPosition.set(position.id, list);
        return;
      }
      for (const edge of incoming.get(nodeId) || []) {
        if (visited.has(edge.from)) continue;
        walk(edge.from, [...nodesFromDependency, edge.from], [...edgesFromDependency, edge.id], new Set([...visited, edge.from]));
      }
    };
    walk(selected.id, [selected.id], [], new Set([selected.id]));
    const affectedPositions = [];
    const affectedMarketIds = new Set();
    const usedEdgeIds = new Set();
    for (const position of positions) {
      const paths = pathsByPosition.get(position.id);
      if (!paths?.length) continue;
      const marketIds = new Set();
      let vaultWide = false;
      for (const path of paths) {
        for (const id of path.nodeIds) if (id.startsWith('market:')) marketIds.add(id.slice(id.lastIndexOf(':') + 1));
        if (!path.nodeIds.some((id) => id.startsWith('market:'))) vaultWide = true;
        for (const id of path.edgeIds) usedEdgeIds.add(id);
      }
      if (vaultWide) for (const allocation of position.analysis.vault.allocations) marketIds.add(allocation.marketId);
      for (const id of marketIds) affectedMarketIds.add(id);
      const exposedPrincipalUsd = vaultWide ? position.amountUsd : unionExposure(position.analysis.exposure, [...marketIds]);
      affectedPositions.push({
        id: position.id, name: position.name || position.analysis.vault.name, assumedPrincipalUsd: position.amountUsd,
        exposedPrincipalUsd, marketIds: [...marketIds], paths, reason: whyAffected(selected, position, marketIds.size),
        dataMode: position.dataMode, retrievedAt: position.analysis.vault.provenance.retrievedAt,
        snapshotCapturedAt: position.snapshotCapturedAt,
      });
    }
    const relevantEdges = graph.edges.filter((edge) => usedEdgeIds.has(edge.id) || edge.from === selected.id);
    const uniqueCapitalExposedUsd = money(affectedPositions.reduce((sum, position) => sum.plus(position.exposedPrincipalUsd), new Decimal(0)));
    impacts[selected.id] = {
      selectedNodeId: selected.id, selectedLabel: selected.label, selectedType: selected.type,
      affectedPositions, affectedPositionCount: affectedPositions.length,
      affectedMarketCount: affectedMarketIds.size, affectedAllocationCount: affectedPositions.reduce((sum, position) => sum + position.marketIds.length, 0), affectedMarketIds: [...affectedMarketIds],
      uniqueCapitalExposedUsd,
      estimatedFinancialLossUsd: null,
      temporarilyInaccessibleCapitalUsd: null,
      estimationNote: 'A dependency path and allocated capital do not establish an incident, permanent loss, or withdrawal blockage.',
      sources: [...new Set(relevantEdges.map((edge) => edge.evidence?.source).filter(Boolean))],
      evidenceStatuses: [...new Set(relevantEdges.map((edge) => edge.status))],
    };
  }
  return { graph, impacts };
}
