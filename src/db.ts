import Database from 'better-sqlite3';
import path from 'path';

export type IncidentVerdict = 'PROCESSING' | 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';

export interface IncidentDetails {
  triggeredRules?: string[];
  urls?: string[];
  fileHashes?: string[];
  status?: string;
  message?: string;
  cached?: boolean;
  processingTimeMs?: number;
  [key: string]: unknown;
}

export interface IncidentRecord {
  id: string;
  sender?: string | null;
  subject?: string | null;
  score: number;
  verdict: IncidentVerdict;
  details: string | IncidentDetails;
  created_at?: string;
}

// Resolve SQLite database path to phishtank.db in the project root
export const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'phishtank.db');

// Initialize SQLite database instance
export const db = new Database(DB_PATH);

// Configure WAL mode for concurrency and read/write performance
db.pragma('journal_mode = WAL');

/**
 * Automatically execute DDL schema on startup to create the incidents table and indexes.
 * Migrates existing tables to allow 'PROCESSING' in the verdict check constraint if needed.
 */
export function initSchema(): void {
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='incidents'").get() as { sql: string } | undefined;

    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes('PROCESSING')) {
      // Migrate existing table to support 'PROCESSING'
      db.exec(`
        PRAGMA foreign_keys = OFF;
        ALTER TABLE incidents RENAME TO incidents_old;
        CREATE TABLE incidents (
          id TEXT PRIMARY KEY,
          sender TEXT,
          subject TEXT,
          score INTEGER NOT NULL,
          verdict TEXT NOT NULL CHECK(verdict IN ('PROCESSING', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS')),
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO incidents (id, sender, subject, score, verdict, details, created_at)
        SELECT id, sender, subject, score, verdict, details, created_at FROM incidents_old;
        DROP TABLE incidents_old;
        CREATE INDEX IF NOT EXISTS idx_incidents_verdict ON incidents(verdict);
        CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
        PRAGMA foreign_keys = ON;
      `);
    } else {
      db.exec(`
        CREATE TABLE IF NOT EXISTS incidents (
          id TEXT PRIMARY KEY,
          sender TEXT,
          subject TEXT,
          score INTEGER NOT NULL,
          verdict TEXT NOT NULL CHECK(verdict IN ('PROCESSING', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS')),
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_incidents_verdict ON incidents(verdict);
        CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
      `);
    }
  } catch (err) {
    console.error('Error during database schema initialization:', err);
  }
}

// Execute DDL schema on startup
initSchema();

// Prepared statements
const saveIncidentStmt = db.prepare(`
  INSERT INTO incidents (id, sender, subject, score, verdict, details, created_at)
  VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
  ON CONFLICT(id) DO UPDATE SET
    sender = excluded.sender,
    subject = excluded.subject,
    score = excluded.score,
    verdict = excluded.verdict,
    details = excluded.details,
    created_at = COALESCE(incidents.created_at, excluded.created_at)
`);

const getRecentIncidentsStmt = db.prepare(`
  SELECT id, sender, subject, score, verdict, details, created_at
  FROM incidents
  ORDER BY created_at DESC
  LIMIT ?
`);

const getIncidentByIdStmt = db.prepare(`
  SELECT id, sender, subject, score, verdict, details, created_at
  FROM incidents
  WHERE id = ?
`);

/**
 * Persists or updates an incident record into SQLite.
 * Serializes details to JSON string if provided as an object.
 */
export function saveIncident(incident: IncidentRecord): void {
  const detailsStr = typeof incident.details === 'string'
    ? incident.details
    : JSON.stringify(incident.details ?? {});

  saveIncidentStmt.run(
    incident.id,
    incident.sender ?? null,
    incident.subject ?? null,
    incident.score,
    incident.verdict,
    detailsStr,
    incident.created_at ?? null
  );
}

/**
 * Immediately creates a pending incident row with verdict = 'PROCESSING'.
 */
export function createPendingIncident(id: string, sender: string = 'Pending Analysis...', subject: string = 'Processing .eml upload...'): void {
  saveIncident({
    id,
    sender,
    subject,
    score: 0,
    verdict: 'PROCESSING',
    details: {
      status: 'PROCESSING',
      message: 'Email enqueued for asynchronous threat evaluation'
    }
  });
}

/**
 * Retrieves the most recent incidents ordered by creation time descending.
 * @param limit Maximum number of records to return (defaults to 20)
 */
export function getRecentIncidents(limit: number = 20): IncidentRecord[] {
  return getRecentIncidentsStmt.all(limit) as IncidentRecord[];
}

/**
 * Retrieves a single incident by its unique ID.
 * @param id Unique incident identifier
 */
export function getIncidentById(id: string): IncidentRecord | undefined {
  return getIncidentByIdStmt.get(id) as IncidentRecord | undefined;
}

/**
 * Utility helper to parse the JSON stored in incident.details.
 */
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

/**
 * Closes the SQLite database connection.
 */
export function closeDatabase(): void {
  db.close();
}

export default db;
