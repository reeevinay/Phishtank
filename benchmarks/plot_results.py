"""
Generates publication-ready IEEE figures from benchmarks/results.json and benchmarks/hf_results.json.
Outputs high-DPI PNGs into paper/figures/.
"""

from __future__ import annotations

import json
import os
import matplotlib.pyplot as plt
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIG_DIR = os.path.join(ROOT, "paper", "figures")
os.makedirs(FIG_DIR, exist_ok=True)


def plot_hf_adversarial_comparison(hf: dict) -> None:
    metrics = ["Accuracy", "Precision", "Recall", "F1-Score", "ROC-AUC"]
    keys = ["accuracy", "precision", "recall", "f1", "roc_auc"]

    neural_clean = [hf["Neural-Only (Clean)"][k] for k in keys]
    ns_clean = [hf["PhishTank-NS (Clean)"][k] for k in keys]
    neural_adv = [hf["Neural-Only (Adversarial Stress)"][k] for k in keys]
    ns_adv = [hf["PhishTank-NS (Adversarial Stress)"][k] for k in keys]

    x = np.arange(len(metrics))
    w = 0.2

    fig, ax = plt.subplots(figsize=(8.5, 4.4), dpi=300)
    ax.bar(x - 1.5 * w, neural_clean, w, label="Neural-Only (Clean)", color="#64748b")
    ax.bar(x - 0.5 * w, ns_clean, w, label="PhishTank-NS (Clean)", color="#3b82f6")
    ax.bar(x + 0.5 * w, neural_adv, w, label="Neural-Only (Adv. Stress)", color="#f59e0b")
    ax.bar(x + 1.5 * w, ns_adv, w, label="PhishTank-NS (Adv. Stress)", color="#10b981")

    ax.set_ylabel("Score (%)")
    ax.set_title("Held-Out HuggingFace Evaluation (N=2,000): Clean vs. Adversarial Stress")
    ax.set_xticks(x)
    ax.set_xticklabels(metrics)
    ax.set_ylim(85, 101.5)
    ax.grid(axis="y", linestyle="--", alpha=0.35)
    ax.legend(loc="lower right", frameon=True, fontsize=8.5)
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "hf_adversarial_comparison.png"), dpi=300)
    plt.close(fig)


def plot_ablation_slices(ab: dict) -> None:
    systems = list(ab.keys())
    f1s = [ab[s]["f1"] for s in systems]
    eces = [ab[s]["ece"] for s in systems]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.0, 3.8), dpi=300)

    colors = ["#94a3b8", "#f59e0b", "#64748b", "#4f46e5"]
    ax1.barh(systems, f1s, color=colors)
    ax1.set_xlim(0, 108)
    ax1.set_xlabel("F1-Score (%)")
    ax1.set_title("Multi-Slice Ablation F1 (Higher = Better)")
    ax1.grid(axis="x", linestyle="--", alpha=0.35)
    for i, v in enumerate(f1s):
        ax1.text(v + 1.2, i, f"{v:.1f}%", va="center", fontsize=8.5)

    ax2.barh(systems, eces, color=colors)
    ax2.set_xlim(0, max(eces) * 1.2)
    ax2.set_xlabel("Expected Calibration Error (ECE)")
    ax2.set_title("Uncertainty Calibration (Lower = Better)")
    ax2.grid(axis="x", linestyle="--", alpha=0.35)
    for i, v in enumerate(eces):
        ax2.text(v + 0.01, i, f"{v:.3f}", va="center", fontsize=8.5)

    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "ablation_f1_ece.png"), dpi=300)
    plt.close(fig)


def main() -> None:
    with open(os.path.join(ROOT, "benchmarks", "hf_results.json"), encoding="utf-8") as f:
        hf = json.load(f)
    with open(os.path.join(ROOT, "benchmarks", "results.json"), encoding="utf-8") as f:
        ab = json.load(f)

    plot_hf_adversarial_comparison(hf)
    plot_ablation_slices(ab)
    print(f"Generated figures in {FIG_DIR}")


if __name__ == "__main__":
    main()
