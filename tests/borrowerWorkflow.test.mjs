import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateBorrowerScenario, compareHoldExit } from '../api/_borrowerRisk.mjs';

const market = { allocations: [{ lltv: '0.86', collateral: { decimals: 8 }, loan: { decimals: 6 } }] };
const borrower = (overrides = {}) => evaluateBorrowerScenario({ market, collateralPriceUsd: '82862.54601748308', loanPriceUsd: '0.9996877291133612', collateralTokens: '1', debtTokens: '60000', shockPercent: '30', ...overrides });
const economics = { probabilityPercent: '30', incrementalLossUsd: '10000', gasUsd: '50', slippageUsd: '0', feesUsd: '0', unwindUsd: '100', repaymentCapacityUsd: '60000', debtValueUsd: '59981.26' };

describe('borrower scenario calculations', () => {
  it('uses real-market LLTV and token prices to recompute health after a shock', () => {
    const result = borrower();
    expect(result.before.liquidationEligible).toBe(false);
    expect(result.after.liquidationEligible).toBe(true);
    expect(Number(result.after.healthFactor)).toBeLessThan(1);
    expect(result.before.debtValueUsd).toBe(result.after.debtValueUsd);
    expect(result.conditionalLenderShortfallUsd).toBe('1977.48');
  });
  it('handles zero debt and exact liquidation boundary', () => {
    expect(borrower({ debtTokens: '0' }).after.healthFactor).toBeNull();
    expect(borrower({ debtTokens: '0' }).after.liquidationEligible).toBe(false);
    const boundary = evaluateBorrowerScenario({ market, collateralPriceUsd: '100', loanPriceUsd: '1', collateralTokens: '1', debtTokens: '86', shockPercent: '0' });
    expect(boundary.before.healthFactor).toBe('1');
    expect(boundary.before.liquidationEligible).toBe(true);
  });
  it('rejects unsupported token precision, invalid prices, and unsupported incidents', () => {
    expect(() => borrower({ debtTokens: '1.0000001' })).toThrow(/decimal places/);
    expect(() => borrower({ collateralPriceUsd: '0' })).toThrow(/price/);
    expect(borrower({ scenarioType: 'ORACLE_STALE' }).status).toBe('UNSUPPORTED_FINANCIAL_MODEL');
  });
});

describe('HOLD/EXIT economics', () => {
  it('calculates expected loss, exit costs, and break-even probability', () => {
    const result = compareHoldExit(economics);
    expect(result.expectedHoldLossUsd).toBe('3000.00');
    expect(result.exitCostUsd).toBe('150.00');
    expect(result.breakEvenProbabilityPercent).toBe('1.5');
    expect(result.recommendation).toBe('EXIT_FAVORED');
  });
  it('blocks an unfunded repayment and rejects missing assumptions', () => {
    expect(compareHoldExit({ ...economics, repaymentCapacityUsd: '50000' }).recommendation).toBe('EXIT_BLOCKED');
    expect(compareHoldExit({ ...economics, gasUsd: undefined }).recommendation).toBe('INSUFFICIENT_DATA');
    expect(compareHoldExit({ ...economics, probabilityPercent: '0' }).recommendation).toBe('HOLD_FAVORED');
  });
});

describe('persisted demo workflow', () => {
  it('analyzes a captured real market, approves an exit, deduplicates bot handoff, and stores a report', async () => {
    process.env.BRANCHLENS_DB_PATH = join(await mkdtemp(join(tmpdir(), 'branchlens-workflow-')), 'demo.sqlite');
    const { createAnalysis, approveDecision, sendToSimulatedBot, getReport, getRun, intentSchema, simulatedBotReceiver } = await import('../api/_workflowService.mjs');
    const run = await createAnalysis({ portfolioId: 'demo', marketId: '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64', chainId: 1, scenarioType: 'COLLATERAL_PRICE_SHOCK', collateralTokens: '1', debtTokens: '60000', shockPercent: '30', source: 'snapshot', assumptions: economics });
    expect(run.source.mode).toBe('SAVED_HISTORICAL_SNAPSHOT');
    expect(run.impact.affectedPositionCount).toBeGreaterThan(1);
    expect(run.impact.affectedPositions.every((item) => item.paths.length > 0)).toBe(true);
    const approved = await approveDecision(run.id, { action: 'EXIT', justification: 'Expected hold loss exceeds estimated exit cost.' });
    const first = await sendToSimulatedBot(run.id);
    const again = await sendToSimulatedBot(run.id);
    expect(first.handoff.status).toBe('ACKNOWLEDGED_SIMULATION_ONLY');
    expect(first.handoff.executionStatus).toBe('NOT_EXECUTED');
    expect(again.duplicate).toBe(true);
    expect(intentSchema.safeParse(first.handoff.intent).success).toBe(true);
    expect(intentSchema.safeParse({ ...first.handoff.intent, action: 'SELL_EVERYTHING' }).success).toBe(false);
    expect(() => simulatedBotReceiver({ ...first.handoff.intent, action: 'SELL_EVERYTHING' })).toThrow();
    expect(simulatedBotReceiver(first.handoff.intent, new Date(first.handoff.intent.expiresAt)).status).toBe('REJECTED_EXPIRED');
    expect((await getRun(run.id)).botHandoff.idempotencyKey).toBe(first.handoff.idempotencyKey);
    expect((await getReport(approved.reportId)).botHandoff.status).toBe('ACKNOWLEDGED_SIMULATION_ONLY');
  });
});
