import type { GraphNode, PortfolioData, Position } from './model';
import type { WorkspaceConfig } from './portfolioWorkspace';

export type SearchState = { query: string; portfolioIds: string[]; protocol: string; asset: string; marketId: string; oracleId: string; risk: string };
export const emptySearch: SearchState = { query: '', portfolioIds: [], protocol: '', asset: '', marketId: '', oracleId: '', risk: '' };
export const searchActive = (filters: SearchState) => Boolean(filters.query.trim() || filters.portfolioIds.length || filters.protocol || filters.asset || filters.marketId || filters.oracleId || filters.risk);

export function filterPositions(data: PortfolioData, filters: SearchState): Position[] {
  const query = filters.query.trim().toLowerCase();
  return data.positions.filter((position) => {
    if (filters.portfolioIds.length && !filters.portfolioIds.includes(position.portfolioId)) return false;
    if (filters.protocol && filters.protocol !== position.analysis.vault.version) return false;
    if (filters.asset && ![position.analysis.vault.asset.symbol, ...position.analysis.vault.allocations.flatMap((item) => [item.collateral.symbol, item.loan.symbol])].some((symbol) => symbol.toLowerCase() === filters.asset.toLowerCase())) return false;
    if (filters.marketId && !position.analysis.graph.nodes.some((node) => node.type === 'LendingMarket' && node.id === filters.marketId)) return false;
    if (filters.oracleId && !position.analysis.graph.nodes.some((node) => node.type === 'Oracle' && node.id === filters.oracleId)) return false;
    if (filters.risk === 'warning' && !position.analysis.findings.some((item) => item.status === 'TRIGGERED')) return false;
    if (filters.risk === 'clear' && position.analysis.findings.some((item) => item.status === 'TRIGGERED')) return false;
    if (filters.risk === 'incident' && !data.portfolioIncident?.affectedPositions.some((item) => item.id === position.id)) return false;
    if (query && ![position.name, position.analysis.vault.name, position.address, position.description, ...position.analysis.graph.nodes.flatMap((node) => [node.label, node.address || '', node.type])].some((value) => value.toLowerCase().includes(query))) return false;
    return true;
  });
}

export function matchingNodes(data: PortfolioData, positions: Position[], query: string): GraphNode[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const ids = new Set(positions.map((position) => position.id));
  return data.portfolioGraph.nodes.filter((node) => node.type !== 'Position' && [node.label, node.address || '', node.type].some((value) => value.toLowerCase().includes(term)) && data.impactIndex[node.id]?.affectedPositions.some((item) => ids.has(item.id)));
}

export function SearchFilters({ data, config, filters, onChange, onPosition, onNode, compact = false }: { data: PortfolioData; config: WorkspaceConfig; filters: SearchState; onChange: (next: SearchState) => void; onPosition: (position: Position) => void; onNode: (node: GraphNode) => void; compact?: boolean }) {
  const positions = filterPositions(data, filters);
  const nodes = matchingNodes(data, positions, filters.query);
  const assets = [...new Set(data.positions.flatMap((position) => [position.analysis.vault.asset.symbol, ...position.analysis.vault.allocations.flatMap((row) => [row.collateral.symbol, row.loan.symbol])]))].filter(Boolean).sort();
  const markets = data.portfolioGraph.nodes.filter((node) => node.type === 'LendingMarket');
  const oracles = data.portfolioGraph.nodes.filter((node) => node.type === 'Oracle');
  const update = (field: keyof SearchState, value: string) => onChange({ ...filters, [field]: value });
  return <section className={`search-panel card ${compact ? 'compact' : ''}`} aria-label="Portfolio search and filters">
    <div className="search-heading"><div><div className="eyebrow">FIND & FILTER</div><h2>Search the dependency network</h2></div><button onClick={() => onChange(emptySearch)} disabled={!searchActive(filters)}>Reset filters</button></div>
    <input aria-label="Search positions and dependencies" type="search" placeholder="Search positions, vaults, tokens, oracles or addresses" value={filters.query} onChange={(event) => update('query', event.target.value)} />
    <div className="portfolio-filter-chips" aria-label="Portfolio filters"><span>Portfolios</span>{config.portfolios.map((portfolio) => <button key={portfolio.id} className={filters.portfolioIds.includes(portfolio.id) ? 'active' : ''} aria-pressed={filters.portfolioIds.includes(portfolio.id)} onClick={() => onChange({ ...filters, portfolioIds: filters.portfolioIds.includes(portfolio.id) ? filters.portfolioIds.filter((id) => id !== portfolio.id) : [...filters.portfolioIds, portfolio.id] })}>{portfolio.name}</button>)}</div>
    <div className="filter-grid"><label>Protocol<select value={filters.protocol} onChange={(event) => update('protocol', event.target.value)}><option value="">All protocols</option><option value="MORPHO_V1">Morpho V1 vaults</option><option value="MORPHO_MARKET">Morpho markets</option></select></label><label>Asset type<select value={filters.asset} onChange={(event) => update('asset', event.target.value)}><option value="">All assets</option>{assets.map((asset) => <option key={asset} value={asset}>{asset}</option>)}</select></label><label>Lending market<select value={filters.marketId} onChange={(event) => update('marketId', event.target.value)}><option value="">All markets</option>{markets.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.address?.slice(0, 8)}</option>)}</select></label><label>Oracle<select value={filters.oracleId} onChange={(event) => update('oracleId', event.target.value)}><option value="">All oracles</option>{oracles.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label><label>Risk / alert<select value={filters.risk} onChange={(event) => update('risk', event.target.value)}><option value="">Any status</option><option value="warning">Structural warning</option><option value="clear">No triggered warning</option><option value="incident">Simulated incident exposure</option></select></label></div>
    {searchActive(filters) && <div className="search-results"><strong>{positions.length} matching position{positions.length === 1 ? '' : 's'}{filters.query.trim() ? ` · ${nodes.length} matching dependencies` : ''}</strong>{filters.query.trim() && <div className="result-links">{positions.slice(0, 5).map((position) => <button key={position.id} onClick={() => onPosition(position)}><span>POSITION</span>{position.name || position.analysis.vault.name}</button>)}{nodes.slice(0, 10).map((node) => <button key={node.id} onClick={() => onNode(node)}><span>{node.type.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()}</span>{node.label}{node.address && <small>{node.address.slice(0, 10)}…</small>}</button>)}</div>}</div>}
  </section>;
}
