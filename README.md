# 🛡️ PhishTank — Autonomous Email Threat Analysis & Incident Response

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.0-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL_Mode-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Firefox Extension](https://img.shields.io/badge/Firefox_Extension-Manifest_V3-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/)

**PhishTank** is an enterprise-grade, full-stack email security and incident response application. It triages incoming emails, detects spear-phishing and business email compromise (BEC), and integrates directly into browser webmails (Gmail and Outlook Web) via a Manifest V3 extension.

---

## ✨ Features

- **Multi-Vector Heuristics Engine**:
  - 🛡️ **Executive & IT Impersonation Detection**: Catches VIP display names sent from free webmail accounts (`@gmail.com`, `@yahoo.com`, etc.).
  - 🔑 **Cryptographic Header Verification**: Analyzes SPF, DKIM, and DMARC alignment failures.
  - 🔗 **URL Typosquatting (Levenshtein Distance)**: Detects lookalike domains ($1 \le d \le 2$ edits) targeting high-value brands (`microsoft.com`, `google.com`, `paypal.com`).
  - 📎 **Dangerous Attachment Filter**: Blocks weaponized script droppers (`.vbs`, `.bat`, `.ps1`, `.exe`, `.scr`, `.iso`) and computes SHA-256 hashes.
  - ↩️ **Reply-To Mismatch Detection**: Identifies covert reply redirection to attacker infrastructure.
- **High-Performance Non-Blocking Architecture**:
  - 🌊 **Disk Buffering**: Raw emails stream directly to disk (`/uploads`) to eliminate RAM bloat.
  - ⚡ **$\mathcal{O}(1)$ Threat Deduplication**: Redis / In-memory TTL cache detects identical bulk phishing campaigns in **1ms**.
  - 🔄 **Asynchronous Worker Queue**: Responds immediately with `HTTP 202 Accepted` while worker pools analyze emails concurrently.
  - 🗄️ **SQLite WAL Persistence**: Concurrent database operations with `journal_mode = WAL`.
- **Browser Extension (Manifest V3)**:
  - Injects a **`🛡️ Scan with PhishTank`** button into Gmail and Outlook Web.
  - Automatically renders a color-coded security banner directly above the email body.
  - Dark-mode popup with 0–100 risk gauge and rule indicators.
- **SOC Web Dashboard**:
  - Drag-and-drop `.eml` upload with visual threat gauges.
  - Live incident history table with search and modal inspection.
  - Real-time queue and cache telemetry.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ installed
- npm or yarn

### 1. Installation
```bash
git clone https://github.com/your-org/phishtank.git
cd phishtank
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

### 3. Start the Server
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) to access the interactive SOC dashboard!

---

## 🧩 Firefox Browser Extension Setup

1. Open **Firefox** and navigate to:
   ```text
   about:debugging#/runtime/this-firefox
   ```
2. Click **"Load Temporary Add-on..."**.
3. Select `extension/manifest.json`.
4. Open [https://mail.google.com](https://mail.google.com) or [http://localhost:3000/mock-webmail.html](http://localhost:3000/mock-webmail.html) and click **"Scan Email with PhishTank"**.

### Package Extension for Store Submission
```bash
npm run package:extension
# Generates: dist/phishtank-extension.zip (Ready for Mozilla Add-on & Chrome Web Store submission)
```

---

## 🐳 Production Deployment with Docker

Run PhishTank with Redis clustering and volume persistence:

```bash
docker compose up -d --build
```

- **API & Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Redis Cache**: `localhost:6379`
- **Data Persistence**: Named volumes `sqlite_data` and `uploads_data`

---

## 📡 API Reference

### 1. Ingest Raw Email File
`POST /api/v1/analyze` (Multipart form-data, field `email` or `file`)
```json
// Returns HTTP 202 Accepted
{
  "success": true,
  "status": "PROCESSING",
  "id": "inc_1792917585076_6edf0503",
  "message": "Email enqueued for asynchronous threat evaluation"
}
```

### 2. Ingest Scraped Webmail DOM
`POST /api/v1/analyze-dom` (Application/json)
```json
{
  "senderName": "CEO Satya Nadella",
  "senderEmail": "ceo.office@gmail.com",
  "subject": "URGENT: Executive Wire Transfer",
  "urls": ["https://micros0ft.com/login"],
  "attachments": ["wire_order.vbs"]
}
```

### 3. Query Incident by ID
`GET /api/v1/incidents/:id`

### 4. Query Recent Incidents
`GET /api/v1/incidents?limit=20`

### 5. Telemetry & Metrics
`GET /api/v1/metrics`

---

## 🧪 Testing & Verification

```bash
# Seed database with realistic mock incidents
npm run seed

# Run TypeScript type check
npm run build
```

---

## 📄 License
ISC License © 2026 PhishTank Security
