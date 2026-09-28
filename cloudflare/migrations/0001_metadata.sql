CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  region TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_event ON alerts(event_id);
CREATE TABLE IF NOT EXISTS model_runs (
  id TEXT PRIMARY KEY,
  initialized_at TEXT NOT NULL,
  model_name TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  longitude REAL NOT NULL,
  latitude REAL NOT NULL,
  source TEXT NOT NULL
);
