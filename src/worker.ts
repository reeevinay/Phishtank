import dotenv from 'dotenv';
dotenv.config();

import { AnalysisQueue } from './queue';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('❌ REDIS_URL is required to run standalone distributed worker.');
  process.exit(1);
}

const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || '10', 10);
new AnalysisQueue(concurrency, true);
console.log(`⚙️  PhishTank-NS Standalone Worker online (concurrency=${concurrency})`);
