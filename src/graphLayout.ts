import type { Analysis, GraphNode } from './model';

export type PlacedNode = GraphNode & { x: number; y: number; width: number; height: number };

export function layoutGraph(analysis: Analysis) {
  const markets = analysis.graph.nodes.filter((node) => node.type === 'LendingMarket');
  const positions = new Map<string, PlacedNode>();
  const marketIndex = new Map(analysis.vault.allocations.map((allocation, i) => [`market:1:${allocation.marketId}`, i]));
  markets.sort((a, b) => (marketIndex.get(a.id) ?? 0) - (marketIndex.get(b.id) ?? 0));
  markets.forEach((node, i) => positions.set(node.id, { ...node, x: 455, y: 65 + i * 112, width: 190, height: 62 }));
  const middle = 65 + Math.max(0, markets.length - 1) * 56;
  const placeFixed = (type: string, x: number, y: number) => analysis.graph.nodes.filter((node) => node.type === type).forEach((node) => positions.set(node.id, { ...node, x, y, width: 190, height: 62 }));
  placeFixed('Position', 25, middle);
  placeFixed('Vault', 240, middle);
  placeFixed('Blockchain', 240, Math.max(20, middle - 130));
  const anchor = (node: GraphNode) => {
    const values = node.affectedMarketIds.map((id) => positions.get(`market:1:${id}`)?.y).filter((value): value is number => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : middle;
  };
  for (const [types, x] of [
    [['CollateralToken', 'LoanToken'], 685],
    [['Oracle'], 905],
    [['OracleFeed', 'OracleVault', 'IssuerCustodian', 'BackingAsset'], 1125],
  ] as Array<[string[], number]>) {
    const lane = analysis.graph.nodes.filter((node) => types.includes(node.type)).sort((a, b) => anchor(a) - anchor(b));
    let last = -72;
    for (const node of lane) {
      const y = Math.max(anchor(node), last + 73);
      positions.set(node.id, { ...node, x, y, width: 190, height: 62 });
      last = y;
    }
  }
  const nodes = [...positions.values()];
  return { nodes, byId: positions, width: 1350, height: Math.max(800, ...nodes.map((node) => node.y + node.height + 50)) };
}
