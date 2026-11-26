"""
FastAPI microservice for PhishTank-NS:
- Adversarial De-obfuscation & Prompt-Injection Guard
- Neural Semantic Intent Classification + 384-d Embeddings
- Dempster-Shafer Neuro-Symbolic Evidence Fusion
- Prometheus Metrics
"""

from __future__ import annotations

import time
from typing import List, Optional
from fastapi import FastAPI, Response
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST

from .deobfuscator import deobfuscate_email
from .neural_scorer import scorer_instance
from .dempster_shafer import EvidenceMass, fuse_evidence

app = FastAPI(
    title="PhishTank-NS ML & Neuro-Symbolic Fusion Engine",
    version="2.0.0",
)

INFER_REQUESTS = Counter("phishtank_ml_infer_total", "Total inference requests", ["verdict"])
INFER_LATENCY = Histogram("phishtank_ml_infer_seconds", "Inference latency in seconds")


class SymbolicSignals(BaseModel):
    spf_fail: bool = False
    spf_pass: bool = False
    dkim_fail: bool = False
    dkim_pass: bool = False
    dmarc_fail: bool = False
    dmarc_pass: bool = False
    auth_header_present: bool = False
    reply_to_mismatch: bool = False
    display_name_spoof: bool = False
    typosquatting_url: bool = False
    dangerous_attachment: bool = False
    url_count: int = 0


class InferRequest(BaseModel):
    subject: str = ""
    plain_text: str = ""
    html_body: str = ""
    sender: str = ""
    symbolic: SymbolicSignals = Field(default_factory=SymbolicSignals)


class InferResponse(BaseModel):
    fused_score: int
    verdict: str
    belief_malicious: float
    plausibility_malicious: float
    epistemic_uncertainty: float
    conflict_k: float
    neural_probability: float
    semantic_indicators: List[str]
    adversarial_flags: List[str]
    obfuscation_ratio: float
    zero_width_count: int
    homoglyph_count: int
    prompt_injection_hits: List[str]
    hidden_text_preview: str
    deobfuscated_preview: str
    embedding_384: List[float]
    evidence_sources: List[dict]
    inference_ms: float


def build_bpas(
    sym: SymbolicSignals,
    neural_prob: float,
    obfuscation_ratio: float,
    homoglyph_count: int,
    zw_count: int,
    prompt_hits: List[str],
    text_len: int,
) -> List[EvidenceMass]:
    evidences: List[EvidenceMass] = []

    # 1. Cryptographic Auth BPA (models missing headers as epistemic uncertainty m(Theta))
    if not sym.auth_header_present:
        evidences.append(EvidenceMass("crypto_auth", 0.0, 0.0, 1.0, "No Authentication-Results header (pure uncertainty)"))
    else:
        fail_count = sum([sym.spf_fail, sym.dkim_fail, sym.dmarc_fail])
        pass_count = sum([sym.spf_pass, sym.dkim_pass, sym.dmarc_pass])
        if fail_count >= 2:
            evidences.append(EvidenceMass("crypto_auth", 0.85, 0.02, 0.13, f"{fail_count} auth checks failed"))
        elif fail_count == 1:
            evidences.append(EvidenceMass("crypto_auth", 0.58, 0.08, 0.34, "Single SPF/DKIM/DMARC failure"))
        elif pass_count == 3:
            evidences.append(EvidenceMass("crypto_auth", 0.01, 0.86, 0.13, "Full SPF+DKIM+DMARC cryptographic alignment passed"))
        elif pass_count >= 2:
            evidences.append(EvidenceMass("crypto_auth", 0.03, 0.72, 0.25, "SPF/DKIM/DMARC alignment passed"))
        else:
            evidences.append(EvidenceMass("crypto_auth", 0.05, 0.45, 0.50, "Partial auth pass"))

    # 2. Structural & Identity Spoofing BPA
    if sym.typosquatting_url or sym.dangerous_attachment:
        m_mal = 0.88 if (sym.typosquatting_url and sym.dangerous_attachment) else 0.78
        evidences.append(EvidenceMass("structural_ioc", m_mal, 0.02, 1.0 - m_mal - 0.02, "Typosquatting URL or weaponized attachment"))
    elif sym.display_name_spoof or sym.reply_to_mismatch:
        m_mal = 0.72 if (sym.display_name_spoof and sym.reply_to_mismatch) else 0.55
        evidences.append(EvidenceMass("structural_ioc", m_mal, 0.05, 1.0 - m_mal - 0.05, "Executive display-name spoof or Reply-To mismatch"))
    else:
        evidences.append(EvidenceMass("structural_ioc", 0.01, 0.52, 0.47, "No structural URL/attachment IOCs"))

    # 3. Adversarial Obfuscation BPA
    if prompt_hits or obfuscation_ratio > 0.15 or homoglyph_count >= 2 or zw_count >= 3:
        m_adv = min(0.92, 0.55 + obfuscation_ratio * 0.6 + (0.25 if prompt_hits else 0.0))
        evidences.append(EvidenceMass("adversarial_shield", m_adv, 0.01, max(0.05, 1.0 - m_adv - 0.01), "Adversarial CSS/Unicode/Prompt-Injection detected"))
    else:
        evidences.append(EvidenceMass("adversarial_shield", 0.02, 0.20, 0.78, "No adversarial obfuscation"))

    # 4. Neural Semantic Intent BPA (discounted by short text length -> uncertainty)
    reliability = min(0.85, 0.35 + (min(text_len, 250) / 250.0) * 0.50)
    m_mal_n = neural_prob * reliability
    m_ben_n = (1.0 - neural_prob) * reliability
    m_th_n = 1.0 - reliability
    evidences.append(EvidenceMass("neural_semantic", m_mal_n, m_ben_n, m_th_n, f"Neural BEC intent p={neural_prob:.2f}, rel={reliability:.2f}"))

    return evidences


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "phishtank-ns-ml-engine", "version": "2.0.0"}


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/v1/infer", response_model=InferResponse)
def infer(req: InferRequest) -> InferResponse:
    t0 = time.perf_counter()

    deobf = deobfuscate_email(req.plain_text, req.html_body, req.subject)
    neural_prob, indicators = scorer_instance.score_intent(deobf.visible_text)
    embedding = scorer_instance.embed_384(deobf.visible_text)

    bpas = build_bpas(
        sym=req.symbolic,
        neural_prob=neural_prob,
        obfuscation_ratio=deobf.obfuscation_ratio,
        homoglyph_count=deobf.homoglyph_count,
        zw_count=deobf.zero_width_count,
        prompt_hits=deobf.prompt_injection_hits,
        text_len=len(deobf.visible_text),
    )
    fusion = fuse_evidence(bpas)

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    INFER_REQUESTS.labels(verdict=fusion.verdict).inc()
    INFER_LATENCY.observe(elapsed_ms / 1000.0)

    return InferResponse(
        fused_score=fusion.fused_score,
        verdict=fusion.verdict,
        belief_malicious=fusion.belief_malicious,
        plausibility_malicious=fusion.plausibility_malicious,
        epistemic_uncertainty=fusion.epistemic_uncertainty,
        conflict_k=fusion.conflict_k,
        neural_probability=neural_prob,
        semantic_indicators=indicators,
        adversarial_flags=deobf.adversarial_flags,
        obfuscation_ratio=deobf.obfuscation_ratio,
        zero_width_count=deobf.zero_width_count,
        homoglyph_count=deobf.homoglyph_count,
        prompt_injection_hits=deobf.prompt_injection_hits,
        hidden_text_preview=deobf.hidden_text_removed,
        deobfuscated_preview=deobf.visible_text[:400],
        embedding_384=embedding,
        evidence_sources=fusion.sources,
        inference_ms=elapsed_ms,
    )
