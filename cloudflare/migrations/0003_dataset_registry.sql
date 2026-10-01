CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  initialized_at TEXT,
  published_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_datasets_kind ON datasets(kind);
