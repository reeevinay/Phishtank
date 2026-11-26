"""
Dempster-Shafer Evidence Theory Fusion Engine (PhishTank-NS).

Combines heterogeneous symbolic detectors and neural semantic classifiers over the
frame of discernment Theta = {Malicious (M), Benign (B)}.

Unlike naive weighted averages or black-box softmax outputs, Dempster-Shafer:
1. Explicitly models epistemic uncertainty m(Theta) when evidence is missing
   (e.g., absent Authentication-Results headers).
2. Computes the conflict coefficient K between sources, surfacing compromised-account
   BEC (valid SPF/DKIM + malicious semantic intent or phishing URL).
3. Uses Murphy's averaging fallback when conflict K exceeds threshold tau to avoid
   Zadeh's counter-intuitive normalization paradox.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass
class EvidenceMass:
    source: str
    m_malicious: float
    m_benign: float
    m_theta: float
    rationale: str = ""

    def normalized(self) -> "EvidenceMass":
        total = self.m_malicious + self.m_benign + self.m_theta
        if total <= 0:
            return EvidenceMass(self.source, 0.0, 0.0, 1.0, self.rationale)
        return EvidenceMass(
            source=self.source,
            m_malicious=round(self.m_malicious / total, 6),
            m_benign=round(self.m_benign / total, 6),
            m_theta=round(self.m_theta / total, 6),
            rationale=self.rationale,
        )


@dataclass
class FusionResult:
    belief_malicious: float
    plausibility_malicious: float
    belief_benign: float
    epistemic_uncertainty: float
    conflict_k: float
    fused_score: int
    verdict: str
    sources: List[Dict[str, object]]


def _combine_pair(m1: EvidenceMass, m2: EvidenceMass) -> tuple[EvidenceMass, float]:
    """Dempster's rule of combination for two BPAs over {M, B, Theta}."""
    k_conflict = (m1.m_malicious * m2.m_benign) + (m1.m_benign * m2.m_malicious)

    # If total conflict approaches 1.0, fall back to average (Murphy's rule)
    if k_conflict >= 0.92:
        avg = EvidenceMass(
            source=f"{m1.source}+{m2.source}",
            m_malicious=0.5 * (m1.m_malicious + m2.m_malicious),
            m_benign=0.5 * (m1.m_benign + m2.m_benign),
            m_theta=0.5 * (m1.m_theta + m2.m_theta),
        ).normalized()
        return avg, round(k_conflict, 6)

    norm = 1.0 - k_conflict
    m_mal = (
        m1.m_malicious * m2.m_malicious
        + m1.m_malicious * m2.m_theta
        + m1.m_theta * m2.m_malicious
    ) / norm
    m_ben = (
        m1.m_benign * m2.m_benign
        + m1.m_benign * m2.m_theta
        + m1.m_theta * m2.m_benign
    ) / norm
    m_th = (m1.m_theta * m2.m_theta) / norm

    combined = EvidenceMass(
        source=f"{m1.source}+{m2.source}",
        m_malicious=m_mal,
        m_benign=m_ben,
        m_theta=m_th,
    ).normalized()
    return combined, round(k_conflict, 6)


def fuse_evidence(evidences: List[EvidenceMass]) -> FusionResult:
    """
    Fuses a list of independent EvidenceMass BPAs into a calibrated risk interval
    [Bel(M), Pl(M)], epistemic uncertainty m(Theta), and conflict coefficient K.
    """
    if not evidences:
        return FusionResult(
            belief_malicious=0.0,
            plausibility_malicious=1.0,
            belief_benign=0.0,
            epistemic_uncertainty=1.0,
            conflict_k=0.0,
            fused_score=0,
            verdict="CLEAN",
            sources=[],
        )

    normalized = [e.normalized() for e in evidences]
    acc = normalized[0]
    max_conflict = 0.0

    for nxt in normalized[1:]:
        acc, k = _combine_pair(acc, nxt)
        if k > max_conflict:
            max_conflict = k

    bel_m = round(acc.m_malicious, 4)
    bel_b = round(acc.m_benign, 4)
    uncertainty = round(acc.m_theta, 4)
    pl_m = round(min(1.0, acc.m_malicious + acc.m_theta), 4)

    # Expected pignistic probability BetP(M) = Bel(M) + 0.5 * m(Theta)
    pignistic_m = acc.m_malicious + 0.5 * acc.m_theta
    fused_score = int(round(max(0.0, min(100.0, pignistic_m * 100.0))))

    if fused_score >= 65 or bel_m >= 0.62:
        verdict = "MALICIOUS"
    elif fused_score >= 30 or bel_m >= 0.25:
        verdict = "SUSPICIOUS"
    else:
        verdict = "CLEAN"

    serialized_sources = [
        {
            "source": e.source,
            "m_malicious": round(e.m_malicious, 4),
            "m_benign": round(e.m_benign, 4),
            "m_theta": round(e.m_theta, 4),
            "rationale": e.rationale,
        }
        for e in normalized
    ]

    return FusionResult(
        belief_malicious=bel_m,
        plausibility_malicious=pl_m,
        belief_benign=bel_b,
        epistemic_uncertainty=uncertainty,
        conflict_k=round(max_conflict, 4),
        fused_score=fused_score,
        verdict=verdict,
        sources=serialized_sources,
    )
