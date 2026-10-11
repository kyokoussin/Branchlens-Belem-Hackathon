import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { layoutGraph } from './graphLayout';
import { calculateGraphShares } from './graphShares';
import { evaluateImpactScenario } from '../api/_impactModel.mjs';
import type { Graph, Impact, PortfolioData, Position } from './model';

const money = (value: string | null | undefined) => value == null ? 'Insufficient data' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
const short = (value: string) => value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
const mechanisms: Record<string, string> = {
  Position: 'Its risk comes from the verified vault or market and the dependencies beneath it.', Vault: 'Allocation changes, smart-contract failure, or withdrawal constraints could affect this position.',
  LendingMarket: 'Collateral impairment, liquidations, bad debt, or liquidity stress could affect lender recoveries.',
  CollateralToken: 'A price depeg, custody failure, or redemption disruption can weaken borrower collateral.',
  LoanToken: 'Loan-asset impairment or transfer restrictions can affect withdrawals and recoveries.',
  Oracle: 'An incorrect or stale market price can affect collateral valuation and liquidation decisions.',
  OracleFeed: 'An upstream feed outage or bad data may propagate into a market oracle; the feed address is observed, but its current health is not assessed.',
  OracleVault: 'A vault conversion used by an oracle may introduce an additional valuation dependency.',
  IssuerCustodian: 'Issuer or custody disruption could affect backing and redemption. This link is a documented company claim.',
  BackingAsset: 'Backing-asset or custody impairment could affect the collateral token. Reserve holdings are not independently verified here.',
  Blockchain: 'Chain availability and settlement correctness affect every dependent market.',
};

export function GraphExplorer({ position, portfolio, view, selectedId, onSelect, onViewImpact, onReview, global = false }: { position: Position; portfolio: PortfolioData; view: 'dependency' | 'impact'; selectedId: string; onSelect: (id: string) => void; onViewImpact: (id: string) => void; onReview: () => void; global?: boolean }) {
  const analysis = position.analysis;
  const impact: Impact | null = view === 'impact' || global ? portfolio.impactIndex[selectedId] || null : null;
  const [impactCase, setImpactCase] = useState('DEPENDENCY_ONLY');
  const [marketLossPercent, setMarketLossPercent] = useState('');
  useEffect(() => {
    setImpactCase(portfolio.portfolioIncident?.dependencyNodeId === selectedId ? 'COLLATERAL_SHOCK' : 'DEPENDENCY_ONLY');
    setMarketLossPercent('');
  }, [selectedId, portfolio.portfolioIncident?.dependencyNodeId]);
  const impactModel = useMemo(() => impact ? evaluateImpactScenario(impact, portfolio.positions, { type: impactCase, marketLossPercent }) : null, [impact, portfolio.positions, impactCase, marketLossPercent]);
  const lossMissingReason = impactCase === 'DEPENDENCY_ONLY' ? 'No incident or realized loss is established by a dependency path.'
    : impactCase === 'MARKET_BAD_DEBT' ? 'Requires a valid lender-loss assumption and verified V1.0 accounting for every affected vault.'
      : 'Requires observed bad debt, liquidations, and recoveries; a price or service shock is not a lender-loss rate.';
  const accessMissingReason = impactCase === 'DEPENDENCY_ONLY' ? 'No access interruption has been selected.'
    : impactCase === 'CHAIN_OUTAGE' ? 'Only a complete chain halt has a modeled blocked-capital amount.'
      : 'Requires a chain halt or a wallet-specific withdrawal check; market-wide liquidity is not enough.';
  // This is viewport history only. Exposure always comes from the selected node's impact.
  const [visibleImpactSelections, setVisibleImpactSelections] = useState<string[]>([]);
  useEffect(() => {
    if (view !== 'impact') { setVisibleImpactSelections([]); return; }
    if (impact) setVisibleImpactSelections((previous) => previous.includes(selectedId) ? previous : [...previous, selectedId]);
  }, [view, selectedId, impact]);
  const graph: Graph = useMemo(() => {
    if (global && view === 'dependency') return portfolio.portfolioGraph;
    if (!impact) return analysis.graph;
    const visibleImpacts = [impact, ...visibleImpactSelections.filter((id) => id !== selectedId).map((id) => portfolio.impactIndex[id]).filter((item): item is Impact => Boolean(item))];
    const nodeIds = new Set(visibleImpacts.flatMap((item) => item.affectedPositions.flatMap((position) => position.paths.flatMap((path) => path.nodeIds))));
    const edgeIds = new Set(visibleImpacts.flatMap((item) => item.affectedPositions.flatMap((position) => position.paths.flatMap((path) => path.edgeIds))));
    return { ...portfolio.portfolioGraph, nodes: portfolio.portfolioGraph.nodes.filter((node) => nodeIds.has(node.id)), edges: portfolio.portfolioGraph.edges.filter((edge) => edgeIds.has(edge.id)) };
  }, [analysis.graph, impact, portfolio.portfolioGraph, portfolio.impactIndex, selectedId, visibleImpactSelections, global, view]);
  const shares = useMemo(() => calculateGraphShares(graph, global || view === 'impact' ? portfolio.positions : [position], global || view === 'impact'), [graph, global, view, portfolio.positions, position]);
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const incomingShares = useMemo(() => {
    const byNode = new Map<string, Array<{ parent: string; label: string }>>();
    for (const edge of graph.edges) {
      const parent = layout.byId.get(edge.from);
      const rows = byNode.get(edge.to) || [];
      rows.push({ parent: parent?.label || edge.from, label: shares[edge.id]?.label || 'Unknown' });
      byNode.set(edge.to, rows);
    }
    return byNode;
  }, [graph.edges, layout.byId, shares]);
  const viewport = useRef<HTMLDivElement>(null);
  const lastFitKey = useRef('');
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [offset, setOffset] = useState({ x: 25, y: 20 });
  const [focusedPositionId, setFocusedPositionId] = useState<string | null>(null);
  useEffect(() => setFocusedPositionId(null), [selectedId, view, portfolio.portfolioIncident?.id]);
  const selected = layout.byId.get(selectedId) || layout.nodes.find((node) => node.type === 'Position') || layout.nodes[0];
  const scenarioCandidate = global ? portfolio.positions.find((item) => item.simulation?.available)?.simulation : position.simulation;
  const scenario = scenarioCandidate?.available ? scenarioCandidate : null;
  const incidentMarkets = new Set(scenario?.marketIds || []);
  const relatedMarkets = new Set(selected?.affectedMarketIds || []);
  const impactPaths = impact?.affectedPositions.flatMap((item) => focusedPositionId && item.id !== focusedPositionId ? [] : item.paths) || [];
  const impactEdgeIds = new Set(impactPaths.flatMap((path) => path.edgeIds));
  const impactNodeIds = new Set(impactPaths.flatMap((path) => path.nodeIds));
  const selectedEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    const expandForward = selected?.type === 'Position' || selected?.type === 'Vault';
    const queue = [selected?.id];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      for (const edge of graph.edges) {
        if (expandForward ? edge.from === current : edge.to === current) {
          ids.add(edge.id);
          queue.push(expandForward ? edge.to : edge.from);
        }
      }
    }
    return ids;
  }, [graph.edges, selected?.id, selected?.type]);
  const cbBtcNode = layout.nodes.find((node) => node.type === 'CollateralToken' && node.label.toLowerCase() === 'cbbtc');
  const incidentEdgeIds = new Set((scenario?.dependencyPaths || []).flatMap((path) => path.slice(0, -1).map((from, i) => `${from}|${path[i + 1]}`)));

  useLayoutEffect(() => {
    const el = viewport.current;
    const key = `${global ? 'global' : position.id}:${view}:${global && view === 'impact' ? selectedId : ''}:${portfolio.portfolioIncident?.id || 'baseline'}`;
    if (!el || lastFitKey.current === key) return;
    lastFitKey.current = key;
    const next = Math.max(0.08, Math.min(1, (el.clientWidth - 32) / layout.width, (el.clientHeight - 32) / layout.height));
    // Large live graphs become unreadable when every node is fitted at once.
    // Start at an inspectable scale; the Fit button still shows the full graph.
    const initialZoom = Math.max(0.55, next);
    const investment = !global && view === 'dependency' ? layout.nodes.find((node) => node.type === 'Position') : null;
    setZoom(initialZoom);
    setOffset({ x: 16, y: investment ? 42 - investment.y * initialZoom : 16 });
  }, [position.id, view, selectedId, global, portfolio.portfolioIncident?.id, layout]);

  function fit() {
    const el = viewport.current;
    if (!el) return;
    const next = Math.max(0.08, Math.min(1, (el.clientWidth - 32) / layout.width, (el.clientHeight - 32) / layout.height));
    setZoom(next); setOffset({ x: 16, y: 16 });
  }
  const connectedEdges = graph.edges.filter((edge) => edge.from === selected.id || edge.to === selected.id);
  const statuses = [...new Set(connectedEdges.map((edge) => edge.status))];
  const sources = [...new Set(connectedEdges.map((edge) => edge.evidence.source).filter((source) => /^https?:\/\//.test(source)))];
  const relatedFindings = analysis.findings.filter((finding) => finding.subjectId === selected.id || (selected.type === 'LendingMarket' && finding.affectedMarketIds.includes(selected.id.split(':').pop() || '')));
  const graphLabels = new Map(portfolio.portfolioGraph.nodes.map((node) => [node.id, `${node.type.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${node.label}${node.type === 'LendingMarket' ? ` (${short(node.address || node.id)})` : ''}`]));

  return <div className={`explorer-grid ${view === 'impact' ? 'impact-view' : ''}`}>
    <section className="graph-panel card"><div className="panel-heading"><div><div className="eyebrow">{view === 'impact' ? 'PORTFOLIO IMPACT MAP' : 'INTERACTIVE DEPENDENCY MAP'}</div><h2>{view === 'impact' ? 'Trace every affected investment' : 'Follow the capital'}</h2><p>{view === 'impact' ? 'Complete verified paths from each tracked position to the selected dependency.' : 'Click any node to inspect its evidence and financial reach.'} Percentages inside each box show the share of capital linked from its preceding node. Drag to pan; scroll to zoom.</p></div><div className="graph-tools"><button onClick={() => setZoom((value) => Math.max(0.08, value - 0.15))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(1.5, value + 0.15))} aria-label="Zoom in">+</button><button onClick={fit}>Fit</button></div></div>
      <div className="graph-shortcuts">{view === 'dependency' && <button onClick={() => onSelect(layout.nodes.find((node) => node.type === 'Position')?.id || '')}>Investment</button>}{cbBtcNode && <button onClick={() => onSelect(cbBtcNode.id)}>Focus cbBTC</button>}{view === 'impact' && focusedPositionId && <button onClick={() => setFocusedPositionId(null)}>Show all paths</button>}{scenario && <span className="scenario-key">Amber: hypothetical incident · No live depeg detected</span>}</div>
      <div className="graph-viewport" ref={viewport}
        onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; drag.current = { x: event.clientX, y: event.clientY, left: offset.x, top: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (drag.current) setOffset({ x: drag.current.left + event.clientX - drag.current.x, y: drag.current.top + event.clientY - drag.current.y }); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(0.08, Math.min(1.5, value - Math.sign(event.deltaY) * 0.08))); }}>
        <div className="graph-stage" style={{ width: layout.width, height: layout.height, transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
          <svg className="graph-lines" width={layout.width} height={layout.height} aria-hidden="true">{graph.edges.map((edge) => {
            const from = layout.byId.get(edge.from); const to = layout.byId.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + from.width; const y1 = from.y + from.height / 2; const x2 = to.x; const y2 = to.y + to.height / 2;
            const selectedPath = selectedEdgeIds.has(edge.id);
            const incidentPath = incidentEdgeIds.has(`${edge.from}|${edge.to}`) || (scenario && edge.from === cbBtcNode?.id);
            return <g key={edge.id} className={view === 'impact' && !impactEdgeIds.has(edge.id) ? 'graph-edge dimmed' : 'graph-edge'}><path d={`M ${x1} ${y1} C ${x1 + 46} ${y1}, ${x2 - 46} ${y2}, ${x2} ${y2}`} className={`graph-line ${view === 'impact' ? impactEdgeIds.has(edge.id) ? 'impact-highlight' : 'dimmed' : incidentPath ? 'incident' : selectedPath ? 'selected' : ''} ${edge.status === 'DOCUMENTED' ? 'documented' : ''}`} /></g>;
          })}</svg>
          {layout.nodes.map((node) => {
            const isIncident = incidentMarkets.has(node.id.split(':').pop() || '') || (scenario && node.id === cbBtcNode?.id);
            const isRelated = node.id === selected.id || (node.type === 'LendingMarket' && relatedMarkets.has(node.id.split(':').pop() || ''));
            const nodeShares = incomingShares.get(node.id) || [];
            const shareDetails = nodeShares.map((row) => `${row.label} of ${row.parent}`).join('\n');
            return <button key={node.id} className={`map-node ${node.type.toLowerCase()} ${node.id === selected.id ? 'active' : ''} ${isIncident ? 'incident' : ''} ${isRelated ? 'related' : ''} ${view === 'impact' && !impactNodeIds.has(node.id) ? 'dimmed' : ''}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} title={[node.address || node.label, shareDetails].filter(Boolean).join('\n')} onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}><span>{node.type.replace(/([a-z])([A-Z])/g, '$1 $2')}</span><strong>{node.label}</strong>{nodeShares.length > 0 && <div className="node-share-list" onWheel={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>{nodeShares.map((row, index) => <div className="node-share" key={`${node.id}-${index}`}><b>{row.label}</b><small title={row.parent}>of {row.parent}</small></div>)}</div>}</button>;
          })}
        </div>
      </div>
      <div className="graph-legend"><span><i className="legend-dot observed" />Observed Morpho link</span><span><i className="legend-dot documented" />Documented claim</span><span><i className="legend-dot assumed" />Assumed position</span><span>Percent of preceding node's linked capital; not a loss probability</span></div>
    </section>
    <aside className="inspector card">{(view === 'impact' || global) && impact ? <>
      <div className="eyebrow">{portfolio.portfolioIncident?.dependencyNodeId === selectedId ? 'SIMULATED INCIDENT · REVIEW REQUIRED' : 'REVERSE DEPENDENCY ANALYSIS'}</div>
      <h2>{impact.selectedLabel}</h2>
      <div className="inspector-sub"><span className="type-pill">{impact.selectedType.replace(/([a-z])([A-Z])/g, '$1 $2')}</span><span>{impact.evidenceStatuses.join(' / ') || 'ASSUMED'}</span></div>
      <p>{portfolio.portfolioIncident?.dependencyNodeId === selectedId ? portfolio.portfolioIncident.whatHappened : 'If this dependency fails, these tracked investments have a verified path to it. No failure has been detected here.'}</p>
      <label className="impact-scenario-control">Incident to assess<select value={impactCase} onChange={(event) => setImpactCase(event.target.value)}><option value="DEPENDENCY_ONLY">Dependency reach only</option>{impact.selectedType === 'Blockchain' && <option value="CHAIN_OUTAGE">Complete chain outage · simulated</option>}{['Oracle', 'OracleFeed', 'OracleVault'].includes(impact.selectedType) && <option value="ORACLE_FAILURE">Oracle failure · simulated</option>}{['Vault', 'LendingMarket', 'LoanToken'].includes(impact.selectedType) && <option value="LIQUIDITY_STRESS">Liquidity stress · simulated</option>}{impact.selectedType === 'CollateralToken' && <option value="COLLATERAL_SHOCK">Collateral price shock · simulated</option>}{impact.selectedType === 'LendingMarket' && <option value="MARKET_BAD_DEBT">Market lender loss · assumed rate</option>}</select></label>
      {impactCase === 'MARKET_BAD_DEBT' && <label className="impact-scenario-control">Hypothetical realized lender loss in this market (%)<input type="number" min="0.0001" max="100" step="0.01" inputMode="decimal" value={marketLossPercent} onChange={(event) => setMarketLossPercent(event.target.value)} placeholder="Enter a rate; not live bad debt" /></label>}
      <div className="impact-summary" aria-label="Portfolio impact summary"><div><small>Affected positions</small><strong>{impact.affectedPositionCount}</strong></div><div><small>Distinct affected markets</small><strong>{impact.affectedMarketCount}</strong><small>{impact.affectedAllocationCount} funded allocations across positions</small></div><div className="wide"><small>Affected capital · unique simulated principal</small><strong>{money(impact.uniqueCapitalExposedUsd)}</strong></div><div className="wide"><small>Estimated financial loss</small><strong>{impactModel?.estimatedFinancialLossUsd == null ? 'Not established' : money(impactModel.estimatedFinancialLossUsd)}</strong>{impactModel?.estimatedFinancialLossUsd == null && <small>{lossMissingReason}</small>}</div><div className="wide"><small>Temporarily inaccessible capital</small><strong>{impactModel?.temporarilyInaccessibleCapitalUsd == null ? 'Not measured' : money(impactModel.temporarilyInaccessibleCapitalUsd)}</strong>{impactModel?.temporarilyInaccessibleCapitalUsd == null && <small>{accessMissingReason}</small>}</div></div>
      <details className="technical-details"><summary>How the figures are calculated</summary><p>Market-linked capital = assumed position principal × Morpho market allocation ÷ Morpho vault total assets. For a direct market supply, the linked share is 100%. Each affected market is counted once per position, then positions are summed. A box percentage = capital linked through that incoming relationship ÷ capital linked to its preceding node × 100.</p><p>Financial loss is calculated only for an assumed realized market lender-loss rate with verified V1.0 vault accounting or a direct market supplier: that position’s market-linked capital × entered loss rate. Under a simulated complete chain halt, temporarily inaccessible capital equals the unique affected capital for the halt’s duration. Other incident types need more evidence.</p></details>
      <details className="technical-details"><summary>Conditional 100% principal-loss bound</summary><p><strong>{money(impactModel?.conditionalMaxPrincipalLossUsd)}</strong> · {impactModel?.conditionalMaxAssumption}</p></details>
      <p className="smallnote">{impactModel?.note} Real Morpho allocation weights determine the capital linked to each market. Shared paths are counted once per position.</p>
      <div className="inspect-list"><h3>Impacted investments and complete paths</h3>{impactModel?.affectedPositions.length ? impactModel.affectedPositions.map((item) => <div className={`impact-position ${focusedPositionId === item.id ? 'focused' : ''}`} key={item.id}>
        <button className="impact-position-button" onClick={() => setFocusedPositionId(item.id)} aria-pressed={focusedPositionId === item.id}><strong>{item.name}</strong><span>{money(item.exposedPrincipalUsd)} exposed · {item.marketIds.length} market{item.marketIds.length === 1 ? '' : 's'}</span></button>
        <p className="impact-reason">{item.explanation}</p>{impactCase === 'MARKET_BAD_DEBT' && <p className="impact-reason">Estimated financial loss: {money(item.estimatedFinancialLossUsd)} · Vault accounting: {portfolio.positions.find((position) => position.id === item.id)?.analysis.vault.accountingVersion || 'unverified'}{portfolio.positions.find((position) => position.id === item.id)?.analysis.vault.provenance.vaultVersionEndpoint && <> · <a href={portfolio.positions.find((position) => position.id === item.id)?.analysis.vault.provenance.vaultVersionEndpoint || '#'} target="_blank" rel="noopener noreferrer">Verify version ↗</a></>}</p>}{impactCase === 'CHAIN_OUTAGE' && <p className="impact-reason">Temporarily inaccessible: {money(item.temporarilyInaccessibleCapitalUsd)}</p>}
        <div className="impact-paths">{item.paths.map((path, index) => <p key={`${item.id}-${index}`} title={path.nodeIds.join(' → ')}><span className="path-index">Path {index + 1}</span>{path.nodeIds.map((id) => graphLabels.get(id) || id).join(' → ')}</p>)}</div>
        <small>{item.dataMode === 'LIVE_API' ? 'Live API retrieved' : 'Historical snapshot retrieved'} {new Date(item.retrievedAt).toLocaleString()}{item.snapshotCapturedAt ? ` · snapshot saved ${new Date(item.snapshotCapturedAt).toLocaleString()}` : ''}</small>
      </div>) : <p>No tracked position reaches this component in the current graph.</p>}</div>
      <div className="inspect-list"><h3>Decision still needed</h3><p>Verify the incident itself, borrower loss or recoverability, wallet-specific withdrawal capacity, and the execution quote before deciding to stay or exit.</p>{portfolio.portfolioIncident?.dependencyNodeId === selectedId && <button onClick={onReview}>Open incident report →</button>}</div>
      <div className="inspect-list"><h3>Sources and data freshness</h3>{impact.sources.map((source) => <p key={source}><a href={source} target="_blank" rel="noopener noreferrer">{source} ↗</a></p>)}<small>Observed links come from Morpho data. Documented issuer/backing links are company claims; assumed holdings are demonstration inputs.</small></div>
    </> : <><div className="eyebrow">SELECTED DEPENDENCY</div><h2>{selected.type === 'Position' ? position.name : selected.label}</h2><div className="inspector-sub"><span className="type-pill">{selected.type.replace(/([a-z])([A-Z])/g, '$1 $2')}</span><span>{statuses.length ? statuses.join(' / ') : 'ASSUMED'}</span></div>
      <div className="inspector-impact"><small>Capital linked to this branch</small><strong>{money(selected.capitalExposedUsd)}</strong><span>{selected.affectedMarketIds.length} funded market{selected.affectedMarketIds.length === 1 ? '' : 's'} · unique within this position</span></div>
      <button className="primary view-impact-button" onClick={() => onViewImpact(selected.id)}>View Portfolio Impact →</button>
      {selected.type === 'Position' && <div className="inspect-list"><h3>Position at a glance</h3><p>{analysis.vault.asset.symbol} {analysis.vault.version === 'MORPHO_MARKET' ? 'loan asset · direct market supply' : `underlying · ${analysis.vault.allocations.length} funded markets · ${(Number(analysis.exposure.coverageRatio) * 100).toFixed(1)}% allocation coverage`}</p></div>}
      {selected.type === 'LendingMarket' && <div className="inspect-list"><h3>Market state</h3>{(() => { const row = analysis.vault.allocations.find((item) => item.marketId === selected.id.split(':').pop()); return row && <><p><strong>{row.collateral.symbol} / {row.loan.symbol}</strong> · {money(row.allocationUsd)} {analysis.vault.version === 'MORPHO_MARKET' ? 'market supply' : 'allocated'}</p><p>Liquidity {money(row.marketLiquidityUsd)} · Utilization {row.utilization == null ? 'Unknown' : `${(Number(row.utilization) * 100).toFixed(1)}%`}</p></>; })()}</div>}
      <div className="inspect-list"><h3>Risk observations</h3>{scenario && selected.id === cbBtcNode?.id && <p className="signal-warning">Simulated −30% price deviation · not a live observation <button onClick={onReview}>Review incident →</button></p>}{relatedFindings.slice(0, 3).map((finding) => <p key={finding.id}><strong>{finding.signalType === 'STRUCTURAL_WARNING' ? 'Concentration' : finding.status}</strong> · {finding.title}</p>)}{relatedFindings.length === 0 && !(scenario && selected.id === cbBtcNode?.id) && <p>No verified failure signal for this component.</p>}<p>{mechanisms[selected.type] || 'Specific failure impact requires further analysis.'}</p></div>
      <div className="inspect-list"><h3>Evidence & freshness</h3>{sources.map((source) => <p key={source}><a href={source} target="_blank" rel="noopener noreferrer">{source.includes('coinbase') ? 'Coinbase documentation' : 'Morpho API source'} ↗</a></p>)}<small>{position.dataMode === 'LIVE_API' ? 'Live API retrieved' : 'Historical snapshot retrieved'} {new Date(analysis.vault.provenance.retrievedAt).toLocaleString()}. {analysis.vault.provenance.sourceTimestamp ? 'Source time available.' : 'GraphQL index time not provided.'}</small><details className="technical-details"><summary>Technical details</summary>{selected.address && <p>{selected.type === 'LendingMarket' ? 'Market ID' : 'Address'} {/^0x[0-9a-fA-F]{40}$/.test(selected.address) ? <a href={`https://etherscan.io/address/${selected.address}`} target="_blank" rel="noopener noreferrer"><code>{selected.address}</code></a> : <code>{selected.address}</code>}</p>}<p>{analysis.graph.nodes.length} discovered nodes · {analysis.vault.allocations.length} allocations</p></details></div></>}
      <div className="inspect-list"><h3>Direct dependency shares</h3>{connectedEdges.map((edge) => { const parent = layout.byId.get(edge.from); const child = layout.byId.get(edge.to); const share = shares[edge.id]; return <p key={edge.id}><strong>{parent?.label || edge.from} → {child?.label || edge.to}</strong><br />{share?.label || 'Unknown'} of {parent?.label || 'the preceding node'} · {money(share?.linkedUsd)} linked / {money(share?.parentUsd)} at parent</p>; })}{!connectedEdges.length && <p>No direct links from this node.</p>}<small>Shares describe capital paths, not the chance or size of a loss. Overlapping branches must not be added together.</small></div>
    </aside>
  </div>;
}
