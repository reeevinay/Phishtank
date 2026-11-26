"""
Train NeuralIntentScorer on the HuggingFace phishing email training split,
persist model.joblib for the live ML Engine, and evaluate on a strictly held-out test split.
"""

from __future__ import annotations

import json
import os
import sys
import time
import joblib
from datasets import load_dataset
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "services", "ml-engine")))

from benchmarks.eval_huggingface import (
    compute_metrics,
    extract_text_and_label,
    inject_adversarial_obfuscation,
)
from app.deobfuscator import deobfuscate_email
from app.dempster_shafer import fuse_evidence
from app.main import SymbolicSignals, build_bpas
from app.neural_scorer import MODEL_PATH, NeuralIntentScorer


def main() -> None:
    print("Loading zefang-liu/phishing-email-dataset...")
    ds = load_dataset("zefang-liu/phishing-email-dataset", split="train").shuffle(seed=42)

    all_rows = [extract_text_and_label(r) for r in ds]
    all_rows = [(t, y) for t, y in all_rows if len(t.strip()) >= 10]

    # Strict 80/20 split (0% leakage)
    split_idx = int(len(all_rows) * 0.8)
    train_rows = all_rows[:split_idx]
    test_rows = all_rows[split_idx:][:2000]  # 2,000 held-out test emails

    train_texts = [t for t, _ in train_rows]
    train_labels = [y for _, y in train_rows]

    print(f"Training calibrated TF-IDF + LogisticRegression on {len(train_texts)} emails...")
    t0 = time.perf_counter()
    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), max_features=25000, sublinear_tf=True, min_df=2)),
        ("clf", LogisticRegression(C=3.0, max_iter=1000, class_weight="balanced", random_state=42)),
    ])
    pipeline.fit(train_texts, train_labels)
    joblib.dump(pipeline, MODEL_PATH, compress=3)
    print(f"Saved trained model to {MODEL_PATH} in {time.perf_counter() - t0:.2f}s")

    # Reload scorer using saved model.joblib
    scorer = NeuralIntentScorer()
    labels = [y for _, y in test_rows]

    raw_preds, raw_probs = [], []
    ns_preds, ns_probs, ns_lat = [], [], []
    adv_raw_preds, adv_raw_probs = [], []
    adv_ns_preds, adv_ns_probs = [], []

    print(f"Evaluating on {len(test_rows)} strictly held-out test emails (Clean + Adversarial)...")
    for i, (text, lbl) in enumerate(test_rows):
        p_raw, _ = scorer.score_intent(text)
        raw_preds.append(1 if p_raw >= 0.5 else 0)
        raw_probs.append(p_raw)

        t_s = time.perf_counter()
        deobf = deobfuscate_email(plain_text=text, html_body="", subject="")
        p_ns, _ = scorer.score_intent(deobf.visible_text)
        bpas = build_bpas(
            sym=SymbolicSignals(auth_header_present=False),
            neural_prob=p_ns,
            obfuscation_ratio=deobf.obfuscation_ratio,
            homoglyph_count=deobf.homoglyph_count,
            zw_count=deobf.zero_width_count,
            prompt_hits=deobf.prompt_injection_hits,
            text_len=len(deobf.visible_text),
        )
        fusion = fuse_evidence(bpas)
        ns_lat.append((time.perf_counter() - t_s) * 1000.0)
        ns_preds.append(1 if fusion.verdict in ("SUSPICIOUS", "MALICIOUS") else 0)
        ns_probs.append(fusion.fused_score / 100.0)

        if lbl == 1:
            adv_plain, adv_html = inject_adversarial_obfuscation(text, i)
        else:
            adv_plain, adv_html = text, f"<p>{text}</p>"

        p_adv_raw, _ = scorer.score_intent(adv_plain)
        adv_raw_preds.append(1 if p_adv_raw >= 0.5 else 0)
        adv_raw_probs.append(p_adv_raw)

        adv_deobf = deobfuscate_email(plain_text=adv_plain, html_body=adv_html, subject="")
        p_adv_ns, _ = scorer.score_intent(adv_deobf.visible_text)
        adv_bpas = build_bpas(
            sym=SymbolicSignals(auth_header_present=False),
            neural_prob=p_adv_ns,
            obfuscation_ratio=adv_deobf.obfuscation_ratio,
            homoglyph_count=adv_deobf.homoglyph_count,
            zw_count=adv_deobf.zero_width_count,
            prompt_hits=adv_deobf.prompt_injection_hits,
            text_len=len(adv_deobf.visible_text),
        )
        adv_fusion = fuse_evidence(adv_bpas)
        adv_ns_preds.append(1 if adv_fusion.verdict in ("SUSPICIOUS", "MALICIOUS") else 0)
        adv_ns_probs.append(adv_fusion.fused_score / 100.0)

    results = {
        "dataset": "zefang-liu/phishing-email-dataset (80/20 held-out test, N=2000)",
        "train_samples": len(train_texts),
        "test_samples": len(test_rows),
        "Neural-Only (Clean)": compute_metrics(raw_preds, raw_probs, labels),
        "PhishTank-NS (Clean)": {
            **compute_metrics(ns_preds, ns_probs, labels),
            "mean_ms": round(sum(ns_lat) / max(1, len(ns_lat)), 3),
        },
        "Neural-Only (Adversarial Stress)": compute_metrics(adv_raw_preds, adv_raw_probs, labels),
        "PhishTank-NS (Adversarial Stress)": compute_metrics(adv_ns_preds, adv_ns_probs, labels),
    }

    print("\n=== Held-Out HuggingFace Evaluation (N=2,000 unseen emails) ===")
    print(f"{'Configuration':<35} | {'Acc%':>6} | {'Prec%':>6} | {'Rec%':>6} | {'F1%':>6} | {'AUC%':>6} | {'ECE':>6}")
    print("-" * 88)
    for k, v in results.items():
        if not isinstance(v, dict):
            continue
        print(f"{k:<35} | {v['accuracy']:>6.2f} | {v['precision']:>6.2f} | {v['recall']:>6.2f} | {v['f1']:>6.2f} | {v['roc_auc']:>6.2f} | {v['ece']:>6.4f}")

    out_path = os.path.join(os.path.dirname(__file__), "hf_results.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved held-out results to {out_path}")


if __name__ == "__main__":
    main()
