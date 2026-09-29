CREATE TABLE IF NOT EXISTS trajectories (
  event_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trajectories_updated ON trajectories(updated_at);
