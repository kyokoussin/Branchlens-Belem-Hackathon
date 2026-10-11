import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { buildGraph } from './_riskEngine.mjs';
import { buildImpactIndex } from './_portfolioImpact.mjs';
import { buildPortfolio } from './_portfolioEngine.mjs';
import { DEMO_POSITIONS } from './_portfolioConfig.mjs';
import { addDocumentedCbbtcDependencies } from './_scenarioEngine.mjs';
import { evaluateBorrowerScenario, compareHoldExit } from './_borrowerRisk.mjs';
import { getBorrowMarketSnapshot } from './_marketData.mjs';
import { openStore } from './_store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moneyString = z.string().regex(/^\d+(?:\.\d+)?$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const marketIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const positionSchema = z.object({ id: z.string().min(1), name: z.string(), address: z.union([address, marketIdSchema]), chainId: z.union([z.literal(1), z.literal(8453)]), amountUsd: moneyString, portfolioId: z.string().min(1), description: z.string(), positionType: z.enum(['supply', 'borrow']).optional(), borrowDebtUsd: moneyString.optional() }).refine((item) => item.positionType !== 'borrow' || (item.address.length === 66 && item.borrowDebtUsd != null && Number(item.borrowDebtUsd) > 0), 'A simulated borrow needs a Morpho market and a positive debt amount.');
const workspaceSchema = z.object({ version: z.literal(1), portfolios: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).min(1), positions: z.array(positionSchema) }).refine((data) => data.positions.every((item) => data.portfolios.some((portfolio) => portfolio.id === item.portfolioId)) && new Set(data.portfolios.map((item) => item.id)).size === data.portfolios.length && new Set(data.positions.map((item) => item.id)).size === data.positions.length, 'Portfolio and position IDs must be unique, and every position must belong to a portfolio.');
const decisionSchema = z.object({ probabilityPercent: moneyString.optional(), incrementalLossUsd: moneyString.optional(), gasUsd: moneyString.optional(), slippageUsd: moneyString.optional(), feesUsd: moneyString.optional(), unwindUsd: moneyString.optional(), repaymentCapacityUsd: moneyString.optional(), exitRemovesRisk: z.boolean().optional() });
const analysisSchema = z.object({
  portfolioId: z.string().min(1), marketId: marketIdSchema, chainId: z.union([z.literal(1), z.literal(8453)]),
  dependencyNodeId: z.string().optional(), scenarioType: z.enum(['COLLATERAL_PRICE_SHOCK', 'ORACLE_STALE', 'ORACLE_PRICE_DEVIATION', 'PROTOCOL_UNAVAILABLE']),
  collateralTokens: moneyString, debtTokens: moneyString, shockPercent: moneyString,
  source: z.enum(['auto', 'snapshot']).default('auto'), assumptions: decisionSchema,
  workspace: workspaceSchema.optional(),
});
const intentSchema = z.object({
  schemaVersion: z.literal('1.0'), decisionId: z.string().min(1), idempotencyKey: z.string().min(1), incidentId: z.string().min(1),
  portfolioId: z.string().min(1), positionId: z.string().min(1), chainId: z.number().int(), protocol: z.literal('MORPHO_BLUE'),
  marketId: marketIdSchema, action: z.literal('REPAY_AND_WITHDRAW_COLLATERAL'),
  amounts: z.object({ debtTokens: moneyString, collateralTokens: moneyString }),
  assets: z.object({ loanAddress: address, collateralAddress: address }),
  riskAssessment: z.object({ recommendation: z.string(), expectedHoldLossUsd: moneyString, exitCostUsd: moneyString }),
  executionConstraints: z.object({ simulatedOnly: z.literal(true), estimatedGasUsd: moneyString, estimatedSwapSlippageUsd: moneyString, repaymentCapacityUsd: moneyString }),
  dataFreshness: z.object({ mode: z.string(), capturedAt: z.string(), collateralPriceAt: z.string(), loanPriceAt: z.string() }),
  authorization: z.object({ status: z.literal('APPROVED_BY_ANALYST_IN_DEMO'), approvedAt: z.string(), justification: z.string().min(1) }),
  createdAt: z.string(), expiresAt: z.string(),
});

export function defaultServerWorkspace() {
  return { version: 1, portfolios: [{ id: 'demo', name: 'Demo Portfolio' }], positions: DEMO_POSITIONS.map((item) => ({ ...item, name: '', chainId: 1, portfolioId: 'demo' })) };
}

export async function getWorkspace() {
  const store = await openStore();
  return (await store.getWorkspace()) || defaultServerWorkspace();
}

export async function putWorkspace(input) {
  const workspace = workspaceSchema.parse(input);
  const store = await openStore();
  await store.putWorkspace(workspace);
  return workspace;
}

function borrowerPosition(snapshot, risk, portfolioId, runId) {
  const market = snapshot.market;
  const marketId = market.allocations[0].marketId;
  const graph = buildGraph(market, { positionRole: 'BORROWER' });
  const capital = risk.before?.collateralValueUsd || '0.00';
  const exposure = { assumedPrincipalUsd: capital, marketExposures: [{ marketId, share: '1', capitalExposedUsd: capital }], unquantifiedUsd: '0.00', coverageRatio: '1' };
  const documented = addDocumentedCbbtcDependencies({ vault: market, graph, exposure });
  return {
    id: `borrower:${runId}`, name: `Simulated ${market.name} borrower`, portfolioId, chainId: market.chainId,
    address: market.address, description: 'Analyst-entered borrower token balances in a verified Morpho market.', amountUsd: capital,
    dataMode: snapshot.mode === 'LIVE_MORPHO_API' ? 'LIVE_API' : 'SAVED_HISTORICAL_SNAPSHOT',
    snapshotCapturedAt: snapshot.mode === 'LIVE_MORPHO_API' ? null : snapshot.capturedAt,
    analysis: { vault: market, graph: documented.graph, exposure },
  };
}

export async function createAnalysis(input) {
  const request = analysisSchema.parse(input);
  const workspace = request.workspace || await getWorkspace();
  if (!workspace.portfolios.some((item) => item.id === request.portfolioId)) throw new Error('Select a portfolio that exists in the workspace.');
  if (request.workspace) await putWorkspace(workspace);
  const snapshot = await getBorrowMarketSnapshot({ chainId: request.chainId, marketId: request.marketId, source: request.source });
  const risk = evaluateBorrowerScenario({ market: snapshot.market, collateralPriceUsd: snapshot.prices.collateral.usd, loanPriceUsd: snapshot.prices.loan.usd, collateralTokens: request.collateralTokens, debtTokens: request.debtTokens, scenarioType: request.scenarioType, shockPercent: request.shockPercent });
  const id = `run_${randomUUID()}`;
  const portfolioSnapshot = JSON.parse(await readFile(join(root, 'data', 'demo-snapshot.json'), 'utf8'));
  const portfolio = await buildPortfolio({ source: request.source, scenario: false, snapshot: portfolioSnapshot, positions: workspace.positions });
  const positions = [...portfolio.positions, ...(risk.status === 'CALCULATED_SCENARIO' ? [borrowerPosition(snapshot, risk, request.portfolioId, id)] : [])];
  const { graph, impacts } = buildImpactIndex(positions);
  const defaultDependency = `token:${request.chainId}:${snapshot.market.allocations[0].collateral.address}`;
  const dependencyNodeId = request.dependencyNodeId || defaultDependency;
  const impact = impacts[dependencyNodeId];
  if (!impact) throw new Error('Selected dependency is not present in the verified graph.');
  const decision = risk.status === 'CALCULATED_SCENARIO' ? compareHoldExit({ ...request.assumptions, debtValueUsd: risk.before.debtValueUsd, exitRemovesRisk: request.assumptions.exitRemovesRisk ?? true }) : { recommendation: 'INSUFFICIENT_DATA', reason: risk.reason, missing: ['supported financial model'] };
  const run = {
    id, incidentId: `incident_${randomUUID()}`, portfolioId: request.portfolioId,
    positionId: `borrower:${id}`, status: 'ANALYZED', createdAt: new Date().toISOString(),
    incident: { type: request.scenarioType, dependencyNodeId, assumed: true, observedFailure: false, description: request.scenarioType === 'COLLATERAL_PRICE_SHOCK' ? `Analyst-simulated ${request.shockPercent}% collateral-price shock.` : `Analyst-simulated ${request.scenarioType}.` },
    source: { mode: snapshot.mode, capturedAt: snapshot.capturedAt, market: snapshot.market, prices: snapshot.prices, oracle: snapshot.oracle, freshness: snapshot.freshness, liveFailure: snapshot.liveFailure || null },
    inputs: request, graph: { nodes: graph.nodes, edges: graph.edges }, impact, risk, decision,
    analystDecision: null, botHandoff: null, reportId: null,
    caveat: 'Supplier positions are shown as affected dependencies; their realized loss is not inferred from this borrower scenario.',
  };
  const store = await openStore();
  await store.putSnapshot(snapshot);
  await store.putRun(run);
  return run;
}

export async function updateAssumptions(runId, assumptionsInput) {
  const assumptions = decisionSchema.parse(assumptionsInput);
  const store = await openStore();
  const run = await store.getRun(runId);
  if (!run) throw new Error('Scenario run not found.');
  if (run.status !== 'ANALYZED') throw new Error('Approved decisions cannot be silently recalculated. Start a new scenario.');
  const decision = run.risk.status === 'CALCULATED_SCENARIO' ? compareHoldExit({ ...assumptions, debtValueUsd: run.risk.before.debtValueUsd, exitRemovesRisk: assumptions.exitRemovesRisk ?? true }) : { recommendation: 'INSUFFICIENT_DATA', reason: run.risk.reason };
  const changed = { ...run, inputs: { ...run.inputs, assumptions }, decision };
  await store.putRun(changed);
  return changed;
}

function reportFor(run) {
  return {
    schemaVersion: '1.0', id: `report:${run.analystDecision.id}`, createdAt: new Date().toISOString(),
    incident: { id: run.incidentId, time: run.createdAt, ...run.incident },
    affectedDependency: { id: run.impact.selectedNodeId, label: run.impact.selectedLabel, evidenceStatuses: run.impact.evidenceStatuses },
    relatedMarkets: run.impact.affectedMarketIds,
    affectedPositions: run.impact.affectedPositions,
    completePaths: run.impact.affectedPositions.flatMap((item) => item.paths.map((path) => ({ positionId: item.id, ...path }))),
    snapshot: { mode: run.source.mode, capturedAt: run.source.capturedAt, prices: run.source.prices, marketSource: run.source.market.provenance, oracle: run.source.oracle, liveFailure: run.source.liveFailure },
    scenarioAssumptions: { collateralTokens: run.inputs.collateralTokens, debtTokens: run.inputs.debtTokens, shockPercent: run.inputs.shockPercent, decision: run.inputs.assumptions },
    borrowerRisk: run.risk, holdExit: run.decision, decision: run.analystDecision,
    botHandoff: run.botHandoff || { status: 'NOT_SENT' }, limitations: [...(run.risk.limitations || []), run.caveat],
  };
}

export async function approveDecision(runId, { action, justification, analyst = 'Demo analyst' }) {
  if (!['HOLD', 'EXIT'].includes(action) || !String(justification || '').trim()) throw new Error('Choose HOLD or EXIT and provide a justification.');
  const store = await openStore();
  const run = await store.getRun(runId);
  if (!run) throw new Error('Scenario run not found.');
  if (run.analystDecision) return run;
  if (action === 'EXIT' && ['EXIT_BLOCKED', 'INSUFFICIENT_DATA'].includes(run.decision.recommendation)) throw new Error('EXIT cannot be approved while its route is blocked or its economics are incomplete.');
  const approved = { ...run, status: 'APPROVED', analystDecision: { id: `decision_${randomUUID()}`, action, justification: String(justification).trim(), analyst, approvedAt: new Date().toISOString(), approvalMode: 'EXPLICIT_DEMO_ANALYST_ACTION' } };
  const report = reportFor(approved);
  approved.reportId = report.id;
  await store.putRun(approved);
  await store.putReport(report);
  return approved;
}

export function makeExecutionIntent(run) {
  if (run.status !== 'APPROVED' || run.analystDecision?.action !== 'EXIT') throw new Error('An explicit approved EXIT decision is required for a bot handoff.');
  if (run.risk.status !== 'CALCULATED_SCENARIO') throw new Error('A supported borrower scenario is required for a bot handoff.');
  const row = run.source.market.allocations[0];
  const createdAt = new Date().toISOString();
  return intentSchema.parse({
    schemaVersion: '1.0', decisionId: run.analystDecision.id, idempotencyKey: `branchlens:${run.analystDecision.id}`,
    incidentId: run.incidentId, portfolioId: run.portfolioId, positionId: run.positionId,
    chainId: run.source.market.chainId, protocol: 'MORPHO_BLUE', marketId: row.marketId,
    action: 'REPAY_AND_WITHDRAW_COLLATERAL', amounts: { debtTokens: run.inputs.debtTokens, collateralTokens: run.inputs.collateralTokens },
    assets: { loanAddress: row.loan.address, collateralAddress: row.collateral.address },
    riskAssessment: { recommendation: run.decision.recommendation, expectedHoldLossUsd: run.decision.expectedHoldLossUsd, exitCostUsd: run.decision.exitCostUsd },
    executionConstraints: { simulatedOnly: true, estimatedGasUsd: run.decision.inputs.gasUsd, estimatedSwapSlippageUsd: run.decision.inputs.slippageUsd, repaymentCapacityUsd: run.decision.availableRepaymentUsd },
    dataFreshness: { mode: run.source.mode, capturedAt: run.source.capturedAt, collateralPriceAt: run.source.prices.collateral.timestamp, loanPriceAt: run.source.prices.loan.timestamp },
    authorization: { status: 'APPROVED_BY_ANALYST_IN_DEMO', approvedAt: run.analystDecision.approvedAt, justification: run.analystDecision.justification },
    createdAt, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
}

// Adapter boundary: a real Belem bot can implement this contract after its API,
// authentication and receipt semantics are known. This receiver never signs or submits.
export function simulatedBotReceiver(payload, now = new Date()) {
  const intent = intentSchema.parse(payload);
  if (Date.parse(intent.createdAt) > now.getTime() + 300_000 || Date.parse(intent.expiresAt) <= now.getTime()) {
    return { status: 'REJECTED_EXPIRED', executionStatus: 'NOT_EXECUTED' };
  }
  return { status: 'ACKNOWLEDGED_SIMULATION_ONLY', executionStatus: 'NOT_EXECUTED' };
}

export async function sendToSimulatedBot(runId) {
  const store = await openStore();
  const run = await store.getRun(runId);
  if (!run) throw new Error('Scenario run not found.');
  if (run.botHandoff) return { run, handoff: run.botHandoff, duplicate: true };
  const intent = makeExecutionIntent(run);
  const previous = await store.getHandoff(intent.idempotencyKey);
  if (previous) return { run, handoff: previous, duplicate: true };
  const now = new Date().toISOString();
  const receipt = simulatedBotReceiver(intent, new Date(now));
  const handoff = {
    idempotencyKey: intent.idempotencyKey, decisionId: intent.decisionId, intent,
    status: receipt.status,
    acknowledgedAt: now, executionStatus: receipt.executionStatus, receiver: 'BRANCHLENS_SIMULATED_BOT',
    note: 'No wallet, signing key, transaction submission or external bot connection is used.',
  };
  await store.putHandoff(handoff);
  const updated = { ...run, botHandoff: handoff, status: receipt.status === 'ACKNOWLEDGED_SIMULATION_ONLY' ? 'HANDOFF_ACKNOWLEDGED' : 'HANDOFF_REJECTED' };
  await store.putRun(updated);
  await store.putReport(reportFor(updated));
  return { run: updated, handoff, duplicate: false };
}

export async function getRun(runId) { return (await openStore()).getRun(runId); }
export async function getReport(reportId) { return (await openStore()).getReport(reportId); }
export async function listReports() { return (await openStore()).listReports(); }
export { analysisSchema, intentSchema };
