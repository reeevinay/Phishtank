-- PhishTank-NS PostgreSQL 16 + pgvector Schema
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  sender TEXT,
  sender_domain TEXT,
  subject TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  belief_low REAL NOT NULL DEFAULT 0.0,
  plausibility_high REAL NOT NULL DEFAULT 1.0,
  epistemic_uncertainty REAL NOT NULL DEFAULT 1.0,
  conflict_k REAL NOT NULL DEFAULT 0.0,
  verdict TEXT NOT NULL CHECK (verdict IN ('PROCESSING', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS')),
  campaign_id TEXT,
  embedding vector(384),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_created ON incidents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_verdict ON incidents (verdict);
CREATE INDEX IF NOT EXISTS idx_incidents_campaign ON incidents (campaign_id);
CREATE INDEX IF NOT EXISTS idx_incidents_embedding_hnsw ON incidents USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  centroid vector(384),
  incident_count INTEGER NOT NULL DEFAULT 1,
  avg_score REAL NOT NULL DEFAULT 0.0,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threat_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL CHECK (node_type IN ('email', 'sender_domain', 'reply_to', 'url_domain', 'attachment_hash', 'campaign')),
  label TEXT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threat_edges (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES threat_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES threat_nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, target_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_threat_edges_src ON threat_edges (source_id);
CREATE INDEX IF NOT EXISTS idx_threat_edges_tgt ON threat_edges (target_id);
