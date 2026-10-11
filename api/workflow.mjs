import { ZodError } from 'zod';
import { approveDecision, createAnalysis, getReport, getRun, getWorkspace, listReports, putWorkspace, reportForBrowserDemo, seedBrowserDemoRun, sendToSimulatedBot, updateAssumptions, updateIncidentStatus } from './_workflowService.mjs';
import { listMorphoMarkets } from './_morphoClient.mjs';

async function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let text = '';
  for await (const part of req) {
    text += part.toString();
    if (text.length > 1_000_000) throw new Error('Request body exceeds 1 MB.');
  }
  return text ? JSON.parse(text) : {};
}

function send(res, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store' });
  res.end(data);
}

export default async function workflowHandler(req, res) {
  const url = new URL(req.url || '/api/workflow', 'http://localhost');
  const action = url.searchParams.get('action') || 'health';
  try {
    if (req.method === 'GET') {
      if (action === 'health') return send(res, 200, { status: 'running', workflow: 'borrower-scenario-v1', execution: 'simulation-only' });
      if (action === 'workspace') return send(res, 200, await getWorkspace());
      if (action === 'run') { const run = await getRun(url.searchParams.get('id')); return send(res, run ? 200 : 404, run || { error: 'Run not found.' }); }
      if (action === 'report') { const report = await getReport(url.searchParams.get('id')); return send(res, report ? 200 : 404, report || { error: 'Report not found.' }); }
      if (action === 'reports') return send(res, 200, await listReports());
      if (action === 'markets') return send(res, 200, await listMorphoMarkets({ chainId: Number(url.searchParams.get('chainId') || 1), cursor: url.searchParams.get('cursor'), limit: 25 }));
      return send(res, 404, { error: 'Unknown workflow action.' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
    const body = await bodyOf(req);
    if (action === 'workspace') return send(res, 200, await putWorkspace(body));
    if (action === 'analyze') return send(res, 200, await createAnalysis(body));
    const browserDemo = !process.env.DATABASE_URL && (process.env.VERCEL || process.env.BRANCHLENS_BROWSER_DEMO === '1');
    if (action === 'report' && body.run && browserDemo) return send(res, 200, reportForBrowserDemo(body.run));
    if (browserDemo) await seedBrowserDemoRun(body.run, body.runId);
    if (action === 'assumptions') return send(res, 200, await updateAssumptions(body.runId, body.assumptions));
    if (action === 'incident-status') return send(res, 200, await updateIncidentStatus(body.runId, body.status));
    if (action === 'approve') return send(res, 200, await approveDecision(body.runId, body));
    if (action === 'send') return send(res, 200, await sendToSimulatedBot(body.runId));
    return send(res, 404, { error: 'Unknown workflow action.' });
  } catch (error) {
    const status = error instanceof ZodError || error instanceof SyntaxError || /must|invalid|select|required|unknown|blocked|cannot|exceeds|not found/i.test(error.message || '') ? 400 : 502;
    return send(res, status, { status: 'UNAVAILABLE', error: error instanceof ZodError ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error.message || 'Workflow failed.' });
  }
}
