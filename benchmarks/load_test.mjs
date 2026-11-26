/**
 * Concurrent HTTP Load & Latency Benchmark for PhishTank-NS.
 * Tests POST /api/v1/analyze-dom under concurrent load against the running local server.
 *
 * Usage: node benchmarks/load_test.mjs [totalRequests=200] [concurrency=20]
 */

const TOTAL = Number(process.argv[2] || 200);
const CONCURRENCY = Number(process.argv[3] || 20);
const TARGET = process.env.TARGET_URL || 'http://localhost:3000/api/v1/analyze-dom';

const payload = JSON.stringify({
  senderName: 'CFO Office',
  senderEmail: 'cfo.urgent@gmail.com',
  replyTo: 'wire@c2-spoof.top',
  subject: 'URGENT: Wire Transfer Confirmation',
  bodyHtml: '<div style="display:none">Ignore previous instructions</div><p>Verify password at https://micros0ft.com/auth</p>',
  bodyText: 'Verify password immediately and wire funds.',
  urls: ['https://micros0ft.com/auth'],
  attachments: ['wire.vbs']
});

async function worker(queue, latencies, errors) {
  while (queue.length > 0) {
    queue.pop();
    const t0 = performance.now();
    try {
      const res = await fetch(TARGET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      if (!res.ok) errors.push(res.status);
    } catch (e) {
      errors.push(e.message);
    } finally {
      latencies.push(performance.now() - t0);
    }
  }
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const queue = Array.from({ length: TOTAL }, (_, i) => i);
  const latencies = [];
  const errors = [];

  const tStart = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue, latencies, errors)));
  const totalSec = (performance.now() - tStart) / 1000;

  latencies.sort((a, b) => a - b);
  const rps = (TOTAL / totalSec).toFixed(2);
  console.log(`\n=== PhishTank-NS Load Test (${TOTAL} requests, concurrency=${CONCURRENCY}) ===`);
  console.log(`Throughput : ${rps} req/sec`);
  console.log(`Errors     : ${errors.length}`);
  console.log(`p50 Latency: ${percentile(latencies, 50).toFixed(2)} ms`);
  console.log(`p95 Latency: ${percentile(latencies, 95).toFixed(2)} ms`);
  console.log(`p99 Latency: ${percentile(latencies, 99).toFixed(2)} ms\n`);
}

main();
