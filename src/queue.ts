import fs from 'fs';
import { EventEmitter } from 'events';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { analyzeEmail } from './analyzer';
import { saveIncident } from './db';

export interface AnalysisJob {
  id: string;
  filePath: string;
  originalName?: string;
  enqueuedAt: number;
  tenantId?: string;
}

export interface QueueStats {
  mode: 'bullmq' | 'memory';
  queued: number;
  active: number;
  concurrency: number;
  completedTotal: number;
  failedTotal: number;
}

export const incidentEvents = new EventEmitter();

async function processJobPayload(job: AnalysisJob): Promise<{ verdict: string; score: number }> {
  const queueWaitMs = Date.now() - job.enqueuedAt;
  try {
    const emlBuffer = await fs.promises.readFile(job.filePath);
    const analysis = await analyzeEmail(emlBuffer, job.id);

    await saveIncident({
      id: analysis.id,
      tenant_id: job.tenantId || 'default',
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
      details: {
        ...analysis.details,
        queueWaitMs
      }
    });

    incidentEvents.emit('incident:completed', {
      id: analysis.id,
      verdict: analysis.verdict,
      score: analysis.score,
      campaign_id: analysis.campaign_id
    });

    return { verdict: analysis.verdict, score: analysis.score };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error during job execution';
    await saveIncident({
      id: job.id,
      tenant_id: job.tenantId || 'default',
      score: 0,
      verdict: 'CLEAN',
      details: {
        status: 'FAILED',
        error: message,
        message: 'Error occurred during asynchronous email parsing and analysis.'
      }
    });
    throw error;
  } finally {
    try {
      if (fs.existsSync(job.filePath)) {
        await fs.promises.unlink(job.filePath);
      }
    } catch {
      // ignore cleanup error
    }
  }
}

export class AnalysisQueue {
  private queue: AnalysisJob[] = [];
  private activeWorkers: number = 0;
  private concurrency: number;
  private completedTotal: number = 0;
  private failedTotal: number = 0;
  private bullQueue: Queue<AnalysisJob> | null = null;
  private bullWorker: Worker<AnalysisJob> | null = null;

  constructor(concurrency?: number, startWorker: boolean = true) {
    const envConcurrency = parseInt(process.env.QUEUE_CONCURRENCY || '5', 10);
    this.concurrency = concurrency || (isNaN(envConcurrency) ? 5 : envConcurrency);

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
      this.bullQueue = new Queue<AnalysisJob>('phishtank-analysis', {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 500,
          removeOnFail: 200
        }
      });

      if (startWorker) {
        this.startBullWorker(redisUrl);
      }
      console.log(`🚀 Distributed BullMQ Queue initialized (concurrency=${this.concurrency})`);
    } else {
      console.log(`🚀 In-Memory Analysis Queue initialized (concurrency=${this.concurrency})`);
    }
  }

  public startBullWorker(redisUrl: string): void {
    if (this.bullWorker) return;
    const workerConn = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.bullWorker = new Worker<AnalysisJob>(
      'phishtank-analysis',
      async (job: Job<AnalysisJob>) => {
        const res = await processJobPayload(job.data);
        this.completedTotal++;
        return res;
      },
      { connection: workerConn, concurrency: this.concurrency }
    );
    this.bullWorker.on('failed', () => {
      this.failedTotal++;
    });
  }

  async enqueue(job: AnalysisJob): Promise<void> {
    if (this.bullQueue) {
      await this.bullQueue.add('analyze-eml', job, { jobId: job.id });
      return;
    }
    this.queue.push(job);
    setImmediate(() => this.processNext());
  }

  private processNext(): void {
    while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;

      this.activeWorkers++;
      processJobPayload(job)
        .then(() => {
          this.completedTotal++;
        })
        .catch(() => {
          this.failedTotal++;
        })
        .finally(() => {
          this.activeWorkers--;
          this.processNext();
        });
    }
  }

  getStats(): QueueStats {
    return {
      mode: this.bullQueue ? 'bullmq' : 'memory',
      queued: this.queue.length,
      active: this.activeWorkers,
      concurrency: this.concurrency,
      completedTotal: this.completedTotal,
      failedTotal: this.failedTotal
    };
  }
}

const isApiOnly = process.env.ROLE === 'api';
export const analysisQueue = new AnalysisQueue(undefined, !isApiOnly);
export default analysisQueue;
