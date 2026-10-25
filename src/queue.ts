import fs from 'fs';
import { analyzeEmail } from './analyzer';
import { saveIncident } from './db';

export interface AnalysisJob {
  id: string;
  filePath: string;
  originalName?: string;
  enqueuedAt: number;
}

export interface QueueStats {
  queued: number;
  active: number;
  concurrency: number;
  completedTotal: number;
  failedTotal: number;
}

export class AnalysisQueue {
  private queue: AnalysisJob[] = [];
  private activeWorkers: number = 0;
  private concurrency: number;
  private completedTotal: number = 0;
  private failedTotal: number = 0;

  constructor(concurrency?: number) {
    const envConcurrency = parseInt(process.env.QUEUE_CONCURRENCY || '5', 10);
    this.concurrency = concurrency || (isNaN(envConcurrency) ? 5 : envConcurrency);
    console.log(`🚀 Analysis Queue initialized with concurrency = ${this.concurrency}`);
  }

  /**
   * Enqueues an email analysis job and immediately triggers worker processing.
   */
  enqueue(job: AnalysisJob): void {
    this.queue.push(job);
    // Asynchronously kick off processing without blocking the caller
    setImmediate(() => this.processNext());
  }

  /**
   * Dispatches pending jobs to available workers up to the concurrency limit.
   */
  private processNext(): void {
    while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;

      this.activeWorkers++;
      this.executeJob(job)
        .catch((err) => {
          console.error(`❌ Unexpected error processing job ${job.id}:`, err);
        })
        .finally(() => {
          this.activeWorkers--;
          this.processNext();
        });
    }
  }

  /**
   * Executes a single analysis job:
   * 1. Reads raw .eml from disk
   * 2. Runs threat analyzer (utilizing Redis/in-memory cache)
   * 3. Persists final score, verdict, and rules into SQLite
   * 4. Deletes the temporary file from disk in finally block
   */
  private async executeJob(job: AnalysisJob): Promise<void> {
    const queueWaitMs = Date.now() - job.enqueuedAt;
    console.log(`[Queue] Processing job ${job.id} (Waited in queue: ${queueWaitMs}ms)`);

    try {
      // 1. Read EML buffer from disk
      const emlBuffer = await fs.promises.readFile(job.filePath);

      // 2. Run threat analysis
      const analysis = await analyzeEmail(emlBuffer, job.id);

      // 3. Persist final incident status in SQLite
      saveIncident({
        id: analysis.id,
        sender: analysis.sender,
        subject: analysis.subject,
        score: analysis.score,
        verdict: analysis.verdict,
        details: {
          ...analysis.details,
          queueWaitMs
        }
      });

      this.completedTotal++;
      console.log(`[Queue] ✓ Finished job ${job.id} -> Verdict: [${analysis.verdict}] Score: ${analysis.score}/100 (Took: ${analysis.details.processingTimeMs}ms)`);
    } catch (error: unknown) {
      this.failedTotal++;
      const message = error instanceof Error ? error.message : 'Unknown error during job execution';
      console.error(`[Queue] ❌ Failed job ${job.id}:`, message);

      // Ensure the record is not stuck in PROCESSING
      saveIncident({
        id: job.id,
        score: 0,
        verdict: 'CLEAN',
        details: {
          status: 'FAILED',
          error: message,
          message: 'Error occurred during asynchronous email parsing and analysis.'
        }
      });
    } finally {
      // 4. Auto-delete temporary .eml file from disk
      try {
        if (fs.existsSync(job.filePath)) {
          await fs.promises.unlink(job.filePath);
          console.log(`[Queue] 🗑️  Cleaned up temp upload file: ${job.filePath}`);
        }
      } catch (cleanupErr) {
        console.warn(`[Queue] Could not delete temp file ${job.filePath}:`, cleanupErr);
      }
    }
  }

  /**
   * Returns real-time queue performance and capacity stats.
   */
  getStats(): QueueStats {
    return {
      queued: this.queue.length,
      active: this.activeWorkers,
      concurrency: this.concurrency,
      completedTotal: this.completedTotal,
      failedTotal: this.failedTotal
    };
  }
}

export const analysisQueue = new AnalysisQueue();
export default analysisQueue;
