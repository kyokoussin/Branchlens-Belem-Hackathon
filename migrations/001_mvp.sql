CREATE TABLE IF NOT EXISTS portfolio_workspaces (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_snapshots (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  market_id TEXT NOT NULL,
  source_mode TEXT NOT NULL,
  payload TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE(chain_id, market_id, observed_at)
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_handoffs (
  idempotency_key TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incident_reports (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
