#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# AimoGate Automated Deployment Script (Google Cloud Run + Firebase Hosting)
# Project: junction26hel-7631
# Region: europe-north1
# ==============================================================================

PROJECT_ID="${PROJECT_ID:-junction26hel-7631}"
REGION="${REGION:-europe-north1}"
SERVICE_NAME="${SERVICE_NAME:-aimogate-api}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-flash-latest}"
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
VALIO_API_BASE_URL="${VALIO_API_BASE_URL:-https://junction26.valioaimo.fi}"
VALIO_API_KEY="${VALIO_API_KEY:-junct_tDnQn4VI_nfhELGCOEkY4vbuxm324MmYmILuokYG03Y}"

echo "============================================================"
echo "🚀 Starting Automated Deployment for AimoGate Procurement API"
echo "Project: $PROJECT_ID | Region: $REGION | Service: $SERVICE_NAME"
echo "============================================================"

# Check CLI dependencies
command -v gcloud >/dev/null 2>&1 || { echo "❌ gcloud CLI not found. Please install or run in Cloud Shell."; exit 1; }
command -v firebase >/dev/null 2>&1 || { echo "⚠️ firebase CLI not found. Attempting npx firebase..."; }

# Step 1: Run Pre-flight Verification Tests
echo ""
echo "🧪 [1/5] Running Pre-flight Verification Tests..."
DISABLE_REMOTE_LLM=true npx tsx src/lib/aimogate.test.ts
DISABLE_REMOTE_LLM=true npx tsx src/lib/rag.test.ts
npm run lint

# Step 2: Build Frontend SPA
echo ""
echo "📦 [2/5] Building Frontend Assets..."
npm run build

# Step 3: Deploy Backend to Cloud Run
echo ""
echo "☁️  [3/5] Deploying Cloud Run Service '$SERVICE_NAME'..."
gcloud run deploy "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --source=. \
  --region="$REGION" \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=$GEMINI_API_KEY,GEMINI_MODEL=${GEMINI_MODEL:-gemini-flash-latest},VALIO_API_BASE_URL=$VALIO_API_BASE_URL,VALIO_API_KEY=$VALIO_API_KEY"

# Retrieve Cloud Run Service URL
RUN_URL=$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" --format="value(status.url)")
echo "✅ Cloud Run deployed successfully: $RUN_URL"

# Step 4: Deploy Firebase Hosting (Option A with /api/** rewrite to Cloud Run)
echo ""
echo "🔥 [4/5] Deploying Firebase Hosting..."
if command -v firebase >/dev/null 2>&1; then
  firebase deploy --only hosting --project="$PROJECT_ID"
else
  npx firebase-tools deploy --only hosting --project="$PROJECT_ID"
fi

# Step 5: Post-deployment Health Check
echo ""
echo "🩺 [5/5] Performing Live Health & Catalog Status Check..."
sleep 2
STATUS_HTTP_CODE=$(curl -s -o /tmp/status_resp.json -w "%{http_code}" "$RUN_URL/api/v1/catalog/status" || echo "000")

if [ "$STATUS_HTTP_CODE" = "200" ]; then
  echo "✅ API responded HTTP 200 OK!"
  cat /tmp/status_resp.json | grep -o '"total_items":[0-9]*' || true
else
  echo "⚠️ Status endpoint returned HTTP $STATUS_HTTP_CODE (service may still be warming up)."
fi

echo ""
echo "============================================================"
echo "🎉 DEPLOYMENT COMPLETE!"
echo "Backend Cloud Run URL: $RUN_URL"
echo "Frontend Firebase URL: https://$PROJECT_ID.web.app"
echo "Catalog Status Check:  $RUN_URL/api/v1/catalog/status"
echo "============================================================"
