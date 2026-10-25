import express, { Request, Response } from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createPendingIncident, getRecentIncidents, getIncidentById, parseIncidentDetails, saveIncident } from './db';
import { analysisQueue } from './queue';
import { cacheService } from './cache';
import { analyzeDomEmail } from './analyzer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure temporary uploads directory exists
const uploadDir = process.env.UPLOAD_DIR || path.resolve(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend dashboard from public/
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Serve test samples statically for dashboard testing
const testSamplesDir = path.resolve(__dirname, '..', 'test-samples');
app.use('/test-samples', express.static(testSamplesDir));

// Configure disk storage for non-blocking file streaming and low memory footprint
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.eml';
    const unique = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB max per email file
});

/**
 * Health check & runtime status endpoint
 */
app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'PhishTank Email Threat Analyzer',
    timestamp: new Date().toISOString(),
    queue: analysisQueue.getStats(),
    cache: cacheService.getMetrics()
  });
});

/**
 * Real-time metrics endpoint for dashboard telemetry
 */
app.get('/api/v1/metrics', (_req: Request, res: Response) => {
  res.json({
    success: true,
    queue: analysisQueue.getStats(),
    cache: cacheService.getMetrics()
  });
});

/**
 * POST /api/v1/analyze:
 * Decoupled non-blocking endpoint:
 * 1. Streams file directly to disk storage in /uploads
 * 2. Writes initial row to SQLite with verdict = 'PROCESSING'
 * 3. Enqueues job to async worker pool
 * 4. Immediately returns HTTP 202 Accepted
 */
app.post('/api/v1/analyze', upload.any(), (req: Request, res: Response): void => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    const file = files && files.length > 0 ? files[0] : (req as unknown as { file?: Express.Multer.File }).file;

    if (!file || !file.path) {
      res.status(400).json({
        success: false,
        error: 'No email file uploaded. Please upload a .eml file via multipart/form-data with field "file" or "email".'
      });
      return;
    }

    // Generate unique incident identifier
    const incidentId = `inc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // 1. Immediately create pending incident row in SQLite with verdict = 'PROCESSING'
    createPendingIncident(
      incidentId,
      'Pending Analysis...',
      file.originalname ? `File: ${file.originalname}` : 'Uploaded .eml'
    );

    // 2. Enqueue analysis job to worker pool
    analysisQueue.enqueue({
      id: incidentId,
      filePath: file.path,
      originalName: file.originalname,
      enqueuedAt: Date.now()
    });

    // 3. Immediately return HTTP 202 Accepted without blocking
    res.status(202).json({
      success: true,
      status: 'PROCESSING',
      id: incidentId,
      message: 'Email enqueued for asynchronous threat evaluation'
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error during upload ingestion';
    console.error('Upload ingestion error:', error);
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

/**
 * POST /api/v1/analyze-dom:
 * Analyzes open email data scraped directly from Gmail / Outlook / Mock Webmail DOM.
 * Saves the incident to SQLite and returns the threat evaluation result.
 */
app.post('/api/v1/analyze-dom', async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Invalid JSON payload. Expected email DOM structure.'
      });
      return;
    }

    const analysis = await analyzeDomEmail(payload);

    // Save incident to SQLite database
    saveIncident({
      id: analysis.id,
      sender: analysis.sender,
      subject: analysis.subject,
      score: analysis.score,
      verdict: analysis.verdict,
      details: analysis.details
    });

    res.status(200).json({
      success: true,
      id: analysis.id,
      score: analysis.score,
      verdict: analysis.verdict,
      reasons: analysis.reasons,
      incident: analysis
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error during DOM analysis';
    console.error('DOM analysis error:', error);
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

/**
 * GET /api/v1/incidents: Returns recent incidents from SQLite
 */
app.get('/api/v1/incidents', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const records = getRecentIncidents(isNaN(limit) ? 20 : limit);

    const formatted = records.map((rec) => ({
      ...rec,
      details: parseIncidentDetails(rec.details)
    }));

    res.json({
      success: true,
      count: formatted.length,
      incidents: formatted
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    console.error('Error fetching incidents:', error);
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

/**
 * GET /api/v1/incidents/:id: Returns single incident by ID.
 * Polled by frontend while status is PROCESSING until finished.
 */
app.get('/api/v1/incidents/:id', (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const incident = getIncidentById(id);

    if (!incident) {
      res.status(404).json({ success: false, error: 'Incident not found' });
      return;
    }

    res.json({
      success: true,
      incident: {
        ...incident,
        details: parseIncidentDetails(incident.details)
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    res.status(500).json({ success: false, error: message });
  }
});

// Start listening if run directly
export const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🛡️  PhishTank API & Dashboard running at http://localhost:${PORT}`);
  console.log(`📁 Upload buffer directory: ${uploadDir}`);
});

export default app;
