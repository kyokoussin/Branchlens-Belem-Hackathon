import { useEffect, useMemo, useRef, useState } from 'react';
import { layoutGraph } from './graphLayout';
import type { Graph, Impact, PortfolioData, Position } from './model';

const money = (value: string | null | undefined) => value == null ? 'Not verified' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
const short = (value: string) => value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
const mechanisms: Record<string, string> = {
  Position: 'Its risk comes from the vault and the markets beneath it.', Vault: 'Allocation changes, smart-contract failure, or withdrawal constraints could affect this position.',
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

export function GraphExplorer({ position, portfolio, view, selectedId, onSelect, onViewImpact, onReview }: { position: Position; portfolio: PortfolioData; view: 'dependency' | 'impact'; selectedId: string; onSelect: (id: string) => void; onViewImpact: (id: string) => void; onReview: () => void }) {
  const analysis = position.analysis;
  const impact: Impact | null = view === 'impact' ? portfolio.impactIndex[selectedId] || null : null;
  // This is viewport history only. Exposure always comes from the selected node's impact.
  const [visibleImpactSelections, setVisibleImpactSelections] = useState<string[]>([]);
  useEffect(() => {
    if (view !== 'impact') { setVisibleImpactSelections([]); return; }
    if (impact) setVisibleImpactSelections((previous) => previous.includes(selectedId) ? previous : [...previous, selectedId]);
  }, [view, selectedId, impact]);
  const graph: Graph = useMemo(() => {
    if (!impact) return analysis.graph;
    const visibleImpacts = [impact, ...visibleImpactSelections.filter((id) => id !== selectedId).map((id) => portfolio.impactIndex[id]).filter((item): item is Impact => Boolean(item))];
    const nodeIds = new Set(visibleImpacts.flatMap((item) => item.affectedPositions.flatMap((position) => position.paths.flatMap((path) => path.nodeIds))));
    const edgeIds = new Set(visibleImpacts.flatMap((item) => item.affectedPositions.flatMap((position) => position.paths.flatMap((path) => path.edgeIds))));
    return { ...portfolio.portfolioGraph, nodes: portfolio.portfolioGraph.nodes.filter((node) => nodeIds.has(node.id)), edges: portfolio.portfolioGraph.edges.filter((edge) => edgeIds.has(edge.id)) };
  }, [analysis.graph, impact, portfolio.portfolioGraph, portfolio.impactIndex, selectedId, visibleImpactSelections]);
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [offset, setOffset] = useState({ x: 25, y: 20 });
  const [focusedPositionId, setFocusedPositionId] = useState<string | null>(null);
  useEffect(() => setFocusedPositionId(null), [selectedId, view]);
  const selected = layout.byId.get(selectedId) || layout.nodes.find((node) => node.type === 'Position') || layout.nodes[0];
  const scenario = position.simulation?.available ? position.simulation : null;
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

  useEffect(() => {
    const node = layout.byId.get(selectedId);
    const el = viewport.current;
    if (!node || !el) return;
    if (view === 'impact') {
      setZoom(Math.max(0.35, Math.min(0.9, el.clientWidth / layout.width, el.clientHeight / layout.height)));
      setOffset({ x: 12, y: 12 });
      return;
    }
    setOffset({ x: Math.min(80, el.clientWidth * 0.42 - node.x * zoom), y: el.clientHeight * 0.43 - node.y * zoom });
  }, [selectedId, position.id, layout, view]);

  function fit() {
    const el = viewport.current;
    if (!el) return;
    const next = Math.max(0.32, Math.min(0.9, el.clientWidth / layout.width, el.clientHeight / layout.height));
    setZoom(next); setOffset({ x: 16, y: 16 });
  }
  const connectedEdges = graph.edges.filter((edge) => edge.from === selected.id || edge.to === selected.id);
  const statuses = [...new Set(connectedEdges.map((edge) => edge.status))];
  const sources = [...new Set(connectedEdges.map((edge) => edge.evidence.source).filter(Boolean))];
  const relatedFindings = analysis.findings.filter((finding) => finding.subjectId === selected.id || (selected.type === 'LendingMarket' && finding.affectedMarketIds.includes(selected.id.split(':').pop() || '')));
  const graphLabels = new Map(portfolio.portfolioGraph.nodes.map((node) => [node.id, `${node.type.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${node.label}${node.type === 'LendingMarket' ? ` (${short(node.address || node.id)})` : ''}`]));

  return <div className={`explorer-grid ${view === 'impact' ? 'impact-view' : ''}`}>
    <section className="graph-panel card"><div className="panel-heading"><div><div className="eyebrow">{view === 'impact' ? 'PORTFOLIO IMPACT MAP' : 'INTERACTIVE DEPENDENCY MAP'}</div><h2>{view === 'impact' ? 'Trace every affected investment' : 'Follow the capital'}</h2><p>{view === 'impact' ? 'Complete verified paths from each tracked position to the selected dependency.' : 'Click any node to inspect its evidence and financial reach.'} Drag to pan; scroll to zoom.</p></div><div className="graph-tools"><button onClick={() => setZoom((value) => Math.max(0.35, value - 0.15))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(1.5, value + 0.15))} aria-label="Zoom in">+</button><button onClick={fit}>Fit</button></div></div>
      <div className="graph-shortcuts">{view === 'dependency' && <button onClick={() => onSelect(layout.nodes.find((node) => node.type === 'Position')?.id || '')}>Investment</button>}{cbBtcNode && <button onClick={() => onSelect(cbBtcNode.id)}>Focus cbBTC</button>}{view === 'impact' && focusedPositionId && <button onClick={() => setFocusedPositionId(null)}>Show all paths</button>}{scenario && <span className="scenario-key">Amber: hypothetical incident · No live depeg detected</span>}</div>
      <div className="graph-viewport" ref={viewport}
        onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; drag.current = { x: event.clientX, y: event.clientY, left: offset.x, top: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (drag.current) setOffset({ x: drag.current.left + event.clientX - drag.current.x, y: drag.current.top + event.clientY - drag.current.y }); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(0.35, Math.min(1.5, value - Math.sign(event.deltaY) * 0.08))); }}>
        <div className="graph-stage" style={{ width: layout.width, height: layout.height, transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
          <svg className="graph-lines" width={layout.width} height={layout.height} aria-hidden="true">{graph.edges.map((edge) => {
            const from = layout.byId.get(edge.from); const to = layout.byId.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + from.width; const y1 = from.y + from.height / 2; const x2 = to.x; const y2 = to.y + to.height / 2;
            const selectedPath = selectedEdgeIds.has(edge.id);
            const incidentPath = incidentEdgeIds.has(`${edge.from}|${edge.to}`) || (scenario && edge.from === cbBtcNode?.id);
            return <path key={edge.id} d={`M ${x1} ${y1} C ${x1 + 46} ${y1}, ${x2 - 46} ${y2}, ${x2} ${y2}`} className={`graph-line ${view === 'impact' ? impactEdgeIds.has(edge.id) ? 'impact-highlight' : 'dimmed' : incidentPath ? 'incident' : selectedPath ? 'selected' : ''} ${edge.status === 'DOCUMENTED' ? 'documented' : ''}`} />;
          })}</svg>
          {layout.nodes.map((node) => {
            const isIncident = incidentMarkets.has(node.id.split(':').pop() || '') || (scenario && node.id === cbBtcNode?.id);
            const isRelated = node.id === selected.id || (node.type === 'LendingMarket' && relatedMarkets.has(node.id.split(':').pop() || ''));
            return <button key={node.id} className={`map-node ${node.type.toLowerCase()} ${node.id === selected.id ? 'active' : ''} ${isIncident ? 'incident' : ''} ${isRelated ? 'related' : ''} ${view === 'impact' && !impactNodeIds.has(node.id) ? 'dimmed' : ''}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} title={node.address || node.label} onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}><span>{node.type.replace(/([a-z])([A-Z])/g, '$1 $2')}</span><strong>{node.label}</strong></button>;
          })}
        </div>
      </div>
      <div className="graph-legend"><span><i className="legend-dot observed" />Observed Morpho link</span><span><i className="legend-dot documented" />Documented claim</span><span><i className="legend-dot assumed" />Assumed position</span></div>
    </section>
    <aside className="inspector card">{view === 'impact' && impact ? <>
      <div className="eyebrow">{portfolio.portfolioIncident?.dependencyNodeId === selectedId ? 'SIMULATED INCIDENT · REVIEW REQUIRED' : 'REVERSE DEPENDENCY ANALYSIS'}</div>
      <h2>{impact.selectedLabel}</h2>
      <div className="inspector-sub"><span className="type-pill">{impact.selectedType.replace(/([a-z])([A-Z])/g, '$1 $2')}</span><span>{impact.evidenceStatuses.join(' / ') || 'ASSUMED'}</span></div>
      <p>{portfolio.portfolioIncident?.dependencyNodeId === selectedId ? portfolio.portfolioIncident.whatHappened : 'If this dependency fails, these tracked investments have a verified path to it. No failure has been detected here.'}</p>
      <div className="impact-summary" aria-label="Portfolio impact summary"><div><small>Affected positions</small><strong>{impact.affectedPositionCount}</strong></div><div><small>Distinct affected markets</small><strong>{impact.affectedMarketCount}</strong><small>{impact.affectedAllocationCount} funded allocations across positions</small></div><div className="wide"><small>Unique assumed principal exposed</small><strong>{money(impact.uniqueCapitalExposedUsd)}</strong></div><div className="wide"><small>Conditional maximum principal loss</small><strong>{money(impact.maximumConditionalPrincipalLossUsd)}</strong></div></div>
      <p className="smallnote">{impact.maximumLossMeaning} Allocation weights come from the current Morpho vault state; repeated paths to a market count once per position.</p>
      <div className="inspect-list"><h3>Impacted investments and complete paths</h3>{impact.affectedPositions.length ? impact.affectedPositions.map((item) => <div className={`impact-position ${focusedPositionId === item.id ? 'focused' : ''}`} key={item.id}>
        <button className="impact-position-button" onClick={() => setFocusedPositionId(item.id)} aria-pressed={focusedPositionId === item.id}><strong>{item.name}</strong><span>{money(item.exposedPrincipalUsd)} exposed · {item.marketIds.length} market{item.marketIds.length === 1 ? '' : 's'}</span></button>
        <div className="impact-paths">{item.paths.map((path, index) => <p key={`${item.id}-${index}`} title={path.nodeIds.join(' → ')}><span className="path-index">Path {index + 1}</span>{path.nodeIds.map((id) => graphLabels.get(id) || id).join(' → ')}</p>)}</div>
        <small>{item.dataMode === 'LIVE_API' ? 'Live API retrieved' : 'Historical snapshot retrieved'} {new Date(item.retrievedAt).toLocaleString()}{item.snapshotCapturedAt ? ` · snapshot saved ${new Date(item.snapshotCapturedAt).toLocaleString()}` : ''}</small>
      </div>) : <p>No tracked position reaches this component in the current graph.</p>}</div>
      <div className="inspect-list"><h3>Decision still needed</h3><p>Verify the incident itself, borrower loss or recoverability, wallet-specific withdrawal capacity, and the execution quote before deciding to stay or exit.</p>{portfolio.portfolioIncident?.dependencyNodeId === selectedId && <button onClick={onReview}>Open incident report →</button>}</div>
      <div className="inspect-list"><h3>Sources and data freshness</h3>{impact.sources.map((source) => <p key={source}><a href={source} target="_blank" rel="noopener noreferrer">{source} ↗</a></p>)}<small>Observed links come from Morpho data. Documented issuer/backing links are company claims; assumed holdings are demonstration inputs.</small></div>
    </> : <><div className="eyebrow">SELECTED DEPENDENCY</div><h2>{selected.type === 'Position' ? analysis.vault.name : selected.label}</h2><div className="inspector-sub"><span className="type-pill">{selected.type.replace(/([a-z])([A-Z])/g, '$1 $2')}</span><span>{statuses.length ? statuses.join(' / ') : 'ASSUMED'}</span></div>
      <div className="inspector-impact"><small>Capital linked to this branch</small><strong>{money(selected.capitalExposedUsd)}</strong><span>{selected.affectedMarketIds.length} funded market{selected.affectedMarketIds.length === 1 ? '' : 's'} · unique within this position</span></div>
      <button className="primary view-impact-button" onClick={() => onViewImpact(selected.id)}>View Portfolio Impact →</button>
      {selected.type === 'Position' && <div className="inspect-list"><h3>Position at a glance</h3><p>{analysis.vault.asset.symbol} underlying · {analysis.vault.allocations.length} funded markets · {(Number(analysis.exposure.coverageRatio) * 100).toFixed(1)}% allocation coverage</p></div>}
      {selected.type === 'LendingMarket' && <div className="inspect-list"><h3>Market state</h3>{(() => { const row = analysis.vault.allocations.find((item) => item.marketId === selected.id.split(':').pop()); return row && <><p><strong>{row.collateral.symbol} / {row.loan.symbol}</strong> · {money(row.allocationUsd)} allocated</p><p>Liquidity {money(row.marketLiquidityUsd)} · Utilization {row.utilization == null ? 'Unknown' : `${(Number(row.utilization) * 100).toFixed(1)}%`}</p></>; })()}</div>}
      <div className="inspect-list"><h3>Connected dependencies</h3><p>{connectedEdges.length} direct relationship{connectedEdges.length === 1 ? '' : 's'} · {selected.affectedMarketIds.length} affected funded markets</p><div className="connected-chips">{connectedEdges.slice(0, 6).map((edge) => { const other = graph.nodes.find((node) => node.id === (edge.from === selected.id ? edge.to : edge.from)); return other && <span key={edge.id}>{other.label}</span>; })}</div>{connectedEdges.length > 6 && <small>+{connectedEdges.length - 6} more connections</small>}</div>
      <div className="inspect-list"><h3>Risk observations</h3>{scenario && selected.id === cbBtcNode?.id && <p className="signal-warning">Simulated −30% price deviation · not a live observation <button onClick={onReview}>Review incident →</button></p>}{relatedFindings.slice(0, 3).map((finding) => <p key={finding.id}><strong>{finding.signalType === 'STRUCTURAL_WARNING' ? 'Concentration' : finding.status}</strong> · {finding.title}</p>)}{relatedFindings.length === 0 && !(scenario && selected.id === cbBtcNode?.id) && <p>No verified failure signal for this component.</p>}<p>{mechanisms[selected.type] || 'Specific failure impact requires further analysis.'}</p></div>
      <div className="inspect-list"><h3>Evidence & freshness</h3>{sources.map((source) => <p key={source}><a href={source} target="_blank" rel="noopener noreferrer">{source.includes('coinbase') ? 'Coinbase documentation' : 'Morpho API source'} ↗</a></p>)}<small>{position.dataMode === 'LIVE_API' ? 'Live API retrieved' : 'Historical snapshot retrieved'} {new Date(analysis.vault.provenance.retrievedAt).toLocaleString()}. {analysis.vault.provenance.sourceTimestamp ? 'Source time available.' : 'GraphQL index time not provided.'}</small><details className="technical-details"><summary>Technical details</summary>{selected.address && <p>{selected.type === 'LendingMarket' ? 'Market ID' : 'Address'} {/^0x[0-9a-fA-F]{40}$/.test(selected.address) ? <a href={`https://etherscan.io/address/${selected.address}`} target="_blank" rel="noopener noreferrer"><code>{selected.address}</code></a> : <code>{selected.address}</code>}</p>}<p>{analysis.graph.nodes.length} discovered nodes · {analysis.vault.allocations.length} allocations</p></details></div></>}
    </aside>
  </div>;
}
