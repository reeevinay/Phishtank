import React from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, Link2, Paperclip, Clock } from 'lucide-react';

interface SimpleViewProps {
  sender: string;
  subject: string;
  score: number;
  verdict: 'PROCESSING' | 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
  reasons?: string[];
  urls?: string[];
  adversarialFlags?: string[];
  processingTimeMs?: number;
  cached?: boolean;
}

export const SimpleView: React.FC<SimpleViewProps> = ({
  sender,
  subject,
  score,
  verdict,
  reasons = [],
  urls = [],
  adversarialFlags = [],
  processingTimeMs,
  cached
}) => {
  const config =
    verdict === 'MALICIOUS'
      ? {
          title: 'High-Risk Phishing / Spoof Detected',
          action: 'Quarantine this email. Do not click links, download attachments, or reply.',
          border: 'border-rose-500/40 bg-rose-950/20',
          badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          bar: 'bg-rose-500',
          icon: <ShieldAlert className="w-8 h-8 text-rose-400 shrink-0" />
        }
      : verdict === 'SUSPICIOUS'
      ? {
          title: 'Suspicious Email — Verify Before Acting',
          action: 'Confirm the sender through a separate channel (phone/Slack) before taking action.',
          border: 'border-amber-500/40 bg-amber-950/20',
          badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          bar: 'bg-amber-500',
          icon: <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />
        }
      : {
          title: 'Email Appears Safe',
          action: 'No spoofing, malicious links, or hidden manipulation detected.',
          border: 'border-emerald-500/40 bg-emerald-950/20',
          badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          bar: 'bg-emerald-500',
          icon: <ShieldCheck className="w-8 h-8 text-emerald-400 shrink-0" />
        };

  return (
    <div className="space-y-4">
      {/* Executive Verdict Card */}
      <div className={`rounded-2xl border p-5 space-y-4 ${config.border}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            {config.icon}
            <div>
              <span className={`inline-block px-2.5 py-0.5 text-xs font-semibold rounded-full border mb-1.5 ${config.badge}`}>
                {verdict === 'CLEAN' ? 'SAFE' : verdict}
              </span>
              <h3 className="text-lg font-bold text-white">{config.title}</h3>
              <p className="text-sm text-slate-300 mt-1">{config.action}</p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-3xl font-bold font-mono text-white">{score}</div>
            <div className="text-xs text-slate-400">Risk / 100</div>
          </div>
        </div>

        {/* Clean Progress Bar */}
        <div className="h-2.5 w-full rounded-full bg-slate-900 overflow-hidden">
          <div className={`h-full transition-all duration-300 ${config.bar}`} style={{ width: `${Math.max(4, score)}%` }} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-1">
          <span>From: <span className="text-slate-200 font-mono">{sender}</span></span>
          {processingTimeMs !== undefined && (
            <span className="inline-flex items-center gap-1 font-mono">
              <Clock className="w-3.5 h-3.5" /> {processingTimeMs} ms {cached ? '(Cached)' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Plain-English Findings */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
          Why This Verdict Was Given
        </div>
        {reasons.length === 0 ? (
          <p className="text-sm text-emerald-400">
            All sender authentication, link safety, and language checks passed cleanly for "{subject}".
          </p>
        ) : (
          <ul className="space-y-2 text-sm text-slate-200">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2.5 bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80">
                <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 text-xs flex items-center justify-center shrink-0 mt-0.5 font-mono">
                  {i + 1}
                </span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        {adversarialFlags.length > 0 && (
          <div className="pt-2 border-t border-slate-800 text-xs text-rose-300">
            Hidden manipulation detected &amp; neutralized: <span className="font-mono">{adversarialFlags.join(', ')}</span>
          </div>
        )}
      </div>

      {/* Extracted Links */}
      {urls.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" /> Links Found in Email ({urls.length})
          </div>
          <div className="space-y-1.5">
            {urls.map((u, idx) => (
              <div key={idx} className="text-xs font-mono text-slate-300 bg-slate-950/70 px-3 py-2 rounded-lg border border-slate-800 truncate">
                {u}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
