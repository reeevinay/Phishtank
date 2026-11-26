"""
Generates a 2-panel Neuro-Symbolic Threat & Dempster-Shafer Evidence Plot
for any raw .eml email file.

Usage:
  python benchmarks/plot_email.py test-samples/phish-spoof.eml
"""

from __future__ import annotations

import email
from email import policy
import os
import re
import sys
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "services", "ml-engine")))

from app.deobfuscator import deobfuscate_email
from app.dempster_shafer import fuse_evidence
from app.main import SymbolicSignals, build_bpas
from app.neural_scorer import scorer_instance

TARGET_DOMAINS = ["microsoft.com", "google.com", "threatcop.com", "paypal.com", "okta.com", "docusign.com"]
FREE_MAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "proton.me"}
EXEC_RE = re.compile(r"\b(ceo|cfo|cto|director|executive|admin|it\s+support|helpdesk|payroll)\b", re.I)
DANGEROUS_EXT = {".exe", ".scr", ".vbs", ".bat", ".ps1", ".iso", ".hta", ".js"}


def extract_symbolic_from_eml(eml_path: str) -> tuple[str, str, str, SymbolicSignals]:
    with open(eml_path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=policy.default)

    subject = str(msg.get("Subject", "(No Subject)"))
    from_hdr = str(msg.get("From", ""))
    reply_to = str(msg.get("Reply-To", ""))
    auth_hdr = " ".join(str(v) for v in msg.get_all("Authentication-Results", [])).lower()

    plain_parts, html_parts, filenames = [], [], []
    if msg.is_multipart():
        for part in msg.walk():
            fn = part.get_filename()
            if fn:
                filenames.append(fn)
            ctype = part.get_content_type()
            try:
                payload = part.get_content()
            except Exception:
                payload = ""
            if isinstance(payload, str):
                if ctype == "text/plain":
                    plain_parts.append(payload)
                elif ctype == "text/html":
                    html_parts.append(payload)
    else:
        try:
            body = msg.get_content()
            if isinstance(body, str):
                if msg.get_content_type() == "text/html":
                    html_parts.append(body)
                else:
                    plain_parts.append(body)
        except Exception:
            pass

    plain_text = "\n".join(plain_parts)
    html_body = "\n".join(html_parts)

    from_addr_m = re.search(r"[\w.+-]+@[\w.-]+", from_hdr)
    from_addr = from_addr_m.group(0).lower() if from_addr_m else ""
    from_domain = from_addr.split("@")[1] if "@" in from_addr else ""
    rt_addr_m = re.search(r"[\w.+-]+@[\w.-]+", reply_to)
    rt_addr = rt_addr_m.group(0).lower() if rt_addr_m else ""

    urls = re.findall(r"https?://[^\s\"'<>]+", f"{plain_text} {html_body}")
    typo = any(
        any(t in u.lower().replace("0", "o") and t not in u.lower() for t in ["microsoft.com", "google.com", "paypal.com"])
        for u in urls
    )
    dang_att = any(os.path.splitext(fn)[1].lower() in DANGEROUS_EXT for fn in filenames)

    sym = SymbolicSignals(
        auth_header_present=bool(auth_hdr.strip()),
        spf_fail=bool(re.search(r"spf=(fail|softfail)", auth_hdr)),
        spf_pass="spf=pass" in auth_hdr,
        dkim_fail="dkim=fail" in auth_hdr,
        dkim_pass="dkim=pass" in auth_hdr,
        dmarc_fail="dmarc=fail" in auth_hdr,
        dmarc_pass="dmarc=pass" in auth_hdr,
        reply_to_mismatch=bool(rt_addr and from_addr and rt_addr != from_addr),
        display_name_spoof=bool(EXEC_RE.search(from_hdr) and from_domain in FREE_MAIL),
        typosquatting_url=typo,
        dangerous_attachment=dang_att,
        url_count=len(urls),
    )
    return subject, plain_text, html_body, sym


def plot_email(eml_path: str, out_path: str | None = None) -> str:
    subject, plain_text, html_body, sym = extract_symbolic_from_eml(eml_path)
    deobf = deobfuscate_email(plain_text, html_body, subject)
    neural_prob, _ = scorer_instance.score_intent(deobf.visible_text)
    bpas = build_bpas(
        sym=sym,
        neural_prob=neural_prob,
        obfuscation_ratio=deobf.obfuscation_ratio,
        homoglyph_count=deobf.homoglyph_count,
        zw_count=deobf.zero_width_count,
        prompt_hits=deobf.prompt_injection_hits,
        text_len=len(deobf.visible_text),
    )
    fusion = fuse_evidence(bpas)

    sources = [s["source"] for s in fusion.sources]
    m_mal = np.array([s["m_malicious"] for s in fusion.sources])
    m_ben = np.array([s["m_benign"] for s in fusion.sources])
    m_unc = np.array([s["m_theta"] for s in fusion.sources])

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10.5, 4.2), dpi=220)

    # Panel 1: Stacked BPA masses per detector
    y = np.arange(len(sources))
    ax1.barh(y, m_mal, color="#ef4444", label="m(Malicious)")
    ax1.barh(y, m_ben, left=m_mal, color="#10b981", label="m(Benign)")
    ax1.barh(y, m_unc, left=m_mal + m_ben, color="#f59e0b", label="m(Theta / Uncertainty)")
    ax1.set_yticks(y)
    ax1.set_yticklabels(sources)
    ax1.set_xlim(0, 1.0)
    ax1.set_xlabel("Basic Probability Assignment (Mass)")
    ax1.set_title("Per-Source Evidence Mass Breakdown")
    ax1.legend(loc="lower right", fontsize=8)

    # Panel 2: Fused Dempster-Shafer Risk Interval
    bel = fusion.belief_malicious * 100
    pl = fusion.plausibility_malicious * 100
    score = fusion.fused_score
    ax2.barh(["Fused Risk"], [bel], color="#ef4444", height=0.35, label=f"Belief Bel(M) = {bel:.1f}%")
    ax2.barh(["Fused Risk"], [max(0.5, pl - bel)], left=[bel], color="#f59e0b", alpha=0.6, height=0.35, label=f"Uncertainty m(Θ) = {fusion.epistemic_uncertainty*100:.1f}%")
    ax2.axvline(score, color="#6366f1", linestyle="--", linewidth=2, label=f"Pignistic Score = {score}/100 ({fusion.verdict})")
    ax2.set_xlim(0, 105)
    ax2.set_xlabel("Threat Risk (%)")
    ax2.set_title(f"Dempster-Shafer Interval | Conflict K = {fusion.conflict_k:.3f}")
    ax2.legend(loc="lower right", fontsize=8)

    fig.suptitle(f"PhishTank-NS Analysis: {os.path.basename(eml_path)} — \"{subject[:52]}\"", fontsize=10.5, fontweight="bold")
    plt.tight_layout()

    if not out_path:
        base = os.path.splitext(os.path.basename(eml_path))[0]
        out_dir = os.path.join(os.path.dirname(__file__), "email_plots")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"{base}_analysis.png")

    plt.savefig(out_path, dpi=220)
    plt.close(fig)
    print(f"Verdict: {fusion.verdict} (Score={score}/100, Bel={bel:.1f}%, Pl={pl:.1f}%, K={fusion.conflict_k:.3f})")
    print(f"Saved plot to: {out_path}")
    return out_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python benchmarks/plot_email.py <path-to-email.eml>")
        sys.exit(1)
    plot_email(sys.argv[1])
