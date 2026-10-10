import { useEffect, useMemo, useState } from 'react';
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
  const [screen, setScreen] = useState<Screen>('home');
  const [selectedPositionId, setSelectedPositionId] = useState('steakhouse-usdc');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [scenario, setScenario] = useState(false);
  const [source, setSource] = useState<'auto' | 'snapshot'>('auto');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<PortfolioData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      setBusy(true); setError('');
      try {
        const params = new URLSearchParams({ source });
        if (scenario) params.set('scenario', 'CBBTC_DEPEG_30');
        const response = await fetch(`/api/portfolio?${params}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Portfolio data unavailable.');
        if (active) setData(payload);
      } catch (cause) {
        if (active) { setData(null); setError(cause instanceof Error ? cause.message : 'Portfolio data unavailable.'); }
      } finally { if (active) setBusy(false); }
    }
    void load();
    const timer = source === 'auto' ? window.setInterval(() => void load(), 60_000) : null;
    return () => { active = false; controller.abort(); if (timer) window.clearInterval(timer); };
  }, [source, scenario, revision]);
  const selectedPosition = useMemo(() => data?.positions.find((position) => position.id === selectedPositionId) || data?.positions[0] || null, [data, selectedPositionId]);
  useEffect(() => {
    if (!selectedPosition) return;
    if (scenario) {
      const cbBtc = selectedPosition.analysis.graph.nodes.find((node) => node.type === 'CollateralToken' && node.label.toLowerCase() === 'cbbtc');
      if (cbBtc) { setSelectedNodeId(cbBtc.id); return; }
    }
    if (!selectedNodeId || !selectedPosition.analysis.graph.nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId(selectedPosition.analysis.graph.nodes.find((node) => node.type === 'Position')?.id || '');
  }, [selectedPosition, scenario]);
  function openPosition(position: Position) {
    setSelectedPositionId(position.id);
    setSelectedNodeId(position.analysis.graph.nodes.find((node) => node.type === 'Position')?.id || '');
    setScreen('explore'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function startScenario() { setScenario(true); setCopied(false); }
  function resetScenario() { setData(null); setScenario(false); setCopied(false); if (screen === 'incident') setScreen('home'); }
  async function copyIncident() {
    if (!data?.portfolioIncident) return;
    try { await navigator.clipboard.writeText(JSON.stringify(data.portfolioIncident, null, 2)); setCopied(true); }
    catch { setCopied(false); downloadJson(data.portfolioIncident, `${data.portfolioIncident.id}.json`); }
  }
  const incident = data?.portfolioIncident;
  const primaryPosition = data?.positions.find((position) => position.id === 'steakhouse-usdc');

  return <div className="app-shell">
    <aside className="sidebar"><img className="brand-logo" src="/belem-logo.svg" alt="Belem Capital" /><div className="rail-divider" /><div className="rail-caption">Risk dependency intelligence</div><nav aria-label="Main navigation"><button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}>Portfolio</button><button className={screen === 'explore' ? 'active' : ''} onClick={() => { if (selectedPosition) openPosition(selectedPosition); }}>Dependency explorer</button><button className={screen === 'incident' ? 'active' : ''} onClick={() => { if (incident) setScreen('incident'); }} disabled={!incident}>Incident review {incident ? '· 1' : ''}</button></nav><div className="rail-foot">Belem Capital hackathon prototype<br />Assumed positions · No trading execution</div></aside>
    <main className="workspace"><header className="topbar"><div><div className="eyebrow">BELEM CAPITAL · DEFI RISK DEPENDENCY CHALLENGE</div><h1>{screen === 'home' ? 'Portfolio Risk Intelligence' : screen === 'explore' ? 'Dependency Explorer' : 'Emergency Incident Review'}</h1><p>{screen === 'home' ? 'Understand what sits beneath each investment before a dependency fails.' : screen === 'explore' ? 'Trace real Morpho allocations into markets, collateral, oracles and documented upstream links.' : 'A structured analyst report from a controlled scenario, ready for review.'}</p></div><div className="topbadges"><span className="badge assumed">SIMULATED PORTFOLIO</span><span className={`badge ${data?.mode === 'LIVE_API' ? 'live' : 'snapshot'}`}>{busy ? 'REFRESHING DATA' : data?.mode === 'LIVE_API' ? 'LIVE MORPHO API' : data?.mode === 'SAVED_HISTORICAL_SNAPSHOT' ? 'HISTORICAL SNAPSHOT' : data?.mode === 'MIXED_LIVE_AND_SNAPSHOT' ? 'MIXED DATA SOURCES' : 'DATA UNAVAILABLE'}</span></div></header>
      {error && <div className="error-card"><strong>Data could not be loaded.</strong><p>{error}</p><button onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
      {!data && !error && <div className="loading-card">Loading verified Morpho investments and dependencies…</div>}
      {data && <>
        {screen === 'home' && <>
          <section className="home-hero card"><div><div className="eyebrow">ONE PORTFOLIO · MANY HIDDEN DEPENDENCIES</div><h2>See the risk below the asset name.</h2><p>Three hypothetical Belem investments point to real Ethereum Morpho vaults. Follow any position to the markets, collateral, oracles and deeper dependencies that could change an exit decision.</p><div className="hero-actions"><button className="primary" onClick={() => document.getElementById('portfolio-cards')?.scrollIntoView({ behavior: 'smooth' })}>Explore Portfolio ↓</button>{!scenario && <button onClick={startScenario}>Simulate Incident</button>}</div></div><div className="hero-monogram" aria-hidden="true">B<span>／</span>C</div></section>
          <section className="metric-grid" aria-label="Portfolio summary"><div className="metric-card"><small>Total hypothetical capital tracked</small><strong>{money(data.portfolio.totalAssumedCapitalUsd)}</strong></div><div className="metric-card"><small>Tracked positions</small><strong>{data.portfolio.trackedPositions}</strong></div><div className="metric-card"><small>Distinct dependencies discovered</small><strong>{data.portfolio.distinctDependencies}</strong></div><div className="metric-card"><small>Active incident alerts</small><strong>{data.portfolio.activeAlerts}</strong><span>{incident ? '1 simulated alert · no live depeg claim' : 'No live emergency detected'}</span></div></section>
          {incident ? <section className="home-alert card"><div><div className="eyebrow">SIMULATED INCIDENT · NOT A LIVE DETECTION</div><h2>{incident.title}</h2><p>{incident.affectedPositions.length} investments affected · {money(incident.uniqueCapitalExposedUsd)} unique assumed principal exposed</p></div><button className="primary" onClick={() => setScreen('incident')}>Review Incident →</button></section> : <section className="scenario-invite card"><div><strong>Try the controlled cbBTC incident</strong><p>Inject a hypothetical price deviation into current Morpho allocations to see which positions depend on cbBTC.</p></div><button onClick={startScenario}>Simulate Incident</button></section>}
          <section className="portfolio-section" id="portfolio-cards"><div className="section-heading"><div><div className="eyebrow">PORTFOLIO · REAL MORPHO REFERENCES</div><h2>Tracked investments</h2><p>Investment amounts are demo assumptions; vault names and allocations come from Morpho.</p></div><div className="data-actions"><button onClick={() => setRevision((value) => value + 1)} disabled={busy}>Refresh data</button><button onClick={() => { setData(null); setSource(source === 'auto' ? 'snapshot' : 'auto'); setScenario(false); }}>{source === 'auto' ? 'Use saved demo snapshot' : 'Return to live API'}</button></div></div><div className="position-grid">{data.positions.map((position, index) => <button className="position-card" key={position.id} onClick={() => openPosition(position)}><span className={`position-icon icon-${index}`}>{position.analysis.vault.asset.symbol.slice(0, 2)}</span><span className="position-main"><span className="position-heading"><strong>{position.analysis.vault.name}</strong><span className="card-arrow">↗</span></span><span className="position-description">{position.description}</span><span className="position-footer"><span><small>Assumed Belem investment</small><b>{money(position.amountUsd)}</b></span><SourceBadge position={position} /></span><span className="position-sub">{position.analysis.vault.allocations.length} funded markets · {position.analysis.graph.nodes.length} dependencies · Ethereum V1</span>{position.changes.length > 0 && <span className="change-note">{position.changes.join(' · ')}</span>}</span></button>)}</div></section>
          <p className="provenance-line">Data mode: {data.mode.replaceAll('_', ' ').toLowerCase()}. The backup was captured from Morpho on {new Date(data.snapshotCapturedAt).toLocaleString()}; it is never labeled live. The incident is always a separate hypothetical observation.</p>
        </>}
        {screen === 'explore' && selectedPosition && <><div className="screen-actions"><button onClick={() => setScreen('home')}>← Portfolio</button><SourceBadge position={selectedPosition} /><span>{money(selectedPosition.amountUsd)} assumed capital</span><button onClick={() => setRevision((value) => value + 1)} disabled={busy}>Refresh</button>{scenario ? <button onClick={resetScenario}>Reset Scenario</button> : <button className="primary" onClick={startScenario}>Simulate Incident</button>}</div>
          <div className="explorer-title"><div><div className="eyebrow">POSITION ANALYSIS · MORPHO V1</div><h2>{selectedPosition.analysis.vault.name}</h2><p>{selectedPosition.description}</p></div><a href={`https://app.morpho.org/ethereum/vault/${selectedPosition.address}`} target="_blank" rel="noopener noreferrer">Verify vault ↗</a></div>
          {incident && <section className="explorer-alert"><div><strong>SIMULATED cbBTC DEPEG · REVIEW REQUIRED</strong><p>{money(incident.uniqueCapitalExposedUsd)} of assumed portfolio capital is linked to cbBTC markets. This is exposure, not realized loss.</p></div><button onClick={() => setScreen('incident')}>Review Incident →</button></section>}
          <GraphExplorer position={selectedPosition} selectedId={selectedNodeId} onSelect={setSelectedNodeId} onReview={() => setScreen('incident')} />
          <section className="source-strip card"><strong>Source integrity</strong><span>GraphQL retrieved {new Date(selectedPosition.analysis.vault.provenance.retrievedAt).toLocaleString()}</span><span>{selectedPosition.dataMode === 'LIVE_API' ? 'LIVE API DATA' : `HISTORICAL SNAPSHOT · captured ${new Date(selectedPosition.snapshotCapturedAt || '').toLocaleString()}`}</span><span>Market allocation coverage {(Number(selectedPosition.analysis.exposure.coverageRatio) * 100).toFixed(1)}%</span><span>{selectedPosition.analysis.vault.warnings.length ? selectedPosition.analysis.vault.warnings.join(' · ') : 'No normalization warnings'}</span></section>
        </>}
        {screen === 'incident' && incident && <><div className="screen-actions"><button onClick={() => { if (primaryPosition) openPosition(primaryPosition); }}>← Dependency explorer</button><button onClick={resetScenario}>Reset Scenario</button></div><section className="incident-hero card"><div className="eyebrow">SIMULATED INCIDENT · NOT A LIVE DETECTION</div><div className="incident-head"><div><h2>{incident.title}</h2><p>{incident.whatHappened}</p></div><span className="severity">REVIEW REQUIRED</span></div><div className="incident-metrics"><div><small>Unique assumed principal exposed</small><strong>{preciseMoney(incident.uniqueCapitalExposedUsd)}</strong></div><div><small>Conditional full-loss bound</small><strong>{preciseMoney(incident.maximumConditionalPrincipalLossUsd)}</strong></div><div><small>Affected investments</small><strong>{incident.affectedPositions.length}</strong></div></div><p>{incident.maxRiskMeaning} Actual lender loss is not calculated.</p></section><div className="incident-grid"><section className="card"><div className="eyebrow">WHY IT MATTERS</div><h2>Impact through the dependency stack</h2><p>{incident.whyItMatters}</p><p>Injected observation: cbBTC/BTC = 0.70 versus baseline 1.00. The explicit ±{incident.detectionRule.thresholdPercent}% deviation rule is <strong>{incident.detectionRule.status}</strong>. Morpho did not report this hypothetical price move.</p><div className="affected-list">{incident.affectedPositions.map((position) => <div key={position.id}><strong>{position.name}</strong><span>{position.markets.length} actual funded cbBTC market{position.markets.length === 1 ? '' : 's'}</span><b>{preciseMoney(position.exposedPrincipalUsd)}</b></div>)}</div></section><section className="card"><div className="eyebrow">WHAT CAN THE ANALYST DO?</div><h2>Review before any exit</h2><dl><dt>Wallet-specific withdrawal</dt><dd>Not verified</dd><dt>Vault-wide liquidity</dt><dd>Shown in each position; not a withdrawal promise</dd><dt>Swap slippage</dt><dd>Not applicable to a plain vault redeem</dd><dt>Execution quote and gas</dt><dd>Not quoted</dd></dl><h3>Verify next</h3><ul>{incident.analystMustVerify.map((item) => <li key={item}>{item}</li>)}</ul><p className="smallnote">This prototype does not connect to Belem's bots, alerting, or a wallet.</p></section></div><section className="card incident-output"><div><div className="eyebrow">STRUCTURED INCIDENT OUTPUT</div><h2>Ready for a future alerting workflow</h2><p>Machine-readable, unsigned, and non-executable. The copied record includes affected markets, provenance, timestamps, assumptions and unresolved questions.</p><div className="buttons"><button className="primary" onClick={() => void copyIncident()}>{copied ? 'Copied incident JSON' : 'Copy Incident JSON'}</button><button onClick={() => downloadJson(incident, `${incident.id}.json`)}>Download JSON</button></div></div><pre>{JSON.stringify({ id: incident.id, status: incident.status, affectedPositions: incident.affectedPositions.map((item) => ({ name: item.name, exposedPrincipalUsd: item.exposedPrincipalUsd })), uniqueCapitalExposedUsd: incident.uniqueCapitalExposedUsd, actualLossUsd: incident.actualLossUsd, executionEnabled: false }, null, 2)}</pre></section><section className="card"><div className="eyebrow">EVIDENCE & TIMESTAMPS</div><h2>Trace every part of the report</h2><div className="source-list">{incident.sources.map((item) => <a key={item} href={item} target="_blank" rel="noopener noreferrer">{item} ↗</a>)}</div>{incident.sourceTimestamps.map((item) => <p key={item.positionId} className="smallnote">{item.positionId}: {item.dataMode === 'LIVE_API' ? 'live API retrieved' : 'historical API data retrieved'} {new Date(item.retrievedAt).toLocaleString()}{item.snapshotCapturedAt ? ` · saved ${new Date(item.snapshotCapturedAt).toLocaleString()}` : ''}</p>)}<p className="smallnote">Scenario injected {new Date(incident.simulatedAt).toLocaleString()}. These times do not imply a detected price incident.</p></section></>}
      </>}
      <footer>Independent hackathon prototype · Real Morpho references · Assumed positions · No transactions or live alerts sent</footer>
    </main>
  </div>;
}
