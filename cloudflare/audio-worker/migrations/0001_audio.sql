CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('generate','import')),
  status TEXT NOT NULL DEFAULT 'queued',
  payload TEXT NOT NULL,
  reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micros >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  asset_id TEXT,
  receipt TEXT,
  error TEXT
);
CREATE INDEX jobs_created ON jobs(created_at);
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','approved','rejected')),
  tags TEXT NOT NULL DEFAULT '[]',
  scene TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  bpm INTEGER,
  loop_verified INTEGER NOT NULL DEFAULT 0,
  vocals TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  creator TEXT NOT NULL,
  license TEXT NOT NULL,
  license_url TEXT NOT NULL,
  attribution TEXT NOT NULL,
  rights_scope TEXT NOT NULL DEFAULT 'internal_only',
  rights_confirmed INTEGER NOT NULL DEFAULT 0,
  quality_confirmed INTEGER NOT NULL DEFAULT 0,
  prompt TEXT,
  model TEXT,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  cost_basis TEXT NOT NULL DEFAULT 'estimate',
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX assets_status_kind ON assets(status,kind);
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL
);
