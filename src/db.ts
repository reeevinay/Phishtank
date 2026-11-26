import Database from 'better-sqlite3';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { ProvenanceSubgraph, ThreatEdge, ThreatNode } from './graph';

export type IncidentVerdict = 'PROCESSING' | 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';

export interface IncidentDetails {
  triggeredRules?: string[];
  urls?: string[];
  fileHashes?: string[];
  status?: string;
  message?: string;
  cached?: boolean;
  processingTimeMs?: number;
  belief_malicious?: number;
  plausibility_malicious?: number;
  epistemic_uncertainty?: number;
  conflict_k?: number;
  neural_probability?: number;
  adversarial_flags?: string[];
  evidence_sources?: unknown[];
  [key: string]: unknown;
}

export interface IncidentRecord {
  id: string;
  tenant_id?: string;
  sender?: string | null;
  sender_domain?: string | null;
  subject?: string | null;
  score: number;
  belief_low?: number;
  plausibility_high?: number;
  epistemic_uncertainty?: number;
  conflict_k?: number;
  verdict: IncidentVerdict;
  campaign_id?: string | null;
  embedding?: number[];
  details: string | IncidentDetails;
  created_at?: string;
}

export interface CampaignRecord {
  id: string;
  label: string;
  incident_count: number;
  avg_score: number;
  first_seen: string;
  last_seen: string;
}

const DATABASE_URL = process.env.DATABASE_URL;
export const isPostgresEnabled = Boolean(DATABASE_URL);

// PostgreSQL Pool (used in Cloud / Docker production)
let pgPool: Pool | null = null;
if (DATABASE_URL) {
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 20
  });
}

// SQLite WAL fallback (used for zero-config local dev & unit tests)
export const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'phishtank.db');
export const db = !pgPool ? new Database(DB_PATH) : null;

if (db) {
  db.pragma('journal_mode = WAL');
}

export async function initSchema(): Promise<void> {
  if (pgPool) {
    const schemaPath = path.resolve(__dirname, 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf-8');
      await pgPool.query(sql);
      console.log('🐘 PostgreSQL + pgvector schema initialized');
    }
    return;
  }

  if (!db) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        tenant_id TEXT DEFAULT 'default',
        sender TEXT,
        sender_domain TEXT,
        subject TEXT,
        score INTEGER NOT NULL,
        belief_low REAL DEFAULT 0.0,
        plausibility_high REAL DEFAULT 1.0,
        epistemic_uncertainty REAL DEFAULT 1.0,
        conflict_k REAL DEFAULT 0.0,
        verdict TEXT NOT NULL CHECK(verdict IN ('PROCESSING', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS')),
        campaign_id TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_verdict ON incidents(verdict);
      CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        incident_count INTEGER NOT NULL DEFAULT 1,
        avg_score REAL NOT NULL DEFAULT 0.0,
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS threat_nodes (
        id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        label TEXT NOT NULL,
        risk_score INTEGER NOT NULL DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS threat_edges (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source_id, target_id, relation)
      );
    `);

    // Migrate older SQLite table if missing new columns
    const cols = db.prepare("PRAGMA table_info('incidents')").all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    const migrations: [string, string][] = [
      ['tenant_id', "TEXT DEFAULT 'default'"],
      ['sender_domain', 'TEXT'],
      ['belief_low', 'REAL DEFAULT 0.0'],
      ['plausibility_high', 'REAL DEFAULT 1.0'],
      ['epistemic_uncertainty', 'REAL DEFAULT 1.0'],
      ['conflict_k', 'REAL DEFAULT 0.0'],
      ['campaign_id', 'TEXT']
    ];
    for (const [col, def] of migrations) {
      if (!colNames.has(col)) {
        db.exec(`ALTER TABLE incidents ADD COLUMN ${col} ${def};`);
      }
    }
  } catch (err) {
    console.error('Error during SQLite schema initialization:', err);
  }
}

void initSchema();

export async function saveIncident(incident: IncidentRecord): Promise<void> {
  const detailsObj = typeof incident.details === 'string' ? parseIncidentDetails(incident.details) : (incident.details ?? {});
  const detailsStr = JSON.stringify(detailsObj);
  const senderDomain =
    incident.sender_domain ??
    (incident.sender && incident.sender.includes('@') ? incident.sender.split('@')[1].replace(/[>]/g, '').toLowerCase() : null);

  if (pgPool) {
    const vecStr = incident.embedding && incident.embedding.length === 384 ? `[${incident.embedding.join(',')}]` : null;
    await pgPool.query(
      `INSERT INTO incidents (
        id, tenant_id, sender, sender_domain, subject, score,
        belief_low, plausibility_high, epistemic_uncertainty, conflict_k,
        verdict, campaign_id, embedding, details
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector,$14::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        sender = EXCLUDED.sender,
        sender_domain = EXCLUDED.sender_domain,
        subject = EXCLUDED.subject,
        score = EXCLUDED.score,
        belief_low = EXCLUDED.belief_low,
        plausibility_high = EXCLUDED.plausibility_high,
        epistemic_uncertainty = EXCLUDED.epistemic_uncertainty,
        conflict_k = EXCLUDED.conflict_k,
        verdict = EXCLUDED.verdict,
        campaign_id = COALESCE(EXCLUDED.campaign_id, incidents.campaign_id),
        embedding = COALESCE(EXCLUDED.embedding, incidents.embedding),
        details = EXCLUDED.details`,
      [
        incident.id,
        incident.tenant_id || 'default',
        incident.sender ?? null,
        senderDomain,
        incident.subject ?? null,
        incident.score,
        incident.belief_low ?? 0,
        incident.plausibility_high ?? 1,
        incident.epistemic_uncertainty ?? 1,
        incident.conflict_k ?? 0,
        incident.verdict,
        incident.campaign_id ?? null,
        vecStr,
        detailsStr
      ]
    );
    return;
  }

  if (!db) return;
  db.prepare(`
    INSERT INTO incidents (
      id, tenant_id, sender, sender_domain, subject, score,
      belief_low, plausibility_high, epistemic_uncertainty, conflict_k,
      verdict, campaign_id, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    ON CONFLICT(id) DO UPDATE SET
      sender = excluded.sender,
      sender_domain = excluded.sender_domain,
      subject = excluded.subject,
      score = excluded.score,
      belief_low = excluded.belief_low,
      plausibility_high = excluded.plausibility_high,
      epistemic_uncertainty = excluded.epistemic_uncertainty,
      conflict_k = excluded.conflict_k,
      verdict = excluded.verdict,
      campaign_id = COALESCE(excluded.campaign_id, incidents.campaign_id),
      details = excluded.details
  `).run(
    incident.id,
    incident.tenant_id || 'default',
    incident.sender ?? null,
    senderDomain,
    incident.subject ?? null,
    incident.score,
    incident.belief_low ?? 0,
    incident.plausibility_high ?? 1,
    incident.epistemic_uncertainty ?? 1,
    incident.conflict_k ?? 0,
    incident.verdict,
    incident.campaign_id ?? null,
    detailsStr,
    incident.created_at ?? null
  );
}

export async function createPendingIncident(
  id: string,
  sender: string = 'Pending Analysis...',
  subject: string = 'Processing .eml upload...',
  tenantId: string = 'default'
): Promise<void> {
  await saveIncident({
    id,
    tenant_id: tenantId,
    sender,
    subject,
    score: 0,
    verdict: 'PROCESSING',
    details: {
      status: 'PROCESSING',
      message: 'Email enqueued for distributed Neuro-Symbolic threat evaluation'
    }
  });
}

export async function getRecentIncidents(limit: number = 20, tenantId?: string): Promise<IncidentRecord[]> {
  if (pgPool) {
    const q = tenantId
      ? `SELECT id, tenant_id, sender, sender_domain, subject, score, belief_low, plausibility_high, epistemic_uncertainty, conflict_k, verdict, campaign_id, details, created_at
         FROM incidents WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`
      : `SELECT id, tenant_id, sender, sender_domain, subject, score, belief_low, plausibility_high, epistemic_uncertainty, conflict_k, verdict, campaign_id, details, created_at
         FROM incidents ORDER BY created_at DESC LIMIT $1`;
    const res = await pgPool.query(q, tenantId ? [tenantId, limit] : [limit]);
    return res.rows as IncidentRecord[];
  }

  if (!db) return [];
  if (tenantId) {
    return db
      .prepare('SELECT id, tenant_id, sender, sender_domain, subject, score, belief_low, plausibility_high, epistemic_uncertainty, conflict_k, verdict, campaign_id, details, created_at FROM incidents WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(tenantId, limit) as IncidentRecord[];
  }
  return db
    .prepare('SELECT id, tenant_id, sender, sender_domain, subject, score, belief_low, plausibility_high, epistemic_uncertainty, conflict_k, verdict, campaign_id, details, created_at FROM incidents ORDER BY created_at DESC LIMIT ?')
    .all(limit) as IncidentRecord[];
}

export async function getIncidentById(id: string): Promise<IncidentRecord | undefined> {
  if (pgPool) {
    const res = await pgPool.query(
      `SELECT id, tenant_id, sender, sender_domain, subject, score, belief_low, plausibility_high, epistemic_uncertainty, conflict_k, verdict, campaign_id, details, created_at
       FROM incidents WHERE id = $1`,
      [id]
    );
    return res.rows[0] as IncidentRecord | undefined;
  }

  if (!db) return undefined;
  return db
    .prepare('SELECT id, tenant_id, sender, sender_domain, subject, score, belief_low, plausibility_high, epistemic_uncertainty, conflict_k, verdict, campaign_id, details, created_at FROM incidents WHERE id = ?')
    .get(id) as IncidentRecord | undefined;
}

/**
 * Finds or creates a polymorphic phishing campaign cluster using pgvector cosine similarity
 * (or subject/domain heuristic fallback in SQLite mode).
 */
export async function correlateCampaign(params: {
  embedding?: number[];
  subject: string;
  score: number;
  verdict: IncidentVerdict;
}): Promise<string | undefined> {
  if (params.verdict === 'CLEAN') return undefined;

  if (pgPool && params.embedding && params.embedding.length === 384) {
    const vecStr = `[${params.embedding.join(',')}]`;
    const match = await pgPool.query(
      `SELECT campaign_id, 1 - (embedding <=> $1::vector) AS similarity
       FROM incidents
       WHERE campaign_id IS NOT NULL AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector ASC
       LIMIT 1`,
      [vecStr]
    );

    if (match.rows.length > 0 && Number(match.rows[0].similarity) >= 0.82) {
      const cId = match.rows[0].campaign_id as string;
      await pgPool.query(
        `UPDATE campaigns SET incident_count = incident_count + 1,
         avg_score = (avg_score * incident_count + $1) / (incident_count + 1),
         last_seen = NOW() WHERE id = $2`,
        [params.score, cId]
      );
      return cId;
    }

    const newCampaignId = `camp_${Date.now().toString(36)}`;
    await pgPool.query(
      `INSERT INTO campaigns (id, label, centroid, incident_count, avg_score) VALUES ($1, $2, $3::vector, 1, $4)`,
      [newCampaignId, params.subject.slice(0, 64) || 'Polymorphic Phishing Wave', vecStr, params.score]
    );
    return newCampaignId;
  }

  // SQLite fallback: group by normalized subject prefix
  if (db) {
    const prefix = (params.subject || '').replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 28) || 'Threat Wave';
    const existing = db.prepare('SELECT id, incident_count, avg_score FROM campaigns WHERE label = ? LIMIT 1').get(prefix) as
      | { id: string; incident_count: number; avg_score: number }
      | undefined;
    if (existing) {
      db.prepare('UPDATE campaigns SET incident_count = incident_count + 1, avg_score = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(
        (existing.avg_score * existing.incident_count + params.score) / (existing.incident_count + 1),
        existing.id
      );
      return existing.id;
    }
    const newId = `camp_${Date.now().toString(36)}`;
    db.prepare('INSERT INTO campaigns (id, label, incident_count, avg_score) VALUES (?, ?, 1, ?)').run(newId, prefix, params.score);
    return newId;
  }

  return undefined;
}

export async function saveProvenanceGraph(graph: ProvenanceSubgraph): Promise<void> {
  if (pgPool) {
    for (const n of graph.nodes) {
      await pgPool.query(
        `INSERT INTO threat_nodes (id, node_type, label, risk_score, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (id) DO UPDATE SET risk_score = GREATEST(threat_nodes.risk_score, EXCLUDED.risk_score)`,
        [n.id, n.node_type, n.label, n.risk_score, JSON.stringify(n.metadata ?? {})]
      );
    }
    for (const e of graph.edges) {
      await pgPool.query(
        `INSERT INTO threat_edges (source_id, target_id, relation, weight)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_id, target_id, relation) DO NOTHING`,
        [e.source_id, e.target_id, e.relation, e.weight ?? 1.0]
      );
    }
    return;
  }

  if (!db) return;
  const insNode = db.prepare(`
    INSERT INTO threat_nodes (id, node_type, label, risk_score, metadata)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET risk_score = MAX(threat_nodes.risk_score, excluded.risk_score)
  `);
  const insEdge = db.prepare(`
    INSERT OR IGNORE INTO threat_edges (source_id, target_id, relation, weight)
    VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const n of graph.nodes) {
      insNode.run(n.id, n.node_type, n.label, n.risk_score, JSON.stringify(n.metadata ?? {}));
    }
    for (const e of graph.edges) {
      insEdge.run(e.source_id, e.target_id, e.relation, e.weight ?? 1.0);
    }
  });
  tx();
}

export async function getProvenanceSubgraph(incidentId: string): Promise<ProvenanceSubgraph> {
  if (pgPool) {
    const edgesRes = await pgPool.query(
      `WITH hop1 AS (
         SELECT source_id, target_id, relation, weight FROM threat_edges
         WHERE source_id = $1 OR target_id = $1
       ),
       hop1_nodes AS (
         SELECT source_id AS id FROM hop1 UNION SELECT target_id AS id FROM hop1
       )
       SELECT DISTINCT e.source_id, e.target_id, e.relation, e.weight
       FROM threat_edges e
       WHERE e.source_id IN (SELECT id FROM hop1_nodes) OR e.target_id IN (SELECT id FROM hop1_nodes)
       LIMIT 80`,
      [incidentId]
    );
    const edges = edgesRes.rows as ThreatEdge[];
    const nodeIds = Array.from(new Set([incidentId, ...edges.flatMap((e) => [e.source_id, e.target_id])]));
    if (nodeIds.length === 0) return { nodes: [], edges: [] };
    const nodesRes = await pgPool.query(`SELECT id, node_type, label, risk_score, metadata FROM threat_nodes WHERE id = ANY($1)`, [nodeIds]);
    return { nodes: nodesRes.rows as ThreatNode[], edges };
  }

  if (!db) return { nodes: [], edges: [] };
  const hop1 = db.prepare('SELECT source_id, target_id, relation, weight FROM threat_edges WHERE source_id = ? OR target_id = ?').all(incidentId, incidentId) as ThreatEdge[];
  const hop1Ids = Array.from(new Set([incidentId, ...hop1.flatMap((e) => [e.source_id, e.target_id])]));
  if (hop1Ids.length === 0) return { nodes: [], edges: [] };

  const placeholders = hop1Ids.map(() => '?').join(',');
  const hop2 = db
    .prepare(`SELECT DISTINCT source_id, target_id, relation, weight FROM threat_edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders}) LIMIT 80`)
    .all(...hop1Ids, ...hop1Ids) as ThreatEdge[];

  const allNodeIds = Array.from(new Set([incidentId, ...hop2.flatMap((e) => [e.source_id, e.target_id])]));
  const nodePh = allNodeIds.map(() => '?').join(',');
  const nodes = db.prepare(`SELECT id, node_type, label, risk_score FROM threat_nodes WHERE id IN (${nodePh})`).all(...allNodeIds) as ThreatNode[];
  return { nodes, edges: hop2 };
}

export async function getCampaigns(limit: number = 20): Promise<CampaignRecord[]> {
  if (pgPool) {
    const res = await pgPool.query('SELECT id, label, incident_count, avg_score, first_seen, last_seen FROM campaigns ORDER BY last_seen DESC LIMIT $1', [limit]);
    return res.rows as CampaignRecord[];
  }
  if (!db) return [];
  return db.prepare('SELECT id, label, incident_count, avg_score, first_seen, last_seen FROM campaigns ORDER BY last_seen DESC LIMIT ?').all(limit) as CampaignRecord[];
}

export function parseIncidentDetails(details: string | IncidentDetails): IncidentDetails {
  if (typeof details === 'object' && details !== null) {
    return details as IncidentDetails;
  }
  try {
    return JSON.parse(details);
  } catch {
    return {};
  }
}

export async function closeDatabase(): Promise<void> {
  if (pgPool) await pgPool.end();
  if (db) db.close();
}

export default db;
