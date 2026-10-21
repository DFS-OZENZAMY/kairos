-- Kairos : coffres chiffrés côté client. Le serveur ne stocke jamais de données en clair.
CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  auth_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iter INTEGER NOT NULL,
  iv TEXT NOT NULL,
  ct TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
