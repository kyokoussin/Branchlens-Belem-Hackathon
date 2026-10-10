import type { Graph, GraphNode } from './model';

export type PlacedNode = GraphNode & { x: number; y: number; width: number; height: number };

// One placement engine renders a position graph or the verified path subgraph.
export function layoutGraph(graph: Graph) {
  const placed = new Map<string, PlacedNode>();
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge.from]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge.to]);
  }
  const set = (node: GraphNode, x: number, y: number) => placed.set(node.id, { ...node, x, y, width: 190, height: 62 });
  const mean = (values: number[], fallback: number) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
  const markets = graph.nodes.filter((node) => node.type === 'LendingMarket');
  markets.forEach((node, index) => set(node, 455, 65 + index * 116));
  const middle = 65 + Math.max(0, markets.length - 1) * 58;
  graph.nodes.filter((node) => node.type === 'Vault').forEach((node, index) => {
    const ys = (outgoing.get(node.id) || []).map((id) => placed.get(id)?.y).filter((y): y is number => y != null);
    set(node, 240, mean(ys, 65 + index * 116));
  });
  graph.nodes.filter((node) => node.type === 'Position').forEach((node, index) => {
    const ys = (outgoing.get(node.id) || []).map((id) => placed.get(id)?.y).filter((y): y is number => y != null);
    set(node, 25, mean(ys, 65 + index * 116));
  });
  const lanes: Array<[string[], number]> = [
    [['CollateralToken', 'LoanToken'], 685],
    [['Oracle'], 905],
    [['OracleFeed', 'OracleVault', 'BackingAsset', 'IssuerCustodian', 'Blockchain'], 1125],
  ];
  for (const [types, x] of lanes) {
    const anchor = (node: GraphNode) => mean((incoming.get(node.id) || []).map((id) => placed.get(id)?.y).filter((y): y is number => y != null), middle);
    const lane = graph.nodes.filter((node) => types.includes(node.type)).sort((a, b) => anchor(a) - anchor(b));
    let last = -72;
    for (const node of lane) {
      const y = Math.max(anchor(node), last + 76);
      set(node, x, y);
      last = y;
    }
  }
  // A newly verified protocol layer remains visible without changing this layout.
  const remaining = new Set(graph.nodes.filter((node) => !placed.has(node.id)).map((node) => node.id));
  for (let pass = 0; pass < graph.nodes.length && remaining.size; pass++) {
    let advanced = false;
    for (const id of [...remaining]) {
      const parents = (incoming.get(id) || []).map((parent) => placed.get(parent)).filter((node): node is PlacedNode => node != null);
      if (!parents.length) continue;
      const node = graph.nodes.find((item) => item.id === id)!;
      set(node, Math.max(...parents.map((parent) => parent.x)) + 220, mean(parents.map((parent) => parent.y), middle));
      remaining.delete(id); advanced = true;
    }
    if (!advanced) break;
  }
  for (const id of remaining) {
    const node = graph.nodes.find((item) => item.id === id)!;
    set(node, 1125, middle);
  }
  const nodes = [...placed.values()];
  return { nodes, byId: placed, width: Math.max(1350, ...nodes.map((node) => node.x + node.width + 35)), height: Math.max(800, ...nodes.map((node) => node.y + node.height + 50)) };
}
