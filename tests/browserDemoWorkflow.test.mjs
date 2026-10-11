import { describe, expect, it } from 'vitest';

describe('Vercel demo without DATABASE_URL', () => {
  it('analyzes, recalculates, approves, simulates handoff and renders a report from browser-supplied state', async () => {
    process.env.VERCEL = '1';
    const { default: handler } = await import('../api/workflow.mjs');
    const { defaultServerWorkspace } = await import('../api/_workflowService.mjs');
    async function post(action, body) {
      const response = { status: 0, payload: null,
        writeHead(status) { this.status = status; },
        end(bytes) { this.payload = JSON.parse(bytes.toString()); },
      };
      await handler({ method: 'POST', url: `/api/workflow?action=${action}`, body }, response);
      return response;
    }
    const assumptions = { probabilityPercent: '30', incrementalLossUsd: '16219.18', gasUsd: '50', slippageUsd: '0', feesUsd: '0', unwindUsd: '100', repaymentCapacityUsd: '60000', exitPercent: '100' };
    const created = await post('analyze', { portfolioId: 'demo', marketId: '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64', chainId: 1, scenarioType: 'COLLATERAL_PRICE_SHOCK', collateralTokens: '1', debtTokens: '60000', shockPercent: '30', source: 'snapshot', assumptions, workspace: defaultServerWorkspace() });
    expect(created.status).toBe(200);
    let run = created.payload;
    expect(run.impact.affectedPositionCount).toBe(6);
    const changed = await post('assumptions', { runId: run.id, run, assumptions: { ...assumptions, exitPercent: '40' } });
    expect(changed.status).toBe(200);
    run = changed.payload;
    expect(run.decision.recommendation).toBe('PARTIAL_EXIT_FAVORED');
    const approved = await post('approve', { runId: run.id, run, action: 'PARTIAL_EXIT', justification: 'Modeled avoided loss exceeds estimated exit cost.' });
    expect(approved.status).toBe(200);
    run = approved.payload;
    const sent = await post('send', { runId: run.id, run });
    expect(sent.status).toBe(200);
    run = sent.payload.run;
    expect(run.botHandoff.executionStatus).toBe('NOT_EXECUTED');
    const report = await post('report', { run });
    expect(report.status).toBe(200);
    expect(report.payload.decision.action).toBe('PARTIAL_EXIT');
    expect(report.payload.botHandoff.status).toBe('ACKNOWLEDGED_SIMULATION_ONLY');
    delete process.env.VERCEL;
  });
});
