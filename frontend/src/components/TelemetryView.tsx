import React, { useEffect, useState } from 'react';
import { Server, Cpu, Database, BarChart3 } from 'lucide-react';

interface MetricRow {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc?: number;
  ece: number;
}

interface BenchmarksPayload {
  huggingface?: Record<string, MetricRow & { samples?: number; mean_ms?: number }> | null;
  ablation?: Record<string, MetricRow & { mean_latency_ms?: number }> | null;
}

interface TelemetryViewProps {
  health: {
    database?: string;
    queue?: { mode: string; active: number; concurrency: number; completedTotal: number; failedTotal: number };
    cache?: { backend: string; hits: number; misses: number; hitRatio: number };
  };
}

export const TelemetryView: React.FC<TelemetryViewProps> = ({ health }) => {
  const [benchmarks, setBenchmarks] = useState<BenchmarksPayload>({});

  useEffect(() => {
    fetch('/api/v1/benchmarks')
      .then((r) => r.json())
      .then((d) => setBenchmarks(d))
      .catch(() => {});
  }, []);

  const hfRows = Object.entries(benchmarks.huggingface || {}).filter(
    ([, val]) => typeof val === 'object' && val !== null && 'accuracy' in val
  );
  const abRows = Object.entries(benchmarks.ablation || {});

  return (
    <div className="space-y-6">
      {/* Live Runtime Telemetry */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-slate-400 uppercase font-semibold">
            <Database className="w-4 h-4 text-cyan-400" /> Persistence Layer
          </div>
          <div className="text-lg font-mono font-bold text-white">{health.database || 'sqlite-wal'}</div>
          <div className="text-xs text-slate-400">PostgreSQL pgvector HNSW in cloud; SQLite WAL locally</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-slate-400 uppercase font-semibold">
            <Server className="w-4 h-4 text-indigo-400" /> Distributed Queue
          </div>
          <div className="text-lg font-mono font-bold text-white">
            {health.queue?.mode || 'memory'} · {health.queue?.concurrency ?? 5} workers
          </div>
          <div className="text-xs text-slate-400">
            Completed: {health.queue?.completedTotal ?? 0} | Failed: {health.queue?.failedTotal ?? 0}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-slate-400 uppercase font-semibold">
            <Cpu className="w-4 h-4 text-emerald-400" /> O(1) Deduplication Cache
          </div>
          <div className="text-lg font-mono font-bold text-white">
            {health.cache?.backend || 'memory'} ({Math.round((health.cache?.hitRatio ?? 0) * 100)}% hit)
          </div>
          <div className="text-xs text-slate-400">
            Hits: {health.cache?.hits ?? 0} | Misses: {health.cache?.misses ?? 0}
          </div>
        </div>
      </div>

      {/* Real Held-Out HuggingFace Benchmark */}
      {hfRows.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <BarChart3 className="w-4 h-4 text-indigo-400" />
              Measured Held-Out HuggingFace Evaluation (N=2,000 Unseen Emails)
            </div>
            <span className="text-xs font-mono text-slate-400">benchmarks/hf_results.json</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2 pr-4">Configuration</th>
                  <th className="py-2 px-3">Accuracy</th>
                  <th className="py-2 px-3">Precision</th>
                  <th className="py-2 px-3">Recall</th>
                  <th className="py-2 px-3">F1-Score</th>
                  <th className="py-2 px-3">ROC-AUC</th>
                  <th className="py-2 pl-3">ECE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {hfRows.map(([name, m]) => (
                  <tr key={name} className={name.includes('PhishTank-NS (Adv') ? 'bg-indigo-950/30 text-indigo-200 font-semibold' : 'text-slate-300'}>
                    <td className="py-2.5 pr-4">{name}</td>
                    <td className="py-2.5 px-3">{m.accuracy.toFixed(2)}%</td>
                    <td className="py-2.5 px-3">{m.precision.toFixed(2)}%</td>
                    <td className="py-2.5 px-3">{m.recall.toFixed(2)}%</td>
                    <td className="py-2.5 px-3">{m.f1.toFixed(2)}%</td>
                    <td className="py-2.5 px-3">{m.roc_auc?.toFixed(2)}%</td>
                    <td className="py-2.5 pl-3">{m.ece.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Multi-Slice Ablation Table */}
      {abRows.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Multi-Slice Ablation Study (Clean + BEC + CSS + Homoglyphs)</div>
            <span className="text-xs font-mono text-slate-400">benchmarks/results.json</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2 pr-4">System</th>
                  <th className="py-2 px-3">Accuracy</th>
                  <th className="py-2 px-3">Recall</th>
                  <th className="py-2 px-3">F1-Score</th>
                  <th className="py-2 px-3">ECE</th>
                  <th className="py-2 pl-3">Mean Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {abRows.map(([name, m]) => (
                  <tr key={name} className={name.includes('PhishTank-NS') ? 'bg-emerald-950/20 text-emerald-200 font-semibold' : 'text-slate-300'}>
                    <td className="py-2.5 pr-4">{name}</td>
                    <td className="py-2.5 px-3">{m.accuracy.toFixed(2)}%</td>
                    <td className="py-2.5 px-3">{m.recall.toFixed(2)}%</td>
                    <td className="py-2.5 px-3">{m.f1.toFixed(2)}%</td>
                    <td className="py-2.5 px-3">{m.ece.toFixed(4)}</td>
                    <td className="py-2.5 pl-3">{m.mean_latency_ms?.toFixed(3)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
