import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let opened;

export async function openStore() {
  if (opened) return opened;
  opened = createStore().catch((error) => { opened = null; throw error; });
  return opened;
}

async function createStore() {
  const migration = await readFile(join(root, 'migrations', '001_mvp.sql'), 'utf8');
  let query;
  let close;
  let kind;
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 8000 });
    await pool.query(migration);
    query = async (sql, values = []) => (await pool.query(sql, values)).rows;
    close = () => pool.end();
    kind = 'POSTGRESQL';
  } else {
    if (process.env.VERCEL) throw new Error('DATABASE_URL is required for durable storage on Vercel.');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(process.env.BRANCHLENS_DB_PATH || join(root, '.branchlens.sqlite'));
    db.exec(migration);
    query = async (sql, values = []) => {
      const normalized = sql.replace(/\$\d+/g, '?');
      const statement = db.prepare(normalized);
      return /^\s*SELECT\b/i.test(sql) ? statement.all(...values) : (statement.run(...values), []);
    };
    close = () => db.close();
    kind = 'SQLITE_LOCAL';
  }
  const read = async (table, idColumn, id) => {
    const rows = await query(`SELECT payload FROM ${table} WHERE ${idColumn} = $1`, [id]);
    return rows[0] ? JSON.parse(rows[0].payload) : null;
  };
  const save = async (table, idColumn, id, record, extraColumns, extraValues) => {
    const now = new Date().toISOString();
    const columns = [idColumn, ...extraColumns, 'payload', 'created_at'];
    // workspaces, runs and snapshots have different timestamps and are handled below.
    await query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) ON CONFLICT (${idColumn}) DO UPDATE SET payload = EXCLUDED.payload${extraColumns.includes('status') ? ', status = EXCLUDED.status' : ''}`, [id, ...extraValues, JSON.stringify(record), now]);
  };
  return {
    kind, close,
    getWorkspace: () => read('portfolio_workspaces', 'id', 'default'),
    putWorkspace: async (workspace) => query('INSERT INTO portfolio_workspaces (id, payload, updated_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at', ['default', JSON.stringify(workspace), new Date().toISOString()]),
    putSnapshot: async (snapshot) => query('INSERT INTO market_snapshots (id, chain_id, market_id, source_mode, payload, observed_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING', [snapshot.id, snapshot.chainId, snapshot.marketId, snapshot.mode, JSON.stringify(snapshot), snapshot.capturedAt]),
    getRun: (id) => read('workflow_runs', 'id', id),
    putRun: async (run) => query('INSERT INTO workflow_runs (id, portfolio_id, position_id, incident_id, status, payload, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at', [run.id, run.portfolioId, run.positionId, run.incidentId, run.status, JSON.stringify(run), run.createdAt, new Date().toISOString()]),
    getHandoff: (key) => read('bot_handoffs', 'idempotency_key', key),
    putHandoff: async (record) => save('bot_handoffs', 'idempotency_key', record.idempotencyKey, record, ['decision_id', 'status'], [record.decisionId, record.status]),
    getReport: (id) => read('incident_reports', 'id', id),
    listReports: async () => (await query('SELECT payload FROM incident_reports ORDER BY created_at DESC LIMIT 10')).map((row) => JSON.parse(row.payload)),
    putReport: async (report) => save('incident_reports', 'id', report.id, report, ['decision_id'], [report.decision.id]),
  };
}
