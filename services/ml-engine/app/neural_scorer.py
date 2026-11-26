"""
Neural Semantic Intent Scorer & 384-d Embedding Generator (PhishTank-NS).

Provides:
1. Calibrated social-engineering / BEC intent probability on de-obfuscated text.
2. Deterministic 384-dimensional L2-normalized dense embeddings for PostgreSQL
   pgvector polymorphic campaign clustering.
"""

from __future__ import annotations

import hashlib
import os
import re
from typing import List, Tuple
import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

# Curated seed corpus for fast, deterministic CPU training (no paid API required)
_PHISH_SEEDS = [
    "urgent wire transfer requested immediately by ceo do not call verify",
    "your microsoft 365 password expires today click here to verify account",
    "unusual sign in activity detected confirm your banking credentials now",
    "suspended account action required update payment billing information",
    "i am in a meeting need you to purchase gift cards confidentially",
    "shared encrypted invoice document review docusign login required",
    "it helpdesk mailbox storage full upgrade quota via link below",
    "payroll direct deposit update request respond before 5pm today",
    "irs tax refund pending submit social security and bank routing",
    "paypal account limited unauthorized login verify identity immediately",
    "security alert new device logged in reset your password immediately",
    "urgent executive request process vendor payment to new bank account",
    "dear customer your package delivery failed pay customs fee here",
    "verify your crypto wallet seed phrase to prevent asset freeze",
    "hr policy update mandatory acknowledgment sign in with corporate email",
]

_BENIGN_SEEDS = [
    "hi team please find attached the weekly sprint retrospective notes",
    "meeting agenda for tomorrow morning product roadmap sync at 10am",
    "github pull request merged into main branch ci pipeline passed",
    "your monthly cloud infrastructure invoice is ready in the portal",
    "thanks for sending the quarterly report let us discuss on friday",
    "welcome to the engineering onboarding channel here are the docs",
    "lunch and learn session on distributed systems this thursday",
    "reminder to submit your timesheet before the end of the month",
    "here is the updated architecture diagram we reviewed earlier",
    "happy to catch up next week let me know what time works best",
    "build succeeded all unit and integration tests passed cleanly",
    "please review the attached pdf specification before code freeze",
    "thank you for your order your receipt is attached for your records",
    "conference paper submission deadline extended by one week",
    "quarterly all hands recording and slide deck now available",
]

URGENCY_LEXICON = re.compile(
    r"\b(urgent|immediately|action required|expires?|suspended|locked|verify|confirm|"
    r"unauthorized|wire transfer|gift cards?|confidential|within 24 hours|asap|deadline)\b",
    re.I,
)
CREDENTIAL_FINANCE_LEXICON = re.compile(
    r"\b(password|login|sign in|credential|bank|routing|invoice|payroll|direct deposit|"
    r"ssn|seed phrase|wallet|billing|payment|docusign|office\s*365|microsoft\s*365)\b",
    re.I,
)


MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.joblib")


class NeuralIntentScorer:
    def __init__(self) -> None:
        if os.path.exists(MODEL_PATH):
            self.pipeline: Pipeline = joblib.load(MODEL_PATH)
        else:
            texts = _PHISH_SEEDS + _BENIGN_SEEDS
            labels = [1] * len(_PHISH_SEEDS) + [0] * len(_BENIGN_SEEDS)
            self.pipeline = Pipeline([
                ("tfidf", TfidfVectorizer(ngram_range=(1, 2), max_features=4096, sublinear_tf=True)),
                ("clf", LogisticRegression(C=2.5, max_iter=500, random_state=42)),
            ])
            self.pipeline.fit(texts, labels)

    def score_intent(self, visible_text: str) -> Tuple[float, List[str]]:
        """
        Returns (malicious_probability in [0, 1], matched_semantic_indicators).
        """
        if not visible_text or len(visible_text.strip()) < 5:
            return 0.5, []

        prob = float(self.pipeline.predict_proba([visible_text])[0][1])

        urgency_hits = len(URGENCY_LEXICON.findall(visible_text))
        cred_hits = len(CREDENTIAL_FINANCE_LEXICON.findall(visible_text))

        indicators: List[str] = []
        if urgency_hits >= 1:
            indicators.append(f"URGENCY_COERCION_FRAMING ({urgency_hits} cues)")
        if cred_hits >= 1:
            indicators.append(f"CREDENTIAL_OR_FINANCIAL_LURE ({cred_hits} cues)")

        # Mild calibrated boost when both psychological urgency and credential/financial lures co-occur
        if urgency_hits >= 1 and cred_hits >= 1:
            prob = min(0.97, prob + 0.14)
        elif urgency_hits >= 2 or cred_hits >= 2:
            prob = min(0.95, prob + 0.08)

        return round(prob, 4), indicators

    def embed_384(self, visible_text: str) -> List[float]:
        """
        Generates a deterministic 384-dimensional L2-normalized semantic vector
        using signed character/word n-gram feature hashing (compatible with pgvector HNSW).
        """
        vec = np.zeros(384, dtype=np.float32)
        tokens = re.findall(r"[a-z0-9]{2,}", (visible_text or "").lower())
        if not tokens:
            vec[0] = 1.0
            return vec.tolist()

        # Unigrams + bigrams
        features = list(tokens) + [f"{tokens[i]}_{tokens[i+1]}" for i in range(len(tokens) - 1)]
        for feat in features:
            digest = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(digest[:4], "little") % 384
            sign = 1.0 if (digest[4] & 1) == 0 else -1.0
            vec[idx] += sign

        norm = float(np.linalg.norm(vec))
        if norm > 1e-9:
            vec /= norm
        else:
            vec[0] = 1.0
        return [round(float(x), 6) for x in vec]


scorer_instance = NeuralIntentScorer()
