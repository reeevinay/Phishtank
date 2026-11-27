"""
Generates the complete, updated BIT-753 Project Progress Report (.docx)
incorporating all verified live deployment, test, extension, and benchmark updates:
  paper/PhishTank-NS-BIT753-Progress-Report.docx
"""

from __future__ import annotations

import os
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DOCX = os.path.join(ROOT, "paper", "PhishTank-NS-BIT753-Progress-Report.docx")
HF_FIG = os.path.join(ROOT, "paper", "figures", "hf_adversarial_comparison.png")
AB_FIG = os.path.join(ROOT, "paper", "figures", "ablation_f1_ece.png")
EML_FIG = os.path.join(ROOT, "benchmarks", "email_plots", "phish-spoof_analysis.png")

NAVY = RGBColor(15, 32, 67)


def add_heading_styled(doc: Document, text: str, level: int = 1) -> None:
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = NAVY


def add_table_styled(doc: Document, headers: list[str], rows: list[list[str]]) -> None:
    tbl = doc.add_table(rows=1 + len(rows), cols=len(headers))
    tbl.style = "Table Grid"
    for j, h in enumerate(headers):
        cell = tbl.rows[0].cells[j]
        p = cell.paragraphs[0]
        r = p.add_run(h)
        r.bold = True
        r.font.size = Pt(9.5)
    for i, row in enumerate(rows, start=1):
        for j, val in enumerate(row):
            p = tbl.rows[i].cells[j].paragraphs[0]
            r = p.add_run(val)
            r.font.size = Pt(9)
    doc.add_paragraph()


def build() -> None:
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(11.5)

    # ---------------- COVER PAGE ----------------
    for line, sz, bold in [
        ("A\nProject Progress Report\nOn", 14, False),
        ("PhishTank: Neuro-Symbolic Email Threat Defense & Provenance Graph", 18, True),
        ("For partial fulfillment of award of the\nB. Tech Degree in Information Technology", 12, False),
        ("Under the Supervision of\nMs. Juli Kumari (Assistant Professor)", 12, True),
    ]:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(line)
        r.font.size = Pt(sz)
        r.bold = bold
        if sz == 18:
            r.font.color.rgb = NAVY

    doc.add_paragraph("Submitted by:").alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_table_styled(
        doc,
        ["Student Name", "University Roll Number"],
        [
            ["Vinay Sharma", "2301920130209"],
            ["Utkarsh Singh", "2301920130200"],
            ["Yash Rajveer Singh", "2301920130220"],
            ["Yogesh Kumar", "2301920130221"],
        ],
    )
    p_org = doc.add_paragraph("Session: 2026-27\nG. L. Bajaj Institute of Technology and Management, Greater Noida")
    p_org.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_page_break()

    # ---------------- APPROVAL PAGE ----------------
    add_heading_styled(doc, "PROJECT PROGRESS REPORT VERIFICATION AND APPROVAL", 1)
    doc.add_paragraph(
        'This is to certify that the report entitled "PhishTank: Neuro-Symbolic Email Threat Defense & Provenance Graph", '
        "submitted by Vinay Sharma (2301920130209), Utkarsh Singh (2301920130200), Yash Rajveer Singh (2301920130220), "
        "Yogesh Kumar (2301920130221), of 7th Semester, Department of Information Technology (Project Code: BIT-753), "
        "has been reviewed and verified by the competent authorities. The project progress report has been found satisfactory "
        "in terms of its content, structure and prescribed academic requirements and is hereby approved for submission."
    )
    add_table_styled(
        doc,
        ["PROJECT SUPERVISOR", "PROJECT COORDINATOR"],
        [
            ["Signature: ________________________\nName: Ms. Juli Kumari (Assistant Professor)",
             "Signature: ________________________\nName: Ms. Pragya Siddhi"],
        ],
    )
    doc.add_page_break()

    # ---------------- DECLARATION & CERTIFICATE ----------------
    add_heading_styled(doc, "Declaration", 1)
    doc.add_paragraph(
        'We hereby declare that the Project Progress Report entitled "PhishTank: Neuro-Symbolic Email Threat Defense & Provenance Graph", '
        "submitted in partial fulfillment of the requirements for the award of the degree of Bachelor of Technology in Information Technology "
        "at Dr. A.P.J. Abdul Kalam Technical University, Uttar Pradesh, is a record of the work carried out by us during the 7th semester "
        "(Project-I, BIT-753) under the guidance and supervision of Ms. Juli Kumari, Assistant Professor, at the Department of Information Technology, "
        "G. L. Bajaj Institute of Technology and Management, Greater Noida."
    )
    doc.add_paragraph(
        "The work presented in this report reflects our completed implementation, live cloud deployment, automated verification, and empirical "
        "evaluation during Project-I, with planned 8th-semester (Project-II) refinements documented in Chapter 5."
    )
    add_table_styled(
        doc,
        ["Team Member 1 & 2", "Team Member 3 & 4"],
        [
            ["Signature: ___________________\nVinay Sharma (2301920130209)", "Signature: ___________________\nUtkarsh Singh (2301920130200)"],
            ["Signature: ___________________\nYash Rajveer Singh (2301920130220)", "Signature: ___________________\nYogesh Kumar (2301920130221)"],
        ],
    )
    doc.add_paragraph("Date: _____________________    Place: Greater Noida")
    doc.add_page_break()

    add_heading_styled(doc, "Certificate", 1)
    doc.add_paragraph(
        'This is to certify that the Project Progress Report entitled "PhishTank: Neuro-Symbolic Email Threat Defense & Provenance Graph", '
        "submitted by Vinay Sharma (2301920130209), Utkarsh Singh (2301920130200), Yash Rajveer Singh (2301920130220), and Yogesh Kumar (2301920130221) "
        "in partial fulfillment of the requirements for the award of the degree of Bachelor of Technology in Information Technology at Dr. A.P.J. Abdul Kalam "
        "Technical University, Uttar Pradesh, is a record of the project work carried out during the 7th semester (Project-I, BIT-753) under my guidance "
        "and supervision at G. L. Bajaj Institute of Technology and Management, Greater Noida."
    )
    add_table_styled(
        doc,
        ["Project Supervisor", "Head of Department"],
        [["Ms. Juli Kumari (Assistant Professor)", "Dr. P. C. Vashist (Head of Department, IT)"]],
    )
    doc.add_page_break()

    # ---------------- ACKNOWLEDGEMENT ----------------
    add_heading_styled(doc, "Acknowledgement", 1)
    doc.add_paragraph(
        "We express our sincere gratitude to our project supervisor, Ms. Juli Kumari, Assistant Professor, for continuous guidance and encouragement "
        "throughout Project-I. We are deeply thankful to Ms. Pragya Siddhi, Project Coordinator, and Dr. P. C. Vashist, Head of the Department of "
        "Information Technology, G. L. Bajaj Institute of Technology and Management, Greater Noida, for their coordination, facilities, and academic support."
    )
    doc.add_page_break()

    # ---------------- ABSTRACT ----------------
    add_heading_styled(doc, "ABSTRACT", 1)
    doc.add_paragraph(
        "Electronic mail remains the primary initial-access vector for credential harvesting, malware delivery, and Business Email Compromise (BEC). "
        "Conventional Secure Email Gateways (SEGs) fail on zero-payload BEC and compromised legitimate accounts where SPF, DKIM, and DMARC pass, "
        "whereas standalone machine-learning and LLM classifiers remain vulnerable to CSS hidden-text poisoning, Unicode UTS #39 homoglyphs, zero-width "
        "obfuscation, and indirect prompt injection while emitting uncalibrated point probabilities."
    )
    doc.add_paragraph(
        "This report presents PhishTank (PhishTank-NS), a live cloud-deployed, three-plane neuro-symbolic email defense and provenance platform. "
        "A Manifest V3 Firefox extension (v2.0.1) and React 18 SOC dashboard (with toggleable Simple View and Research View) provide dual ingestion paths: "
        "asynchronous RFC-5322 .eml uploads (HTTP 202 Accepted) and synchronous webmail DOM inspection across Gmail, Outlook Web, and a mock webmail harness. "
        "A Python FastAPI microservice executes visibility-aware HTML/Unicode de-obfuscation, TF-IDF + Logistic Regression semantic intent scoring "
        "(trained on 14,474 emails from zefang-liu/phishing-email-dataset), 384-d Blake2b feature hashing, and Dempster-Shafer Evidence Fusion with Murphy "
        "averaging fallback (K >= 0.92). Deployed on Render Cloud with PostgreSQL 16 + pgvector HNSW, Redis, and BullMQ, PhishTank-NS achieves 98.50% clean "
        "accuracy (99.83% ROC-AUC) and 98.95% adversarial accuracy (99.87% recall, 99.99% ROC-AUC) on 2,000 held-out unseen emails, 443.12 req/sec HTTP "
        "throughput, and 8/8 passing automated unit/integration tests."
    )
    doc.add_page_break()

    # ---------------- CHAPTER 1 ----------------
    add_heading_styled(doc, "CHAPTER-1: INTRODUCTION", 1)
    add_heading_styled(doc, "1.1 Overview & Background", 2)
    doc.add_paragraph(
        "Email continues to serve as the primary identity and communication backbone for enterprise workflows, making it the leading vector for "
        "credential harvesting and Business Email Compromise (BEC) [1], [2]. Modern attackers exploit four major gaps: (1) zero-payload BEC without "
        "malicious URLs or attachments, (2) compromised legitimate accounts passing SPF/DKIM/DMARC [5]-[8], (3) CSS hidden-text poisoning (display:none, "
        "opacity:0, font-size:0) and Unicode UTS #39 homoglyph spoofing [12], and (4) indirect prompt injection targeting LLM triage tools [10], [11]."
    )
    add_heading_styled(doc, "1.2 Problem Statement & Objectives", 2)
    for obj in [
        "Dual-Path Ingestion: Async .eml uploads (POST /api/v1/analyze -> HTTP 202) and sync DOM scans (POST /api/v1/analyze-dom).",
        "Visibility-Aware Adversarial De-obfuscation: Strip hidden CSS nodes, normalize NFKC + UTS #39 confusables, and flag prompt injections.",
        "Dempster-Shafer Neuro-Symbolic Fusion: Fuse 4 independent BPAs into [Bel(M), Pl(M)], epistemic uncertainty m(Theta), and conflict K.",
        "Vector-Graph Provenance: Cluster polymorphic campaigns via pgvector HNSW (cosine >= 0.82) and persist 2-hop heterogeneous graphs.",
        "Live Cloud & Browser Deployment: Deploy on Render (PostgreSQL pgvector + Redis/BullMQ) with dual-mode React SOC UI & Firefox MV3 extension.",
    ]:
        doc.add_paragraph(obj, style="List Bullet")

    add_table_styled(
        doc,
        ["Attack Vector", "Traditional Rule / SEG Gap", "Pure Neural / LLM Gap", "PhishTank-NS Mitigation"],
        [
            ["Zero-Payload BEC", "Misses linkless/fileless lures", "Uncalibrated polite framing", "Title/free-mail/Reply-To + semantic intent"],
            ["Compromised Account (spf=pass)", "Whitelisted by passing auth", "Ignores MIME auth headers", "D-S Conflict K >= 0.45 flags contradiction"],
            ["CSS Hidden-Text Poisoning", "Ignores inline CSS styles", "Dilutes malicious token score", "Strips hidden CSS + computes obfuscation_ratio"],
            ["Homoglyphs & Zero-Width", "Exact rules fail on Cyrillic", "Tokenizer fragmentation", "Zero-width strip + NFKC + UTS #39 map"],
            ["Indirect Prompt Injection", "N/A", "Hijacked by hidden override", "Regex guard + adversarial_shield BPA"],
        ],
    )

    # ---------------- CHAPTER 2 ----------------
    add_heading_styled(doc, "CHAPTER-2: LITERATURE SURVEY AND EXISTING SYSTEM", 1)
    doc.add_paragraph(
        "We reviewed IETF authentication standards (SPF RFC 7208, DKIM RFC 6376, DMARC RFC 7489, Authentication-Results RFC 8601) [5]-[8], "
        "phishing surveys [2]-[4], indirect prompt injection [10], [11], Unicode UTS #39 [12], Dempster-Shafer Evidence Theory [13]-[15], "
        "model calibration [16], and feature hashing / HNSW indexing [17], [18]."
    )
    add_table_styled(
        doc,
        ["Evaluation Criterion", "Rule-Based Gateways", "Pure Neural / LLM Scanners", "PhishTank-NS (Live Production)"],
        [
            ["Zero-Payload BEC", "Low", "Moderate-High", "High (symbolic + semantic fusion)"],
            ["Compromised Account", "Fails", "Ignores auth", "Conflict K >= 0.45 alert"],
            ["CSS & Homoglyph Evasion", "Bypassed", "Score dilution / split tokens", "Pre-inference DOM & UTS #39 sanitizer"],
            ["Missing Headers", "Hard default", "Not modeled", "Explicit epistemic uncertainty m(Theta)=1.0"],
            ["Compute & Latency", "< 1 ms CPU", "1-3 s LLM / GPU", "~2.9 ms ML CPU + O(1) Redis cache"],
        ],
    )

    # ---------------- CHAPTER 3 ----------------
    add_heading_styled(doc, "CHAPTER-3: PROPOSED WORK & MATHEMATICAL FORMULATION", 1)
    add_heading_styled(doc, "3.1 Adversarial De-Obfuscation & Intent Classification", 2)
    doc.add_paragraph(
        "deobfuscator.py strips hidden HTML nodes (display:none, visibility:hidden, opacity:0, font-size:0, width/height:0+overflow:hidden, "
        "negative text-indent/left) and computes the adversarial obfuscation ratio:"
    )
    doc.add_paragraph("  (3.1)  r_obf = L_hid / (L_vis + L_hid)  in [0, 1]")
    doc.add_paragraph(
        "After NFKC + UTS #39 confusable mapping and dual-surface prompt-injection scanning, NeuralIntentScorer (neural_scorer.py) scores "
        "intent using a calibrated TF-IDF (25,000 n-grams) + Logistic Regression pipeline (model.joblib) and generates 384-d L2-normalized "
        "Blake2b signed feature-hashing vectors."
    )

    add_heading_styled(doc, "3.2 Dempster-Shafer Evidence Fusion & Provenance Graph", 2)
    doc.add_paragraph("Over Theta = {Malicious (M), Benign (B)}, four independent BPAs satisfy:")
    doc.add_paragraph("  (3.2)  m_k(M) + m_k(B) + m_k(Theta) = 1,   m_k(empty) = 0")
    doc.add_paragraph("Pairwise conflict K and Dempster combination (with Murphy averaging fallback when K >= 0.92) follow:")
    doc.add_paragraph("  (3.3)  K = m1(M)*m2(B) + m1(B)*m2(M)")
    doc.add_paragraph("  (3.4)  m12(M) = [m1(M)m2(M) + m1(M)m2(Theta) + m1(Theta)m2(M)] / (1 - K)")
    doc.add_paragraph("  (3.5)  m12(B) = [m1(B)m2(B) + m1(B)m2(Theta) + m1(Theta)m2(B)] / (1 - K)")
    doc.add_paragraph("  (3.6)  m12(Theta) = [m1(Theta)m2(Theta)] / (1 - K)")
    doc.add_paragraph("  (3.7)  Bel(M) = m*(M),   Pl(M) = min(1, m*(M) + m*(Theta))")
    doc.add_paragraph("  (3.8)  Pignistic Score S = round(100 * (Bel(M) + 0.5 * m*(Theta)))")
    doc.add_paragraph("  (3.9)  Campaign Cosine Similarity: sim(v, c) = 1 - (v . c) / (||v||_2 ||c||_2)  (merge if >= 0.82)")

    add_table_styled(
        doc,
        ["BPA Source", "Trigger Condition", "m(M)", "m(B)", "m(Theta)"],
        [
            ["crypto_auth", "No Authentication-Results header", "0.00", "0.00", "1.00"],
            ["crypto_auth", "fail_count >= 2 (SPF/DKIM/DMARC)", "0.85", "0.02", "0.13"],
            ["crypto_auth", "pass_count == 3 (Full alignment)", "0.01", "0.86", "0.13"],
            ["structural_ioc", "typosquatting_url AND dangerous_attachment", "0.88", "0.02", "0.10"],
            ["structural_ioc", "No structural IOCs", "0.01", "0.52", "0.47"],
            ["adversarial_shield", "Prompt inj / obf > 0.15 / homo >= 2 / zw >= 3", "0.55-0.92", "0.01", "0.05-0.44"],
            ["neural_semantic", "Length L, prob p, reliability rho", "p * rho", "(1-p) * rho", "1 - rho"],
        ],
    )

    # ---------------- CHAPTER 4 ----------------
    add_heading_styled(doc, "CHAPTER-4: TECHNOLOGY STACK, METHODOLOGY & VERIFIED RESULTS", 1)
    add_heading_styled(doc, "4.1 Verified Technology Stack & Live Cloud Deployment", 2)
    doc.add_paragraph(
        "PhishTank-NS is deployed live on Render Cloud (https://phishtank-ns-api.onrender.com and https://phishtank-ns-ml.onrender.com) "
        "with managed PostgreSQL 16 + pgvector, Redis 7, and BullMQ. The Firefox MV3 extension (v2.0.1) passed Mozilla's web-ext lint with "
        "0 errors, 0 notices, and 0 warnings, was submitted to Mozilla Add-ons (AMO), and was verified against live Gmail messages."
    )

    add_table_styled(
        doc,
        ["Test / Benchmark Suite", "Tool / Scope", "Verified Execution Status"],
        [
            ["tests/backend.test.ts", "Vitest + Supertest (API, DOM, .eml, Graph)", "PASSED (4/4 tests)"],
            ["services/ml-engine/tests/test_ml_engine.py", "Pytest + FastAPI TestClient", "PASSED (4/4 tests)"],
            ["extension/ (web-ext lint)", "Mozilla WebExtensions MV3 Validator", "PASSED (0 errors, 0 warnings)"],
            ["benchmarks/run_eval.py", "40-sample 4-slice ablation study", "VERIFIED (100% F1, 2.93 ms)"],
            ["benchmarks/train_and_eval_hf.py", "14,474 train / 2,000 held-out test (seed=42)", "VERIFIED (98.95% Adv. Acc, 99.99% AUC)"],
            ["benchmarks/load_test.mjs", "150 concurrent HTTP requests (c=20)", "VERIFIED (443.12 req/sec, 0 errors, p50=21.71 ms)"],
        ],
    )

    add_heading_styled(doc, "4.2 Verified Benchmark Results (N=40 Ablation & N=2,000 HuggingFace)", 2)
    add_table_styled(
        doc,
        ["Configuration (N=2,000 Held-Out)", "Acc (%)", "Prec (%)", "Rec (%)", "F1 (%)", "ROC-AUC (%)", "ECE"],
        [
            ["Neural-Only (Clean)", "98.70", "98.00", "98.74", "98.37", "99.89", "0.0486"],
            ["PhishTank-NS (Clean)", "98.50", "97.51", "98.74", "98.12", "99.83", "0.1380"],
            ["Neural-Only (Adversarial Stress)", "96.25", "97.87", "92.56", "95.14", "99.53", "0.0810"],
            ["PhishTank-NS (Adversarial Stress)", "98.95", "97.54", "99.87", "98.69", "99.99", "0.0733"],
        ],
    )

    for fig_path, cap in [
        (HF_FIG, "Figure 4.1: Held-out HuggingFace evaluation (N = 2,000) comparing clean vs. adversarial stress."),
        (AB_FIG, "Figure 4.2: Multi-slice ablation F1-score and Expected Calibration Error (ECE)."),
        (EML_FIG, "Figure 4.3: Per-source BPA mass breakdown and Dempster-Shafer interval for phish-spoof.eml."),
    ]:
        if os.path.exists(fig_path):
            p_img = doc.add_paragraph()
            p_img.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p_img.add_run().add_picture(fig_path, width=Inches(5.8))
            p_cap = doc.add_paragraph(cap)
            p_cap.alignment = WD_ALIGN_PARAGRAPH.CENTER

    add_heading_styled(doc, "4.3 Current System Limitations", 2)
    for lim in [
        "Header-Only Auth Parsing: Trusts pre-stamped Authentication-Results headers rather than live DNS/DKIM crypto lookups.",
        "Linear Semantic Classifier: Uses English TF-IDF + Logistic Regression for 2.9 ms CPU inference rather than multilingual transformers.",
        "Static CSS & Narrow IOC Scope: Typosquatting checks 6 target domains; CSS parser omits foreground/background color-equality matching.",
        "Cross-Container SSE & Multi-Pod Storage: Multi-container BullMQ workers require Redis Pub/Sub for SSE and S3/R2 for multi-pod .eml uploads.",
    ]:
        doc.add_paragraph(lim, style="List Bullet")

    # ---------------- CHAPTER 5 ----------------
    add_heading_styled(doc, "CHAPTER-5: FUTURE WORK AND CONCLUSION", 1)
    add_heading_styled(doc, "5.1 Current Status & Project-II (8th Semester) Roadmap", 2)
    doc.add_paragraph(
        "Project-I (BIT-753) delivered the complete, verified, and cloud-deployed PhishTank-NS platform, dual-mode React SOC UI, "
        "published-ready IEEEtran manuscript, and Firefox MV3 extension (v2.0.1). Project-II will extend depth across four phases:"
    )
    add_table_styled(
        doc,
        ["Phase", "Target Focus", "Planned Deliverables"],
        [
            ["Phase 1 (Weeks 1-3)", "Cross-Container Polish", "Redis Pub/Sub SSE bridge, dynamic content.js dashboard URL, CSS color-contrast stripping"],
            ["Phase 2 (Weeks 4-7)", "Protocol & IOC Depth", "Live DNS SPF/DMARC + DKIM crypto verification, IDN Punycode decoding, archive/macro inspection"],
            ["Phase 3 (Weeks 8-11)", "Model & Enterprise Auth", "Quantized multilingual ONNX transformer, user RBAC, analyst triage actions, S3 upload storage"],
            ["Phase 4 (Weeks 12-14)", "Large-Scale Validation", "Multi-corpus evaluation, headless Chromium brand-cloning detection, and Project-II thesis"],
        ],
    )
    add_heading_styled(doc, "5.2 Conclusion", 2)
    doc.add_paragraph(
        "PhishTank-NS demonstrates that uniting visibility-aware adversarial de-obfuscation, Dempster-Shafer neuro-symbolic fusion, and "
        "pgvector Threat Provenance Graphs closes critical evasion gaps in modern email defense while achieving 98.95% adversarial accuracy "
        "(99.99% ROC-AUC) and 443.12 req/sec throughput on CPU-only cloud infrastructure."
    )

    # ---------------- REFERENCES ----------------
    add_heading_styled(doc, "REFERENCES", 1)
    refs = [
        "[1] APWG, 'Phishing Activity Trends Report, Q4 2024,' Mar. 2025.",
        "[2] A. Almomani et al., 'A Survey of Phishing Email Filtering Techniques,' IEEE Comm. Surveys & Tutorials, 2013.",
        "[3] S. A. Salloum et al., 'Systematic Literature Review on Phishing Detection Using NLP,' IEEE Access, 2022.",
        "[4] R. M. Alguliyev et al., 'Business Email Compromise Detection using NLP and Deep Learning,' IEEE AICT, 2024.",
        "[5]-[8] IETF RFC 7208 (SPF), RFC 6376 (DKIM), RFC 7489 (DMARC), RFC 8601 (Authentication-Results).",
        "[9] V. I. Levenshtein, 'Binary codes capable of correcting deletions, insertions, and reversals,' 1966.",
        "[10] K. Greshake et al., 'Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection,' ACM AISec, 2023.",
        "[11] OWASP Foundation, 'OWASP Top 10 for LLM Applications — LLM01: Prompt Injection.'",
        "[12] The Unicode Consortium, 'UTS #39: Unicode Security Mechanisms,' 2024.",
        "[13]-[15] G. Shafer (1976), L. A. Zadeh (1986), C. K. Murphy (2000) — Dempster-Shafer Theory & Conflict Combination.",
        "[16] C. Guo et al., 'On Calibration of Modern Neural Networks,' ICML, 2017.",
        "[17]-[18] K. Weinberger et al., 'Feature Hashing' (ICML 2009); Y. A. Malkov & D. A. Yashunin, 'HNSW Graphs' (IEEE TPAMI 2020).",
        "[19]-[27] Scikit-learn, HuggingFace zefang-liu/phishing-email-dataset, FastAPI, Express 5, pgvector, Firefox MV3, SQLite WAL, BullMQ, Prometheus.",
    ]
    for r in refs:
        doc.add_paragraph(r)

    doc.save(OUT_DOCX)
    print(f"Generated complete BIT-753 report at: {OUT_DOCX}")


if __name__ == "__main__":
    build()
