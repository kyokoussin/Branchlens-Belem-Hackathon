import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import { DEFAULT_VAULT, fetchMorphoVault, SourceError } from './morphoClient.mjs';
import { analyze, DataError } from './riskEngine.mjs';
import { formatIncidents } from './incidentFormatter.mjs';
import { addDocumentedCbbtcDependencies, simulateCbbtcDepeg } from './scenarioEngine.mjs';
import { buildPortfolio } from './portfolioEngine.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const snapshotPath = join(root, 'data', 'demo-snapshot.json');
const port = Number(process.env.PORT || 8780);
const incidents = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store' });
  res.end(data);
}

async function serveStatic(pathname, res) {
  const path = pathname === '/' ? join(dist, 'index.html') : resolve(dist, '.' + pathname);
  if (!path.startsWith(dist + '/') && path !== join(dist, 'index.html')) return json(res, 404, { error: 'Not found.' });
  try {
    if (!(await stat(path)).isFile()) throw new Error();
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream', 'content-length': data.length });
    res.end(data);
  } catch { json(res, 404, { error: 'Build the UI first with pnpm build.' }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  if (req.method !== 'GET') return json(res, 405, { error: 'Read-only server: GET only.' });
  if (url.pathname === '/api/health') return json(res, 200, { status: 'running', dataSource: 'Morpho public API queried per analysis request' });
  if (url.pathname === '/api/portfolio') {
    try {
      const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
      const source = url.searchParams.get('source') || 'auto';
      const scenarioCode = url.searchParams.get('scenario');
      if (scenarioCode && scenarioCode !== 'CBBTC_DEPEG_30') return json(res, 400, { error: 'Unsupported scenario.' });
      return json(res, 200, await buildPortfolio({ source, scenario: Boolean(scenarioCode), snapshot }));
    } catch (error) {
      return json(res, error instanceof DataError ? 400 : 502, { status: 'UNKNOWN', error: error.message || 'Portfolio analysis unavailable.' });
    }
  }
  if (url.pathname === '/api/analyze') {
    try {
      const vaultAddress = url.searchParams.get('vault') || DEFAULT_VAULT;
      const amount = url.searchParams.get('positionUsd') || '1000000';
      const scenarioCode = url.searchParams.get('scenario');
      if (scenarioCode && scenarioCode !== 'CBBTC_DEPEG_30') return json(res, 400, { status: 'UNKNOWN', error: 'Unsupported simulation scenario.' });
      let { raw, provenance } = await fetchMorphoVault(vaultAddress);
      let analyzed;
      try {
        analyzed = analyze(raw, provenance, amount);
      } catch (error) {
        // Morpho's live aggregate and allocations can briefly come from different index states.
        // Re-fetch once; the financial model still rejects a second inconsistent snapshot.
        if (!(error instanceof DataError) || !error.message.includes('allocation USD sum exceeds')) throw error;
        ({ raw, provenance } = await fetchMorphoVault(vaultAddress));
        analyzed = analyze(raw, provenance, amount);
        analyzed.vault.warnings.push('An initial Morpho response had inconsistent allocation totals; a fresh consistent response was used.');
      }
      const result = addDocumentedCbbtcDependencies(formatIncidents(analyzed));
      for (const incident of result.incidents) incidents.set(incident.id, incident);
      const simulation = scenarioCode ? simulateCbbtcDepeg(result) : null;
      if (simulation?.available) incidents.set(simulation.id, simulation);
      return json(res, 200, { mode: scenarioCode ? 'SIMULATION_ON_LIVE_MORPHO_DATA' : 'LIVE_API_WITH_ASSUMED_POSITION', ...result, simulation });
    } catch (error) {
      const status = error instanceof DataError || error.code === 'INVALID_ADDRESS' ? 400 : error.code === 'NOT_FOUND' ? 404 : 502;
      return json(res, status, { status: 'UNKNOWN', code: error.code || 'ANALYSIS_FAILED', error: error.message || 'Analysis failed. No values were substituted.' });
    }
  }
  if (url.pathname.startsWith('/api/incidents/')) {
    const incident = incidents.get(url.pathname.split('/').pop());
    return json(res, incident ? 200 : 404, incident || { error: 'Incident not in this local session. Run an analysis first.' });
  }
  return serveStatic(url.pathname, res);
});
server.listen(port, '127.0.0.1', () => console.log(`Belem analyst prototype: http://127.0.0.1:${port}`));
