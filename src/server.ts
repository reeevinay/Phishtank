import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import client from 'prom-client';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  createPendingIncident,
  getRecentIncidents,
  getIncidentById,
  parseIncidentDetails,
  saveIncident,
  getProvenanceSubgraph,
  getCampaigns,
  isPostgresEnabled
} from './db';
import { analysisQueue, incidentEvents } from './queue';
import { cacheService } from './cache';
import { analyzeDomEmail } from './analyzer';
import { warmMlEngine } from './mlClient';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Prometheus Metrics
client.collectDefaultMetrics({ prefix: 'phishtank_' });
const verdictCounter = new client.Counter({
  name: 'phishtank_verdicts_total',
  help: 'Total analyzed email verdicts',
  labelNames: ['verdict']
});

const uploadDir = process.env.UPLOAD_DIR || path.resolve(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting on API routes
app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_RPM || 180),
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Optional API Key & Multi-Tenant Middleware
function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requiredKey = process.env.API_KEY;
  if (requiredKey && req.path.startsWith('/api/v1/') && req.path !== '/api/v1/health') {
    const provided = req.header('x-api-key');
    if (provided !== requiredKey) {
      res.status(401).json({ success: false, error: 'Unauthorized: invalid or missing x-api-key' });
      return;
    }
  }
  next();
}
app.use(tenantMiddleware);

// Serve built React SPA (frontend/dist) if available, else fallback to public/
const frontendDist = path.resolve(__dirname, '..', 'frontend', 'dist');
const publicDir = path.resolve(__dirname, '..', 'public');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}
app.use(express.static(publicDir));

const testSamplesDir = path.resolve(__dirname, '..', 'test-samples');
app.use('/test-samples', express.static(testSamplesDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.eml';
    cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.get('/api/v1/health', (_req: Request, res: Response) => {
  warmMlEngine();
  res.json({
    status: 'ok',
    service: 'PhishTank-NS Neuro-Symbolic Threat Analyzer',
    database: isPostgresEnabled ? 'postgresql+pgvector' : 'sqlite-wal',
    timestamp: new Date().toISOString(),
    queue: analysisQueue.getStats(),
    cache: cacheService.getMetrics()
  });
});

app.get('/api/v1/metrics', (_req: Request, res: Response) => {
  res.json({
    success: true,
    database: isPostgresEnabled ? 'postgresql+pgvector' : 'sqlite-wal',
    queue: analysisQueue.getStats(),
    cache: cacheService.getMetrics()
  });
});

/**
 * Server-Sent Events (SSE) stream for real-time SOC dashboard updates
 */
app.get('/api/v1/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onCompleted = (payload: unknown) => {
    res.write(`event: incident\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  incidentEvents.on('incident:completed', onCompleted);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    incidentEvents.off('incident:completed', onCompleted);
  });
});

app.post('/api/v1/analyze', upload.any(), async (req: Request, res: Response): Promise<void> => {
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

    const tenantId = req.header('x-tenant-id') || 'default';
    const incidentId = `inc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    await createPendingIncident(
      incidentId,
      'Pending Analysis...',
      file.originalname ? `File: ${file.originalname}` : 'Uploaded .eml',
      tenantId
    );

    await analysisQueue.enqueue({
      id: incidentId,
      filePath: file.path,
      originalName: file.originalname,
      enqueuedAt: Date.now(),
      tenantId
    });

    res.status(202).json({
      success: true,
      status: 'PROCESSING',
      id: incidentId,
      message: 'Email enqueued for distributed Neuro-Symbolic evaluation'
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error during upload ingestion';
    res.status(500).json({ success: false, error: message });
  }
});

app.post('/api/v1/analyze-dom', async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ success: false, error: 'Invalid JSON payload.' });
      return;
    }

    const tenantId = req.header('x-tenant-id') || 'default';
    const analysis = await analyzeDomEmail(payload);

    await saveIncident({
      id: analysis.id,
      tenant_id: tenantId,
      sender: analysis.sender,
      subject: analysis.subject,
      score: analysis.score,
      belief_low: analysis.belief_low,
      plausibility_high: analysis.plausibility_high,
      epistemic_uncertainty: analysis.epistemic_uncertainty,
      conflict_k: analysis.conflict_k,
      verdict: analysis.verdict,
      campaign_id: analysis.campaign_id,
      embedding: analysis.embedding,
      details: analysis.details
    });

    verdictCounter.labels(analysis.verdict).inc();
    incidentEvents.emit('incident:completed', {
      id: analysis.id,
      verdict: analysis.verdict,
      score: analysis.score,
      campaign_id: analysis.campaign_id
    });

    res.status(200).json({
      success: true,
      id: analysis.id,
      score: analysis.score,
      belief_low: analysis.belief_low,
      plausibility_high: analysis.plausibility_high,
      epistemic_uncertainty: analysis.epistemic_uncertainty,
      conflict_k: analysis.conflict_k,
      verdict: analysis.verdict,
      campaign_id: analysis.campaign_id,
      reasons: analysis.reasons,
      incident: analysis
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error during DOM analysis';
    res.status(500).json({ success: false, error: message });
  }
});

app.get('/api/v1/incidents', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const tenantId = req.header('x-tenant-id');
    const records = await getRecentIncidents(isNaN(limit) ? 20 : limit, tenantId);

    const formatted = records.map((rec) => ({
      ...rec,
      details: parseIncidentDetails(rec.details)
    }));

    res.json({ success: true, count: formatted.length, incidents: formatted });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    res.status(500).json({ success: false, error: message });
  }
});

app.get('/api/v1/incidents/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const incident = await getIncidentById(id);

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

app.get('/api/v1/graph/:incidentId', async (req: Request, res: Response) => {
  try {
    const incidentId = Array.isArray(req.params.incidentId) ? req.params.incidentId[0] : req.params.incidentId;
    const graph = await getProvenanceSubgraph(incidentId);
    res.json({ success: true, ...graph });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Graph query error';
    res.status(500).json({ success: false, error: message });
  }
});

app.get('/api/v1/campaigns', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const campaigns = await getCampaigns(isNaN(limit) ? 20 : limit);
    res.json({ success: true, count: campaigns.length, campaigns });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Campaign query error';
    res.status(500).json({ success: false, error: message });
  }
});

app.get('/api/v1/benchmarks', (_req: Request, res: Response) => {
  try {
    const benchDir = path.resolve(__dirname, '..', 'benchmarks');
    const hfPath = path.join(benchDir, 'hf_results.json');
    const abPath = path.join(benchDir, 'results.json');
    const hf = fs.existsSync(hfPath) ? JSON.parse(fs.readFileSync(hfPath, 'utf-8')) : null;
    const ablation = fs.existsSync(abPath) ? JSON.parse(fs.readFileSync(abPath, 'utf-8')) : null;
    res.json({ success: true, huggingface: hf, ablation });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Benchmark read error';
    res.status(500).json({ success: false, error: message });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🛡️  PhishTank-NS API & SOC Dashboard running at http://localhost:${PORT}`);
    console.log(`📁 Upload buffer directory: ${uploadDir}`);
    warmMlEngine();
  });
}

export default app;
