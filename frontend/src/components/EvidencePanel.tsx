import React, { useRef } from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle2, EyeOff, Download } from 'lucide-react';

interface EvidenceSource {
  source: string;
  m_malicious: number;
  m_benign: number;
  m_theta: number;
  rationale: string;
}

interface EvidencePanelProps {
  score: number;
  verdict: string;
  beliefLow?: number;
  plausibilityHigh?: number;
  uncertainty?: number;
  conflictK?: number;
  adversarialFlags?: string[];
  hiddenTextPreview?: string;
  evidenceSources?: EvidenceSource[];
  reasons?: string[];
}

export const EvidencePanel: React.FC<EvidencePanelProps> = ({
  score,
  verdict,
  beliefLow = 0,
  plausibilityHigh = 1,
  uncertainty = 0,
  conflictK = 0,
  adversarialFlags = [],
  hiddenTextPreview = '',
  evidenceSources = [],
  reasons = []
}) => {
  const belPct = Math.round(beliefLow * 100);
  const plPct = Math.round(plausibilityHigh * 100);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const exportChartSvg = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgRef.current);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phishtank-evidence-${verdict.toLowerCase()}-${score}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Dempster-Shafer Risk Interval */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
            Dempster-Shafer Risk Interval [Bel(M), Pl(M)]
          </span>
          <span className="text-xs font-mono text-indigo-300">
            Fused Pignistic Score: {score}/100 ({verdict})
          </span>
        </div>

        <div className="relative h-5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="absolute top-0 bottom-0 bg-amber-500/35 border-x border-amber-400"
            style={{ left: `${belPct}%`, width: `${Math.max(2, plPct - belPct)}%` }}
            title="Epistemic Uncertainty Interval"
          />
          <div
            className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-indigo-500 to-rose-500"
            style={{ width: `${belPct}%` }}
            title="Belief(Malicious)"
          />
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs font-mono">
          <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
            <div className="text-slate-400">Belief Bel(M)</div>
            <div className="text-sm font-semibold text-rose-400">{(beliefLow * 100).toFixed(1)}%</div>
          </div>
          <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
            <div className="text-slate-400">Uncertainty m(Θ)</div>
            <div className="text-sm font-semibold text-amber-400">{(uncertainty * 100).toFixed(1)}%</div>
          </div>
          <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
            <div className="text-slate-400">Conflict K</div>
            <div className={`text-sm font-semibold ${conflictK >= 0.45 ? 'text-rose-400' : 'text-cyan-400'}`}>
              {conflictK.toFixed(3)} {conflictK >= 0.45 ? '⚠' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Adversarial De-obfuscation Alert */}
      {(adversarialFlags.length > 0 || hiddenTextPreview) && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2 text-rose-300 text-xs font-semibold uppercase">
            <EyeOff className="w-4 h-4" />
            Adversarial Obfuscation Neutralized
          </div>
          <div className="flex flex-wrap gap-1.5">
            {adversarialFlags.map((f) => (
              <span key={f} className="px-2 py-0.5 text-xs rounded bg-rose-500/20 text-rose-200 border border-rose-500/30 font-mono">
                {f}
              </span>
            ))}
          </div>
          {hiddenTextPreview && (
            <div className="text-xs font-mono bg-slate-950/80 p-2 rounded border border-slate-800 text-slate-300">
              <span className="text-rose-400">Stripped hidden CSS payload: </span>
              {hiddenTextPreview}
            </div>
          )}
        </div>
      )}

      {/* Per-Source BPA Breakdown + Exportable Visual Plot */}
      {evidenceSources.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              Neuro-Symbolic Evidence Mass Plot (BPA)
            </span>
            <button
              onClick={exportChartSvg}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              Export Plot (SVG)
            </button>
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 560 ${evidenceSources.length * 36 + 44}`}
            className="w-full bg-slate-950/70 rounded-lg border border-slate-800/80"
          >
            <rect width="560" height={evidenceSources.length * 36 + 44} fill="#020617" />
            {evidenceSources.map((src, i) => {
              const y = 14 + i * 36;
              const barX = 135;
              const barW = 405;
              const wMal = src.m_malicious * barW;
              const wBen = src.m_benign * barW;
              const wTh = src.m_theta * barW;
              return (
                <g key={src.source}>
                  <text x={10} y={y + 15} fill="#cbd5e1" fontSize="11" fontFamily="monospace">
                    {src.source}
                  </text>
                  <rect x={barX} y={y + 3} width={wMal} height={16} fill="#ef4444" rx={2} />
                  <rect x={barX + wMal} y={y + 3} width={wBen} height={16} fill="#10b981" />
                  <rect x={barX + wMal + wBen} y={y + 3} width={wTh} height={16} fill="#f59e0b" rx={2} />
                </g>
              );
            })}
            <g transform={`translate(135, ${evidenceSources.length * 36 + 22})`}>
              <rect width="10" height="10" fill="#ef4444" rx="2" />
              <text x="15" y="9" fill="#94a3b8" fontSize="10">m(Malicious)</text>
              <rect x="100" width="10" height="10" fill="#10b981" rx="2" />
              <text x="115" y="9" fill="#94a3b8" fontSize="10">m(Benign)</text>
              <rect x="190" width="10" height="10" fill="#f59e0b" rx="2" />
              <text x="205" y="9" fill="#94a3b8" fontSize="10">m(Θ Uncertainty)</text>
            </g>
          </svg>

          <div className="space-y-2">
            {evidenceSources.map((src) => (
              <div key={src.source} className="text-xs bg-slate-950/60 border border-slate-800 rounded-lg p-2.5">
                <div className="flex justify-between font-mono mb-1">
                  <span className="text-indigo-300 font-semibold">{src.source}</span>
                  <span className="text-slate-400">
                    m(M)={src.m_malicious.toFixed(2)} | m(B)={src.m_benign.toFixed(2)} | m(Θ)={src.m_theta.toFixed(2)}
                  </span>
                </div>
                <div className="text-slate-400">{src.rationale}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Triggered Explanations */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
        <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
          Explainable Triage Reasons
        </div>
        {reasons.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> No malicious indicators triggered.
          </div>
        ) : (
          <ul className="space-y-1.5 text-xs text-slate-300">
            {reasons.map((r, idx) => (
              <li key={idx} className="flex items-start gap-2">
                {verdict === 'MALICIOUS' ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                )}
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
