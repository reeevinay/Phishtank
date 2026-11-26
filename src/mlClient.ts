import axios from 'axios';

export interface SymbolicSignalsPayload {
  spf_fail: boolean;
  spf_pass: boolean;
  dkim_fail: boolean;
  dkim_pass: boolean;
  dmarc_fail: boolean;
  dmarc_pass: boolean;
  auth_header_present: boolean;
  reply_to_mismatch: boolean;
  display_name_spoof: boolean;
  typosquatting_url: boolean;
  dangerous_attachment: boolean;
  url_count: number;
}

export interface MLInferRequest {
  subject: string;
  plain_text: string;
  html_body: string;
  sender: string;
  symbolic: SymbolicSignalsPayload;
}

export interface EvidenceSourceItem {
  source: string;
  m_malicious: number;
  m_benign: number;
  m_theta: number;
  rationale: string;
}

export interface MLInferResponse {
  fused_score: number;
  verdict: 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
  belief_malicious: number;
  plausibility_malicious: number;
  epistemic_uncertainty: number;
  conflict_k: number;
  neural_probability: number;
  semantic_indicators: string[];
  adversarial_flags: string[];
  obfuscation_ratio: number;
  zero_width_count: number;
  homoglyph_count: number;
  prompt_injection_hits: string[];
  hidden_text_preview: string;
  deobfuscated_preview: string;
  embedding_384: number[];
  evidence_sources: EvidenceSourceItem[];
  inference_ms: number;
  fallback?: boolean;
}

const rawHostPort = process.env.ML_ENGINE_HOSTPORT;
const ML_ENGINE_URL =
  process.env.ML_ENGINE_URL ||
  (rawHostPort ? (rawHostPort.startsWith('http') ? rawHostPort : `http://${rawHostPort}`) : 'http://localhost:8000');

/**
 * Calls the Python FastAPI Neuro-Symbolic ML Engine with a fast timeout.
 * Falls back cleanly to local TypeScript Dempster-Shafer estimation if offline.
 */
export async function callMlEngine(payload: MLInferRequest): Promise<MLInferResponse> {
  try {
    const res = await axios.post<MLInferResponse>(`${ML_ENGINE_URL}/v1/infer`, payload, {
      timeout: 8000
    });
    return res.data;
  } catch (err) {
    console.warn(`⚠️ ML Engine unreachable at ${ML_ENGINE_URL}, using local fallback:`, err instanceof Error ? err.message : err);
    return localFallbackFusion(payload);
  }
}

/**
 * Deterministic TypeScript fallback mirroring the Dempster-Shafer fusion math
 * so the system remains resilient even if the Python ML container is restarting.
 */
export function localFallbackFusion(req: MLInferRequest): MLInferResponse {
  const s = req.symbolic;
  const text = `${req.subject} ${req.plain_text}`.toLowerCase();
  const urgency = /\b(urgent|immediately|suspended|verify|wire transfer|expires?)\b/i.test(text);
  const creds = /\b(password|login|credential|bank|payroll|docusign|invoice)\b/i.test(text);

  const mMalAuth = s.spf_fail || s.dkim_fail || s.dmarc_fail ? 0.65 : 0.03;
  const mBenAuth = s.auth_header_present && !s.spf_fail && !s.dkim_fail ? 0.65 : 0.0;
  const mThAuth = Math.max(0.05, 1 - mMalAuth - mBenAuth);

  const mMalStruct = s.typosquatting_url || s.dangerous_attachment ? 0.8 : s.display_name_spoof || s.reply_to_mismatch ? 0.58 : 0.02;
  const mBenStruct = mMalStruct < 0.1 ? 0.35 : 0.02;
  const mThStruct = Math.max(0.05, 1 - mMalStruct - mBenStruct);

  const k = mMalAuth * mBenStruct + mBenAuth * mMalStruct;
  const norm = Math.max(0.08, 1 - k);
  let belM = (mMalAuth * mMalStruct + mMalAuth * mThStruct + mThAuth * mMalStruct) / norm;
  const belB = (mBenAuth * mBenStruct + mBenAuth * mThStruct + mThAuth * mBenStruct) / norm;
  const unc = (mThAuth * mThStruct) / norm;

  if (urgency && creds) belM = Math.min(0.95, belM + 0.25);

  const fused = Math.round(Math.min(100, Math.max(0, (belM + 0.5 * unc) * 100)));
  const verdict: 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS' =
    fused >= 65 ? 'MALICIOUS' : fused >= 30 ? 'SUSPICIOUS' : 'CLEAN';

  return {
    fused_score: fused,
    verdict,
    belief_malicious: Number(belM.toFixed(4)),
    plausibility_malicious: Number(Math.min(1, belM + unc).toFixed(4)),
    epistemic_uncertainty: Number(unc.toFixed(4)),
    conflict_k: Number(k.toFixed(4)),
    neural_probability: urgency && creds ? 0.78 : 0.15,
    semantic_indicators: urgency && creds ? ['URGENCY_AND_CREDENTIAL_LURE (fallback)'] : [],
    adversarial_flags: [],
    obfuscation_ratio: 0,
    zero_width_count: 0,
    homoglyph_count: 0,
    prompt_injection_hits: [],
    hidden_text_preview: '',
    deobfuscated_preview: `${req.subject} ${req.plain_text}`.slice(0, 300),
    embedding_384: new Array(384).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
    evidence_sources: [
      { source: 'crypto_auth', m_malicious: mMalAuth, m_benign: mBenAuth, m_theta: mThAuth, rationale: 'Local fallback' },
      { source: 'structural_ioc', m_malicious: mMalStruct, m_benign: mBenStruct, m_theta: mThStruct, rationale: 'Local fallback' }
    ],
    inference_ms: 1.2,
    fallback: true
  };
}
