# 🛡️ PhishTank-NS — Neuro-Symbolic Email Threat Defense & Provenance Graph

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python FastAPI](https://img.shields.io/badge/Python-FastAPI_ML-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![PostgreSQL pgvector](https://img.shields.io/badge/PostgreSQL-16_+_pgvector-336791?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![BullMQ + Redis](https://img.shields.io/badge/BullMQ-Redis_Distributed-DC382D?logo=redis&logoColor=white)](https://docs.bullmq.io/)
[![React + Vite](https://img.shields.io/badge/React-Vite_SOC_UI-61DAFB?logo=react&logoColor=black)](https://vitejs.dev/)
[![Docker](https://img.shields.io/badge/Docker-Multi_Service-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Render_Cloud-10B981?logo=render&logoColor=white)](https://phishtank-ns-api.onrender.com)

**PhishTank-NS** is a horizontally scalable, polyglot **Neuro-Symbolic Email Defense Platform** built for real-time phishing, Business Email Compromise (BEC), and adversarial email attack mitigation, accompanied by a reproducible benchmark suite and an **IEEEtran research paper** ([paper/main.tex](paper/main.tex)).

### 🌐 Live Cloud Deployment
- **SOC Dashboard & API**: https://phishtank-ns-api.onrender.com
- **Mock Webmail Test Page**: https://phishtank-ns-api.onrender.com/mock-webmail.html
- **Python ML Engine Swagger Docs**: https://phishtank-ns-ml.onrender.com/docs
*(Note: Hosted on Render free tier — the first request after inactivity may take ~30–50s to wake up.)*

---

## 🧠 Core Research & Engineering Innovations

1. **Visibility-Aware Adversarial De-obfuscation (`services/ml-engine/app/deobfuscator.py`)**
   - Strips CSS-hidden decoy nodes (`display:none`, `visibility:hidden`, `opacity:0`, `font-size:0`, off-screen elements) before neural inference while turning the stripped artifacts into an explicit `obfuscation_ratio` signal.
   - Normalizes zero-width characters and Unicode **UTS #39** homoglyphs (Cyrillic/Greek confusables) and flags embedded **LLM prompt-injection** payloads.

2. **Dempster-Shafer Neuro-Symbolic Evidence Fusion (`services/ml-engine/app/dempster_shafer.py`)**
   - Models each symbolic and neural detector as an independent Basic Probability Assignment (BPA) over $\Theta = \{\text{Malicious}, \text{Benign}\}$.
   - Outputs calibrated risk intervals $[\text{Bel}(M), \text{Pl}(M)]$, **epistemic uncertainty** $m(\Theta)$, and **conflict coefficient $K$** (automatically flagging compromised-account BEC where `spf=pass, dkim=pass` conflicts with malicious semantic intent or IOCs).

3. **Heterogeneous Threat Provenance Graph & `pgvector` Campaign Clustering (`src/graph.ts`, `src/db.ts`)**
   - Generates 384-d L2-normalized semantic embeddings indexed with `pgvector` HNSW to cluster polymorphic phishing waves in $O(\log N)$ time.
   - Persists 2-hop provenance graphs (`email` ↔ `sender_domain` ↔ `reply_to` ↔ `url_domain` ↔ `attachment_hash` ↔ `campaign`).

4. **Cloud-Native Distributed Architecture**
   - **Stateless API Gateway (`src/server.ts`)**: Express + Multer disk streaming, rate limiting, optional `x-api-key` multi-tenancy, Prometheus `/metrics`, and live SSE (`/api/v1/stream`).
   - **Distributed Worker Pool (`src/queue.ts`, `src/worker.ts`)**: BullMQ + Redis with exponential-backoff retries (falls back cleanly to SQLite WAL + in-memory queue locally when `DATABASE_URL` / `REDIS_URL` are unset).
   - **React + Vite SOC Dashboard (`frontend/`)**: Interactive SVG Threat Provenance Graph, Dempster-Shafer uncertainty interval bar, and neutralized hidden-CSS inspector.

---

## 📊 Measured Benchmark & Load-Test Results

### Held-Out HuggingFace Evaluation (`zefang-liu/phishing-email-dataset`, $N=2{,}000$ unseen emails, $14{,}474$ train)
| Configuration | Accuracy | Precision | Recall | F1-Score | ROC-AUC | ECE |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Neural-Only (Clean) | 98.70% | 98.00% | 98.74% | 98.37% | 99.89% | 0.0486 |
| PhishTank-NS (Clean) | 98.50% | 97.51% | 98.74% | 98.12% | 99.83% | 0.1380 |
| Neural-Only (Adversarial Stress) | 96.25% | 97.87% | 92.56% | 95.14% | 99.53% | 0.0810 |
| **PhishTank-NS (Adversarial Stress)** | **98.95%** | **97.54%** | **99.87%** | **98.69%** | **99.99%** | **0.0733** |

### Concurrent HTTP Load Test (`node benchmarks/load_test.mjs 150 20`)
- **Throughput**: `443.12 req/sec` (`0` errors)
- **Latency**: `p50 = 21.71 ms` | `p95 = 171.04 ms` | `p99 = 188.00 ms`

---

## 🚀 Quick Start (Local Development)

```bash
# 1. Install Node dependencies & build backend + React SOC dashboard
npm install
npm run build
cd frontend && npm install && npm run build && cd ..

# 2. Start Python ML Engine (port 8000)
cd services/ml-engine
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3. In a second terminal, start Node.js API & SOC Dashboard (port 3000)
npm start
```

Open **https://phishtank-ns-api.onrender.com** (or `http://localhost:3000` locally) and click **"Scan Custom Email"** or upload `.eml` files from `test-samples/`.

---

## 🐳 Production & Cloud Deployment

- **Docker Compose** (PostgreSQL 16 + `pgvector`, Redis, ML Engine, API, 2x BullMQ Workers, Prometheus):
  ```bash
  docker compose up -d --build
  ```
- **Render Cloud PaaS**: Connect your GitHub repository using `render.yaml` for managed PostgreSQL + Redis + Docker web services over HTTPS.

---

## 🧪 Tests, Benchmarks & Research Paper

```bash
# Backend integration tests (Vitest)
npm test

# Python ML & Dempster-Shafer unit tests
cd services/ml-engine && pytest -v

# Reproducible ablation & HuggingFace benchmarks + IEEE figures
python benchmarks/run_eval.py
python benchmarks/train_and_eval_hf.py
python benchmarks/plot_results.py
```

The full two-column IEEE manuscript and BibTeX references are in `paper/main.tex` and `paper/references.bib`, with generated 300-DPI figures in `paper/figures/`.
