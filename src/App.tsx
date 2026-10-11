import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphExplorer } from './GraphExplorer';
import type { PortfolioData, Position } from './model';

type Screen = 'home' | 'explore' | 'incident';
const money = (value: string | null | undefined) => value == null ? 'Not verified' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
const preciseMoney = (value: string | null | undefined) => value == null ? 'Not verified' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function SourceBadge({ position }: { position: Position }) {
  return <span className={`source-badge ${position.dataMode === 'LIVE_API' ? 'live' : 'snapshot'}`}>{position.dataMode === 'LIVE_API' ? 'LIVE MORPHO DATA' : 'SAVED HISTORICAL SNAPSHOT'}</span>;
}

export default function App() {
  const staticHost = window.location.hostname.endsWith('.github.io');
  const [screen, setScreen] = useState<Screen>('home');
  const [graphView, setGraphView] = useState<'dependency' | 'impact'>('dependency');
  const [selectedPositionId, setSelectedPositionId] = useState('steakhouse-usdc');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [scenario, setScenario] = useState(false);
  const [source, setSource] = useState<'auto' | 'snapshot'>('auto');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<PortfolioData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
  const replayStartedAt = useRef<string | null>(null);
  useEffect(() => {
    const updateHeader = () => {
      const hero = document.getElementById('home-hero');
      setShowHeader(screen !== 'home' || (hero != null && hero.getBoundingClientRect().bottom <= 0));
    };
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
    window.addEventListener('resize', updateHeader);
    return () => { window.removeEventListener('scroll', updateHeader); window.removeEventListener('resize', updateHeader); };
  }, [screen]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      setBusy(true); setError('');
      try {
        let payload: PortfolioData;
        try {
          if (staticHost) throw new Error('Static demo host');
          const params = new URLSearchParams({ source });
          if (scenario) params.set('scenario', 'CBBTC_DEPEG_30');
          const response = await fetch(`/api/portfolio?${params}`, { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error(`Portfolio API returned ${response.status}`);
          payload = await response.json();
        } catch (apiError) {
          if (controller.signal.aborted) throw apiError;
          const file = scenario ? 'demo-scenario.json' : 'demo-baseline.json';
          const response = await fetch(`${import.meta.env.BASE_URL}${file}`, { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('Neither the portfolio API nor the verified historical demo snapshot is available.');
          payload = await response.json();
          if (scenario && payload.portfolioIncident) payload.portfolioIncident.simulatedAt = replayStartedAt.current || new Date().toISOString();
        }
        if (active) setData(payload);
      } catch (cause) {
        if (active) { setData(null); setError(cause instanceof Error ? cause.message : 'Portfolio data unavailable.'); }
      } finally { if (active) setBusy(false); }
    }
    void load();
    const timer = source === 'auto' ? window.setInterval(() => void load(), 60_000) : null;
    return () => { active = false; controller.abort(); if (timer) window.clearInterval(timer); };
  }, [source, scenario, revision, staticHost]);
  const selectedPosition = useMemo(() => data?.positions.find((position) => position.id === selectedPositionId) || data?.positions[0] || null, [data, selectedPositionId]);
  useEffect(() => {
    if (!selectedPosition) return;
    if (graphView === 'impact') {
      if (!data?.portfolioGraph.nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId(data?.portfolioGraph.nodes.find((node) => node.type === 'Blockchain')?.id || '');
      return;
    }
    if (scenario) {
      const cbBtc = selectedPosition.analysis.graph.nodes.find((node) => node.type === 'CollateralToken' && node.label.toLowerCase() === 'cbbtc');
      if (cbBtc) { setSelectedNodeId(cbBtc.id); return; }
    }
    if (!selectedNodeId || !selectedPosition.analysis.graph.nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId(selectedPosition.analysis.graph.nodes.find((node) => node.type === 'Position')?.id || '');
  }, [selectedPosition, scenario, graphView, data]);
  function openPosition(position: Position) {
    setGraphView('dependency');
    setSelectedPositionId(position.id);
    setSelectedNodeId(position.analysis.graph.nodes.find((node) => node.type === 'Position')?.id || '');
    setScreen('explore'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openImpact(nodeId: string) { setSelectedNodeId(nodeId.startsWith('position:assumed:') ? `position:tracked:${selectedPosition?.id || selectedPositionId}` : nodeId); setGraphView('impact'); setScreen('explore'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function openIncidentImpact() { if (data?.portfolioIncident) openImpact(data.portfolioIncident.dependencyNodeId); }
  function startScenario() { replayStartedAt.current = new Date().toISOString(); setScenario(true); setCopied(false); const cbBtc = data?.portfolioGraph.nodes.find((node) => node.type === 'CollateralToken' && node.label.toLowerCase() === 'cbbtc'); if (cbBtc) { setSelectedNodeId(cbBtc.id); setGraphView('impact'); setScreen('explore'); window.scrollTo({ top: 0, behavior: 'smooth' }); } }
  function resetScenario() { replayStartedAt.current = null; setData(null); setScenario(false); setCopied(false); if (screen === 'incident') setScreen('home'); }
  async function copyIncident() {
    if (!data?.portfolioIncident) return;
    try { await navigator.clipboard.writeText(JSON.stringify(data.portfolioIncident, null, 2)); setCopied(true); }
    catch { setCopied(false); downloadJson(data.portfolioIncident, `${data.portfolioIncident.id}.json`); }
  }
  const incident = data?.portfolioIncident;
  const primaryPosition = data?.positions.find((position) => position.id === 'steakhouse-usdc');

  return <div className="app-shell">
    <header className={`site-header ${screen !== 'home' || showHeader ? 'visible' : ''}`} aria-hidden={screen === 'home' && !showHeader}>
      <div className="header-identity"><button className="menu-button" aria-label="Open navigation" aria-expanded={navOpen} aria-controls="primary-navigation" onClick={() => setNavOpen((value) => !value)}><span /><span /><span /></button><button className="header-logo-button" aria-label="Back to BranchLens hero" onClick={() => { setScreen('home'); setNavOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><img className="header-logo" src={`${import.meta.env.BASE_URL}branchlens-logo.png`} alt="BranchLens" /></button></div>
      <span className="demo-pill">Demo</span>
    </header>
    {navOpen && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
    <aside className={`sidebar ${navOpen ? 'open' : ''}`} id="primary-navigation" aria-hidden={!navOpen}><div className="drawer-top"><img className="brand-logo" src={`${import.meta.env.BASE_URL}branchlens-logo.png`} alt="BranchLens" /><button aria-label="Close navigation" onClick={() => setNavOpen(false)}>×</button></div><div className="rail-caption">Institutional DeFi Risk Intelligence</div><nav aria-label="Main navigation"><button className={screen === 'home' ? 'active' : ''} onClick={() => { setScreen('home'); setNavOpen(false); requestAnimationFrame(() => document.getElementById('portfolio-summary')?.scrollIntoView({ behavior: 'smooth' })); }}>Portfolio Overview</button><button className={screen === 'explore' ? 'active' : ''} onClick={() => { if (selectedPosition) openPosition(selectedPosition); setNavOpen(false); }} disabled={!selectedPosition}>Dependency Explorer</button><button onClick={() => { startScenario(); setNavOpen(false); }} disabled={!data}>Run Simulated Incident</button></nav><div className="rail-foot">Illustrative portfolio · No trade execution<br />Built for the Belem Capital DeFi Risk Challenge</div></aside>
    <main className={`workspace ${screen === 'home' ? 'home-workspace' : 'analysis-workspace'}`}>
      {screen === 'home' && <section className="home-hero" id="home-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(4, 17, 31, .79) 0%, rgba(4, 17, 31, .51) 38%, rgba(4, 17, 31, .03) 72%), url(${import.meta.env.BASE_URL}branchlens-network-hero.png)` }}><div className="hero-copy"><div className="hero-overline">INSTITUTIONAL DEFI RISK INTELLIGENCE</div><h1>BranchLens</h1><p className="hero-tagline">See beyond the position.</p><p className="hero-description">Follow each position through its verified markets and dependencies.</p><div className="challenge-attribution"><span>Built for the Belem Capital DeFi Risk Challenge</span><img src={`${import.meta.env.BASE_URL}belem-logo.svg`} alt="Belem Capital" /></div></div></section>}
      {screen === 'incident' && <header className="topbar"><div><div className="eyebrow">BRANCHLENS / INCIDENT REVIEW</div><h1>Emergency Incident Review</h1><p>A structured report from a clearly simulated scenario.</p></div><div className="topbadges"><span className="badge assumed">ILLUSTRATIVE HOLDINGS</span></div></header>}
      {error && <div className="error-card"><strong>Data could not be loaded.</strong><p>{error}</p><button onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
      {!data && !error && <div className="loading-card">Loading verified Morpho investments and dependencies…</div>}
      {data && <>
        {screen === 'home' && <>
          <section className="metric-grid" id="portfolio-summary" aria-label="Portfolio summary"><div className="metric-card"><small>Total Capital Tracked</small><strong>{money(data.portfolio.totalAssumedCapitalUsd)}</strong><span>Illustrative position principal</span></div><div className="metric-card"><small>Active Incident Alerts</small><strong>{data.portfolio.activeAlerts}</strong><span>{incident ? 'Simulated incident · no live detection' : 'No verified live incident'}</span></div><div className="metric-card"><small>Tracked Dependencies</small><strong>{data.portfolio.trackedDependencyRelationships ?? data.portfolioGraph.edges.length}</strong><span>Graph relationships</span></div><div className="metric-card"><small>Distinct Dependencies Discovered</small><strong>{data.portfolio.distinctDependencies}</strong><span>Unique dependency nodes</span></div></section>
          {incident ? <section className="home-alert card"><div><div className="eyebrow">SIMULATED INCIDENT · NOT A LIVE DETECTION</div><h2>{incident.title}</h2><p>{incident.affectedPositions.length} investments affected · {money(incident.uniqueCapitalExposedUsd)} unique assumed principal exposed</p></div><button className="primary" onClick={openIncidentImpact}>View Portfolio Impact →</button></section> : null}
          <section className="portfolio-section" id="portfolio-cards"><div className="section-heading"><div><div className="eyebrow">PORTFOLIO · REAL MORPHO REFERENCES</div><h2>Tracked investments</h2><p>Investment amounts are demo assumptions; vault names and allocations come from Morpho.</p></div><div className="data-actions"><button onClick={() => setRevision((value) => value + 1)} disabled={busy}>{staticHost ? 'Reload saved data' : 'Refresh Morpho data'}</button>{!staticHost && <button onClick={() => { replayStartedAt.current = null; setData(null); setSource(source === 'auto' ? 'snapshot' : 'auto'); setScenario(false); }}>{source === 'auto' ? 'Use historical snapshot' : 'Return to live API'}</button>}</div></div><div className="position-grid">{data.positions.map((position, index) => <button className="position-card" key={position.id} onClick={() => openPosition(position)}><span className={`position-icon icon-${index}`}>{position.analysis.vault.asset.symbol.slice(0, 2)}</span><span className="position-main"><span className="position-heading"><strong>{position.analysis.vault.name}</strong><span className="card-arrow">↗</span></span><span className="position-description">{position.description}</span><span className="position-footer"><span><small>Illustrative principal</small><b>{money(position.amountUsd)}</b></span><SourceBadge position={position} /></span><span className="position-sub">{position.analysis.vault.allocations.length} funded markets · {position.analysis.graph.nodes.length} dependencies · Ethereum V1</span>{position.changes.length > 0 && <span className="change-note">{position.changes.join(' · ')}</span>}</span></button>)}</div></section>
          <p className="provenance-line">Data mode: {data.mode.replaceAll('_', ' ').toLowerCase()}. The backup was captured from Morpho on {new Date(data.snapshotCapturedAt).toLocaleString()}; it is never labeled live. The incident is always a separate hypothetical observation.</p>
        </>}
        {screen === 'explore' && selectedPosition && <><div className="explorer-overview"><div className="explorer-overview-title"><div className="eyebrow">BRANCHLENS / DEPENDENCY INTELLIGENCE</div><h1>{graphView === 'impact' ? 'Portfolio Impact View' : 'Dependency Explorer'}</h1><p>{graphView === 'impact' ? 'Trace every tracked position linked to a selected dependency.' : 'Follow each position through verified markets and dependencies.'}</p></div><div className="explorer-position-context"><span>SELECTED INVESTMENT · ILLUSTRATIVE HOLDING</span><strong>{selectedPosition.analysis.vault.name}</strong><small>{selectedPosition.analysis.vault.asset.symbol} · {money(selectedPosition.amountUsd)} tracked · {selectedPosition.analysis.vault.allocations.length} funded markets</small><a href={`https://app.morpho.org/ethereum/vault/${selectedPosition.address}`} target="_blank" rel="noopener noreferrer">Verify vault ↗</a></div></div><div className="screen-actions"><button onClick={() => { setScreen('home'); requestAnimationFrame(() => document.getElementById('portfolio-summary')?.scrollIntoView({ behavior: 'smooth' })); }}>← Portfolio</button><div className="view-toggle" role="group" aria-label="Graph view"><button className={graphView === 'dependency' ? 'active' : ''} aria-pressed={graphView === 'dependency'} onClick={() => { setGraphView('dependency'); setSelectedNodeId(selectedPosition.analysis.graph.nodes.find((node) => node.type === 'Position')?.id || ''); }}>Dependency View</button><button className={graphView === 'impact' ? 'active' : ''} aria-pressed={graphView === 'impact'} onClick={() => openImpact(selectedNodeId)}>Impact View</button></div><span className="screen-source">{selectedPosition.dataMode === 'LIVE_API' ? 'LIVE MORPHO DATA' : 'HISTORICAL SNAPSHOT'}</span></div>
          {incident && graphView === 'dependency' && <section className="explorer-alert"><div><strong>SIMULATED cbBTC DEPEG · REVIEW REQUIRED</strong><p>{money(incident.uniqueCapitalExposedUsd)} of assumed portfolio capital is linked to cbBTC markets. This is exposure, not realized loss.</p></div><button onClick={openIncidentImpact}>View Portfolio Impact →</button></section>}
          <GraphExplorer position={selectedPosition} portfolio={data} view={graphView} selectedId={selectedNodeId} onSelect={setSelectedNodeId} onViewImpact={openImpact} onReview={() => setScreen('incident')} />
          <section className="source-strip card"><strong>Source integrity</strong><span>{graphView === 'impact' ? 'All affected positions list their own retrieval time and data mode in the analyst panel.' : `GraphQL retrieved ${new Date(selectedPosition.analysis.vault.provenance.retrievedAt).toLocaleString()}`}</span><span>{data.mode.replaceAll('_', ' ')}</span><span>Graph links are observed, documented or assumed as labeled.</span></section>
        </>}
        {screen === 'incident' && incident && <><div className="screen-actions"><button onClick={() => { if (primaryPosition) openPosition(primaryPosition); }}>← Dependency explorer</button><button onClick={resetScenario}>Reset simulated incident</button></div><section className="incident-hero card"><div className="eyebrow">SIMULATED INCIDENT · NOT A LIVE DETECTION</div><div className="incident-head"><div><h2>{incident.title}</h2><p>{incident.whatHappened}</p></div><span className="severity">REVIEW REQUIRED</span></div><div className="incident-metrics"><div><small>Unique assumed principal exposed</small><strong>{preciseMoney(incident.uniqueCapitalExposedUsd)}</strong></div><div><small>Conditional full-loss bound</small><strong>{preciseMoney(incident.maximumConditionalPrincipalLossUsd)}</strong></div><div><small>Affected investments</small><strong>{incident.affectedPositions.length}</strong></div></div><p>{incident.maxRiskMeaning} Actual lender loss is not calculated.</p></section><div className="incident-grid"><section className="card"><div className="eyebrow">WHY IT MATTERS</div><h2>Impact through the dependency stack</h2><p>{incident.whyItMatters}</p><p>Injected observation: cbBTC/BTC = 0.70 versus baseline 1.00. The explicit ±{incident.detectionRule.thresholdPercent}% deviation rule is <strong>{incident.detectionRule.status}</strong>. Morpho did not report this hypothetical price move.</p><div className="affected-list">{incident.affectedPositions.map((position) => <div key={position.id}><strong>{position.name}</strong><span>{position.markets.length} actual funded cbBTC market{position.markets.length === 1 ? '' : 's'}</span><b>{preciseMoney(position.exposedPrincipalUsd)}</b></div>)}</div></section><section className="card"><div className="eyebrow">WHAT CAN THE ANALYST DO?</div><h2>Review before any exit</h2><dl><dt>Wallet-specific withdrawal</dt><dd>Not verified</dd><dt>Vault-wide liquidity</dt><dd>Shown in each position; not a withdrawal promise</dd><dt>Swap slippage</dt><dd>Not applicable to a plain vault redeem</dd><dt>Execution quote and gas</dt><dd>Not quoted</dd></dl><h3>Verify next</h3><ul>{incident.analystMustVerify.map((item) => <li key={item}>{item}</li>)}</ul><p className="smallnote">This prototype does not connect to a production alerting system or wallet.</p></section></div><section className="card incident-output"><div><div className="eyebrow">STRUCTURED INCIDENT OUTPUT</div><h2>Ready for a future alerting workflow</h2><p>Machine-readable, unsigned, and non-executable. The copied record includes affected markets, provenance, timestamps, assumptions and unresolved questions.</p><div className="buttons"><button className="primary" onClick={() => void copyIncident()}>{copied ? 'Copied incident JSON' : 'Copy Incident JSON'}</button><button onClick={() => downloadJson(incident, `${incident.id}.json`)}>Download JSON</button></div></div><pre>{JSON.stringify({ id: incident.id, status: incident.status, affectedPositions: incident.affectedPositions.map((item) => ({ name: item.name, exposedPrincipalUsd: item.exposedPrincipalUsd })), uniqueCapitalExposedUsd: incident.uniqueCapitalExposedUsd, actualLossUsd: incident.actualLossUsd, executionEnabled: false }, null, 2)}</pre></section><section className="card"><div className="eyebrow">EVIDENCE & TIMESTAMPS</div><h2>Trace every part of the report</h2><div className="source-list">{incident.sources.map((item) => <a key={item} href={item} target="_blank" rel="noopener noreferrer">{item} ↗</a>)}</div>{incident.sourceTimestamps.map((item) => <p key={item.positionId} className="smallnote">{item.positionId}: {item.dataMode === 'LIVE_API' ? 'live API retrieved' : 'historical API data retrieved'} {new Date(item.retrievedAt).toLocaleString()}{item.snapshotCapturedAt ? ` · saved ${new Date(item.snapshotCapturedAt).toLocaleString()}` : ''}</p>)}<p className="smallnote">Scenario injected {new Date(incident.simulatedAt).toLocaleString()}. These times do not imply a detected price incident.</p></section></>}
      </>}
      <footer>Independent hackathon prototype · Real Morpho references · Assumed positions · No transactions or live alerts sent</footer>
    </main>
  </div>;
}
