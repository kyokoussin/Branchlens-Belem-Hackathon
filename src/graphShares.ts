import Decimal from 'decimal.js';
import type { Graph, GraphEdge, GraphNode, Position } from './model';

export type GraphShare = { label: string; linkedUsd: string; parentUsd: string };

const keyOf = (edge: GraphEdge) => `${edge.from}|${edge.type}|${edge.to}`;
const amount = (value: string) => new Decimal(value);

function branchCapital(position: Position, parent: GraphNode, child: GraphNode): Decimal | null {
  const parentCapital = amount(parent.capitalExposedUsd);
  const parentMarkets = parent.affectedMarketIds;
  const childMarkets = new Set(child.affectedMarketIds);
  if (!parentMarkets.length) return parentCapital;
  if (!childMarkets.size) return null;
  if (parentMarkets.every((marketId) => childMarkets.has(marketId))) return parentCapital;
  const sharedMarkets = new Set(parentMarkets.filter((marketId) => childMarkets.has(marketId)));
  const uniqueRows = new Map(position.analysis.exposure.marketExposures.map((row) => [row.marketId, row]));
  const linked = [...sharedMarkets].reduce((sum, marketId) => sum.plus(uniqueRows.get(marketId)?.capitalExposedUsd || '0'), new Decimal(0));
  return Decimal.min(parentCapital, linked);
}

export function calculateGraphShares(graph: Graph, positions: Position[], merged: boolean): Record<string, GraphShare> {
  const graphs = positions.map((position) => {
    const positionId = position.analysis.graph.nodes.find((node) => node.type === 'Position')?.id;
    const translate = (id: string) => merged && id === positionId ? `position:tracked:${position.id}` : id;
    return {
      position,
      nodes: new Map(position.analysis.graph.nodes.map((node) => [translate(node.id), node])),
      edges: new Set(position.analysis.graph.edges.map((edge) => `${translate(edge.from)}|${edge.type}|${translate(edge.to)}`)),
    };
  });
  const result: Record<string, GraphShare> = {};
  for (const edge of graph.edges) {
    let parentUsd = new Decimal(0);
    let linkedUsd = new Decimal(0);
    let unknown = false;
    let fullStructuralLink = true;
    let matched = false;
    for (const entry of graphs) {
      const parent = entry.nodes.get(edge.from);
      if (!parent) continue;
      parentUsd = parentUsd.plus(parent.capitalExposedUsd);
      if (!entry.edges.has(keyOf(edge))) { fullStructuralLink = false; continue; }
      matched = true;
      const child = entry.nodes.get(edge.to);
      if (!child) { unknown = true; continue; }
      if (parent.affectedMarketIds.some((marketId) => !child.affectedMarketIds.includes(marketId))) fullStructuralLink = false;
      const linked = branchCapital(entry.position, parent, child);
      if (linked === null) unknown = true;
      else linkedUsd = linkedUsd.plus(linked);
    }
    const share = unknown ? null : parentUsd.gt(0) ? Decimal.min(100, linkedUsd.div(parentUsd).mul(100)) : matched && fullStructuralLink ? new Decimal(100) : null;
    result[edge.id] = {
      label: share === null ? 'Unknown' : share.eq(100) ? '100%' : share.gt(0) && share.lt('0.1') ? '<0.1%' : `${share.toDecimalPlaces(1).toFixed(1)}%`,
      linkedUsd: linkedUsd.toFixed(2),
      parentUsd: parentUsd.toFixed(2),
    };
  }
  return result;
}
