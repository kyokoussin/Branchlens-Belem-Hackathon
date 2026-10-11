import { useEffect, useMemo, useState } from 'react';
import { evaluateImpactScenario } from '../api/_impactModel.mjs';
import type { PortfolioData } from './model';
import type { WorkspaceConfig } from './portfolioWorkspace';

type Run = { id: string; reportId: string | null; status: string; incidentStatus: string; incident: { type: string; dependencyNodeId: string; description: string }; source: { mode: string; capturedAt: string; market: { name: string; allocations: Array<{ collateral: { symbol: string }; loan: { symbol: string }; lltv: string }> }; prices: { collateral: { usd: string; timestamp: string }; loan: { usd: string; timestamp: string } }; liveFailure: string | null; portfolioMode?: string; liveVerifiedOutsideSnapshotIds?: string[] }; impact: { selectedLabel: string; affectedPositionCount: number; affectedMarketCount: number; uniqueCapitalExposedUsd: string; affectedPositions: Array<{ id: string; name: string; exposedPrincipalUsd: string; paths: Array<{ nodeIds: string[] }> }> }; risk: { status: string; reason?: string; before?: { collateralValueUsd: string; debtValueUsd: string; equityUsd: string; ltv: string | null; healthFactor: string | null; liquidationEligible: boolean }; after?: { collateralValueUsd: string; debtValueUsd: string; equityUsd: string; ltv: string | null; healthFactor: string | null; liquidationEligible: boolean }; conditionalLenderShortfallUsd?: string }; decision: { recommendation: string; reason: string; expectedHoldLossUsd?: string; exitCostUsd?: string; avoidedExpectedLossUsd?: string; residualExpectedLossUsd?: string; remainingExposureUsd?: string | null; remainingDebtUsd?: string; requestedExitPercent?: string; quoteStatus?: string; breakEvenProbabilityPercent?: string | null; missing?: string[] }; analystDecision: { action: string; justification: string } | null; botHandoff: { status: string; executionStatus: string } | null };
type Report = { id: string; incident: { id: string; type: string; description: string }; snapshot: { mode: string; capturedAt: string }; affectedPositions: Run['impact']['affectedPositions']; borrowerRisk: Run['risk']; holdExit: Run['decision']; decision: NonNullable<Run['analystDecision']>; residualExposure?: { collateralUsd: string | null; debtUsd: string | null }; botHandoff: { status: string; executionStatus?: string } };
const amount = (value: string | number | null | undefined) => value == null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value));
const sample = { collateralTokens: '1', debtTokens: '60000', shockPercent: '30', probabilityPercent: '30', incrementalLossUsd: '10000', gasUsd: '50', slippageUsd: '0', feesUsd: '0', unwindUsd: '100', repaymentCapacityUsd: '60000', exitPercent: '100' };
const savedRunKey = 'branchlens:scenario-run:v1';
function savedRun(): Run | null { try { return JSON.parse(localStorage.getItem(savedRunKey) || 'null'); } catch { return null; } }

async function workflow(action: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/workflow?action=${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Workflow returned HTTP ${response.status}.`);
  return result;
}

export function CrisisWorkflow({ portfolio, workspace, onBack }: { portfolio: PortfolioData; workspace: WorkspaceConfig; onBack: () => void }) {
  const marketOptions = useMemo(() => portfolio.portfolioGraph.nodes.filter((node) => node.type === 'LendingMarket' && node.address), [portfolio]);
  const defaultMarket = marketOptions.find((node) => node.label.toLowerCase().includes('cbbtc')) || marketOptions[0];
  const cbBtcImpact = Object.values(portfolio.impactIndex).find((item) => item.selectedType === 'CollateralToken' && item.selectedLabel.toLowerCase() === 'cbbtc');
  const modeledPortfolioLoss = cbBtcImpact ? evaluateImpactScenario(cbBtcImpact, portfolio.positions, { type: 'DEMO_STRESS' }).estimatedFinancialLossUsd : null;
  const [marketId, setMarketId] = useState(defaultMarket?.address || '');
  const [portfolioId, setPortfolioId] = useState(workspace.portfolios[0]?.id || 'demo');
  const [inputs, setInputs] = useState(() => {
    const prior = savedRun() as (Run & { inputs?: { collateralTokens: string; debtTokens: string; shockPercent: string; assumptions: Partial<typeof sample> } }) | null;
    return { ...sample, incrementalLossUsd: modeledPortfolioLoss || sample.incrementalLossUsd, ...prior?.inputs?.assumptions,
      collateralTokens: prior?.inputs?.collateralTokens || sample.collateralTokens,
      debtTokens: prior?.inputs?.debtTokens || sample.debtTokens,
      shockPercent: prior?.inputs?.shockPercent || sample.shockPercent };
  });
  const [scenarioType, setScenarioType] = useState('COLLATERAL_PRICE_SHOCK');
  const [source, setSource] = useState<'auto' | 'snapshot'>('auto');
  const [run, setRun] = useState<Run | null>(savedRun);
  const [report, setReport] = useState<Report | null>(null);
  const [action, setAction] = useState<'HOLD' | 'EXIT' | 'PARTIAL_EXIT' | 'ESCALATE'>(() => {
    const prior = savedRun();
    if (prior?.analystDecision?.action && ['HOLD', 'EXIT', 'PARTIAL_EXIT', 'ESCALATE'].includes(prior.analystDecision.action)) return prior.analystDecision.action as 'HOLD' | 'EXIT' | 'PARTIAL_EXIT' | 'ESCALATE';
    return Number(prior?.decision?.requestedExitPercent) > 0 && Number(prior?.decision?.requestedExitPercent) < 100 ? 'PARTIAL_EXIT' : 'EXIT';
  });
  const [justification, setJustification] = useState('The modeled scenario expected loss exceeds the entered exit costs; repay funding is assumed available.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [autoStarted, setAutoStarted] = useState(() => Boolean(savedRun()));
  const staticHost = window.location.hostname.endsWith('.github.io');
  const exitApprovalBlocked = Boolean(run && ['EXIT', 'PARTIAL_EXIT'].includes(action) && ['EXIT_BLOCKED', 'INSUFFICIENT_DATA'].includes(run.decision.recommendation));
  useEffect(() => { if (run) localStorage.setItem(savedRunKey, JSON.stringify(run)); else localStorage.removeItem(savedRunKey); }, [run]);
  const update = (key: keyof typeof sample, value: string) => { setInputs((current) => ({ ...current, [key]: value })); if (key === 'exitPercent') setAction(Number(value) === 100 ? 'EXIT' : 'PARTIAL_EXIT'); };
  const assumptions = () => ({ probabilityPercent: inputs.probabilityPercent, incrementalLossUsd: inputs.incrementalLossUsd, gasUsd: inputs.gasUsd, slippageUsd: inputs.slippageUsd, feesUsd: inputs.feesUsd, unwindUsd: inputs.unwindUsd, repaymentCapacityUsd: inputs.repaymentCapacityUsd, exitPercent: inputs.exitPercent, exitRemovesRisk: true });
  async function analyze() {
    if (!marketId) { setError('Choose a verified Morpho market.'); return; }
    setBusy(true); setError(''); setRun(null); setReport(null);
    try { const selected = marketOptions.find((item) => item.address === marketId); const chainId = Number(selected?.id.split(':')[1] || 1); setRun(await workflow('analyze', { portfolioId, marketId, chainId, scenarioType, collateralTokens: inputs.collateralTokens, debtTokens: inputs.debtTokens, shockPercent: inputs.shockPercent, source, assumptions: assumptions(), workspace })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Analysis unavailable.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (!autoStarted && !staticHost && marketId) { setAutoStarted(true); void analyze(); } }, [autoStarted, staticHost, marketId]);
  async function recalculate() {
    if (!run) return;
    setBusy(true); setError('');
    try { setRun(await workflow('assumptions', { runId: run.id, run, assumptions: assumptions() })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not recalculate.'); }
    finally { setBusy(false); }
  }
  async function setIncidentStatus(status: 'ACKNOWLEDGED' | 'INVESTIGATING' | 'ESCALATED') {
    if (!run) return;
    setBusy(true); setError('');
    try { setRun(await workflow('incident-status', { runId: run.id, run, status })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update incident status.'); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!run) return;
    setBusy(true); setError('');
    try { setRun(await workflow('approve', { runId: run.id, run, action, justification })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Approval failed.'); }
    finally { setBusy(false); }
  }
  async function sendIntent() {
    if (!run) return;
    setBusy(true); setError('');
    try { const result = await workflow('send', { runId: run.id, run }); setRun(result.run); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Simulated bot handoff failed.'); }
    finally { setBusy(false); }
  }
  async function openReport() {
    if (!run?.reportId) return;
    setBusy(true); setError('');
    try { setReport(await workflow('report', { run })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Report unavailable.'); }
    finally { setBusy(false); }
  }
  return <div className="crisis-workflow"><div className="eyebrow">SIMULATED INCIDENT · REAL MORPHO MARKET</div><h1>Incident → impact → decision</h1><p>Adjust the shock, inspect affected capital, then compare staying with exiting. All holdings and decisions are simulated.</p><button onClick={onBack}>← Portfolio</button>
    {staticHost && <div className="form-error">This technical workflow needs the BranchLens API. Run the local app or a server deployment; the GitHub Pages replay remains a historical front-end demo.</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <section className="card manage-section"><div className="eyebrow">1 · INCIDENT</div><h2>Set the shock</h2><div className="position-form">
      <label>Verified Morpho market<select value={marketId} onChange={(event) => setMarketId(event.target.value)}>{marketOptions.map((item) => <option value={item.address || ''} key={item.id}>{item.label} · {item.address?.slice(0, 10)}</option>)}</select></label>
      {([['collateralTokens', 'Assumed collateral tokens'], ['debtTokens', 'Assumed debt tokens'], ['shockPercent', 'Assumed collateral shock (%)']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="any" value={inputs[key]} onChange={(event) => update(key, event.target.value)} /></label>)}
    </div><details className="advanced-inputs"><summary>Advanced scenario settings</summary><div className="position-form"><label>Portfolio<select value={portfolioId} onChange={(event) => setPortfolioId(event.target.value)}>{workspace.portfolios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Data source<select value={source} onChange={(event) => setSource(event.target.value as 'auto' | 'snapshot')}><option value="auto">Live Morpho API, saved fallback</option><option value="snapshot">Saved Morpho snapshot</option></select></label><label>Incident type<select value={scenarioType} onChange={(event) => setScenarioType(event.target.value)}><option value="COLLATERAL_PRICE_SHOCK">Collateral price shock</option><option value="ORACLE_STALE">Oracle stale</option><option value="ORACLE_PRICE_DEVIATION">Oracle price deviation</option><option value="PROTOCOL_UNAVAILABLE">Protocol unavailable</option></select></label></div></details><button className="primary" disabled={busy || staticHost} onClick={() => void analyze()}>{busy ? 'Checking Morpho…' : 'Analyze impact'}</button><p className="smallnote">Market, LLTV and USD prices: Morpho. Holdings and shock: simulated.</p></section>
    {run && <><section className="card manage-section"><div className="eyebrow">INCIDENT STATE · SIMULATION ONLY</div><h2>{run.incidentStatus.replaceAll('_', ' ')}</h2><p>This is an analyst workflow state, not evidence of a live exploit or execution.</p>{!run.analystDecision && <div className="buttons"><button disabled={busy} onClick={() => void setIncidentStatus('ACKNOWLEDGED')}>Acknowledge</button><button disabled={busy} onClick={() => void setIncidentStatus('INVESTIGATING')}>Investigating</button><button disabled={busy} onClick={() => void setIncidentStatus('ESCALATED')}>Escalate</button></div>}</section><section className="card manage-section"><div className="eyebrow">2 · VERIFIED DEPENDENCY PROPAGATION</div><h2>{run.impact.selectedLabel} affects {run.impact.affectedPositionCount} tracked positions</h2><p>{run.impact.affectedMarketCount} distinct markets · {amount(run.impact.uniqueCapitalExposedUsd)} unique illustrative capital linked through the graph.</p><p className="smallnote">{run.source.mode.replaceAll('_', ' ')} · captured {new Date(run.source.capturedAt).toLocaleString()}{run.source.liveFailure ? ` · Live API failed: ${run.source.liveFailure}` : ''}{run.source.liveVerifiedOutsideSnapshotIds?.length ? ` · ${run.source.liveVerifiedOutsideSnapshotIds.length} newly configured position(s) verified live because no historical snapshot exists` : ''}</p><div className="affected-list">{run.impact.affectedPositions.map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.paths.length} complete path{item.paths.length === 1 ? '' : 's'}</span><b>{amount(item.exposedPrincipalUsd)}</b></div>)}</div><details><summary>Show complete dependency paths</summary>{run.impact.affectedPositions.flatMap((item) => item.paths.map((path, index) => <p className="smallnote" key={`${item.id}:${index}`}>{item.name}: {path.nodeIds.join(' → ')}</p>))}</details></section>
      <section className="card manage-section"><div className="eyebrow">3 · BORROWER RISK</div><h2>{run.incident.description}</h2>{run.risk.status === 'CALCULATED_SCENARIO' ? <><div className="incident-metrics"><div><small>Collateral / debt before</small><strong>{amount(run.risk.before?.collateralValueUsd)} / {amount(run.risk.before?.debtValueUsd)}</strong></div><div><small>Health factor before → after</small><strong>{run.risk.before?.healthFactor ?? 'No debt'} → {run.risk.after?.healthFactor ?? 'No debt'}</strong></div><div><small>After shock</small><strong>{run.risk.after?.liquidationEligible ? 'Liquidation eligible' : 'Above LLTV threshold'}</strong></div></div><p>Shocked collateral {amount(run.risk.after?.collateralValueUsd)} · equity {amount(run.risk.after?.equityUsd)} · conditional lender shortfall {amount(run.risk.conditionalLenderShortfallUsd)}.</p><p className="smallnote">Eligibility is not an executed liquidation. The shortfall is a scenario bound, not observed loss. Other supplier positions are affected by the dependency, but their losses are not inferred from this borrower.</p></> : <p>{run.risk.reason}</p>}</section>
      <section className="card manage-section">
        <div className="eyebrow">4 · DECISION</div><h2>Stay or exit?</h2>
        <p className="smallnote">The default conditional loss is {amount(modeledPortfolioLoss)} from the portfolio stress model. Probability, exit size and costs are editable assumptions; no executable quote is claimed.</p>
        <div className="position-form">{([['probabilityPercent', 'Incident probability (%)'], ['incrementalLossUsd', 'Loss if incident occurs (USD)'], ['exitPercent', 'Exit share (%)'], ['repaymentCapacityUsd', 'Funds for debt repayment (USD)']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="any" value={inputs[key]} onChange={(event) => update(key, event.target.value)} /></label>)}</div>
        <details className="advanced-inputs"><summary>Exit-cost assumptions</summary><div className="position-form">{([['gasUsd', 'Gas (USD)'], ['slippageUsd', 'Slippage (USD)'], ['feesUsd', 'Fees (USD)'], ['unwindUsd', 'Other unwind costs (USD)']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="any" value={inputs[key]} onChange={(event) => update(key, event.target.value)} /></label>)}</div></details>
        <button disabled={busy || run.status !== 'ANALYZED'} onClick={() => void recalculate()}>Recalculate decision</button>
        <div className="incident-metrics"><div><small>Expected hold loss</small><strong>{amount(run.decision.expectedHoldLossUsd)}</strong></div><div><small>Expected loss avoided</small><strong>{amount(run.decision.avoidedExpectedLossUsd)}</strong></div><div><small>Estimated exit cost</small><strong>{amount(run.decision.exitCostUsd)}</strong></div><div><small>Signal</small><strong>{run.decision.recommendation.replaceAll('_', ' ')}</strong></div></div>
        <p className="smallnote">Residual expected loss {amount(run.decision.residualExpectedLossUsd)} · residual collateral {amount(run.decision.remainingExposureUsd)} · quote {run.decision.quoteStatus || 'NOT_QUOTED'}. {run.decision.breakEvenProbabilityPercent != null && `Break-even probability ${run.decision.breakEvenProbabilityPercent}%.`}</p>{run.decision.missing?.length ? <p className="smallnote">Missing: {run.decision.missing.join(', ')}</p> : null}
      </section>
      <section className="card manage-section"><div className="eyebrow">5 · ANALYST APPROVAL AND SIMULATED BOT</div><h2>Record your decision</h2><div className="position-form"><label>Decision<select value={action} disabled={Boolean(run.analystDecision)} onChange={(event) => setAction(event.target.value as 'HOLD' | 'EXIT' | 'PARTIAL_EXIT' | 'ESCALATE')}><option value="EXIT">FULL EXIT</option><option value="PARTIAL_EXIT">PARTIAL EXIT</option><option value="HOLD">HOLD</option><option value="ESCALATE">ESCALATE</option></select></label><label>Justification<input value={justification} disabled={Boolean(run.analystDecision)} onChange={(event) => setJustification(event.target.value)} /></label></div>{exitApprovalBlocked && <p className="smallnote" role="status">An exit cannot be approved while repayment is blocked or the financial model is incomplete. Recalculate with valid inputs, or record HOLD or ESCALATE.</p>}{!run.analystDecision ? <button className="primary" disabled={busy || exitApprovalBlocked} onClick={() => void approve()}>Approve decision for this demo</button> : <p><strong>{run.analystDecision.action} approved.</strong> {run.analystDecision.justification}</p>}{['EXIT', 'PARTIAL_EXIT'].includes(run.analystDecision?.action || '') && !run.botHandoff && <button className="primary" disabled={busy} onClick={() => void sendIntent()}>Send to simulated bot</button>}{run.botHandoff && <p><strong>{run.botHandoff.status.replaceAll('_', ' ')}</strong> · {run.botHandoff.executionStatus.replaceAll('_', ' ')}. No on-chain transaction was submitted.</p>}{run.reportId && <button disabled={busy} onClick={() => void openReport()}>Open generated incident report</button>}</section>
    </>}
    {report && <section className="card manage-section" aria-label="Generated incident report"><div className="eyebrow">AUDIT REPORT · {report.id}</div><h2>Approved incident report</h2><p>{report.incident.type} · {report.snapshot.mode.replaceAll('_', ' ')} · {new Date(report.snapshot.capturedAt).toLocaleString()}</p><p>{report.affectedPositions.length} affected positions · decision {report.decision.action} · bot {report.botHandoff.status.replaceAll('_', ' ')}. Residual collateral exposure: {amount(report.residualExposure?.collateralUsd)} · quote NOT QUOTED.</p><details><summary>Full machine-readable report</summary><pre className="report-json">{JSON.stringify(report, null, 2)}</pre></details><button onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${report.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download report JSON</button></section>}
  </div>;
}
