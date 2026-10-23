export const SCHEMA = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,                 -- "cg:<coingecko_id>" ou "dex:<chain>:<adresse>"
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  chain TEXT,                          -- blockchain principale
  contract_address TEXT,
  coingecko_id TEXT,
  logo_url TEXT,
  categories TEXT NOT NULL DEFAULT '[]',   -- JSON array d'ids de catégories
  narrative TEXT,                      -- narrative principale (id catégorie)
  narrative_source TEXT,               -- 'coingecko' | 'heuristique'
  description TEXT,
  website TEXT,
  twitter TEXT,
  dex_url TEXT,
  pair_created_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- active | suspect | delisted
  status_reason TEXT,
  discovered_via TEXT,
  dev_commits_4w INTEGER,
  detail_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tokens_contract ON tokens(chain, contract_address);
CREATE INDEX IF NOT EXISTS idx_tokens_cg ON tokens(coingecko_id);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  ts TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  price_usd REAL,
  market_cap REAL,
  fdv REAL,
  volume_24h REAL,
  volume_1h REAL,
  volume_6h REAL,
  liquidity_usd REAL,
  change_1h REAL,
  change_24h REAL,
  change_7d REAL,
  circulating_supply REAL,
  total_supply REAL,
  max_supply REAL,
  buys_24h INTEGER,
  sells_24h INTEGER,
  holders INTEGER,
  source_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_snap_token_ts ON market_snapshots(token_id, ts);
CREATE INDEX IF NOT EXISTS idx_snap_ts ON market_snapshots(ts);

CREATE TABLE IF NOT EXISTS security_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  ts TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_url TEXT,
  is_honeypot INTEGER,
  buy_tax REAL,
  sell_tax REAL,
  top10_holders_pct REAL,
  holder_count INTEGER,
  flags TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_sec_token ON security_checks(token_id, ts);

CREATE TABLE IF NOT EXISTS catalysts (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  title TEXT NOT NULL,
  kind TEXT,
  event_date TEXT,                 -- ISO date
  date_precision TEXT DEFAULT 'day',   -- day | month | quarter | unknown
  status TEXT NOT NULL,            -- confirmed | rumor
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  first_confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cat_token ON catalysts(token_id);

CREATE TABLE IF NOT EXISTS category_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  run_id INTEGER,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  market_cap REAL,
  change_24h REAL,
  volume_24h REAL,
  momentum_rank INTEGER
);
CREATE INDEX IF NOT EXISTS idx_catsnap ON category_snapshots(category_id, ts);

-- Distribution des capitalisations par catégorie (comparables pour les scénarios)
CREATE TABLE IF NOT EXISTS category_peers (
  category_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  peer_caps TEXT NOT NULL,         -- JSON array des market caps (USD) triées
  peer_names TEXT NOT NULL,        -- JSON [{id,name,cap}] (top) pour l'explication
  PRIMARY KEY (category_id, ts)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,               -- daily | refresh | discovery
  run_key TEXT NOT NULL,           -- ex. daily:2026-10-23
  trigger TEXT NOT NULL,           -- cron | manual | catchup | cli
  status TEXT NOT NULL,            -- running | success | partial | failed
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  stats TEXT NOT NULL DEFAULT '{}',
  provider_results TEXT NOT NULL DEFAULT '{}',
  steps TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_jobs ON job_runs(job, started_at);

CREATE TABLE IF NOT EXISTS rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES job_runs(id),
  ts TEXT NOT NULL,
  horizon TEXT NOT NULL,           -- week | month | year
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  rank INTEGER,                    -- NULL si données insuffisantes
  score REAL,                      -- NULL si données insuffisantes
  confidence REAL NOT NULL,
  coverage REAL NOT NULL,
  components TEXT NOT NULL,        -- JSON
  scenarios TEXT,                  -- JSON (null si aucun scénario défendable)
  catalyst_proximity TEXT,         -- JSON
  price_usd REAL,
  market_cap REAL,
  fdv REAL,
  status TEXT NOT NULL,            -- ranked | insufficient | suspect
  movement TEXT,                   -- JSON {prevRank, delta, reason}
  weights_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rank_run ON rankings(run_id, horizon, rank);
CREATE INDEX IF NOT EXISTS idx_rank_token ON rankings(token_id, ts);

CREATE TABLE IF NOT EXISTS daily_reports (
  run_id INTEGER PRIMARY KEY REFERENCES job_runs(id),
  report_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_date ON daily_reports(report_date);

CREATE TABLE IF NOT EXISTS provider_status (
  provider TEXT PRIMARY KEY,
  last_ok_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  calls_ok INTEGER NOT NULL DEFAULT 0,
  calls_failed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS favorites (
  token_id TEXT PRIMARY KEY REFERENCES tokens(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT REFERENCES tokens(id),   -- NULL = règle globale
  type TEXT NOT NULL,              -- price_above | price_below | volume_spike | catalyst_confirmed | entered_list | daily_report
  params TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_minutes INTEGER NOT NULL DEFAULT 180,
  last_fired_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
  token_id TEXT,
  ts TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  pushed INTEGER NOT NULL DEFAULT 0,
  push_error TEXT,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_ev ON alert_events(ts);

CREATE TABLE IF NOT EXISTS push_devices (
  expo_token TEXT PRIMARY KEY,
  platform TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
