# AimoGate — Autonomous B2B Procurement Governance for Valio Aimo

AimoGate is an autonomous procurement engine and Zero-Trust policy gateway built for hotel & restaurant kitchens ordering from **Valio Aimo** (Junction 2026 challenge).

It enables kitchen teams to request supplies in plain English, while an autonomous AI buyer agent evaluates price, unit economics, warehouse stock availability, and hotel-specific safety guardrails.

---

## Key Features

1. **RAG Catalog Intelligence (17,546 Valio Aimo SKUs)**:
   - Full-text search and semantic retrieval across all 17,546 official Valio Aimo products.
   - MariaDB fulltext index support with fallback to high-speed in-memory indexing.
   - Live upstream API sync with `https://junction26.valioaimo.fi`:
     - Real-time catalog price and comparison price per litre/kg (`POST /api/price`).
     - Real-time warehouse availability and order cut-off times (`POST /api/availability`).

2. **NVIDIA Nemotron 3.5 Super VL 120B Reasoning**:
   - Powered by **NVIDIA Nemotron-3.5-Super-VL** running on **DataCrunch B300** vLLM infrastructure.
   - Performs multi-step mathematical trade-off calculations (pack conversions, unit economics, inventory sufficiency, and dietary compliance).
   - Generates transparent chain-of-thought audit traces for every procurement proposal.

3. **Autonomous Governance & Policy Guardrails**:
   - **Spending Caps**: Auto-approves orders within budget (e.g. up to €1,000); flags excess for manager approval.
   - **Category Time Windows & Storage Caps**: Enforces rolling limits (e.g., maximum storage of 1,000L of milk/dairy per week).
   - **Category Rule Time Limits**: Temporary exemptions or limits (e.g. valid for 30 days) to prevent repeated manual approvals.
   - **Single-Restaurant Scoping**: Tailored for the specific restaurant tenant (`hotel_nordic_group`).
   - **Cryptographic Audit Trail**: Integrity-hashed audit log for every transaction and policy decision.

---

## Deployment: Option A (Firebase Hosting + Google Cloud Run)

This deployment architecture hosts the frontend on **Firebase Hosting** and the backend API container on **Google Cloud Run** in the same GCP/Firebase project (`junction26hel-7631`).

### Step 1: Deploy the Backend Container to Cloud Run

Deploy the container using the included [Dockerfile](./Dockerfile):

```bash
gcloud run deploy aimogate-api \
  --project=junction26hel-7631 \
  --source . \
  --region=europe-north1 \
  --allow-unauthenticated \
  --set-env-vars="DATACRUNCH_ENDPOINT=https://containers.datacrunch.io/nemotron-3-5-super-vl-b300/v1,DATACRUNCH_MODEL=nemotron-3.5-super-vl,VALIO_API_BASE_URL=https://junction26.valioaimo.fi"
```

### Step 2: Deploy Frontend & Rules to Firebase Hosting

[firebase.json](./firebase.json) is configured to automatically route `/api/**` traffic to the `aimogate-api` Cloud Run service in `europe-north1` while serving the Vite React single-page app from `dist/`:

```bash
# 1. Install dependencies & build Vite bundle
npm install
npm run build

# 2. Deploy to Firebase
firebase login
npm run deploy
```

Your application will be live at:
- **`https://junction26hel-7631.web.app`**
- **`https://junction26hel-7631.firebaseapp.com`**

---

## Local Development

```bash
# Install dependencies
npm install --legacy-peer-deps

# Run local development server (Express API + Vite frontend)
npm run dev

# Run unit tests (Policy Engine & RAG Pipeline)
DISABLE_REMOTE_LLM=true npx tsx src/lib/aimogate.test.ts
DISABLE_REMOTE_LLM=true npx tsx src/lib/rag.test.ts

# Production build test
npm run build
```

---

## Docker Compose (Self-Hosted Option)

To run both the application server and MariaDB container locally or on an external VM:

```bash
docker compose up -d --build

# Ingest all 17,546 Valio Aimo products into MariaDB
docker compose exec aimogate-app npx tsx scripts/ingest_catalog_mariadb.ts
```
